// Proves the file store against the production schemas rather than toy ones: the whole point of the
// shim is that 336 existing call sites keep working, so the test speaks their dialect and checks
// both what comes back in memory and what landed on the drive.
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mongoose, { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import '../src/models/Bill';
import '../src/models/Counter';
import '../src/models/Order';
import { claimFolder, defineModel, folderForRestaurant, resetStore, root, startStore } from '../src/store';
import type { FileModel } from '../src/store';

const restaurantId = new Types.ObjectId();
const otherRestaurantId = new Types.ObjectId();

let dir = '';
const bills = defineModel('Bill', mongoose.model('Bill').schema) as FileModel;
const orders = defineModel('Order', mongoose.model('Order').schema) as FileModel;
const counters = defineModel('Counter', mongoose.model('Counter').schema) as FileModel;

function bill(over: Record<string, unknown> = {}) {
  return {
    restaurantId,
    billNumber: `B-${Math.floor(Math.random() * 1e9)}`,
    orderIds: [new Types.ObjectId()],
    subtotal: 500,
    taxTotal: 90,
    grandTotal: 590,
    publicToken: `tok-${Math.floor(Math.random() * 1e9)}`,
    ...over,
  };
}

/** The path a restaurant-scoped collection writes for a document, exactly as layout.ts builds it. */
function path(folder: string, ...rest: string[]): string {
  return join(root(), folder, ...rest);
}

async function readJsonl(file: string): Promise<string[]> {
  const text = await readFile(file, 'utf8');
  return text.split('\n').filter((line) => line.trim().length > 0);
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sizzle-store-'));
  await startStore(dir);
  claimFolder(restaurantId, 'Sizzle Kitchen');
  claimFolder(otherRestaurantId, 'Sizzle Kitchen');
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('the file store answers the way the model did', () => {
  it('casts and defaults through the schema, then writes one readable line', async () => {
    const created = await bills.create(bill({ billNumber: 'B-1', roundOff: '10' }));
    expect(created._id).toBeInstanceOf(Types.ObjectId);
    expect(created.status).toBe('ISSUED');
    expect(created.paymentStatus).toBe('UNPAID');
    expect(created.roundOff).toBe(10);
    expect(created.createdAt).toBeInstanceOf(Date);

    const lines = await readJsonl(path('Sizzle Kitchen', 'bills', ...dayOf(created.createdAt), 'bills.jsonl'));
    expect(lines).toHaveLength(1);
    const onDisk = JSON.parse(lines[0]!);
    expect(onDisk.billNumber).toBe('B-1');
    expect(onDisk.grandTotal).toBe(590);
    // Dates and ids have no JSON form, so the file carries the ISO string and the 24-character hex.
    expect(typeof onDisk.createdAt).toBe('string');
    expect(String(onDisk.restaurantId)).toBe(restaurantId.toHexString());
  });

  it('refuses a document the schema would have refused', async () => {
    await expect(bills.create({ restaurantId, billNumber: 'B-2' })).rejects.toThrow(/required/i);
    expect(await bills.countDocuments({ billNumber: 'B-2' })).toBe(0);
  });

  it('refuses a duplicate the way the unique index did', async () => {
    await bills.create(bill({ billNumber: 'B-3', publicToken: 'shared-token' }));
    const clash = await bills.create(bill({ billNumber: 'B-3' })).catch((err: unknown) => err);
    expect((clash as { code?: number }).code).toBe(11000);
    expect((clash as Error).name).toBe('MongoServerError');
    const tokenClash = await bills.create(bill({ publicToken: 'shared-token' })).catch((err: unknown) => err);
    expect((tokenClash as { code?: number }).code).toBe(11000);
  });

  it('reads a sorted, limited page the way an endpoint does', async () => {
    await orders.create({ restaurantId, orderNumber: 'O-1', source: 'DINE_IN_WAITER', items: [{ name: 'Paneer', price: 330, qty: 1, lineTotal: 330 }], subtotal: 330, taxTotal: 60, grandTotal: 390, placedAt: new Date('2026-10-13T10:00:00Z') });
    await orders.create({ restaurantId, orderNumber: 'O-2', source: 'SWIGGY', items: [{ name: 'Chicken 65', price: 330, qty: 2, lineTotal: 660 }], subtotal: 660, taxTotal: 120, grandTotal: 780, placedAt: new Date('2026-10-13T12:00:00Z') });

    const latest = await orders.find({ restaurantId }).sort({ placedAt: -1 }).limit(1).lean();
    expect(latest).toHaveLength(1);
    expect(latest[0].orderNumber).toBe('O-2');

    const byString = await orders.find({ restaurantId }).sort('-placedAt').lean();
    expect(byString.map((o: Record<string, any>) => o.orderNumber)).toEqual(['O-2', 'O-1']);

    const one = await orders.findOne({ orderNumber: 'O-1' }).lean();
    expect(one?.paymentStatus).toBe('UNPAID');
    expect((await orders.exists({ orderNumber: 'O-1' }))._id).toBeInstanceOf(Types.ObjectId);
    expect(await orders.exists({ orderNumber: 'O-404' })).toBeNull();
  });

  it('keeps document.save() working', async () => {
    const found = (await bills.findOne({ billNumber: 'B-1' }))!;
    found.paymentStatus = 'PAID';
    found.paidAt = new Date('2026-10-13T18:00:00Z');
    await found.save();

    const again = (await bills.findOne({ billNumber: 'B-1' }).lean())!;
    expect(again.paymentStatus).toBe('PAID');
    expect((again.paidAt as Date).toISOString()).toBe('2026-10-13T18:00:00.000Z');
  });

  it('counts a counter up from nothing, the way nextSeq asks for it', async () => {
    const first = await counters.findOneAndUpdate({ key: 'BILL-2026-10-13' }, { $inc: { seq: 1 } }, { new: true, upsert: true }).lean();
    expect(first!.seq).toBe(1);
    const second = await counters.findOneAndUpdate({ key: 'BILL-2026-10-13' }, { $inc: { seq: 1 } }, { new: true, upsert: true }).lean();
    expect(second!.seq).toBe(2);
    expect(await counters.countDocuments()).toBe(1);

    const upserted = await counters.updateOne({ key: 'ORDER-2026-10-13' }, { $inc: { seq: 1 } }, { upsert: true });
    expect(upserted.upsertedCount).toBe(1);
    expect((await counters.findOne({ key: 'ORDER-2026-10-13' }).lean())!.seq).toBe(1);
    expect(await counters.countDocuments()).toBe(2);
  });

  it('files a bill by the Indian calendar day, not the server clock', async () => {
    // 23:30 IST on the 13th is 18:00 UTC, which a UTC-only partitioning would have filed a day late.
    const late = await bills.create(bill({ createdAt: new Date('2026-10-13T18:00:00Z'), updatedAt: new Date('2026-10-13T18:00:00Z') }));
    const midnight = await bills.create(bill({ createdAt: new Date('2026-10-13T18:30:00Z'), updatedAt: new Date('2026-10-13T18:30:00Z') }));
    expect(dayOf(late.createdAt)).toEqual(['2026', '10', '2026-10-13']);
    expect(dayOf(midnight.createdAt)).toEqual(['2026', '10', '2026-10-14']);
    await expect(readFile(path('Sizzle Kitchen', 'bills', '2026', '10', '2026-10-14', 'bills.jsonl'), 'utf8')).resolves.toContain(String(midnight._id));
  });

  it('keeps two restaurants with the same name in separate folders', async () => {
    const second = await bills.create({ ...bill(), restaurantId: otherRestaurantId });
    expect(folderForRestaurant(restaurantId)).toBe('Sizzle Kitchen');
    expect(folderForRestaurant(otherRestaurantId)).toBe('Sizzle Kitchen 2');
    const lines = await readJsonl(path('Sizzle Kitchen 2', 'bills', ...dayOf(second.createdAt), 'bills.jsonl'));
    expect(lines.map((line) => JSON.parse(line).billNumber)).toEqual([second.billNumber]);
  });
});

describe('the archive survives a restart', () => {
  it('reads every file back and rebinds each restaurant to the folder it was written in', async () => {
    const before = {
      bills: await bills.find({}).lean(),
      orders: await orders.find({}).lean(),
      counters: await counters.find({}).lean(),
    };
    expect(before.bills.length).toBeGreaterThan(0);

    resetStore();
    await startStore(dir);

    expect(await bills.countDocuments()).toBe(before.bills.length);
    expect(await orders.countDocuments()).toBe(before.orders.length);
    expect(await counters.countDocuments()).toBe(before.counters.length);

    // The id-to-folder map is learned from the drive, so a renamed restaurant still owns its history.
    expect(folderForRestaurant(restaurantId)).toBe('Sizzle Kitchen');
    expect(folderForRestaurant(otherRestaurantId)).toBe('Sizzle Kitchen 2');

    const restored = (await bills.findOne({ billNumber: 'B-1' }))!;
    expect(restored.createdAt).toBeInstanceOf(Date);
    expect(restored.restaurantId).toBeInstanceOf(Types.ObjectId);
    expect(String(restored.restaurantId)).toBe(restaurantId.toHexString());
    expect(restored.paymentStatus).toBe('PAID');
    expect(await bills.exists({ billNumber: 'B-1' })).toBeTruthy();
  });
});

/** The date folders layout.ts uses, checked against Indian wall-clock time. */
function dayOf(at: Date): string[] {
  const ist = new Date(at.getTime() + 330 * 60_000);
  const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  return [String(ist.getUTCFullYear()), mm, `${ist.getUTCFullYear()}-${mm}-${dd}`];
}
