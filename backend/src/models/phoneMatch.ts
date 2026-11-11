import { UserModel } from './User';
import { phoneDigits } from '../utils/phone';

/**
 * The same number is typed with a country code sometimes and without it other times, and both
 * have to reach one account: the job form, the code request and the code verify all resolve a
 * phone through here. A match is the exact digits, or the same digits with up to three leading
 * country-code digits on either side — which is enough for every real dialling code and too
 * little to let one number walk into somebody else's account.
 */
export async function findUserByTypedPhone(raw: string) {
  const digits = phoneDigits(raw);
  if (digits.length < 8) return [];

  const shorter = [digits];
  for (let cut = 1; cut <= 3; cut += 1) {
    if (digits.length - cut >= 8) shorter.push(digits.slice(cut));
  }
  const longer = new RegExp(`^\\d{0,3}${digits}$`);

  return UserModel.find({ $or: [{ phoneDigits: { $in: shorter } }, { phoneDigits: { $regex: longer } }] }).lean();
}
