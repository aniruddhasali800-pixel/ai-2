import { Types } from 'mongoose';
import { RestaurantModel, StaffApplicationModel, UserModel } from '../models';
import { ApiError } from '../utils/httpError';
import { isUsablePhone, phoneDigits } from '../utils/phone';
import { findUserByTypedPhone } from '../models/phoneMatch';
import { randomToken } from '../utils/tokens';
import { emit, Events } from '../realtime/emit';
import { hashPassword, publicUser } from '../modules/auth/auth.service';
import { recordAudit } from './audit.service';
import { notifyRoles } from './notification.service';
import { FLOOR_ROLES, ROLES, type Role } from '../types/constants';

/**
 * Hiring, from the sticker to a working account.
 *
 * An application arrives from a stranger with no session behind it, so nothing it carries is
 * trusted: the restaurant is resolved from the slug in the URL, the job has to be one the owner
 * left open, and the applicant only ever types four fields. The account itself appears only when
 * a manager or the owner accepts, and the only jobs this path can hand out are floor jobs.
 */

export function publicApplication(app: Record<string, any>) {
  return {
    _id: String(app._id),
    name: app.name,
    phone: app.phone,
    role: app.role,
    note: app.note ?? '',
    status: app.status,
    createdAt: app.createdAt,
    decidedByName: app.decidedByName ?? '',
    decidedAt: app.decidedAt ?? null,
    userId: app.userId ? String(app.userId) : null,
  };
}

/** Which jobs this restaurant's sticker is currently offering. */
export function openRolesFor(restaurant: {
  settings?: { openRoles?: readonly string[] | null } | null;
}): Role[] {
  const listed = restaurant.settings?.openRoles ?? [];
  // An owner who unchecked everything gets the default set back rather than a form with no jobs on it.
  const roles = listed.filter((r): r is Role => (FLOOR_ROLES as readonly string[]).includes(r));
  return roles.length ? roles : [...FLOOR_ROLES];
}

export async function submitApplication(slug: string, input: { name: string; phone: string; role: string; note?: string }) {
  const restaurant = await RestaurantModel.findOne({ slug: slug.toLowerCase() }).lean();
  if (!restaurant) throw ApiError.notFound('Restaurant not found');

  if (!openRolesFor(restaurant).includes(input.role as Role)) {
    throw ApiError.badRequest('We are not hiring for that job right now');
  }

  const digits = phoneDigits(input.phone);
  if (!isUsablePhone(input.phone)) throw ApiError.badRequest('Enter a phone number we can actually reach you on');

  // Somebody with an account does not need to apply; answer as if the form worked either way.
  const known = await findUserByTypedPhone(input.phone);
  if (known.some((u) => String(u.restaurantId) === String(restaurant._id))) {
    return { ok: true, restaurantName: restaurant.name, alreadyStaff: true };
  }

  const duplicate = await StaffApplicationModel.findOne({ restaurantId: restaurant._id, phoneDigits: digits, status: 'PENDING' }).lean();
  if (duplicate) {
    return { ok: true, restaurantName: restaurant.name, alreadyApplied: true };
  }

  let application;
  try {
    application = await StaffApplicationModel.create({
      restaurantId: restaurant._id,
      name: input.name,
      phone: input.phone,
      phoneDigits: digits,
      role: input.role,
      note: input.note ?? '',
    });
  } catch (err) {
    // Two taps at once hit the partial unique index; the second one is a duplicate, not a crash.
    if ((err as { code?: number }).code === 11000) {
      return { ok: true, restaurantName: restaurant.name, alreadyApplied: true };
    }
    throw err;
  }

  await notifyRoles(String(restaurant._id), ['MANAGER', 'OWNER'], {
    type: 'SYSTEM',
    title: `${application.name} asked to work here`,
    body: `${application.role.replace(/_/g, ' ')} · ${application.phone}`,
    entityType: 'StaffApplication',
    entityId: String(application._id),
  });
  emit.toRestaurant(String(restaurant._id), Events.STAFF_UPDATED, {
    reason: 'applied',
    applicationId: String(application._id),
  });

  return { ok: true, restaurantName: restaurant.name, alreadyStaff: false, alreadyApplied: false };
}

export async function listApplications(restaurantId: string, status?: string) {
  const query: Record<string, unknown> = { restaurantId };
  if (status) query.status = status;
  const apps = await StaffApplicationModel.find(query).sort({ status: 1, createdAt: -1 }).limit(200).lean();
  return { data: apps.map(publicApplication) };
}

/**
 * Accepting is the only way an account leaves this queue. A manager may hire the floor; a
 * manager account is the owner's to hand out, so the same gate lives here as in /staff.
 */
export async function approveApplication(
  auth: { restaurantId: string; userId: string; name: string; role: Role },
  id: string,
  input: { role?: Role } = {},
) {
  const application = await StaffApplicationModel.findOne({ _id: id, restaurantId: auth.restaurantId });
  if (!application) throw ApiError.notFound('Application not found');
  if (application.status !== 'PENDING') throw ApiError.conflict('This application has already been handled');

  const wanted = (input.role ?? application.role) as Role;
  if (!ROLES.includes(wanted) || wanted === 'OWNER') throw ApiError.badRequest('That job is not one we can hand out here');
  if (!(FLOOR_ROLES as readonly string[]).includes(wanted) && auth.role !== 'OWNER') {
    throw ApiError.forbidden('Only the owner can hand out a manager account');
  }

  // The number was typed once by the applicant and once by the manager, and both have to reach
  // the same account. More than one match means two people answer to those digits.
  const candidates = await findUserByTypedPhone(application.phone);
  if (candidates.length > 1) throw ApiError.conflict('That phone number already reaches more than one account');
  const existing = candidates[0] ? await UserModel.findById(candidates[0]._id) : null;
  if (existing && String(existing.restaurantId) !== String(auth.restaurantId)) {
    throw ApiError.conflict('That phone number belongs to another restaurant');
  }
  if (existing?.role === 'OWNER') throw ApiError.conflict('That phone number is the owner account');

  let user = existing;
  if (user) {
    // The number already works here — approval reopens the account instead of a second one.
    user.role = wanted;
    user.status = 'ACTIVE';
    await user.save();
  } else {
    user = await UserModel.create({
      restaurantId: auth.restaurantId,
      role: wanted,
      name: application.name,
      phone: application.phone,
      // An approved hire signs in with a code on their phone, so there is no shared password to
      // hand over. This hash is unguessable and deliberately never shown to anyone.
      passwordHash: await hashPassword(randomToken(24)),
    });
  }

  application.status = 'APPROVED';
  application.decidedByUserId = new Types.ObjectId(auth.userId);
  application.decidedByName = auth.name;
  application.decidedAt = new Date();
  application.userId = user._id;
  await application.save();

  emit.toRestaurant(auth.restaurantId, Events.STAFF_UPDATED, { reason: 'hired', userId: String(user._id) });
  await notifyRoles(auth.restaurantId, ['MANAGER', 'OWNER'], {
    type: 'SYSTEM',
    title: `${user.name} is on the team`,
    body: `${wanted.replace(/_/g, ' ')} · approved by ${auth.name}`,
    entityType: 'User',
    entityId: String(user._id),
  });
  await recordAudit({
    restaurantId: auth.restaurantId,
    actorId: auth.userId,
    actorName: auth.name,
    action: 'staff.application_approved',
    entityType: 'User',
    entityId: String(user._id),
    metadata: { name: user.name, role: wanted, applicationId: String(application._id), phone: user.phone },
  });

  return { application: publicApplication(application.toObject()), account: publicUser(user.toObject()) };
}

export async function rejectApplication(
  auth: { restaurantId: string; userId: string; name: string; role: Role },
  id: string,
) {
  const application = await StaffApplicationModel.findOne({ _id: id, restaurantId: auth.restaurantId });
  if (!application) throw ApiError.notFound('Application not found');
  if (application.status !== 'PENDING') throw ApiError.conflict('This application has already been handled');

  application.status = 'REJECTED';
  application.decidedByUserId = new Types.ObjectId(auth.userId);
  application.decidedByName = auth.name;
  application.decidedAt = new Date();
  await application.save();

  emit.toRestaurant(auth.restaurantId, Events.STAFF_UPDATED, {
    reason: 'rejected',
    applicationId: String(application._id),
  });
  await recordAudit({
    restaurantId: auth.restaurantId,
    actorId: auth.userId,
    actorName: auth.name,
    action: 'staff.application_rejected',
    entityType: 'StaffApplication',
    entityId: String(application._id),
    metadata: { name: application.name, role: application.role, phone: application.phone },
  });

  return publicApplication(application.toObject());
}
