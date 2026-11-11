import { db } from './db';
import type { StaffRole } from './auth/session';

/** Who is acting when the request comes from Sizzle rather than from a screen in this service. */
export interface StaffIdentity {
  role: StaffRole;
  name: string;
  id: string | null;
}

/**
 * The id a write here may store in a User relation. Sizzle's staff hold no account in this
 * database, but "who read the money out of the statement" is a foreign key on purpose — the
 * income report names the verifier afterwards, so the person is mirrored rather than dropped.
 * A mirror cannot sign in here: its password column holds a value the verifier rejects before
 * it compares anything.
 */
export async function mirroredStaffId(actor: StaffIdentity): Promise<string | null> {
  if (!actor.id) {
    const local = await db.user.findFirst({
      where: { role: actor.role },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    return local?.id ?? null;
  }
  const known = await db.user.findUnique({ where: { id: actor.id }, select: { id: true } });
  if (known) return known.id;

  const handle = actor.name.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.+|\.+$/g, '') || 'staff';
  await db.user.upsert({
    where: { id: actor.id },
    create: {
      id: actor.id,
      email: `${handle}.${actor.id}@relay.invalid`,
      name: actor.name.slice(0, 60),
      role: actor.role,
      passwordHash: 'relay-only',
    },
    update: { name: actor.name.slice(0, 60), role: actor.role },
  });
  return actor.id;
}
