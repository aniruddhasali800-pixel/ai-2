import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import bcrypt from 'bcryptjs';
import { RestaurantModel, UserModel } from '../src/models';
import { DEMO_MASTER_PASSWORD, DEMO_TENANT_SLUG } from '../src/config/env';
import { login, logout, refreshSession } from '../src/modules/auth/auth.service';
import { connectTestDb, disconnectTestDb, makeRestaurant, makeUser, resetDb, TEST_PASSWORD } from './helpers';
import type { Role } from '../src/types/constants';

beforeEach(async () => {
  await connectTestDb();
  await resetDb();
});
afterAll(disconnectTestDb);

/** A tenant under the slug the seed uses, because that is the only one the master opens. */
async function demoFloor(role: Role, name: string) {
  const { restaurant, owner } = await makeRestaurant();
  await RestaurantModel.updateOne({ _id: restaurant._id }, { slug: DEMO_TENANT_SLUG });
  const user = await makeUser(restaurant._id, role, name);
  return { restaurant, owner, user };
}

async function anyFloor(role: Role, name: string) {
  const { restaurant, owner } = await makeRestaurant();
  const user = await makeUser(restaurant._id, role, name);
  return { restaurant, owner, user };
}

describe('signing in', () => {
  it('accepts the account’s own password', async () => {
    const { user } = await anyFloor('CASHIER', 'Rohit Deshmukh');
    const session = await login(String(user.email), TEST_PASSWORD);
    expect(session.user).toMatchObject({ _id: String(user._id), role: 'CASHIER' });
    expect(session.accessToken).toBeTruthy();
  });

  it('opens any active account in the demo tenant with the master', async () => {
    const { user } = await demoFloor('KITCHEN', 'Vikram Rathore');
    const session = await login(String(user.email), DEMO_MASTER_PASSWORD);
    expect(session.user).toMatchObject({ _id: String(user._id), role: 'KITCHEN' });
  });

  it('keeps the master out of a restaurant that onboarded itself', async () => {
    const { user } = await anyFloor('OWNER', 'Asha Rao');
    await expect(login(String(user.email), DEMO_MASTER_PASSWORD)).rejects.toThrow(/do not match/i);
    await expect(login(String(user.email), TEST_PASSWORD)).resolves.toMatchObject({
      user: { _id: String(user._id) },
    });
  });

  it('refuses anything else, with the same wording either way', async () => {
    const { user } = await demoFloor('WAITER', 'Sneha Patil');
    await expect(login(String(user.email), 'guess')).rejects.toThrow(/do not match/i);
    await expect(login('nobody@nowhere.test', TEST_PASSWORD)).rejects.toThrow(/do not match/i);
  });

  it('will not resurrect a suspended account through the master', async () => {
    const { user } = await demoFloor('MANAGER', 'Neha Kulkarni');
    await UserModel.updateOne({ _id: user._id }, { status: 'SUSPENDED' });
    await expect(login(String(user.email), DEMO_MASTER_PASSWORD)).rejects.toThrow(/suspended/i);
  });

  it('does not store the master anywhere near the password hash', async () => {
    const { user } = await demoFloor('OWNER', 'Aarav Mehta');
    await login(String(user.email), DEMO_MASTER_PASSWORD);
    const stored = await UserModel.findById(user._id).select('+passwordHash').lean();
    expect(await bcrypt.compare(DEMO_MASTER_PASSWORD, String(stored?.passwordHash))).toBe(false);
  });
});

describe('one account on two devices', () => {
  it('keeps the first sign-in alive when a second device joins', async () => {
    const { user } = await anyFloor('WAITER', 'Sneha Patil');
    const phone = await login(String(user.email), TEST_PASSWORD);
    await login(String(user.email), TEST_PASSWORD);

    // The floor phone is signed in as the same job account as the counter screen; taking the
    // second one must not silence the first, or the waiter stops seeing their own orders.
    const refreshed = await refreshSession(phone.refreshToken);
    expect(refreshed.accessToken).toBeTruthy();
  });

  it('ends only the device that signs out', async () => {
    const { user } = await anyFloor('CASHIER', 'Rohit Deshmukh');
    const laptop = await login(String(user.email), TEST_PASSWORD);
    const tablet = await login(String(user.email), TEST_PASSWORD);

    await logout(String(user._id), laptop.refreshToken);

    await expect(refreshSession(laptop.refreshToken)).rejects.toThrow(/session has ended/i);
    await expect(refreshSession(tablet.refreshToken)).resolves.toMatchObject({ user: { role: 'CASHIER' } });
  });

  it('retires the oldest device once the list is full', async () => {
    const { user } = await anyFloor('MANAGER', 'Neha Kulkarni');
    const first = await login(String(user.email), TEST_PASSWORD);
    for (let i = 0; i < 5; i += 1) await login(String(user.email), TEST_PASSWORD);

    await expect(refreshSession(first.refreshToken)).rejects.toThrow(/session has ended/i);
  });
});
