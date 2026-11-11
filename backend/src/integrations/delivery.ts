import { env } from '../config/env';
import { hmacHex } from '../utils/tokens';
import { createOrder } from '../services/order.service';
import { OrderModel } from '../models';
import type { OrderSource, OrderStatus } from '../types/constants';

export type DeliveryProvider = Extract<OrderSource, 'SWIGGY' | 'ZOMATO' | 'WEBSITE'>;

export interface NormalizedDeliveryItem {
  name: string;
  price: number;
  qty: number;
  notes?: string;
}

export interface NormalizedDeliveryOrder {
  provider: DeliveryProvider;
  externalOrderId: string;
  customerName: string;
  customerPhone: string;
  customerAddress?: string;
  customerCity?: string;
  items: NormalizedDeliveryItem[];
  notes?: string;
  placedAt?: Date;
  paymentState: 'PAID' | 'UNPAID';
  raw?: Record<string, unknown>;
}

export interface DeliveryAdapter {
  provider: DeliveryProvider;
  label: string;
  signatureHeader: string;
  webhookSecret: string | null;
  /** Signature is mandatory whenever a webhook secret is configured. */
  verifyWebhook(rawBody: string, signature: string | undefined): boolean;
  parseWebhook(payload: unknown): NormalizedDeliveryOrder | null;
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function pick<T = unknown>(source: Record<string, unknown>, keys: string[]): T | undefined {
  for (const key of keys) {
    if (source[key] !== undefined && source[key] !== null) return source[key] as T;
  }
  return undefined;
}

/** Partner webhooks arrive either flat or wrapped in `order`, `data` or `payload`. */
function unwrap(payload: unknown): Record<string, unknown> {
  const body = (payload ?? {}) as Record<string, unknown>;
  const nested = body.order ?? body.data ?? body.payload;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return { ...body, ...(nested as Record<string, unknown>) };
  }
  return body;
}

function normalizeItems(raw: unknown, priceKeys: string[], qtyKeys: string[], nameKeys: string[]): NormalizedDeliveryItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map<NormalizedDeliveryItem | null>((entry) => {
      const item = (entry ?? {}) as Record<string, unknown>;
      const name = String(pick(item, nameKeys) ?? '').trim();
      const price = num(pick(item, priceKeys));
      const qty = Math.max(1, Math.round(num(pick(item, qtyKeys), 1)));
      if (!name || price <= 0) return null;
      return { name, price, qty, notes: String(pick(item, ['notes', 'instructions', 'special_instructions']) ?? '') };
    })
    .filter((item): item is NormalizedDeliveryItem => item !== null);
}

function verifyWithSecret(secret: string | null, rawBody: string, signature: string | undefined): boolean {
  if (!secret) return false;
  if (!signature) return false;
  return hmacHex(secret, rawBody) === signature;
}

const swiggyAdapter: DeliveryAdapter = {
  provider: 'SWIGGY',
  label: 'Swiggy',
  signatureHeader: 'x-swiggy-signature',
  webhookSecret: env.SWIGGY_WEBHOOK_SECRET,
  verifyWebhook: (rawBody, signature) => verifyWithSecret(env.SWIGGY_WEBHOOK_SECRET, rawBody, signature),
  parseWebhook(payload) {
    const body = unwrap(payload);
    const customer = (pick(body, ['customer', 'customer_details']) ?? {}) as Record<string, unknown>;
    const items = normalizeItems(
      pick(body, ['items', 'order_items', 'cart']),
      ['price', 'unit_price', 'item_price'],
      ['quantity', 'qty', 'count'],
      ['name', 'item_name', 'title'],
    );
    const externalOrderId = String(pick(body, ['order_id', 'orderId', 'id']) ?? '');
    if (!externalOrderId || !items.length) return null;
    const paymentStatus = String(pick(body, ['payment_status', 'paymentStatus', 'payment.state']) ?? '').toUpperCase();
    return {
      provider: 'SWIGGY',
      externalOrderId,
      customerName: String(pick(customer, ['name', 'customer_name']) ?? pick(body, ['customer_name']) ?? 'Swiggy customer'),
      customerPhone: String(pick(customer, ['phone', 'contact_number']) ?? ''),
      customerAddress: String(pick(customer, ['address', 'address_line']) ?? pick(body, ['delivery_address']) ?? ''),
      customerCity: String(pick(customer, ['city']) ?? pick(body, ['city']) ?? ''),
      items,
      notes: String(pick(body, ['instructions', 'notes', 'delivery_instructions']) ?? ''),
      placedAt: new Date(),
      paymentState: paymentStatus.includes('PAID') ? 'PAID' : 'UNPAID',
      raw: body,
    };
  },
};

const zomatoAdapter: DeliveryAdapter = {
  provider: 'ZOMATO',
  label: 'Zomato',
  signatureHeader: 'x-zomato-signature',
  webhookSecret: env.ZOMATO_WEBHOOK_SECRET,
  verifyWebhook: (rawBody, signature) => verifyWithSecret(env.ZOMATO_WEBHOOK_SECRET, rawBody, signature),
  parseWebhook(payload) {
    const body = unwrap(payload);
    const customer = (pick(body, ['customer', 'customer_details', 'user']) ?? {}) as Record<string, unknown>;
    const items = normalizeItems(
      pick(body, ['products', 'items', 'order_items']),
      ['price', 'unit_price', 'amount'],
      ['quantity', 'qty'],
      ['name', 'product_name', 'item_name'],
    );
    const externalOrderId = String(pick(body, ['orderId', 'order_id', 'id']) ?? '');
    if (!externalOrderId || !items.length) return null;
    const paymentStatus = String(pick(body, ['payment_status', 'paymentStatus']) ?? '').toUpperCase();
    return {
      provider: 'ZOMATO',
      externalOrderId,
      customerName: String(pick(customer, ['name', 'customer_name']) ?? 'Zomato customer'),
      customerPhone: String(pick(customer, ['phone', 'contact']) ?? ''),
      customerAddress: String(pick(customer, ['address', 'delivery_address']) ?? pick(body, ['delivery_address', 'address']) ?? ''),
      customerCity: String(pick(customer, ['city']) ?? pick(body, ['city']) ?? ''),
      items,
      notes: String(pick(body, ['instructions', 'notes', 'delivery_note']) ?? ''),
      placedAt: new Date(),
      paymentState: paymentStatus.includes('PAID') ? 'PAID' : 'UNPAID',
      raw: body,
    };
  },
};

const websiteAdapter: DeliveryAdapter = {
  provider: 'WEBSITE',
  label: 'Website',
  signatureHeader: 'x-website-signature',
  webhookSecret: env.WEBSITE_WEBHOOK_SECRET,
  verifyWebhook: (rawBody, signature) => verifyWithSecret(env.WEBSITE_WEBHOOK_SECRET, rawBody, signature),
  parseWebhook(payload) {
    const body = unwrap(payload);
    const customer = (pick(body, ['customer', 'customer_details']) ?? {}) as Record<string, unknown>;
    const items = normalizeItems(
      pick(body, ['items', 'line_items', 'products']),
      ['price', 'unitPrice', 'unit_price', 'amount'],
      ['qty', 'quantity'],
      ['name', 'productName', 'product_name'],
    );
    const externalOrderId = String(pick(body, ['orderId', 'order_id', 'reference', 'id']) ?? '');
    if (!externalOrderId || !items.length) return null;
    return {
      provider: 'WEBSITE',
      externalOrderId,
      customerName: String(
        pick(customer, ['name', 'customer_name']) ?? pick(body, ['customerName', 'customer_name', 'name']) ?? 'Online customer',
      ),
      customerPhone: String(
        pick(customer, ['phone', 'contact_number']) ?? pick(body, ['customerPhone', 'customer_phone', 'phone']) ?? '',
      ),
      customerAddress: String(
        pick(customer, ['address', 'line1']) ?? pick(body, ['address', 'customerAddress', 'customer_address', 'delivery_address']) ?? '',
      ),
      customerCity: String(
        pick(customer, ['city']) ?? pick(body, ['city', 'customerCity', 'customer_city']) ?? '',
      ),
      items,
      notes: String(pick(body, ['notes', 'instructions']) ?? ''),
      placedAt: new Date(),
      paymentState: 'UNPAID',
      raw: body,
    };
  },
};

const ADAPTERS: Record<DeliveryProvider, DeliveryAdapter> = {
  SWIGGY: swiggyAdapter,
  ZOMATO: zomatoAdapter,
  WEBSITE: websiteAdapter,
};

export function getAdapter(provider: string): DeliveryAdapter | null {
  return ADAPTERS[provider?.toUpperCase() as DeliveryProvider] ?? null;
}

export function listAdapters(): { provider: DeliveryProvider; label: string; configured: boolean }[] {
  return Object.values(ADAPTERS).map((adapter) => ({
    provider: adapter.provider,
    label: adapter.label,
    configured: Boolean(adapter.webhookSecret),
  }));
}

const pushedStatuses: OrderStatus[] = ['ACCEPTED', 'PREPARING', 'READY', 'COMPLETED', 'CANCELLED'];
const STATUS_TEXT: Partial<Record<OrderStatus, string>> = {
  ACCEPTED: 'ACCEPTED',
  PREPARING: 'PREPARING',
  READY: 'READY_FOR_PICKUP',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

export interface StatusPushResult {
  pushed: boolean;
  detail: string;
}

/**
 * Outbound status push to a delivery partner. Only runs when partner API
 * credentials are configured — otherwise the sync is recorded and skipped.
 */
export async function pushOrderStatus(order: {
  source: OrderSource;
  externalOrderId?: string | null;
  orderNumber: string;
  status: OrderStatus;
}): Promise<StatusPushResult> {
  const adapter = getAdapter(order.source);
  if (!adapter) return { pushed: false, detail: 'No partner adapter for this channel' };
  if (!order.externalOrderId) return { pushed: false, detail: 'Order has no partner reference' };
  if (!pushedStatuses.includes(order.status)) return { pushed: false, detail: 'Status is not synced to partners' };

  const base = adapter.provider === 'SWIGGY' ? env.SWIGGY_API_BASE : env.ZOMATO_API_BASE;
  const key = adapter.provider === 'SWIGGY' ? env.SWIGGY_API_KEY : env.ZOMATO_API_KEY;
  if (!base || !key) {
    return { pushed: false, detail: `${adapter.label} partner API credentials not configured` };
  }

  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/orders/${encodeURIComponent(order.externalOrderId)}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        order_id: order.externalOrderId,
        status: STATUS_TEXT[order.status],
        restaurant_order_number: order.orderNumber,
      }),
    });
    if (!res.ok) return { pushed: false, detail: `${adapter.label} responded ${res.status}` };
    return { pushed: true, detail: `Synced to ${adapter.label}` };
  } catch (err) {
    return { pushed: false, detail: err instanceof Error ? err.message : 'Partner push failed' };
  }
}

export async function ingestDeliveryOrder(
  restaurantId: string,
  normalized: NormalizedDeliveryOrder,
  opts: { autoAccept?: boolean } = {},
) {
  const existing = normalized.externalOrderId
    ? await OrderModel.findOne({
        restaurantId,
        source: normalized.provider,
        externalOrderId: normalized.externalOrderId,
      }).lean()
    : null;
  if (existing) {
    return { order: existing, duplicate: true };
  }

  const order = await createOrder({
    restaurantId,
    source: normalized.provider,
    customerName: normalized.customerName,
    customerPhone: normalized.customerPhone,
    customerAddress: normalized.customerAddress ?? '',
    customerCity: normalized.customerCity ?? '',
    notes: normalized.notes ?? '',
    externalItems: normalized.items,
    externalOrderId: normalized.externalOrderId,
    integrationMeta: { channel: 'partner-webhook', paymentState: normalized.paymentState, ingestedAt: new Date().toISOString() },
    placedAt: normalized.placedAt ?? new Date(),
    status: opts.autoAccept ? 'ACCEPTED' : undefined,
  });
  return { order, duplicate: false };
}
