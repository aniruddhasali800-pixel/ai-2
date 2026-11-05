import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import nodemailer from 'nodemailer';
import { EmailCodeModel, RestaurantModel, UserModel } from '../models';
import { ApiError } from '../utils/httpError';
import { hashPassword, issueTokens, publicUser } from '../modules/auth/auth.service';
import { env, isDeployedHost } from '../config/env';

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_ATTEMPTS = 5;

/**
 * Deliver email OTP code: sends real email if SMTP is configured, otherwise logs to console.
 */
async function deliverEmailOtp(email: string, code: string, subject: string): Promise<string | null> {
  console.log(`[email:otp] ${subject} -> To: ${email} | Code: ${code}`);

  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = Number(process.env.SMTP_PORT || 465);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM || `"Sizzle Restaurant OS" <${smtpUser || 'noreply@sizzle.com'}>`;

  if (smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      await transporter.sendMail({
        from: smtpFrom,
        to: email,
        subject,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
            <div style="display: flex; align-items: center; margin-bottom: 20px;">
              <span style="font-size: 20px; font-weight: 800; color: #0f172a;">Sizzle <span style="color: #ea580c; font-size: 13px; text-transform: uppercase;">Restaurant OS</span></span>
            </div>
            <h2 style="color: #0f172a; font-size: 20px; margin-top: 0; font-weight: 700;">Verification Code</h2>
            <p style="color: #475569; font-size: 14px; line-height: 1.6;">
              Here is your one-time authentication code. Enter this code to verify your email address.
            </p>
            <div style="background-color: #fff7ed; border: 1.5px solid #fed7aa; border-radius: 10px; padding: 18px; text-align: center; margin: 24px 0;">
              <span style="font-size: 34px; font-weight: 800; letter-spacing: 8px; color: #ea580c; font-family: monospace;">
                ${code}
              </span>
            </div>
            <p style="color: #64748b; font-size: 12.5px; line-height: 1.5;">
              This code will expire in 10 minutes. If you did not request this code, you can safely ignore this email.
            </p>
          </div>
        `,
      });
      console.log(`[email:otp] Real email delivered successfully to ${email}`);
      return null;
    } catch (err: any) {
      console.error(`[email:otp] Could not send real email via SMTP:`, err?.message || err);
    }
  }

  if (env.isProd || isDeployedHost) {
    return null;
  }
  return code;
}

/**
 * 1. Owner requests OTP to verify a new staff member's email before adding them.
 */
export async function sendStaffInviteOtp(email: string, restaurantId: string) {
  const cleanEmail = email.trim().toLowerCase();
  const code = String(randomInt(100_000, 1_000_000));

  // Invalidate any previous pending invite codes for this email
  await EmailCodeModel.deleteMany({ email: cleanEmail, purpose: 'STAFF_INVITE' });

  await EmailCodeModel.create({
    email: cleanEmail,
    restaurantId,
    codeHash: await hashPassword(code),
    purpose: 'STAFF_INVITE',
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  const demoCode = await deliverEmailOtp(
    cleanEmail,
    code,
    'Sizzle Staff Onboarding Verification',
  );

  return { ok: true, sent: true, demoCode };
}

/**
 * Verify the OTP sent to staff email during onboarding.
 */
export async function verifyStaffInviteOtp(email: string, code: string) {
  const cleanEmail = email.trim().toLowerCase();
  const live = await EmailCodeModel.findOne({
    email: cleanEmail,
    purpose: 'STAFF_INVITE',
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  }).select('+codeHash');

  if (!live || live.attempts >= MAX_ATTEMPTS) {
    throw ApiError.badRequest('Verification code is invalid or has expired. Please request a new code.');
  }

  const valid = await bcrypt.compare(code.trim(), live.codeHash);
  if (!valid) {
    live.attempts += 1;
    if (live.attempts >= MAX_ATTEMPTS) live.consumedAt = new Date();
    await live.save();
    throw ApiError.badRequest('Incorrect verification code. Please check your email.');
  }

  live.consumedAt = new Date();
  await live.save();
  return true;
}

/**
 * 2. Staff member logs in using only their email without a password.
 */
export async function sendStaffLoginOtp(email: string) {
  const cleanEmail = email.trim().toLowerCase();
  const user = await UserModel.findOne({ email: cleanEmail });

  if (!user || user.status !== 'ACTIVE') {
    throw ApiError.notFound('No active staff account found with that email address.');
  }

  const code = String(randomInt(100_000, 1_000_000));

  await EmailCodeModel.deleteMany({ email: cleanEmail, purpose: 'STAFF_LOGIN' });

  await EmailCodeModel.create({
    email: cleanEmail,
    userId: user._id,
    restaurantId: user.restaurantId,
    codeHash: await hashPassword(code),
    purpose: 'STAFF_LOGIN',
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  const demoCode = await deliverEmailOtp(
    cleanEmail,
    code,
    `Sign-in code for ${user.name} (${user.role})`,
  );

  return { ok: true, sent: true, demoCode, name: user.name, role: user.role };
}

/**
 * Staff member enters email OTP to verify and obtain access tokens without a password.
 */
export async function verifyStaffLoginOtp(email: string, code: string) {
  const cleanEmail = email.trim().toLowerCase();
  const user = await UserModel.findOne({ email: cleanEmail });

  if (!user || user.status !== 'ACTIVE') {
    throw ApiError.unauthorized('No active account found for that email address.');
  }

  const live = await EmailCodeModel.findOne({
    email: cleanEmail,
    purpose: 'STAFF_LOGIN',
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  }).select('+codeHash');

  if (!live || live.attempts >= MAX_ATTEMPTS) {
    throw ApiError.unauthorized('That sign-in code is incorrect or has expired.');
  }

  const valid = await bcrypt.compare(code.trim(), live.codeHash);
  if (!valid) {
    live.attempts += 1;
    if (live.attempts >= MAX_ATTEMPTS) live.consumedAt = new Date();
    await live.save();
    throw ApiError.unauthorized('That sign-in code is incorrect or has expired.');
  }

  live.consumedAt = new Date();
  await live.save();

  user.lastLoginAt = new Date();
  await user.save();

  const [restaurant, tokens] = await Promise.all([
    RestaurantModel.findById(user.restaurantId).lean(),
    issueTokens(user),
  ]);

  return { user: publicUser(user.toObject()), restaurant, ...tokens };
}

/**
 * 3. Job seeker requests OTP to verify their email address before submitting an application.
 */
export async function sendApplicantOtp(email: string, restaurantName: string) {
  const cleanEmail = email.trim().toLowerCase();
  const code = String(randomInt(100_000, 1_000_000));

  await EmailCodeModel.deleteMany({ email: cleanEmail, purpose: 'APPLICANT_VERIFY' });

  await EmailCodeModel.create({
    email: cleanEmail,
    codeHash: await hashPassword(code),
    purpose: 'APPLICANT_VERIFY',
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  });

  const demoCode = await deliverEmailOtp(
    cleanEmail,
    code,
    `Verification code for ${restaurantName} job application`,
  );

  return { ok: true, sent: true, demoCode };
}

/**
 * Verify OTP entered by job applicant.
 */
export async function verifyApplicantOtp(email: string, code: string) {
  const cleanEmail = email.trim().toLowerCase();
  const live = await EmailCodeModel.findOne({
    email: cleanEmail,
    purpose: 'APPLICANT_VERIFY',
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  }).select('+codeHash');

  if (!live || live.attempts >= MAX_ATTEMPTS) {
    throw ApiError.badRequest('Verification code is invalid or has expired. Please request a new code.');
  }

  const valid = await bcrypt.compare(code.trim(), live.codeHash);
  if (!valid) {
    live.attempts += 1;
    if (live.attempts >= MAX_ATTEMPTS) live.consumedAt = new Date();
    await live.save();
    throw ApiError.badRequest('Incorrect verification code. Please check your email.');
  }

  live.consumedAt = new Date();
  await live.save();
  return true;
}

/**
 * Send a welcome email to an approved employee informing them of their new account and station.
 */
export async function sendStaffWelcomeEmail(input: {
  email: string;
  name: string;
  role: string;
  restaurantName: string;
  loginUrl: string;
}) {
  const cleanEmail = input.email.trim().toLowerCase();
  console.log(`[email:welcome] Sending welcome email to ${cleanEmail} for ${input.restaurantName}`);

  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = Number(process.env.SMTP_PORT || 465);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const smtpFrom = process.env.SMTP_FROM || `"Sizzle Restaurant OS" <${smtpUser || 'noreply@sizzle.com'}>`;

  if (smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpPort === 465,
        auth: { user: smtpUser, pass: smtpPass },
      });

      await transporter.sendMail({
        from: smtpFrom,
        to: cleanEmail,
        subject: `Welcome to ${input.restaurantName}! Your ${input.role} account is ready`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 500px; margin: auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
            <div style="display: flex; align-items: center; margin-bottom: 20px;">
              <span style="font-size: 20px; font-weight: 800; color: #0f172a;">Sizzle <span style="color: #ea580c; font-size: 13px; text-transform: uppercase;">Restaurant OS</span></span>
            </div>
            <h2 style="color: #0f172a; font-size: 20px; margin-top: 0; font-weight: 700;">Welcome to the team, ${input.name}!</h2>
            <p style="color: #475569; font-size: 14px; line-height: 1.6;">
              Your application has been approved at <strong>${input.restaurantName}</strong> for the role of <strong>${input.role}</strong>.
            </p>
            <p style="color: #475569; font-size: 14px; line-height: 1.6;">
              You can log in to your station anytime without needing a password. Simply use your email address or phone number to receive a one-time sign-in code, or sign in with your Google/Apple account or Passkey.
            </p>
            <div style="margin: 24px 0; text-align: center;">
              <a href="${input.loginUrl}" style="background-color: #ea580c; color: #ffffff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px; display: inline-block;">
                Open Staff Station
              </a>
            </div>
            <p style="color: #64748b; font-size: 12px; line-height: 1.5; border-top: 1px solid #f1f5f9; padding-top: 16px;">
              Sign-in link: <a href="${input.loginUrl}" style="color: #ea580c;">${input.loginUrl}</a>
            </p>
          </div>
        `,
      });
      console.log(`[email:welcome] Welcome email delivered successfully to ${cleanEmail}`);
    } catch (err: any) {
      console.error(`[email:welcome] Could not send welcome email via SMTP:`, err?.message || err);
    }
  }
}
