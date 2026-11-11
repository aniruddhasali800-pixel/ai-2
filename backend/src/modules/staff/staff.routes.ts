import { Router } from 'express';
import { z } from 'zod';
import { UserModel } from '../../models';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { ApiError } from '../../utils/httpError';
import { randomToken } from '../../utils/tokens';
import { emit, Events } from '../../realtime/emit';
import { hashPassword, publicUser } from '../auth/auth.service';
import { recordAudit } from '../../services/audit.service';
import { approveApplication, listApplications, rejectApplication } from '../../services/hiring.service';
import { FLOOR_ROLES, ROLES, type Role } from '../../types/constants';

export const staffRouter = Router();

staffRouter.use(requireAuth);

const staffRoles = ROLES.filter((role) => role !== 'OWNER') as unknown as [string, ...string[]];

/**
 * A manager runs the floor, so a manager can hire the floor. Manager authority is the owner's
 * to hand out — otherwise one manager could mint another one and inherit their permissions.
 */
function assertCanGrant(auth: { role: Role }, role: Role) {
  if ((FLOOR_ROLES as readonly string[]).includes(role)) return;
  if (auth.role !== 'OWNER') throw ApiError.forbidden('Only the owner can hand out a manager account');
}

const createSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  role: z.enum(staffRoles),
  email: z.string().trim().email('Please enter a valid email address'),
  phone: z.string().trim().max(20).optional().or(z.literal('')),
  password: z.string().min(6, 'Password must be at least 6 characters').max(72),
});

staffRouter.get(
  '/',
  requirePermission('staff:read'),
  asyncHandler(async (req, res) => {
    const { role, status, search } = req.query as Record<string, string | undefined>;
    const query: Record<string, unknown> = { restaurantId: req.auth!.restaurantId };
    if (role) query.role = role;
    if (status) query.status = status;
    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ name: rx }, { email: rx }, { phone: rx }];
    }
    const users = await UserModel.find(query).sort({ role: 1, name: 1 }).lean();
    res.json({ data: users.map(publicUser) });
  }),
);

staffRouter.post(
  '/',
  requirePermission('staff:write'),
  validate({ body: createSchema }),
  asyncHandler(async (req, res) => {
    const { name, role, email, phone, password } = req.body;
    assertCanGrant(req.auth!, role as Role);

    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone?.trim() || undefined;

    const clash = await UserModel.findOne({
      $or: [
        { email: cleanEmail },
        ...(cleanPhone ? [{ phone: cleanPhone }] : []),
      ],
    }).lean();
    if (clash) throw ApiError.conflict('A staff member with this email or phone already exists');

    const user = await UserModel.create({
      restaurantId: req.auth!.restaurantId,
      role,
      name: name.trim(),
      email: cleanEmail,
      phone: cleanPhone,
      passwordHash: await hashPassword(password),
    });

    emit.toRestaurant(req.auth!.restaurantId, Events.STAFF_UPDATED, { reason: 'created', userId: String(user._id) });
    await recordAudit({
      restaurantId: req.auth!.restaurantId,
      actorId: req.auth!.userId,
      actorName: req.auth!.name,
      action: 'staff.created',
      entityType: 'User',
      entityId: String(user._id),
      metadata: { name, role },
    });
    res.status(201).json(publicUser(user.toObject()));
  }),
);

staffRouter.patch(
  '/:id',
  requirePermission('staff:write'),
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({
      name: z.string().min(2).max(80).optional(),
      role: z.enum(staffRoles).optional(),
      email: z.string().email().nullable().optional(),
      phone: z.string().min(8).max(15).nullable().optional(),
      status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const user = await UserModel.findOne({ _id: req.params.id, restaurantId: req.auth!.restaurantId });
    if (!user) throw ApiError.notFound('Staff member not found');
    if (user.role === 'OWNER') throw ApiError.forbidden('The owner account cannot be changed here');
    if (user.role === 'MANAGER' && req.auth!.role !== 'OWNER') {
      throw ApiError.forbidden('Only the owner can change a manager account');
    }

    const before = { role: user.role, status: user.status };
    const { name, role, email, phone, status } = req.body;
    if (role) assertCanGrant(req.auth!, role as Role);
    if (name) user.name = name;
    if (role) user.role = role;
    if (email !== undefined) user.email = email ? email.toLowerCase() : undefined;
    if (phone !== undefined) user.phone = phone ?? undefined;
    if (status) user.status = status;
    await user.save();

    emit.toRestaurant(req.auth!.restaurantId, Events.STAFF_UPDATED, { reason: 'updated', userId: String(user._id) });
    await recordAudit({
      restaurantId: req.auth!.restaurantId,
      actorId: req.auth!.userId,
      actorName: req.auth!.name,
      action: 'staff.updated',
      entityType: 'User',
      entityId: String(user._id),
      metadata: { before, after: { role: user.role, status: user.status }, name: user.name },
    });
    res.json(publicUser(user.toObject()));
  }),
);

staffRouter.post(
  '/:id/reset-password',
  requirePermission('staff:write'),
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z.object({ password: z.string().min(8).max(72) }),
  }),
  asyncHandler(async (req, res) => {
    const user = await UserModel.findOne({ _id: req.params.id, restaurantId: req.auth!.restaurantId });
    if (!user) throw ApiError.notFound('Staff member not found');
    if (user.role === 'OWNER') throw ApiError.forbidden('The owner password is changed from the owner profile');
    if (user.role === 'MANAGER' && req.auth!.role !== 'OWNER') {
      throw ApiError.forbidden('Only the owner can reset a manager password');
    }
    user.passwordHash = await hashPassword(req.body.password);
    // Every device on the old password is signed out, not only the one that reset it.
    user.refreshTokens = [];
    await user.save();

    await recordAudit({
      restaurantId: req.auth!.restaurantId,
      actorId: req.auth!.userId,
      actorName: req.auth!.name,
      action: 'staff.password_reset',
      entityType: 'User',
      entityId: String(user._id),
      metadata: { name: user.name },
    });
    res.json({ ok: true });
  }),
);

/**
 * The hiring queue: whoever scanned the sticker and asked for a shift lands here.
 * A manager works the floor hires; the owner is the only one who can turn an applicant
 * into a manager, because that is the one job the queue could otherwise use to hand out
 * authority it should not hold.
 */
staffRouter.get(
  '/applications',
  requirePermission('staff:read'),
  asyncHandler(async (req, res) => {
    const { status } = req.query as Record<string, string | undefined>;
    res.json(await listApplications(req.auth!.restaurantId, status));
  }),
);

staffRouter.post(
  '/applications/:id/approve',
  requirePermission('staff:write'),
  validate({
    params: z.object({ id: z.string().min(1) }),
    body: z
      .object({ role: z.enum(staffRoles).optional() })
      .optional()
      .default({}),
  }),
  asyncHandler(async (req, res) => {
    res.json(await approveApplication(req.auth!, req.params.id, req.body));
  }),
);

staffRouter.post(
  '/applications/:id/reject',
  requirePermission('staff:write'),
  validate({ params: z.object({ id: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    res.json(await rejectApplication(req.auth!, req.params.id));
  }),
);
