import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { loginLimiter } from '../../middleware/rateLimit';
import {
  changePassword,
  getProfile,
  login,
  loginWithClerk,
  checkUserExists,
  logout,
  refreshSession,
  registerOwner,
  syncClerkSession,
  registerRestaurant,
} from './auth.service';
import { requestCode, verifyCode } from './otp.service';
import { sendStaffLoginOtp, verifyStaffLoginOtp } from '../../services/emailOtp.service';

export const authRouter = Router();

const passwordSchema = z.string().min(8, 'Use at least 8 characters').max(72);

authRouter.post(
  '/register',
  loginLimiter,
  validate({
    body: z.object({
      restaurantName: z.string().min(2).max(80),
      name: z.string().min(2).max(80),
      email: z.string().email().optional(),
      phone: z.string().min(8).max(15).optional(),
      password: passwordSchema,
      cuisine: z.string().max(60).optional(),
      logoUrl: z.string().max(500).optional(),
      tagline: z.string().max(160).optional(),
      address: z
        .object({
          line1: z.string().max(120).optional(),
          city: z.string().max(60).optional(),
          state: z.string().max(60).optional(),
          pincode: z.string().max(10).optional(),
        })
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await registerOwner(req.body);
    res.status(201).json(result);
  }),
);

authRouter.post(
  '/login',
  loginLimiter,
  validate({
    body: z.object({
      identifier: z.string().min(3, 'Enter your email or phone number'),
      password: z.string().min(1, 'Enter your password'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await login(req.body.identifier, req.body.password);
    res.json(result);
  }),
);

authRouter.post(
  '/clerk',
  loginLimiter,
  validate({
    body: z.object({
      identifier: z.string().min(3, 'Enter your email or phone number'),
      name: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await loginWithClerk(req.body.identifier, req.body.name);
    res.json(result);
  }),
);

authRouter.post(
  '/clerk-sync',
  loginLimiter,
  validate({
    body: z.object({
      clerkUserId: z.string().min(1, 'Clerk user ID is required'),
      email: z.string().email().optional(),
      name: z.string().optional(),
      phone: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await syncClerkSession(req.body);
    res.json(result);
  }),
);

authRouter.post(
  '/register-restaurant',
  loginLimiter,
  validate({
    body: z.object({
      restaurantName: z.string().min(2).max(80),
      clerkUserId: z.string().min(1, 'Clerk user ID is required'),
      name: z.string().min(2).max(80).optional(),
      email: z.string().email().optional(),
      phone: z.string().min(8).max(15).optional(),
      cuisine: z.string().max(60).optional(),
      logoUrl: z.string().max(500).optional(),
      tagline: z.string().max(160).optional(),
      address: z
        .object({
          line1: z.string().max(120).optional(),
          city: z.string().max(60).optional(),
          state: z.string().max(60).optional(),
          pincode: z.string().max(10).optional(),
        })
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await registerRestaurant(req.body);
    res.status(201).json(result);
  }),
);

authRouter.post(
  '/check-user',
  validate({
    body: z.object({
      identifier: z.string().min(3),
    }),
  }),
  asyncHandler(async (req, res) => {
    const exists = await checkUserExists(req.body.identifier);
    res.json({ exists });
  }),
);

/**
 * The floor signs in with the phone number they gave on the job form plus a code that is worth
 * five minutes. Nobody has to be handed a password to start a shift.
 */
authRouter.post(
  '/otp/request',
  loginLimiter,
  validate({ body: z.object({ phone: z.string().min(8).max(20) }) }),
  asyncHandler(async (req, res) => {
    const { requested, code } = await requestCode(req.body.phone);
    // A number we will not text answers the same way as one that does not exist here.
    res.json({ ok: true, sent: requested, demoCode: code });
  }),
);

authRouter.post(
  '/otp/verify',
  loginLimiter,
  validate({
    body: z.object({
      phone: z.string().min(8).max(20),
      code: z.string().regex(/^\d{4,8}$/, 'Enter the digits from the code'),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await verifyCode(req.body.phone, req.body.code));
  }),
);

/**
 * Staff can sign in with their registered work email without needing a password.
 * A 6-digit authentication OTP code is delivered to their email address.
 */
authRouter.post(
  '/email-otp/request',
  loginLimiter,
  validate({ body: z.object({ email: z.string().email('Enter your registered email address') }) }),
  asyncHandler(async (req, res) => {
    const result = await sendStaffLoginOtp(req.body.email);
    res.json(result);
  }),
);

authRouter.post(
  '/email-otp/verify',
  loginLimiter,
  validate({
    body: z.object({
      email: z.string().email(),
      code: z.string().regex(/^\d{4,8}$/, 'Enter the digits from the code'),
    }),
  }),
  asyncHandler(async (req, res) => {
    res.json(await verifyStaffLoginOtp(req.body.email, req.body.code));
  }),
);

authRouter.post(
  '/refresh',
  validate({ body: z.object({ refreshToken: z.string().min(10) }) }),
  asyncHandler(async (req, res) => {
    const result = await refreshSession(req.body.refreshToken);
    res.json(result);
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  validate({ body: z.object({ refreshToken: z.string().min(10).nullish() }) }),
  asyncHandler(async (req, res) => {
    await logout(req.auth!.userId, req.body.refreshToken ?? undefined);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await getProfile(req.auth!.userId);
    res.json(result);
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  validate({
    body: z.object({
      currentPassword: z.string().min(1),
      newPassword: passwordSchema,
    }),
  }),
  asyncHandler(async (req, res) => {
    await changePassword(req.auth!.userId, req.body.currentPassword, req.body.newPassword);
    res.json({ ok: true });
  }),
);
