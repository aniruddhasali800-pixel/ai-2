import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { LoginCodeModel, RestaurantModel, UserModel } from '../../models';
import { findUserByTypedPhone } from '../../models/phoneMatch';
import { env, isDeployedHost } from '../../config/env';
import { ApiError } from '../../utils/httpError';
import { phoneDigits } from '../../utils/phone';
import { FLOOR_ROLES } from '../../types/constants';
import { hashPassword, issueTokens, publicUser } from './auth.service';

const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const MAX_CODES_PER_QUARTER_HOUR = 3;

/**
 * One number has to reach one account however it was typed. Where two accounts answer to the
 * same number, a code would land on whichever the database happened to read first, so that
 * case gets the same silence as an unknown number and a manager sorts it out.
 */
async function resolveAccount(rawPhone: string) {
  const matches = await findUserByTypedPhone(rawPhone);
  return matches.length === 1 ? UserModel.findById(matches[0]._id) : null;
}

/**
 * A code only ever goes to a floor account. The owner and the manager hold the keys to staff,
 * settings and refunds, so they keep signing in with a password — and a code that a demo build
 * can show on screen is not something either of those should be able to reach.
 */
export async function requestCode(rawPhone: string) {
  const digits = phoneDigits(rawPhone);
  const user = await resolveAccount(rawPhone);
  // An unknown number and one we will not text both answer the same way, so the form cannot
  // be used to find out who works at this restaurant.
  if (!user || user.status !== 'ACTIVE' || !FLOOR_ROLES.includes(user.role as (typeof FLOOR_ROLES)[number])) {
    return { requested: false, code: null };
  }

  const since = new Date(Date.now() - 15 * 60 * 1000);
  const recent = await LoginCodeModel.countDocuments({ userId: user._id, createdAt: { $gte: since } });
  if (recent >= MAX_CODES_PER_QUARTER_HOUR) {
    throw ApiError.tooManyRequests('Too many codes to that number. Try again in a few minutes.');
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  // One live code per account: asking again kills the one still on the screen.
  await LoginCodeModel.deleteMany({ userId: user._id });
  await LoginCodeModel.create({
    userId: user._id,
    phoneDigits: digits,
    codeHash: await hashPassword(code),
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });

  return { requested: true, code: deliver(user.name, user.phone, code) };
}

export async function verifyCode(rawPhone: string, code: string) {
  const user = await resolveAccount(rawPhone);
  if (!user || user.status !== 'ACTIVE') throw ApiError.unauthorized('That code is not right, or it has expired');

  const live = await LoginCodeModel.findOne({ userId: user._id, consumedAt: null, expiresAt: { $gt: new Date() } }).select(
    '+codeHash',
  );
  if (!live || live.attempts >= MAX_ATTEMPTS) throw ApiError.unauthorized('That code is not right, or it has expired');

  if (!(await bcrypt.compare(code, live.codeHash))) {
    live.attempts += 1;
    // Five wrong guesses and the code is burned, so a lucky guesser gets five tries, not more.
    if (live.attempts >= MAX_ATTEMPTS) live.consumedAt = new Date();
    await live.save();
    throw ApiError.unauthorized('That code is not right, or it has expired');
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
 * No SMS gateway is wired into this build, the same way no bank sits behind the payment mock.
 * On a laptop with nothing beside it the code is logged and handed back for the screen to show, which
 * is the only way the flow can be walked through at all. A deployed host stays silent rather than
 * pretending a text was sent, because a code returned in an HTTP response is a key anybody who can
 * reach that address can ask for — and that includes a host left running with `NODE_ENV=development`.
 * Set an SMS provider and this function is the one line to change.
 */
function deliver(
  name: string | null | undefined,
  phone: string | null | undefined,
  code: string,
): string | null {
  if (env.isProd || isDeployedHost) {
    console.warn(`[sms] no gateway configured — the code for ${name ?? phone} was not sent to anyone`);
    return null;
  }
  console.log(`[sms:mock] sign-in code for ${name ?? phone}: ${code}`);
  return code;
}
