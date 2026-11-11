import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Types } from 'mongoose';
import { timingSafeEqual } from 'node:crypto';
import { CategoryModel, RestaurantModel, TableModel, UserModel } from '../../models';
import { env, DEMO_MASTER_PASSWORD, DEMO_TENANT_SLUG } from '../../config/env';
import { ApiError } from '../../utils/httpError';
import { signAccessToken, type AccessPayload } from '../../middleware/auth';
import { randomToken } from '../../utils/tokens';
import { recordAudit } from '../../services/audit.service';
import type { Role } from '../../types/constants';

const BCRYPT_ROUNDS = 10;

/** How many devices may hold a live session for one account. Past this the oldest signs out. */
const LIVE_SESSIONS = 5;

interface RefreshPayload {
  sub: string;
  v: string;
}

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return base || 'restaurant';
}

export function publicUser(user: Record<string, any>) {
  return {
    _id: String(user._id),
    restaurantId: String(user.restaurantId),
    role: user.role,
    name: user.name,
    email: user.email ?? null,
    phone: user.phone ?? null,
    status: user.status,
    lastLoginAt: user.lastLoginAt ?? null,
    createdAt: user.createdAt,
  };
}

export async function issueTokens(user: { _id: unknown; restaurantId: unknown; role: Role; name: string }) {
  const accessToken = signAccessToken({
    sub: String(user._id),
    rid: String(user.restaurantId),
    role: user.role,
    name: user.name,
  } satisfies AccessPayload);
  const { refreshToken, hash } = await mintRefresh(String(user._id));
  // A sign-in joins the list rather than replacing it: one job account is used on the floor phone
  // and the counter screen, and taking the second device must not silence the first.
  await UserModel.updateOne(
    { _id: user._id },
    { $push: { refreshTokens: { $each: [hash], $slice: -LIVE_SESSIONS } } },
  );
  return { accessToken, refreshToken, expiresInDays: env.REFRESH_TOKEN_TTL_DAYS };
}

/** A refresh token plus the hash that gets stored for it. */
async function mintRefresh(userId: string) {
  const version = randomToken(8);
  const refreshToken = jwt.sign({ sub: userId, v: version } satisfies RefreshPayload, env.REFRESH_TOKEN_SECRET, {
    expiresIn: `${env.REFRESH_TOKEN_TTL_DAYS}d`,
  });
  return { refreshToken, hash: await bcrypt.hash(version, BCRYPT_ROUNDS) };
}

export async function registerOwner(input: {
  restaurantName: string;
  name?: string;
  email?: string;
  phone?: string;
  password: string;
  cuisine?: string;
  logoUrl?: string;
  tagline?: string;
  address?: {
    line1?: string;
    city?: string;
    state?: string;
    pincode?: string;
  };
}) {
  const cleanEmail = input.email?.trim().toLowerCase();
  const cleanPhone = input.phone?.trim();

  if (!cleanEmail && !cleanPhone) {
    throw ApiError.badRequest('Please enter an email address or a phone number to sign in with.');
  }

  const clash = await UserModel.findOne({
    $or: [
      ...(cleanEmail ? [{ email: cleanEmail }] : []),
      ...(cleanPhone ? [{ phone: cleanPhone }] : []),
    ],
  }).lean();
  if (clash) throw ApiError.conflict('An account with this email or phone already exists. Please sign in with your password.');

  let slug = slugify(input.restaurantName);
  if (await RestaurantModel.exists({ slug })) slug = `${slug}-${randomToken(3).toLowerCase()}`;

  const restaurantId = new Types.ObjectId();
  const ownerId = new Types.ObjectId();
  const ownerName = input.name?.trim() || (cleanEmail ? cleanEmail.split('@')[0] : '') || `${input.restaurantName.trim()} Owner`;

  const restaurant = await RestaurantModel.create({
    _id: restaurantId,
    ownerId,
    name: input.restaurantName.trim(),
    slug,
    email: cleanEmail,
    phone: cleanPhone,
    address: input.address,
    branding: {
      logoUrl: input.logoUrl ?? '',
      coverUrl: '',
      tagline: input.tagline ?? '',
    },
  });

  const user = await UserModel.create({
    _id: ownerId,
    restaurantId,
    role: 'OWNER',
    name: ownerName,
    email: cleanEmail,
    phone: cleanPhone,
    passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
  });

  // Create starter tables and starter categories for the new restaurant
  await CategoryModel.insertMany([
    { restaurantId: restaurant._id, name: 'Starters', sortOrder: 1, isActive: true },
    { restaurantId: restaurant._id, name: 'Main Course', sortOrder: 2, isActive: true },
    { restaurantId: restaurant._id, name: 'Beverages', sortOrder: 3, isActive: true },
    { restaurantId: restaurant._id, name: 'Desserts', sortOrder: 4, isActive: true },
  ]);

  const starterTables = [1, 2, 3, 4, 5].map((num) => ({
    restaurantId: restaurant._id,
    number: String(num),
    capacity: 4,
    section: 'Main',
    qrToken: randomToken(16),
  }));
  await TableModel.insertMany(starterTables);

  await recordAudit({
    restaurantId: String(restaurant._id),
    actorId: String(user._id),
    actorName: user.name,
    action: 'restaurant.created',
    entityType: 'Restaurant',
    entityId: String(restaurant._id),
    metadata: { name: restaurant.name, cuisine: input.cuisine ?? '' },
  });

  const tokens = await issueTokens(user);
  return { user: publicUser(user.toObject()), restaurant: restaurant.toObject(), ...tokens };
}

export async function login(identifier: string, password: string) {
  const key = identifier.trim().toLowerCase();
  const digits = identifier.replace(/\D/g, '');

  const user = await UserModel.findOne({
    $or: [
      { email: key },
      { phone: identifier.trim() },
      ...(digits.length >= 8 ? [{ phoneDigits: digits }] : []),
    ],
  }).select('+passwordHash');
  if (!user) throw ApiError.unauthorized('Those credentials do not match our records. Please verify your email or password.');
  if (user.status !== 'ACTIVE') throw ApiError.forbidden('This account has been suspended. Please contact the administrator.');

  const restaurant = await RestaurantModel.findById(user.restaurantId).lean();
  // A user row can be saved without the hash ever being loaded onto it, so the field is optional
  // in the schema. No hash means no password to compare, which only the demo master can pass.
  const valid =
    (!!user.passwordHash && (await bcrypt.compare(password, user.passwordHash))) ||
    (isDemoMaster(password) && restaurant?.slug === DEMO_TENANT_SLUG);
  if (!valid) throw ApiError.unauthorized('Those credentials do not match our records');

  user.lastLoginAt = new Date();
  await user.save();

  const tokens = await issueTokens(user);
  return { user: publicUser(user.toObject()), restaurant, ...tokens };
}

export async function refreshSession(refreshToken: string) {
  let payload: RefreshPayload;
  try {
    payload = jwt.verify(refreshToken, env.REFRESH_TOKEN_SECRET) as RefreshPayload;
  } catch {
    throw ApiError.unauthorized('Your session has ended, please sign in again');
  }
  const user = await UserModel.findById(payload.sub).select('+refreshTokens');
  if (!user || user.status !== 'ACTIVE' || !user.refreshTokens?.length) {
    throw ApiError.unauthorized('Your session has ended, please sign in again');
  }
  const slot = user.refreshTokens.findIndex((hash) => bcrypt.compareSync(payload.v, hash));
  if (slot === -1) throw ApiError.unauthorized('Your session has ended, please sign in again');

  const accessToken = signAccessToken({
    sub: String(user._id),
    rid: String(user.restaurantId),
    role: user.role,
    name: user.name,
  } satisfies AccessPayload);
  // Only this device's slot moves, so refreshing on the phone cannot end the counter's session.
  const next = await mintRefresh(String(user._id));
  user.refreshTokens[slot] = next.hash;
  user.markModified('refreshTokens');
  await user.save();

  return {
    user: publicUser(user.toObject()),
    accessToken,
    refreshToken: next.refreshToken,
    expiresInDays: env.REFRESH_TOKEN_TTL_DAYS,
  };
}

/**
 * Signing out ends the device that asked, not every screen sharing the account — the counter
 * tablet stays awake when the owner closes a laptop. Without a refresh token to point at there
 * is nothing to single out, so all of them end.
 */
export async function logout(userId: string, refreshToken?: string) {
  if (!refreshToken) return void (await UserModel.updateOne({ _id: userId }, { refreshTokens: [] }));

  let payload: RefreshPayload;
  try {
    payload = jwt.verify(refreshToken, env.REFRESH_TOKEN_SECRET) as RefreshPayload;
  } catch {
    return;
  }
  if (payload.sub !== userId) return;

  const user = await UserModel.findById(userId).select('+refreshTokens');
  if (!user) return;
  const kept = user.refreshTokens.filter((hash) => !bcrypt.compareSync(payload.v, hash));
  if (kept.length === user.refreshTokens.length) return;
  user.refreshTokens = kept;
  user.markModified('refreshTokens');
  await user.save();
}

export async function getProfile(userId: string) {
  const user = await UserModel.findById(userId).lean();
  if (!user) throw ApiError.notFound('Account not found');
  const restaurant = await RestaurantModel.findById(user.restaurantId).lean();
  return { user: publicUser(user), restaurant };
}

export async function changePassword(userId: string, currentPassword: string, nextPassword: string) {
  const user = await UserModel.findById(userId).select('+passwordHash');
  if (!user) throw ApiError.notFound('Account not found');
  if (!user.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw ApiError.badRequest('Your current password is incorrect');
  }
  user.passwordHash = await bcrypt.hash(nextPassword, BCRYPT_ROUNDS);
  await user.save();
  await logout(userId);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS);
}

/**
 * Compares against the demo master without leaking how much of a guess was right, and never
 * writes the password anywhere. A suspended account is turned away before this is reached, a
 * production API has no master to match because the value arrives empty from the config, and the
 * caller checks it only ever opens the seeded demo tenant — a restaurant that onboarded itself
 * for real is not reachable with a password printed in a README.
 */
function isDemoMaster(password: string): boolean {
  if (!DEMO_MASTER_PASSWORD) return false;
  const guess = Buffer.from(password);
  const master = Buffer.from(DEMO_MASTER_PASSWORD);
  return guess.length === master.length && timingSafeEqual(guess, master);
}
