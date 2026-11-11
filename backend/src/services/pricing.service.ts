import { Types } from 'mongoose';
import { AddonModel, ProductModel } from '../models';
import { round2 } from '../utils/money';
import { ApiError } from '../utils/httpError';
import type { Station } from '../types/constants';

export interface IncomingItem {
  productId: string;
  qty: number;
  addonIds?: string[];
  notes?: string;
}

export interface PricedAddon {
  addonId: Types.ObjectId | null;
  name: string;
  price: number;
}

export interface PricedLine {
  productId: Types.ObjectId | null;
  name: string;
  price: number;
  qty: number;
  taxPercent: number;
  station: Station;
  isVeg: boolean;
  addons: PricedAddon[];
  notes: string;
  lineTotal: number;
}

export interface DiscountInput {
  type: 'PERCENT' | 'FLAT';
  value: number;
  note?: string;
}

export interface Totals {
  subtotal: number;
  taxTotal: number;
  serviceCharge: number;
  discountAmount: number;
  grandTotal: number;
  taxBreakup: { label: string; percent: number; amount: number }[];
}

export interface PriceResult extends Totals {
  items: PricedLine[];
}

export function lineTotalOf(line: Pick<PricedLine, 'price' | 'qty' | 'addons'>): number {
  const addonSum = line.addons.reduce((sum, a) => sum + a.price, 0);
  return round2((line.price + addonSum) * line.qty);
}

export function discountAmountOf(subtotal: number, discount?: DiscountInput): number {
  if (!discount || discount.value <= 0) return 0;
  if (discount.type === 'PERCENT') {
    if (discount.value > 100) throw ApiError.badRequest('Discount cannot exceed 100%');
    return round2((subtotal * discount.value) / 100);
  }
  if (discount.value > subtotal) throw ApiError.badRequest('Discount cannot be more than the bill subtotal');
  return round2(discount.value);
}

/**
 * Totals are always derived on the server. Menu prices are pre-tax; a discount
 * reduces each tax bucket proportionally, service charge applies after discount.
 */
export function computeTotals(opts: {
  lines: PricedLine[];
  discount?: DiscountInput;
  serviceChargePercent: number;
}): Totals {
  const { lines, discount, serviceChargePercent } = opts;
  const subtotal = round2(lines.reduce((sum, line) => sum + line.lineTotal, 0));
  const discountAmount = discountAmountOf(subtotal, discount);
  const netSubtotal = round2(subtotal - discountAmount);
  const serviceCharge = round2((netSubtotal * serviceChargePercent) / 100);

  const buckets = new Map<number, number>();
  for (const line of lines) {
    buckets.set(line.taxPercent, round2((buckets.get(line.taxPercent) ?? 0) + line.lineTotal));
  }

  const taxBreakup: Totals['taxBreakup'] = [];
  let taxTotal = 0;
  const ratio = subtotal > 0 ? netSubtotal / subtotal : 0;

  for (const [percent, bucketTotal] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    const taxable = round2(bucketTotal * ratio);
    const tax = round2((taxable * percent) / 100);
    taxTotal = round2(taxTotal + tax);
    if (tax > 0) {
      const half = round2(tax / 2);
      taxBreakup.push({ label: 'CGST', percent: round2(percent / 2), amount: half });
      taxBreakup.push({ label: 'SGST', percent: round2(percent / 2), amount: round2(tax - half) });
    }
  }

  const grandTotal = round2(netSubtotal + serviceCharge + taxTotal);
  return { subtotal, taxTotal, serviceCharge, discountAmount, grandTotal, taxBreakup };
}

/** Rebuilds menu lines from the database — client prices are never trusted. */
export async function priceOrderItems(opts: {
  restaurantId: string;
  items: IncomingItem[];
  discount?: DiscountInput;
  serviceChargePercent: number;
  defaultTaxPercent: number;
}): Promise<PriceResult> {
  const { restaurantId, items, discount, serviceChargePercent, defaultTaxPercent } = opts;
  if (!items.length) throw ApiError.badRequest('An order needs at least one item');
  for (const item of items) {
    if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > 99) {
      throw ApiError.badRequest('Item quantity must be between 1 and 99');
    }
  }

  const productIds = [...new Set(items.map((i) => i.productId))];
  const addonIds = [...new Set(items.flatMap((i) => i.addonIds ?? []))];

  const [products, addons] = await Promise.all([
    ProductModel.find({ _id: { $in: productIds }, restaurantId }).lean(),
    addonIds.length ? AddonModel.find({ _id: { $in: addonIds }, restaurantId }).lean() : Promise.resolve([]),
  ]);

  const productById = new Map(products.map((p) => [String(p._id), p]));
  const addonById = new Map(addons.map((a) => [String(a._id), a]));

  const lines: PricedLine[] = items.map((item) => {
    const product = productById.get(item.productId);
    if (!product) throw ApiError.badRequest('One of the items is no longer on the menu');
    if (!product.isActive) throw ApiError.badRequest(`"${product.name}" is currently unavailable`);

    const lineAddons: PricedAddon[] = (item.addonIds ?? []).map((id) => {
      const addon = addonById.get(id);
      if (!addon || !addon.isActive) throw ApiError.badRequest('One of the add-ons is unavailable');
      return { addonId: addon._id, name: addon.name, price: addon.price };
    });

    const line: PricedLine = {
      productId: product._id,
      name: product.name,
      price: product.price,
      qty: item.qty,
      taxPercent: product.taxPercent ?? defaultTaxPercent,
      station: product.station as Station,
      isVeg: product.isVeg,
      addons: lineAddons,
      notes: (item.notes ?? '').slice(0, 240),
      lineTotal: 0,
    };
    line.lineTotal = lineTotalOf(line);
    return line;
  });

  const totals = computeTotals({ lines, discount, serviceChargePercent });
  return { items: lines, ...totals };
}

/** Lines that already carry their own price (verified delivery-platform payloads). */
export function externalLines(
  items: { name: string; price: number; qty: number; notes?: string }[],
  taxPercent: number,
): PricedLine[] {
  return items.map((item) => {
    const line: PricedLine = {
      productId: null,
      name: item.name,
      price: item.price,
      qty: item.qty,
      taxPercent,
      station: 'MAIN',
      isVeg: true,
      addons: [],
      notes: item.notes ?? '',
      lineTotal: 0,
    };
    line.lineTotal = lineTotalOf(line);
    return line;
  });
}
