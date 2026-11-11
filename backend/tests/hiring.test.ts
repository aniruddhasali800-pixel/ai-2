import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { RestaurantModel, StaffApplicationModel, UserModel } from '../src/models';
import { connectTestDb, disconnectTestDb, makeRestaurant, makeUser, resetDb } from './helpers';
import { approveApplication, openRolesFor, rejectApplication, submitApplication } from '../src/services/hiring.service';
import { requestCode, verifyCode } from '../src/modules/auth/otp.service';
import { Types } from 'mongoose';
import type { Role } from '../src/types/constants';

beforeEach(async () => {
  await connectTestDb();
  await resetDb();
});
afterAll(disconnectTestDb);

async function dinerWithManagers() {
  const { restaurant, owner } = await makeRestaurant();
  const manager = await makeUser(restaurant._id, 'MANAGER', 'Neha Kapoor');
  const authFor = (u: { _id: Types.ObjectId; name: string; role: Role }) => ({
    restaurantId: String(restaurant._id),
    userId: String(u._id),
    name: u.name,
    role: u.role as Role,
  });
  return {
    restaurant,
    owner,
    manager,
    asOwner: authFor(owner),
    asManager: authFor(manager),
  };
}

/** Save rather than updateOne, so the model's own phoneDigits hook is what the flow relies on. */
async function givePhone(userId: Types.ObjectId, phone: string) {
  const user = await UserModel.findById(userId);
  if (!user) throw new Error('no such user');
  user.phone = phone;
  await user.save();
  return user;
}

const apply = (slug: string, over: Partial<{ name: string; phone: string; role: Role }> = {}) =>
  submitApplication(slug, { name: 'Ravi Kumar', phone: '98765 43210', role: 'WAITER', ...over });

describe('applying from the sticker', () => {
  it('lands a pending application with the number normalised', async () => {
    const { restaurant } = await dinerWithManagers();
    const result = await apply(restaurant.slug);

    expect(result.ok).toBe(true);
    const [app] = await StaffApplicationModel.find({});
    expect(app?.status).toBe('PENDING');
    expect(app?.phoneDigits).toBe('9876543210');
    expect(app?.role).toBe('WAITER');
  });

  it('refuses a job the owner has not left open', async () => {
    const { restaurant } = await dinerWithManagers();
    await RestaurantModel.updateOne({ _id: restaurant._id }, { $set: { 'settings.openRoles': ['KITCHEN'] } });

    await expect(apply(restaurant.slug, { role: 'CASHIER' })).rejects.toThrow(/not hiring for that job/);
    await expect(apply(restaurant.slug, { role: 'KITCHEN' })).resolves.toMatchObject({ ok: true });
  });

  it('refuses a manager account asked for by a stranger', async () => {
    const { restaurant } = await dinerWithManagers();
    await expect(apply(restaurant.slug, { role: 'MANAGER' })).rejects.toThrow();
    expect(await StaffApplicationModel.countDocuments({})).toBe(0);
  });

  it('gives a second application from the same phone the same friendly answer', async () => {
    const { restaurant } = await dinerWithManagers();
    await apply(restaurant.slug);
    const second = await apply(restaurant.slug, { name: 'Ravi K' });

    expect(second).toMatchObject({ ok: true, alreadyApplied: true });
    expect(await StaffApplicationModel.countDocuments({})).toBe(1);
  });

  it('does not let an existing employee apply to themselves', async () => {
    const { restaurant, manager } = await dinerWithManagers();
    await givePhone(manager._id, '+91 98765 43210');

    const result = await apply(restaurant.slug);
    expect(result).toMatchObject({ ok: true, alreadyStaff: true });
    expect(await StaffApplicationModel.countDocuments({})).toBe(0);
  });
});

describe('accepting an application', () => {
  it('opens a floor account that signs in with a code', async () => {
    const { restaurant, asManager } = await dinerWithManagers();
    const applied = await apply(restaurant.slug);
    expect(applied.ok).toBe(true);
    const [app] = await StaffApplicationModel.find({});

    const { account } = await approveApplication(asManager, String(app?._id));
    expect(account.role).toBe('WAITER');
    expect(account.status).toBe('ACTIVE');

    // The whole point of the flow: no password was ever handed to anybody.
    const withPassword = await UserModel.findOne({ phoneDigits: '9876543210' }).select('+passwordHash');
    expect(withPassword?.passwordHash).toBeTruthy();

    const issued = await requestCode('98765-43210');
    expect(issued.code).toMatch(/^\d{6}$/);
    const session = await verifyCode('9876543210', String(issued.code));
    expect(session.user.name).toBe('Ravi Kumar');
    expect(session.accessToken).toBeTruthy();
  });

  it('will not let a manager hand out a manager account', async () => {
    const { restaurant, asManager, asOwner } = await dinerWithManagers();
    await apply(restaurant.slug);
    const [app] = await StaffApplicationModel.find({});

    await expect(approveApplication(asManager, String(app?._id), { role: 'MANAGER' })).rejects.toThrow(/Only the owner/);

    const { account } = await approveApplication(asOwner, String(app?._id), { role: 'MANAGER' });
    expect(account.role).toBe('MANAGER');
  });

  it('refuses to be accepted twice', async () => {
    const { restaurant, asManager } = await dinerWithManagers();
    await apply(restaurant.slug);
    const [app] = await StaffApplicationModel.find({});
    await approveApplication(asManager, String(app?._id));

    await expect(approveApplication(asManager, String(app?._id))).rejects.toThrow(/already been handled/);
    expect(await UserModel.countDocuments({ phoneDigits: '9876543210' })).toBe(1);
  });

  it('declining leaves no account behind', async () => {
    const { restaurant, asManager } = await dinerWithManagers();
    await apply(restaurant.slug);
    const [app] = await StaffApplicationModel.find({});

    const rejected = await rejectApplication(asManager, String(app?._id));
    expect(rejected.status).toBe('REJECTED');
    expect(await UserModel.countDocuments({ phoneDigits: '9876543210' })).toBe(0);
    await expect(requestCode('98765 43210')).resolves.toMatchObject({ requested: false, code: null });
  });
});

describe('one-time sign-in codes', () => {
  it('stay out of reach of the accounts that hold the keys', async () => {
    const { owner, manager } = await dinerWithManagers();
    await givePhone(owner._id, '9000000001');
    await givePhone(manager._id, '9000000002');

    // An unknown number and a number we refuse to text answer identically, so the
    // sign-in form cannot be used to find out who works here.
    await expect(requestCode('9000000001')).resolves.toEqual({ requested: false, code: null });
    await expect(requestCode('9000000002')).resolves.toEqual({ requested: false, code: null });
    await expect(requestCode('9111111111')).resolves.toEqual({ requested: false, code: null });
  });

  it('go silent when one number answers to more than one account', async () => {
    const { restaurant } = await dinerWithManagers();
    const near = await makeUser(restaurant._id, 'WAITER', 'Nikhil Joshi');
    const exact = await makeUser(restaurant._id, 'WAITER', 'Ravi Kumar');
    await givePhone(near._id, '876543210');
    await givePhone(exact._id, '9876543210');

    await expect(requestCode('9876543210')).resolves.toEqual({ requested: false, code: null });
  });

  it('are worth one sign-in and five wrong guesses', async () => {
    const { restaurant, asManager } = await dinerWithManagers();
    await apply(restaurant.slug);
    const [app] = await StaffApplicationModel.find({});
    await approveApplication(asManager, String(app?._id));

    const issued = await requestCode('9876543210');
    const code = String(issued.code);

    for (let i = 0; i < 5; i += 1) {
      await expect(verifyCode('9876543210', code === '000000' ? '111111' : '000000')).rejects.toThrow(/not right|expired/);
    }
    await expect(verifyCode('9876543210', code)).rejects.toThrow(/not right|expired/);

    const fresh = await requestCode('9876543210');
    await verifyCode('9876543210', String(fresh.code));
    await expect(verifyCode('9876543210', String(fresh.code))).rejects.toThrow(/not right|expired/);
  });
});

describe('open roles', () => {
  it('fall back to every floor job rather than an empty form', async () => {
    expect(openRolesFor({ settings: { openRoles: [] } })).toEqual(['WAITER', 'KITCHEN', 'CASHIER']);
    expect(openRolesFor({ settings: null })).toEqual(['WAITER', 'KITCHEN', 'CASHIER']);
    expect(openRolesFor({ settings: { openRoles: ['CASHIER', 'WAITER'] } })).toEqual(['CASHIER', 'WAITER']);
  });
});
