import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { hmacHex, safeEqual } from '../crypto';
import { db } from '../db';

export type StaffRole = 'OWNER' | 'MANAGER' | 'CASHIER';
export type StaffAction = 'view' | 'verify' | 'settings';

const COOKIE = 'pay_session';
const TTL_SECONDS = 12 * 60 * 60;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: StaffRole;
}

/** The role rule for the whole service: a manager reads, never settles; the payee belongs to the owner. */
export function roleCan(role: StaffRole, action: StaffAction): boolean {
  if (role === 'OWNER') return true;
  if (role === 'CASHIER') return action === 'view' || action === 'verify';
  return action === 'view';
}

function secret(): string {
  const value = process.env.APP_SECRET;
  if (!value) throw new Error('APP_SECRET is not set');
  return value;
}

export function signSession(user: SessionUser): string {
  const payload = Buffer.from(
    JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + TTL_SECONDS }),
  ).toString('base64url');
  return `${payload}.${hmacHex(secret(), payload)}`;
}

function readPayload(token: string): SessionUser | null {
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  if (!safeEqual(hmacHex(secret(), payload), signature)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SessionUser & { exp: number };
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return { id: parsed.id, email: parsed.email, name: parsed.name, role: parsed.role };
  } catch {
    return null;
  }
}

/**
 * The cookie is only a claim. The user row is re-read on every staff action, so a deleted or
 * demoted account loses authority on the next click rather than at the next expiry.
 */
export async function currentStaff(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const claim = readPayload(token);
  if (!claim) return null;

  const user = await db.user.findUnique({ where: { id: claim.id }, select: { id: true, email: true, name: true, role: true } });
  if (!user) return null;
  if (user.role !== claim.role) return null;
  return { ...user, role: user.role as StaffRole };
}

export async function requireStaff(): Promise<SessionUser> {
  const user = await currentStaff();
  if (!user) redirect('/login');
  return user;
}

export async function requireAction(action: StaffAction): Promise<SessionUser> {
  const user = await requireStaff();
  if (!roleCan(user.role, action)) redirect('/admin?denied=' + action);
  return user;
}

export async function startSession(user: SessionUser): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, signSession(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: TTL_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}
