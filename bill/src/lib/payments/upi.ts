import { rupeeString } from '../money';

const VPA = /^[a-zA-Z0-9][a-zA-Z0-9._-]{2,255}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

export interface UpiUriInput {
  vpa: string;
  payeeName: string;
  amountPaise: number;
  /** Shown in the payer's app as the transaction note. */
  note: string;
  /** Sent as `tr` so a bank statement line can be matched back to this bill. */
  transactionRef: string;
}

export class UpiUriError extends Error {}

/**
 * Free text becomes display text inside a URI that a third-party UPI app re-parses, so the
 * characters that separate parameters are stripped here instead of trusting encoding alone.
 */
const SEPARATORS = /[&=?#%+]/g;

const clean = (value: string, max: number): string =>
  value
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(SEPARATORS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/**
 * The only place a `upi://pay` URI is built, so the QR image and the tappable deep link
 * can never disagree about where a scan leads.
 */
export function buildUpiUri(input: UpiUriInput): string {
  const vpa = input.vpa.trim();
  if (!VPA.test(vpa)) throw new UpiUriError('The payee UPI ID is not valid');
  if (!Number.isInteger(input.amountPaise) || input.amountPaise <= 0) {
    throw new UpiUriError('The amount must be a positive number of paise');
  }
  const payeeName = clean(input.payeeName, 50);
  if (!payeeName) throw new UpiUriError('The payee name is required');
  const note = clean(input.note, 60);
  const transactionRef = clean(input.transactionRef, 35);

  const params = new URLSearchParams({
    pa: vpa,
    pn: payeeName,
    am: rupeeString(input.amountPaise),
    cu: 'INR',
  });
  if (note) params.set('tn', note);
  if (transactionRef) params.set('tr', transactionRef);
  return `upi://pay?${params.toString()}`;
}

export interface ParsedUpiUri {
  vpa: string;
  payeeName: string;
  amountPaise: number;
  currency: string;
  note: string;
  transactionRef: string;
}

/** Used by tests to check what a phone would actually read out of a QR image. */
export function parseUpiUri(uri: string): ParsedUpiUri {
  if (!uri.startsWith('upi://pay?')) throw new UpiUriError('Not a UPI payment URI');
  const params = new URLSearchParams(uri.slice('upi://pay?'.length));
  const amount = params.get('am');
  return {
    vpa: params.get('pa') ?? '',
    payeeName: params.get('pn') ?? '',
    amountPaise: amount ? Math.round(Number(amount) * 100) : 0,
    currency: params.get('cu') ?? '',
    note: params.get('tn') ?? '',
    transactionRef: params.get('tr') ?? '',
  };
}
