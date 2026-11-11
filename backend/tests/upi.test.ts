import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { connectTestDb, disconnectTestDb, makeDiner, resetDb } from './helpers';
import { RestaurantModel } from '../src/models';
import { upiChargeFor } from '../src/services/upi.service';

beforeEach(async () => {
  await connectTestDb();
  await resetDb();
});
afterAll(disconnectTestDb);

async function withUpi(restaurantId: string, upiId: string, upiName?: string) {
  await RestaurantModel.updateOne({ _id: restaurantId }, { payment: { upiId, upiName: upiName ?? '' } });
}

describe('scan-to-pay UPI charge', () => {
  it('bakes the exact amount and bill reference into the link', async () => {
    const diner = await makeDiner();
    await withUpi(diner.restaurantId, 'saffron@icici', 'Saffron & Smoke');

    const charge = await upiChargeFor(diner.restaurantId, 1520, 'INV-20260927-0004');
    expect(charge).not.toBeNull();
    expect(charge!.link).toBe(
      'upi://pay?pa=saffron@icici&pn=Saffron%20%26%20Smoke&am=1520.00&cu=INR&tn=INV-20260927-0004',
    );
    expect(charge!.qrDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(charge!.amount).toBe(1520);
  });

  it('falls back to the restaurant name when no payee name is set', async () => {
    const diner = await makeDiner();
    await withUpi(diner.restaurantId, 'corner@axis');

    const charge = await upiChargeFor(diner.restaurantId, 99.5, 'INV-7');
    expect(charge!.link).toContain('pn=Test%20Bistro');
    expect(charge!.link).toContain('am=99.50');
  });

  it('offers no QR when the handle is missing or the bill is already zero', async () => {
    const diner = await makeDiner();
    expect(await upiChargeFor(diner.restaurantId, 100, 'INV-1')).toBeNull();

    await withUpi(diner.restaurantId, 'corner@axis');
    expect(await upiChargeFor(diner.restaurantId, 0, 'INV-2')).toBeNull();
  });
});
