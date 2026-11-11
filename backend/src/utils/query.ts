import type { Request } from 'express';
import { z } from 'zod';

/** Typed readers for `req.query` values, which arrive as string | string[] | ParsedQs. */

export function qstr(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  return undefined;
}

export function qnum(value: unknown): number | undefined {
  const raw = qstr(value);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function qpaging(value: unknown, fallback = 1, max = Number.MAX_SAFE_INTEGER): number {
  const n = qnum(value);
  if (n === undefined) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(n)));
}

export function qbool(value: unknown): boolean | undefined {
  const raw = qstr(value)?.toLowerCase();
  if (raw === undefined) return undefined;
  if (['1', 'true', 'yes'].includes(raw)) return true;
  if (['0', 'false', 'no'].includes(raw)) return false;
  return undefined;
}

export function qdate(value: unknown): Date | undefined {
  const raw = qstr(value);
  if (!raw) return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Reads query values on routes where `validate({ query })` already parsed and replaced them. */
export function queryOf<T>(req: Request): T {
  return req.query as unknown as T;
}

/** `?flag=false` and `?flag=0` must read as false — z.coerce.boolean() would say true. */
export const zFlag = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => (typeof value === 'boolean' ? value : value === 'true' || value === '1'));
