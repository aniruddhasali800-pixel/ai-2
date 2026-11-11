import { buildUpiUri } from './upi';
import { qrDataUrl } from './qr';
import { maskVpa } from '../crypto';
import type { PaymentProviderAdapter } from './types';

/**
 * Direct UPI to the merchant's own VPA: no gateway, no keys, and nothing to verify against.
 * `canSettle = false` is the whole point — a transfer claim only becomes PAID through a human
 * who can see the money in their bank statement.
 */
export const upiDirectAdapter: PaymentProviderAdapter = {
  id: 'UPI_DIRECT',
  label: 'Direct UPI to the restaurant',
  canSettle: false,

  async create({ amountPaise, vpa, payeeName, note, transactionRef }) {
    const uri = buildUpiUri({ vpa, payeeName, amountPaise, note, transactionRef });
    return {
      upiUri: uri,
      qrDataUrl: await qrDataUrl(uri),
      payeeVpaMasked: maskVpa(vpa),
      payeeName,
      amountPaise,
    };
  },

  // There is no API that says "this UPI transfer arrived", so we never pretend to ask one.
  async queryStatus() {
    return null;
  },
};
