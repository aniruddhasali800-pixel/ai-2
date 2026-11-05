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
    clerkUserId: user.clerkUserId ?? null,
    status: user.status,
    employeeId: user.employeeId ?? null,
    department: user.department ?? null,
    dateOfJoining: user.dateOfJoining ?? null,
    workingDays: user.workingDays ?? [],
    workingHours: user.workingHours ?? null,
    shift: user.shift ?? null,
    invitationStatus: user.invitationStatus ?? 'NONE',
    invitationId: user.invitationId ?? null,
    workArea: user.workArea ?? null,
    assignedTables: user.assignedTables ?? [],
    permissions: user.permissions ?? [],
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
  name: string;
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
  if (!input.email && !input.phone) {
    throw ApiError.badRequest('Provide an email or a phone number to sign in with');
  }
  const clash = await UserModel.findOne({
    $or: [...(input.email ? [{ email: input.email.toLowerCase() }] : []), ...(input.phone ? [{ phone: input.phone }] : [])],
  });

  let slug = slugify(input.restaurantName);
  if (await RestaurantModel.exists({ slug })) slug = `${slug}-${randomToken(3).toLowerCase()}`;

  const restaurantId = new Types.ObjectId();
  const ownerId = clash ? (clash._id as Types.ObjectId) : new Types.ObjectId();

  const restaurant = await RestaurantModel.create({
    _id: restaurantId,
    ownerId,
    name: input.restaurantName,
    slug,
    email: input.email?.toLowerCase(),
    phone: input.phone,
    address: input.address,
    branding: {
      logoUrl: input.logoUrl ?? '',
      coverUrl: '',
      tagline: input.tagline ?? '',
    },
  });

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  let user: any;

  if (clash) {
    // If account already exists with that email/phone, lock in the new credentials and link to the new restaurant
    clash.restaurantId = restaurantId;
    clash.role = 'OWNER';
    clash.name = input.name;
    if (input.email) clash.email = input.email.toLowerCase();
    if (input.phone) clash.phone = input.phone;
    clash.passwordHash = passwordHash;
    clash.status = 'ACTIVE';
    await clash.save();
    user = clash;
  } else {
    user = await UserModel.create({
      _id: ownerId,
      restaurantId,
      role: 'OWNER',
      name: input.name,
      email: input.email?.toLowerCase(),
      phone: input.phone,
      passwordHash,
    });
  }

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
  const user = await UserModel.findOne({
    $or: [{ email: key }, { phone: identifier.trim() }],
  }).select('+passwordHash');
  if (!user) throw ApiError.unauthorized('Those credentials do not match our records');
  if (user.status !== 'ACTIVE') throw ApiError.forbidden('This account has been suspended');

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

export async function loginWithClerk(identifier: string, name?: string) {
  const key = identifier.trim().toLowerCase();
  let user = await UserModel.findOne({
    $or: [{ email: key }, { phone: identifier.trim() }],
  });

  if (!user) {
    throw ApiError.unauthorized('No account found. Please create a restaurant first.');
  }

  if (user.status !== 'ACTIVE') throw ApiError.forbidden('This account has been suspended');

  const restaurant = await RestaurantModel.findById(user.restaurantId).lean();
  user.lastLoginAt = new Date();
  await user.save();

  const tokens = await issueTokens(user);
  return { user: publicUser(user.toObject()), restaurant, ...tokens };
}

export async function syncClerkSession(input: {
  clerkUserId: string;
  email?: string;
  name?: string;
  phone?: string;
}) {
  const { clerkUserId } = input;
  const email = input.email?.trim().toLowerCase();
  const phone = input.phone?.trim();

  // Find user by clerkUserId first, or fallback to matching verified email or phone
  let user = await UserModel.findOne({
    $or: [
      { clerkUserId },
      ...(email ? [{ email }] : []),
      ...(phone ? [{ phone }] : []),
    ],
  });

  if (!user) {
    return {
      isNewUser: true,
      clerkUserId,
      email: email ?? null,
      name: input.name ?? null,
    };
  }

  // Link clerkUserId to existing user if not already linked
  if (!user.clerkUserId) {
    user.clerkUserId = clerkUserId;
  }
  if (input.name && (!user.name || user.name === 'Owner')) {
    user.name = input.name;
  }

  if (user.status === 'SUSPENDED') {
    throw ApiError.forbidden('This account has been suspended');
  }

  // Verify associated restaurant
  const restaurant = await RestaurantModel.findById(user.restaurantId).lean();
  if (!restaurant) {
    return {
      isNewUser: true,
      clerkUserId,
      email: user.email ?? email ?? null,
      name: user.name ?? input.name ?? null,
    };
  }

  user.lastLoginAt = new Date();
  await user.save();

  const tokens = await issueTokens(user);
  return {
    isNewUser: false,
    user: publicUser(user.toObject()),
    restaurant,
    ...tokens,
  };
}

export async function registerRestaurant(input: {
  restaurantName: string;
  name?: string;
  email?: string;
  phone?: string;
  cuisine?: string;
  logoUrl?: string;
  tagline?: string;
  clerkUserId: string;
  address?: {
    line1?: string;
    city?: string;
    state?: string;
    pincode?: string;
  };
}) {
  const { clerkUserId } = input;
  const email = input.email?.trim().toLowerCase();
  const phone = input.phone?.trim();

  // Idempotency: if user and restaurant already exist for this clerkUserId or email, return existing
  let user = await UserModel.findOne({
    $or: [
      { clerkUserId },
      ...(email ? [{ email }] : []),
    ],
  });

  if (user && user.restaurantId) {
    const existingRestaurant = await RestaurantModel.findById(user.restaurantId).lean();
    if (existingRestaurant) {
      if (!user.clerkUserId) {
        user.clerkUserId = clerkUserId;
        await user.save();
      }
      const tokens = await issueTokens(user);
      return {
        isNewUser: false,
        user: publicUser(user.toObject()),
        restaurant: existingRestaurant,
        ...tokens,
      };
    }
  }

  let slug = slugify(input.restaurantName);
  if (await RestaurantModel.exists({ slug })) slug = `${slug}-${randomToken(3).toLowerCase()}`;

  const restaurantId = new Types.ObjectId();
  const ownerId = user ? (user._id as Types.ObjectId) : new Types.ObjectId();

  const restaurant = await RestaurantModel.create({
    _id: restaurantId,
    ownerId,
    clerkOwnerId: clerkUserId,
    name: input.restaurantName,
    slug,
    email: email || undefined,
    phone: phone || undefined,
    address: input.address,
    branding: {
      logoUrl: input.logoUrl ?? '',
      coverUrl: '',
      tagline: input.tagline ?? '',
    },
  });

  if (user) {
    user.restaurantId = restaurantId;
    user.role = 'OWNER';
    user.name = input.name || user.name || 'Owner';
    if (email) user.email = email;
    if (phone) user.phone = phone;
    user.clerkUserId = clerkUserId;
    user.status = 'ACTIVE';
    user.lastLoginAt = new Date();
    await user.save();
  } else {
    user = await UserModel.create({
      _id: ownerId,
      restaurantId,
      clerkUserId,
      role: 'OWNER',
      name: input.name || 'Owner',
      email: email || undefined,
      phone: phone || undefined,
      status: 'ACTIVE',
      lastLoginAt: new Date(),
    });
  }

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
    metadata: { name: restaurant.name, cuisine: input.cuisine ?? '', clerkUserId },
  });

  const tokens = await issueTokens(user);
  return { isNewUser: false, user: publicUser(user.toObject()), restaurant: restaurant.toObject(), ...tokens };
}

export async function checkUserExists(identifier: string): Promise<boolean> {
  const key = identifier.trim().toLowerCase();
  const exists = await UserModel.exists({
    $or: [{ email: key }, { phone: identifier.trim() }],
  });
  return Boolean(exists);
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
