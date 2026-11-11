import { ApiError } from '@/lib/api/handle';
import { roleCan, type StaffAction, type StaffRole } from '@/lib/auth/session';
import type { StaffIdentity } from '@/lib/staff';

/**
 * When Sizzle relays a human action, it states who acted. We honour that only inside the role
 * rule — a manager's dashboard can read the queue but can never settle, and only the owner may
 * move the payee — because the permission model must not depend on the caller remembering it.
 */
export type RelayActor = StaffIdentity;

const ROLES: StaffRole[] = ['OWNER', 'MANAGER', 'CASHIER'];

export function actorFromBody(body: { actor?: { role?: string; name?: string; id?: string } } | null | undefined): RelayActor {
  const raw = body?.actor;
  if (!raw?.role || !ROLES.includes(raw.role as StaffRole)) {
    throw new ApiError(400, 'The request must say which staff role is acting (OWNER, MANAGER or CASHIER)');
  }
  return { role: raw.role as StaffRole, name: String(raw.name ?? raw.role), id: raw.id ? String(raw.id) : null };
}

export function assertAllowed(actor: RelayActor, action: StaffAction): void {
  if (roleCan(actor.role, action)) return;
  const what = action === 'verify' ? 'confirm or reject a payment' : 'change the payee details';
  throw new ApiError(403, `A ${actor.role} may only read this screen — they cannot ${what}.`, 'FORBIDDEN');
}
