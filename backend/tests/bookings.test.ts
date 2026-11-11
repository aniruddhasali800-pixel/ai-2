import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { connectTestDb, disconnectTestDb, makeDiner, makeRestaurant, resetDb } from './helpers';
import { checkAvailability, createBooking, transitionBooking } from '../src/services/booking.service';
import { TableModel } from '../src/models';

beforeEach(async () => {
  await connectTestDb();
  await resetDb();
});
afterAll(disconnectTestDb);

const later = (hours: number) => new Date(Date.now() + hours * 60 * 60_000);

describe('availability', () => {
  it('auto-picks the smallest table that fits the party', async () => {
    const diner = await makeDiner();
    const booking = await createBooking({
      restaurantId: diner.restaurantId,
      customerName: 'Rohan Kapoor',
      customerPhone: '9820011223',
      guests: 5,
      startAt: later(3),
      source: 'STAFF',
    });

    expect(booking.status).toBe('CONFIRMED');
    expect(String(booking.tableId)).toBe(diner.largeTableId);
  });

  it('refuses a party bigger than the table', async () => {
    const diner = await makeDiner();
    await expect(
      createBooking({
        restaurantId: diner.restaurantId,
        tableId: diner.smallTableId,
        customerName: 'Big Group',
        customerPhone: '9820011224',
        guests: 8,
        startAt: later(3),
        source: 'CUSTOMER',
      }),
    ).rejects.toThrow(/seats 2 guests/);
  });

  it('refuses overlapping bookings on the same table', async () => {
    const diner = await makeDiner();
    const first = await createBooking({
      restaurantId: diner.restaurantId,
      tableId: diner.largeTableId,
      customerName: 'Ananya Ghosh',
      customerPhone: '9820011225',
      guests: 4,
      startAt: later(3),
      durationMinutes: 90,
      source: 'STAFF',
    });
    expect(first.status).toBe('CONFIRMED');

    await expect(
      createBooking({
        restaurantId: diner.restaurantId,
        tableId: diner.largeTableId,
        customerName: 'Sunil Menon',
        customerPhone: '9820011226',
        guests: 3,
        startAt: later(4),
        durationMinutes: 90,
        source: 'CUSTOMER',
      }),
    ).rejects.toThrow(/already booked/);

    // A slot that starts after the first booking ends is free again.
    const laterBooking = await createBooking({
      restaurantId: diner.restaurantId,
      tableId: diner.largeTableId,
      customerName: 'Farhan Ali',
      customerPhone: '9820011227',
      guests: 3,
      startAt: later(5),
      durationMinutes: 60,
      source: 'CUSTOMER',
    });
    expect(laterBooking.status).toBe('PENDING');
  });

  it('reports free tables for a slot', async () => {
    const diner = await makeDiner();
    await createBooking({
      restaurantId: diner.restaurantId,
      tableId: diner.largeTableId,
      customerName: 'Blocking Guest',
      customerPhone: '9820011228',
      guests: 6,
      startAt: later(3),
      source: 'STAFF',
    });

    const forFour = await checkAvailability({
      restaurantId: diner.restaurantId,
      startAt: later(3),
      durationMinutes: 90,
      guests: 4,
    });
    expect(forFour.available).toBe(false);

    const forTwo = await checkAvailability({
      restaurantId: diner.restaurantId,
      startAt: later(3),
      durationMinutes: 90,
      guests: 2,
    });
    expect(forTwo.available).toBe(true);
    const freeTables = 'tables' in forTwo ? forTwo.tables : undefined;
    expect(freeTables?.map((t) => t._id)).toEqual([diner.smallTableId]);
  });

  it('rejects times in the past', async () => {
    const diner = await makeDiner();
    await expect(
      checkAvailability({
        restaurantId: diner.restaurantId,
        startAt: new Date(Date.now() - 60 * 60_000),
        durationMinutes: 90,
        guests: 2,
      }),
    ).rejects.toThrow(/future/);
  });

  it('never leaks another tenant table', async () => {
    const a = await makeDiner();
    const b = await makeRestaurant();
    await expect(
      checkAvailability({
        restaurantId: String(b.restaurant._id),
        startAt: later(3),
        durationMinutes: 90,
        guests: 2,
        tableId: a.smallTableId,
      }),
    ).rejects.toThrow(/Table not found/);
  });
});

describe('booking lifecycle', () => {
  it('seating a guest opens a table session and marks the table occupied', async () => {
    const diner = await makeDiner();
    const booking = await createBooking({
      restaurantId: diner.restaurantId,
      tableId: diner.largeTableId,
      customerName: 'Tanya Bhatt',
      customerPhone: '9820011229',
      guests: 4,
      startAt: later(1),
      source: 'STAFF',
      actor: { userId: diner.managerId, role: 'MANAGER', name: 'Neha' },
    });

    const manager = { userId: diner.managerId, role: 'MANAGER' as const, name: 'Neha' };
    await transitionBooking({
      restaurantId: diner.restaurantId,
      bookingId: String(booking._id),
      next: 'ARRIVED',
      actor: manager,
    });
    const seated = await transitionBooking({
      restaurantId: diner.restaurantId,
      bookingId: String(booking._id),
      next: 'SEATED',
      actor: manager,
    });

    expect(seated.status).toBe('SEATED');
    const table = await TableModel.findById(diner.largeTableId).lean();
    expect(table?.status).toBe('OCCUPIED');
    expect(table?.activeSessionId).toBeTruthy();
  });

  it('blocked roles cannot cancel a booking', async () => {
    const diner = await makeDiner();
    const booking = await createBooking({
      restaurantId: diner.restaurantId,
      customerName: 'Kavya Reddy',
      customerPhone: '9820011230',
      guests: 2,
      startAt: later(2),
      source: 'CUSTOMER',
    });

    await expect(
      transitionBooking({
        restaurantId: diner.restaurantId,
        bookingId: String(booking._id),
        next: 'CANCELLED',
        actor: { userId: diner.waiterId, role: 'WAITER', name: 'Sneha' },
      }),
    ).rejects.toThrow(/cannot mark a booking as cancelled/);
  });
});
