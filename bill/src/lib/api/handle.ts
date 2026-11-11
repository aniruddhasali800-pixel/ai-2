import { NextResponse } from 'next/server';
import { requestSignature, verifySignature } from '@/lib/signature';

/**
 * Server-to-server auth for the whole /api/v1 surface. The signature proves the caller holds
 * the shared secret, so there is no key to leak, and it covers the path and body bytes, so a
 * signed request cannot be pointed at a different bill.
 */
export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code = 'REJECTED') {
    super(message);
  }
}

export function sharedSecret(): string | null {
  return process.env.SIZZLE_SHARED_SECRET ?? null;
}

function checkOrThrow(req: Request, rawBody: string): void {
  const check = verifySignature({ secret: sharedSecret(), rawBody, ...requestSignature(req) });
  if (!check.ok) throw new ApiError(check.reason === 'Signature has expired' ? 408 : 401, check.reason);
  const key = process.env.PAY_SERVICE_KEY ?? 'sizzle';
  if (req.headers.get('x-pay-key') !== key) throw new ApiError(403, 'Unknown caller key');
}

/** The body may only be read once, so verification and parsing share the same string. */
export async function requireSignedJson<T>(req: Request): Promise<T> {
  const raw = await req.text();
  checkOrThrow(req, raw);
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ApiError(400, 'The request body is not JSON');
  }
}

export async function requireSignedGet(req: Request): Promise<void> {
  checkOrThrow(req, await req.text());
}

export function requireFields<T extends object>(body: T, allowed: string[]): T {
  for (const key of Object.keys(body ?? {})) {
    if (!allowed.includes(key)) throw new ApiError(400, `Unexpected field: ${key}`);
  }
  return body;
}

export function text(value: unknown, field: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim()) throw new ApiError(400, `${field} is required`);
  if (value.length > max) throw new ApiError(400, `${field} is too long`);
  return value.trim();
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

/** Every route handler funnels through this so failures look the same and never leak a secret. */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    return json(await fn());
  } catch (error) {
    if (error instanceof ApiError) return json({ ok: false, code: error.code, message: error.message }, error.status);
    const message = error instanceof Error ? error.message : 'Unexpected failure';
    const status = /not valid UPI|no longer exists|someone else just now|not allowed to|Cannot move|UTR/.test(message)
      ? 409
      : 500;
    return json({ ok: false, code: 'REJECTED', message }, status);
  }
}
