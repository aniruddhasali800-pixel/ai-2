import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const KEY_SALT = 'sizzle-pay-v1';

function secret(): string {
  const value = process.env.APP_SECRET;
  if (!value) throw new Error('APP_SECRET is not set — run `npm run setup:env`');
  return value;
}

const key = (): Buffer => scryptSync(secret(), KEY_SALT, 32);

const b64u = (buf: Buffer): string => buf.toString('base64url');

/** AES-256-GCM. The payee VPA never lands in the database as readable text. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', b64u(iv), b64u(cipher.getAuthTag()), b64u(data)].join('.');
}

export function decryptSecret(token: string): string {
  const [version, iv, tag, data] = token.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unreadable encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}

/** `demo@okhdfcbank` -> `dem••••@okhdfcbank` — enough to recognise, not enough to steal. */
export function maskVpa(vpa: string): string {
  const at = vpa.lastIndexOf('@');
  if (at <= 0) return '••••';
  const handle = vpa.slice(0, at);
  const visible = handle.slice(0, Math.min(3, handle.length));
  return `${visible}••••${vpa.slice(at)}`;
}

export function hmacHex(secretKey: string, data: string): string {
  return createHmac('sha256', secretKey).update(data).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function randomToken(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32, SCRYPT_PARAMS);
  return ['scrypt', salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, Buffer.from(salt, 'base64url'), 32, SCRYPT_PARAMS);
  return safeEqual(candidate.toString('base64url'), hash);
}
