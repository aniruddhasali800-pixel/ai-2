import QRCode from 'qrcode';
import { RestaurantModel } from '../models';

export interface UpiCharge {
  /** upi:// deep link — the amount is baked in so nobody has to type it. */
  link: string;
  qrDataUrl: string;
  upiId: string;
  payeeName: string;
  amount: number;
  /** Bill reference sent as the UPI transaction note. */
  note: string;
}

/**
 * Builds the scan-to-pay charge for one bill. Returns null when the restaurant has
 * not configured a UPI handle, so the counter falls back to cash / card.
 */
export async function upiChargeFor(
  restaurantId: string,
  amount: number,
  note: string,
): Promise<UpiCharge | null> {
  const restaurant = await RestaurantModel.findById(restaurantId).lean();
  const upiId = restaurant?.payment?.upiId?.trim();
  if (!upiId || amount <= 0) return null;

  const payeeName = restaurant?.payment?.upiName?.trim() || restaurant?.name || 'Merchant';
  // '@' is legal raw in a query string and several UPI apps only split on literal text,
  // so encode the values but keep the handle readable.
  const query = [
    ['pa', upiId],
    ['pn', payeeName],
    ['am', amount.toFixed(2)],
    ['cu', 'INR'],
    ['tn', note.slice(0, 60)],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value).replace(/%40/g, '@')}`)
    .join('&');
  const link = `upi://pay?${query}`;
  const qrDataUrl = await QRCode.toDataURL(link, { margin: 1, width: 320, errorCorrectionLevel: 'M' });

  return { link, qrDataUrl, upiId, payeeName, amount, note: note.slice(0, 60) };
}
