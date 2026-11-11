import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { connectTestDb, disconnectTestDb, makeDiner, makeRestaurant, resetDb } from './helpers';
import { RestaurantModel, TableModel } from '../src/models';
import { appOrderView, confirmAppCheckout, listAppSeats, placeAppOrder, sitAppGuest, startAppCheckout } from '../src/services/customerApp.service';

beforeEach(async () => {
  await connectTestDb();
  await resetDb();
});
afterAll(disconnectTestDb);

const guest = {
  customerName: 'Aarav Shah',
  customerPhone: '+91 90045 77881',
  customerAddress: '204 Sadashiv Chambers, Baner Road',
  customerCity: 'Pune',
};

describe('the guest ordering app', () => {
  it('puts a delivery ticket in the kitchen with its own private link', async () => {
    const diner = await makeDiner();
    const { order, bill } = await placeAppOrder({
      restaurantId: diner.restaurantId,
      fulfilment: 'DELIVERY',
      paymentMode: 'CASH_ON_DELIVERY',
      ...guest,
      items: [{ productId: diner.mainsProductId, qty: 2 }],
    });

    expect(order.source).toBe('CUSTOMER_APP');
    expect(order.fulfilment).toBe('DELIVERY');
    expect(order.paymentMode).toBe('CASH_ON_DELIVERY');
    expect(order.paymentStatus).toBe('UNPAID');
    expect(order.trackingToken?.length).toBeGreaterThan(16);
    // Cash at the door is not money in the drawer yet, so nothing is billed.
    expect(bill).toBeNull();

    const view = await appOrderView(order.trackingToken ?? '');
    expect(view.orderNumber).toBe(order.orderNumber);
    expect(view.riderName).toBe('');
    expect(view.restaurant?.name).toBe('Test Bistro');
    expect(view.items[0]).toMatchObject({ name: 'Butter Chicken', qty: 2 });
  });

  it('refuses a delivery with nowhere to ride, and honours a paused service area', async () => {
    const diner = await makeDiner();
    await expect(
      placeAppOrder({
        restaurantId: diner.restaurantId,
        fulfilment: 'DELIVERY',
        paymentMode: 'CASH_ON_DELIVERY',
        ...guest,
        customerAddress: '   ',
        items: [{ productId: diner.colaProductId, qty: 1 }],
      }),
    ).rejects.toThrow(/needs an address/);

    await RestaurantModel.updateOne({ _id: diner.restaurantId }, { 'settings.deliveryEnabled': false });
    await expect(
      placeAppOrder({
        restaurantId: diner.restaurantId,
        fulfilment: 'DELIVERY',
        paymentMode: 'UPI',
        ...guest,
        items: [{ productId: diner.colaProductId, qty: 1 }],
      }),
    ).rejects.toThrow(/delivery is paused/);
  });

  it('settles a card intent only through the signed webhook path', async () => {
    const diner = await makeDiner();
    const { order, bill } = await placeAppOrder({
      restaurantId: diner.restaurantId,
      fulfilment: 'PICKUP',
      paymentMode: 'CARD',
      ...guest,
      customerAddress: '',
      items: [{ productId: diner.colaProductId, qty: 2 }],
    });
    expect(bill).not.toBeNull();
    const token = order.trackingToken ?? '';

    const first = await startAppCheckout(token, 'CARD');
    const again = await startAppCheckout(token, 'CARD');
    expect(first.status).toBe('PENDING');
    // Two taps on "pay" are one checkout, not two charges on the same bill.
    expect(String(again._id)).toBe(String(first._id));

    const { payment, bill: settled } = await confirmAppCheckout(token);
    expect(payment?.status).toBe('SUCCEEDED');
    expect(settled?.paymentStatus).toBe('PAID');

    const view = await appOrderView(token);
    expect(view.paymentStatus).toBe('PAID');
    await expect(startAppCheckout(token, 'CARD')).rejects.toThrow(/already paid/);
  });

  it('has nothing to capture on a ticket that was never billed', async () => {
    const diner = await makeDiner();
    const { order } = await placeAppOrder({
      restaurantId: diner.restaurantId,
      fulfilment: 'PICKUP',
      paymentMode: 'CASH_ON_DELIVERY',
      ...guest,
      customerAddress: '',
      items: [{ productId: diner.colaProductId, qty: 1 }],
    });

    await expect(confirmAppCheckout(order.trackingToken ?? '')).rejects.toThrow(/nothing is billed/i);
    await expect(appOrderView('not-a-real-token')).rejects.toThrow(/cannot find that order/i);
  });
});

describe('seating a guest from the app', () => {
  it('offers only free tables, and never the token printed on the sticker', async () => {
    const diner = await makeDiner();
    const seats = await listAppSeats(diner.restaurantId);
    const small = await TableModel.findById(diner.smallTableId).lean();

    expect(seats.map((s) => s.number).sort()).toEqual(['L1', 'S1']);
    expect(seats.every((s) => !s.seatCode.includes(String(small?.qrToken)))).toBe(true);
    // The code is table id + expiry + signature, and it does not contain the sticker token.
    expect(seats[0].seatCode.split('.')).toHaveLength(3);
  });

  it('sits a guest on the chosen seat and opens the same session a scan would', async () => {
    const diner = await makeDiner();
    const [seat] = await listAppSeats(diner.restaurantId);
    const { session, table } = await sitAppGuest({
      restaurantId: diner.restaurantId,
      code: seat.seatCode,
      guestCount: 3,
      customerName: 'Meera Nair',
    });

    expect(table.number).toBe(seat.number);
    expect(session.guestCount).toBe(3);
    expect(session.status).toBe('OPEN');
    expect(String(session.publicToken).length).toBeGreaterThan(16);
    expect((await TableModel.findById(table.id).lean())?.status).toBe('OCCUPIED');
  });

  it('accepts the real sticker when the camera reads it', async () => {
    const diner = await makeDiner();
    const token = String((await TableModel.findById(diner.largeTableId).lean())?.qrToken);

    const { table } = await sitAppGuest({ restaurantId: diner.restaurantId, code: token, guestCount: 5 });
    expect(table.number).toBe('L1');
  });

  it('sits the guest from the printed URL the camera actually returns', async () => {
    const diner = await makeDiner();
    const token = String((await TableModel.findById(diner.smallTableId).lean())?.qrToken);

    const { table } = await sitAppGuest({
      restaurantId: diner.restaurantId,
      code: `https://demo.vercel.app/t/${token}?from=qr`,
      guestCount: 3,
    });
    expect(table.number).toBe('S1');
  });

  it('refuses a seat the room has already taken', async () => {
    const diner = await makeDiner();
    const [seat] = await listAppSeats(diner.restaurantId);
    await sitAppGuest({ restaurantId: diner.restaurantId, code: seat.seatCode });

    // The code was signed while the table was free; a walk-in beat the guest to it.
    await expect(sitAppGuest({ restaurantId: diner.restaurantId, code: seat.seatCode, guestCount: 2 })).rejects.toThrow(/just been taken/);
  });

  it('refuses a tampered or expired seat code', async () => {
    const diner = await makeDiner();
    const [seat] = await listAppSeats(diner.restaurantId);
    const [tableId, , sig] = seat.seatCode.split('.');

    await expect(sitAppGuest({ restaurantId: diner.restaurantId, code: `${tableId}.9999999999999.${sig}` })).rejects.toThrow(/could not match that seat/);
    await expect(sitAppGuest({ restaurantId: diner.restaurantId, code: `${tableId}.${Date.now() + 60000}.deadbeef` })).rejects.toThrow(/could not match that seat/);
  });

  it('will not seat a guest at another restaurant using its own seat code', async () => {
    const diner = await makeDiner();
    const [seat] = await listAppSeats(diner.restaurantId);
    const other = await makeRestaurant();

    await expect(sitAppGuest({ restaurantId: String(other.restaurant._id), code: seat.seatCode })).rejects.toThrow(/could not match that seat/);
  });
});

