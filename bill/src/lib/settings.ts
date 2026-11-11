import { db } from './db';
import { decryptSecret, encryptSecret, maskVpa } from './crypto';

export interface Payee {
  vpa: string;
  name: string;
}

export interface SettingsView {
  configured: boolean;
  enabled: boolean;
  businessName: string;
  payeeName: string;
  /** Masked always. The plaintext VPA is only ever handed to the intent builder. */
  payeeMasked: string;
  currency: string;
  notesPrefix: string;
  updatedAt: Date | null;
  updatedByName: string | null;
}

const DEFAULTS = {
  businessName: 'Saffron & Smoke',
  payeeName: 'Saffron & Smoke',
  currency: 'INR',
  notesPrefix: 'Bill',
};

export async function getRawSettings() {
  return db.paymentSetting.findUnique({ where: { id: 'default' }, include: { updatedBy: true } });
}

export async function settingsView(): Promise<SettingsView> {
  const row = await getRawSettings();
  if (!row) {
    return {
      configured: false,
      enabled: false,
      businessName: DEFAULTS.businessName,
      payeeName: DEFAULTS.payeeName,
      payeeMasked: 'not set',
      currency: DEFAULTS.currency,
      notesPrefix: DEFAULTS.notesPrefix,
      updatedAt: null,
      updatedByName: null,
    };
  }
  return {
    configured: true,
    enabled: row.enabled,
    businessName: row.businessName,
    payeeName: row.upiPayeeName ?? row.businessName,
    payeeMasked: row.upiIdMasked,
    currency: row.currency,
    notesPrefix: row.notesPrefix ?? DEFAULTS.notesPrefix,
    updatedAt: row.updatedAt,
    updatedByName: row.updatedBy?.name ?? null,
  };
}

/** The live payee, decrypted. Null when the owner has not configured it or switched it off. */
export async function currentPayee(): Promise<Payee | null> {
  const row = await getRawSettings();
  if (!row || !row.enabled) return null;
  try {
    return { vpa: decryptSecret(row.upiIdEncrypted), name: row.upiPayeeName ?? row.businessName };
  } catch {
    return null;
  }
}

/**
 * Why there is no QR to show. A stored payee that will not decrypt means the encryption key
 * changed, which is a different fix than never having set one — say so instead of blaming the owner.
 */
export async function payeeHealth(): Promise<'configured' | 'unconfigured' | 'unreadable'> {
  const row = await getRawSettings();
  if (!row) return 'unconfigured';
  try {
    decryptSecret(row.upiIdEncrypted);
    return 'configured';
  } catch {
    return 'unreadable';
  }
}

export interface SavePayeeInput {
  vpa: string;
  payeeName: string;
  businessName?: string;
  enabled?: boolean;
  actorId: string;
}

export async function savePayee(input: SavePayeeInput): Promise<SettingsView> {
  const vpa = input.vpa.trim();
  // Validated here as well as in the URI builder: a typo would otherwise surface only as a
  // QR a customer cannot pay into.
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{2,255}@[a-zA-Z][a-zA-Z0-9]{1,63}$/.test(vpa)) {
    throw new Error('That is not a valid UPI ID (it looks like name@bank)');
  }
  const payeeName = input.payeeName.trim().slice(0, 50);
  if (!payeeName) throw new Error('The payee name is required');

  const data = {
    businessName: (input.businessName ?? DEFAULTS.businessName).trim().slice(0, 60) || DEFAULTS.businessName,
    upiPayeeName: payeeName,
    upiIdEncrypted: encryptSecret(vpa),
    upiIdMasked: maskVpa(vpa),
    enabled: input.enabled ?? true,
    updatedById: input.actorId,
  };
  await db.paymentSetting.upsert({ where: { id: 'default' }, create: { id: 'default', ...data }, update: data });
  return settingsView();
}
