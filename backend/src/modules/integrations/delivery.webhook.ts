import { RestaurantModel } from '../../models/Restaurant';
import { getAdapter, ingestDeliveryOrder } from '../../integrations/delivery';

export interface DeliveryWebhookResult {
  ok: boolean;
  status: number;
  message: string;
  orderId?: string;
  orderNumber?: string;
  duplicate?: boolean;
}

async function resolveRestaurantId(explicit?: string, payload?: Record<string, unknown>) {
  if (explicit) return explicit;
  const fromPayload = (payload?.restaurant_id ?? payload?.restaurantId) as string | undefined;
  if (fromPayload) return fromPayload;
  const count = await RestaurantModel.countDocuments({});
  if (count === 1) {
    const only = await RestaurantModel.findOne().select('_id').lean();
    return only ? String(only._id) : undefined;
  }
  return undefined;
}

export async function handleDeliveryWebhook(opts: {
  provider: string;
  rawBody: string;
  signature?: string;
  restaurantId?: string;
}): Promise<DeliveryWebhookResult> {
  const adapter = getAdapter(opts.provider);
  if (!adapter) {
    return { ok: false, status: 404, message: `Unknown delivery provider "${opts.provider}"` };
  }

  if (!adapter.verifyWebhook(opts.rawBody, opts.signature)) {
    return { ok: false, status: 401, message: `${adapter.label} signature verification failed` };
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(opts.rawBody) as Record<string, unknown>;
  } catch {
    return { ok: false, status: 400, message: 'Webhook body is not valid JSON' };
  }

  const normalized = adapter.parseWebhook(payload);
  if (!normalized || !normalized.items?.length) {
    return { ok: false, status: 400, message: 'Webhook payload has no usable order items' };
  }

  const restaurantId = await resolveRestaurantId(opts.restaurantId, payload);
  if (!restaurantId) {
    return {
      ok: false,
      status: 400,
      message: 'Cannot resolve the restaurant for this webhook — pass ?rid=<restaurantId> in the webhook URL',
    };
  }

  const restaurant = await RestaurantModel.findById(restaurantId).lean();
  if (!restaurant) {
    return { ok: false, status: 404, message: 'Restaurant not found for this webhook' };
  }

  const result = await ingestDeliveryOrder(restaurantId, normalized, {
    autoAccept: Boolean(restaurant.settings?.autoAcceptOrders),
  });

  if (result.duplicate) {
    return {
      ok: true,
      status: 200,
      message: 'Order already ingested',
      orderId: String(result.order._id),
      orderNumber: result.order.orderNumber,
      duplicate: true,
    };
  }

  return {
    ok: true,
    status: 201,
    message: `${adapter.label} order ${result.order.orderNumber} ingested`,
    orderId: String(result.order._id),
    orderNumber: result.order.orderNumber,
    duplicate: false,
  };
}
