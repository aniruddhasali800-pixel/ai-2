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
import { sendStaffInviteOtp, verifyStaffInviteOtp } from '../../services/emailOtp.service';
import { syncOrInviteClerkStaff } from '../../services/clerkStaff.service';
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
  name: z.string().min(2).max(80),
  role: z.enum(staffRoles),
  email: z.string().email().optional(),
  phone: z.string().min(8).max(15).optional(),
  verificationCode: z.string().min(4).max(10).optional(),
  /** Left out, the account signs in with Clerk or with an email/phone code. */
  password: z.string().min(8).max(72).optional(),
  status: z.enum(['ACTIVE', 'PENDING', 'INACTIVE', 'SUSPENDED']).optional().default('ACTIVE'),
  employeeId: z.string().max(40).optional(),
  department: z.string().max(80).optional(),
  dateOfJoining: z.string().optional(),
  workingDays: z.array(z.string()).optional(),
  workingHours: z.string().max(80).optional(),
  shift: z.string().max(80).optional(),
  workArea: z.string().max(80).optional(),
  assignedTables: z.array(z.string()).optional(),
  permissions: z.array(z.string()).optional(),
});

staffRouter.post(
  '/send-verification',
  requirePermission('staff:write'),
  validate({
    body: z.object({
      email: z.string().email('Please enter a valid email address'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const cleanEmail = req.body.email.trim().toLowerCase();
    const result = await sendStaffInviteOtp(cleanEmail, req.auth!.restaurantId);
    res.json(result);
  }),
);

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
    const {
      name,
      role,
      email,
      phone,
      verificationCode,
      password,
      status,
      employeeId,
      department,
      dateOfJoining,
      workingDays,
      workingHours,
      shift,
      workArea,
      assignedTables,
      permissions,
    } = req.body;
    if (!email && !phone) throw ApiError.badRequest('Add an email or phone number for this staff member');
    assertCanGrant(req.auth!, role as Role);

    const cleanEmail = email?.trim().toLowerCase();
    let cleanPhone = phone?.trim();

    // Verify Email OTP if code was submitted
    if (cleanEmail && verificationCode) {
      await verifyStaffInviteOtp(cleanEmail, verificationCode);
    }

    // 1. Check Email uniqueness
    if (cleanEmail) {
      const emailClash = await UserModel.findOne({ email: cleanEmail }).lean();
      if (emailClash) {
        if (String(emailClash._id) === String(req.auth!.userId)) {
          throw ApiError.conflict(
            `The email '${cleanEmail}' is already your Owner account. Team members must have their own email so the system knows to open their staff station.`,
          );
        }
        if (String(emailClash.restaurantId) === String(req.auth!.restaurantId)) {
          if (emailClash.status === 'INACTIVE') {
            // Reactivate previous staff member in this restaurant
            const reactivated = await UserModel.findById(emailClash._id);
            if (reactivated) {
              reactivated.name = name;
              reactivated.role = role;
              reactivated.status = status ?? 'ACTIVE';
              if (cleanPhone) reactivated.phone = cleanPhone;
              if (employeeId !== undefined) reactivated.employeeId = employeeId;
              if (department !== undefined) reactivated.department = department;
              if (dateOfJoining) reactivated.dateOfJoining = new Date(dateOfJoining);
              if (workingDays !== undefined) reactivated.workingDays = workingDays;
              if (workingHours !== undefined) reactivated.workingHours = workingHours;
              if (shift !== undefined) reactivated.shift = shift;
              if (workArea !== undefined) reactivated.workArea = workArea;
              if (assignedTables !== undefined) reactivated.assignedTables = assignedTables;
              if (permissions !== undefined) reactivated.permissions = permissions;
              if (password) reactivated.passwordHash = await hashPassword(password);
              await reactivated.save();

              emit.toRestaurant(req.auth!.restaurantId, Events.STAFF_UPDATED, { reason: 'reactivated', userId: String(reactivated._id) });
              return res.status(200).json(publicUser(reactivated.toObject()));
            }
          }
          throw ApiError.conflict(`A staff member with email '${cleanEmail}' already exists in your team (${emailClash.name} - ${emailClash.role}).`);
        }
        throw ApiError.conflict(`The email '${cleanEmail}' is already registered to another user account.`);
      }
    }

    // 2. Check Phone uniqueness
    if (cleanPhone) {
      const phoneClash = await UserModel.findOne({ phone: cleanPhone }).lean();
      if (phoneClash) {
        if (String(phoneClash._id) === String(req.auth!.userId)) {
          if (cleanEmail) {
            // Owner accidentally entered their own phone number; clear it so staff member can still be created with email without conflict
            cleanPhone = undefined;
          } else {
            throw ApiError.conflict(
              `The phone number '${cleanPhone}' is already your Owner account phone. Team members must have their own phone number for phone code sign-in.`,
            );
          }
        } else if (String(phoneClash.restaurantId) === String(req.auth!.restaurantId)) {
          if (phoneClash.status === 'INACTIVE') {
            const reactivated = await UserModel.findById(phoneClash._id);
            if (reactivated) {
              reactivated.name = name;
              reactivated.role = role;
              reactivated.status = status ?? 'ACTIVE';
              if (cleanEmail) reactivated.email = cleanEmail;
              if (employeeId !== undefined) reactivated.employeeId = employeeId;
              if (department !== undefined) reactivated.department = department;
              if (dateOfJoining) reactivated.dateOfJoining = new Date(dateOfJoining);
              if (workingDays !== undefined) reactivated.workingDays = workingDays;
              if (workingHours !== undefined) reactivated.workingHours = workingHours;
              if (shift !== undefined) reactivated.shift = shift;
              if (workArea !== undefined) reactivated.workArea = workArea;
              if (assignedTables !== undefined) reactivated.assignedTables = assignedTables;
              if (permissions !== undefined) reactivated.permissions = permissions;
              if (password) reactivated.passwordHash = await hashPassword(password);
              await reactivated.save();

              emit.toRestaurant(req.auth!.restaurantId, Events.STAFF_UPDATED, { reason: 'reactivated', userId: String(reactivated._id) });
              return res.status(200).json(publicUser(reactivated.toObject()));
            }
          }
          throw ApiError.conflict(`A staff member with phone '${cleanPhone}' already exists in your team (${phoneClash.name} - ${phoneClash.role}).`);
        } else {
          // If phone was linked to an old/other test restaurant account, reassign it cleanly to this new staff member!
          await UserModel.updateOne({ _id: phoneClash._id }, { $unset: { phone: 1, phoneDigits: 1 } });
        }
      }
    }

    // 3. Connect to Clerk API: link existing Clerk user or invite / provision passwordless email identity
    let clerkUserId: string | undefined = undefined;
    let invitationId: string | undefined = undefined;
    let invitationStatus: 'NONE' | 'PENDING' | 'ACCEPTED' = 'NONE';

    if (cleanEmail) {
      const clerkResult = await syncOrInviteClerkStaff({
        email: cleanEmail,
        name,
        role,
        restaurantId: String(req.auth!.restaurantId),
      });
      if (clerkResult.clerkUserId) {
        clerkUserId = clerkResult.clerkUserId;
        invitationStatus = 'ACCEPTED';
      } else if (clerkResult.invitationId) {
        invitationId = clerkResult.invitationId;
        invitationStatus = 'PENDING';
      }
    }

    const user = await UserModel.create({
      restaurantId: req.auth!.restaurantId,
      clerkUserId,
      role,
      name,
      email: cleanEmail,
      phone: cleanPhone,
      passwordHash: await hashPassword(password ?? randomToken(24)),
      status: status ?? 'ACTIVE',
      employeeId,
      department: department ?? '',
      dateOfJoining: dateOfJoining ? new Date(dateOfJoining) : undefined,
      workingDays: workingDays ?? [],
      workingHours: workingHours ?? '',
      shift: shift ?? '',
      invitationStatus,
      invitationId,
      workArea,
      assignedTables,
      permissions,
    });

    emit.toRestaurant(req.auth!.restaurantId, Events.STAFF_UPDATED, { reason: 'created', userId: String(user._id) });
    await recordAudit({
      restaurantId: req.auth!.restaurantId,
      actorId: req.auth!.userId,
      actorName: req.auth!.name,
      action: 'staff.created',
      entityType: 'User',
      entityId: String(user._id),
      metadata: { name, role, email: cleanEmail, clerkUserId, invitationStatus },
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
      status: z.enum(['ACTIVE', 'PENDING', 'INACTIVE', 'SUSPENDED']).optional(),
      employeeId: z.string().max(40).nullable().optional(),
      department: z.string().max(80).nullable().optional(),
      dateOfJoining: z.string().nullable().optional(),
      workingDays: z.array(z.string()).optional(),
      workingHours: z.string().max(80).nullable().optional(),
      shift: z.string().max(80).nullable().optional(),
      workArea: z.string().max(80).nullable().optional(),
      assignedTables: z.array(z.string()).optional(),
      permissions: z.array(z.string()).optional(),
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
    const {
      name,
      role,
      email,
      phone,
      status,
      employeeId,
      department,
      dateOfJoining,
      workingDays,
      workingHours,
      shift,
      workArea,
      assignedTables,
      permissions,
    } = req.body;
    if (role) assertCanGrant(req.auth!, role as Role);
    if (name) user.name = name;
    if (role) user.role = role;
    if (email !== undefined) user.email = email ? email.toLowerCase() : undefined;
    if (phone !== undefined) user.phone = phone ?? undefined;
    if (status) user.status = status;
    if (employeeId !== undefined) user.employeeId = employeeId ?? undefined;
    if (department !== undefined) user.department = department ?? undefined;
    if (dateOfJoining !== undefined) user.dateOfJoining = dateOfJoining ? new Date(dateOfJoining) : undefined;
    if (workingDays !== undefined) user.workingDays = workingDays;
    if (workingHours !== undefined) user.workingHours = workingHours ?? undefined;
    if (shift !== undefined) user.shift = shift ?? undefined;
    if (workArea !== undefined) user.workArea = workArea ?? undefined;
    if (assignedTables !== undefined) user.assignedTables = assignedTables;
    if (permissions !== undefined) user.permissions = permissions;
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
  '/:id/resend-invite',
  requirePermission('staff:write'),
  validate({ params: z.object({ id: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const user = await UserModel.findOne({ _id: req.params.id, restaurantId: req.auth!.restaurantId });
    if (!user) throw ApiError.notFound('Staff member not found');
    if (!user.email) throw ApiError.badRequest('Staff member does not have an email address');

    // 1. Resend Clerk invite
    const clerkResult = await syncOrInviteClerkStaff({
      email: user.email,
      name: user.name,
      role: user.role,
      restaurantId: String(req.auth!.restaurantId),
    });

    if (clerkResult.clerkUserId && !user.clerkUserId) {
      user.clerkUserId = clerkResult.clerkUserId;
      user.invitationStatus = 'ACCEPTED';
    } else if (clerkResult.invitationId) {
      user.invitationId = clerkResult.invitationId;
      user.invitationStatus = 'PENDING';
    }
    await user.save();

    // 2. Also send internal email OTP invite
    await sendStaffInviteOtp(user.email, req.auth!.restaurantId);

    res.json({
      ok: true,
      message: `Invitation and login code resent to ${user.email}`,
      clerkStatus: clerkResult.status,
    });
  }),
);

staffRouter.delete(
  '/:id',
  requirePermission('staff:write'),
  validate({ params: z.object({ id: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const user = await UserModel.findOne({ _id: req.params.id, restaurantId: req.auth!.restaurantId });
    if (!user) throw ApiError.notFound('Staff member not found');
    if (user.role === 'OWNER') throw ApiError.forbidden('The owner account cannot be deleted');
    if (user.role === 'MANAGER' && req.auth!.role !== 'OWNER') {
      throw ApiError.forbidden('Only the owner can delete a manager account');
    }

    // Soft delete: de-activate account and revoke all sessions; preserve historical order and audit logs
    user.status = 'INACTIVE';
    user.refreshTokens = [];
    await user.save();

    emit.toRestaurant(req.auth!.restaurantId, Events.STAFF_UPDATED, { reason: 'deleted', userId: String(user._id) });
    await recordAudit({
      restaurantId: req.auth!.restaurantId,
      actorId: req.auth!.userId,
      actorName: req.auth!.name,
      action: 'staff.deleted',
      entityType: 'User',
      entityId: String(user._id),
      metadata: { name: user.name, role: user.role },
    });
    res.json({ ok: true });
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
