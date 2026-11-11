// What a deployed host is, the config decides when the process boots, so the address a platform would
// hand a service has to be in the environment before anything reads the config. That means no static
// imports in this file: every module below is loaded after the variable is set.
process.env.RENDER_EXTERNAL_URL = 'https://deployed.example.com';

const { afterAll, beforeEach, describe, expect, it } = await import('vitest');
const { connectTestDb, disconnectTestDb, makeRestaurant, makeUser, resetDb } = await import('./helpers');
const { UserModel } = await import('../src/models');
const { requestCode } = await import('../src/modules/auth/otp.service');

beforeEach(async () => {
  await connectTestDb();
  await resetDb();
});
afterAll(disconnectTestDb);

async function staffOnShift(role: 'WAITER' | 'OWNER', name: string, phone: string) {
  const { restaurant } = await makeRestaurant();
  const created = await makeUser(restaurant._id, role, name);
  const user = await UserModel.findById(created._id);
  if (!user) throw new Error('no such user');
  user.phone = phone;
  await user.save();
  return user;
}

describe('a code on a server the internet can reach', () => {
  /**
   * No SMS gateway sits behind this build, so the only way a code reaches a person is being printed
   * into the response that asked for it. On a laptop that is the walk-through; on a host with a public
   * address it is a key handed to whoever asked. The account still gets its code, so the flow is not
   * broken — it is simply not readable from outside.
   */
  it('issues the code but keeps it out of the response', async () => {
    await staffOnShift('WAITER', 'Ravi Kumar', '+91 98765 43210');

    const issued = await requestCode('+91 98765 43210');

    expect(issued.requested).toBe(true);
    expect(issued.code).toBeNull();
  });

  it('still refuses a code to someone whose job holds the keys', async () => {
    await staffOnShift('OWNER', 'Anil Deshpande', '+91 98123 45678');

    await expect(requestCode('+91 98123 45678')).resolves.toEqual({ requested: false, code: null });
  });
});

// Top-level await, which TypeScript only allows in a module.
export {};
