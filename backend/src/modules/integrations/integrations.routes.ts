import { Router, raw } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { validate } from '../../middleware/validate';
import { ApiError } from '../../utils/httpError';
import { env } from '../../config/env';
import { hmacHex } from '../../utils/tokens';
import { OrderModel } from '../../models/Order';
import { DELIVERY_SOURCES } from '../../types/constants';
import { getAdapter, listAdapters, pushOrderStatus } from '../../integrations/delivery';
import { handleDeliveryWebhook } from './delivery.webhook';

export const integrationsRouter = Router();

integrationsRouter.use(requireAuth);

integrationsRouter.get('/', requirePermission('integrations:write'), (req, res) => {
  const restaurantId = req.auth!.restaurantId;
  const adapters = listAdapters().map((adapter) => ({
    ...adapter,
    webhookUrl: `${env.PUBLIC_BASE_URL}/api/integrations/webhook/${adapter.provider.toLowerCase()}?rid=${restaurantId}`,
    signatureHeader: getAdapter(adapter.provider)?.signatureHeader ?? 'x-signature',
    docsHint:
      adapter.provider === 'SWIGGY'
        ? 'Sign the raw webhook body with HMAC-SHA256 using the Swiggy partner secret.'
        : adapter.provider === 'ZOMATO'
          ? 'Sign the raw webhook body with HMAC-SHA256 using the Zomato partner secret.'
          : 'Sign the raw webhook body with HMAC-SHA256 using the website checkout secret.',
  }));
  res.json({ adapters, restaurantId });
});

integrationsRouter.get('/orders', requirePermission('orders:read'), async (req, res) => {
  const query: Record<string, unknown> = {
    restaurantId: req.auth!.restaurantId,
    source: { $in: DELIVERY_SOURCES },
  };
  if (typeof req.query.source === 'string' && req.query.source) {
    query.source = req.query.source;
  }
  if (typeof req.query.status === 'string' && req.query.status) {
    query.status = req.query.status;
  }
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 40));

  const [data, total] = await Promise.all([
    OrderModel.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    OrderModel.countDocuments(query),
  ]);
  res.json({ data, total, page, limit });
});

integrationsRouter.post(
  '/push/:orderId',
  requirePermission('integrations:write'),
  async (req, res) => {
    const order = await OrderModel.findOne({
      _id: req.params.orderId,
      restaurantId: req.auth!.restaurantId,
    }).lean();
    if (!order) throw ApiError.notFound('Order not found');
    if (!DELIVERY_SOURCES.includes(order.source as (typeof DELIVERY_SOURCES)[number])) {
      throw ApiError.badRequest('Only delivery partner orders can be pushed to an external API');
    }
    const result = await pushOrderStatus({
      source: order.source,
      externalOrderId: order.externalOrderId ?? undefined,
      orderNumber: order.orderNumber,
      status: order.status,
    });
    res.json(result);
  },
);

const simulateSchema = z
  .object({
    autoAccept: z.boolean().optional(),
    externalOrderId: z.string().trim().min(1).max(64).optional(),
  })
  .default({});

function samplePayload(
  provider: string,
  externalOrderId: string,
): Record<string, unknown> {
  const customer = {
    name: 'Ritika Sharma',
    phone: '9812345670',
    address: 'Flat 1203, Sundarahar Towers, Baner Road',
    city: 'Pune',
  };
  const items = [
    { name: 'Butter Chicken', price: 340, quantity: 1, notes: 'Less spicy' },
    { name: 'Garlic Naan', price: 60, quantity: 3 },
    { name: 'Jeera Rice', price: 180, quantity: 1 },
  ];
  if (provider === 'ZOMATO') {
    return {
      event: 'order.placed',
      order: {
        id: externalOrderId,
        restaurant_id: 'demo',
        customer,
        items: items.map((item) => ({
          name: item.name,
          price: item.price,
          qty: item.quantity,
          special_instructions: item.notes ?? '',
        })),
        payment_status: 'paid',
        created_at: new Date().toISOString(),
      },
    };
  }
  if (provider === 'WEBSITE') {
    return {
      event: 'checkout.completed',
      data: {
        reference: externalOrderId,
        customer,
        line_items: items,
        payment: { status: 'captured', method: 'UPI' },
        placed_at: new Date().toISOString(),
      },
    };
  }
  return {
    event: 'order_placed',
    order: {
      order_id: externalOrderId,
      customer,
      items,
      instructions: 'Ring the bell twice',
      payment_status: 'PAID',
      placed_at: new Date().toISOString(),
    },
  };
}

integrationsRouter.post(
  '/simulate/:provider',
  requirePermission('integrations:write'),
  validate({ body: simulateSchema }),
  async (req, res) => {
    const provider = req.params.provider.toUpperCase();
    const adapter = getAdapter(provider);
    if (!adapter) throw ApiError.notFound(`Unknown delivery provider "${provider}"`);

    const externalOrderId =
      req.body.externalOrderId ?? `${provider.slice(0, 2)}-${Date.now().toString(36).toUpperCase()}`;
    const payload = samplePayload(provider, externalOrderId);
    const rawBody = JSON.stringify(payload);
    const signature = hmacHex(adapter.webhookSecret ?? '', rawBody);

    const result = await handleDeliveryWebhook({
      provider,
      rawBody,
      signature,
      restaurantId: req.auth!.restaurantId,
    });

    if (!result.ok) throw new ApiError(result.status, result.message);

    if (req.body.autoAccept) {
      await OrderModel.updateOne(
        { _id: result.orderId, restaurantId: req.auth!.restaurantId },
        { $set: { status: 'ACCEPTED', acceptedAt: new Date() } },
      );
    }
    res.status(201).json(result);
  },
);

export const deliveryWebhookRouter = Router();

// Raw body is required to verify the partner HMAC signature.
deliveryWebhookRouter.post(
  '/:provider',
  raw({ type: () => true, limit: '1mb' }),
  async (req, res) => {
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString('utf8')
      : typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body ?? {});
    const header = getAdapter(req.params.provider)?.signatureHeader ?? 'x-signature';
    const signature =
      (req.header(header) as string | undefined) ??
      (req.header('x-signature') as string | undefined) ??
      (req.header('x-hub-signature-256') as string | undefined);

    const rid = typeof req.query.rid === 'string' ? req.query.rid : undefined;

    const result = await handleDeliveryWebhook({
      provider: req.params.provider,
      rawBody,
      signature,
      restaurantId: rid,
    });
    res.status(result.status).json({ ok: result.ok, message: result.message, duplicate: result.duplicate });
  },
);
