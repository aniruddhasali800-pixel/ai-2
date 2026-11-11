import { BookingModel, RestaurantModel, TableModel } from '../models';
import { emit, Events } from '../realtime/emit';
import { runDayCloseSweep } from './dayClose.service';
import { notify, notifyRoles } from './notification.service';
import { setTableStatus } from './table.service';

const TICK_MS = 60_000;
let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Background loop: booking reminders, pre-arrival table reservations,
 * stale-session housekeeping and the automatic end-of-day close. Every action is idempotent so
 * missed ticks are safe.
 */
export async function tick(): Promise<{ reminders: number; reserved: number; closed: number }> {
  if (running) return { reminders: 0, reserved: 0, closed: 0 };
  running = true;
  try {
    const reminders = await sendBookingReminders();
    const reserved = await reserveUpcomingTables();
    const closed = (await runDayCloseSweep()).length;
    return { reminders, reserved, closed };
  } finally {
    running = false;
  }
}

async function sendBookingReminders(): Promise<number> {
  const now = new Date();
  const candidates = await BookingModel.find({
    status: 'CONFIRMED',
    reminderSentAt: null,
    startAt: { $gte: now, $lte: new Date(now.getTime() + 6 * 60 * 60_000) },
  }).limit(50);

  let sent = 0;
  for (const booking of candidates) {
    const restaurant = await RestaurantModel.findById(booking.restaurantId).lean();
    if (!restaurant) continue;
    const leadMinutes = restaurant.settings?.bookingReminderMinutes ?? 60;
    const minutesAway = (booking.startAt.getTime() - now.getTime()) / 60_000;
    if (minutesAway > leadMinutes) continue;

    booking.reminderSentAt = now;
    await booking.save();

    const table = await TableModel.findById(booking.tableId).select('number').lean();
    const when = booking.startAt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const title = `Booking in ${Math.max(1, Math.round(minutesAway))} min · ${booking.customerName}`;
    const body = `${booking.guests} guest(s) · Table ${table?.number ?? '—'} at ${when}`;
    const payload = { booking: booking.toObject(), minutesAway: Math.round(minutesAway) };

    emit.toRestaurant(String(booking.restaurantId), Events.BOOKING_REMINDER, payload);

    if (booking.assignedWaiterId) {
      emit.toWaiter(String(booking.assignedWaiterId), Events.BOOKING_REMINDER, payload);
      await notify({
        restaurantId: String(booking.restaurantId),
        recipientId: String(booking.assignedWaiterId),
        type: 'BOOKING_REMINDER',
        title,
        body,
        entityType: 'Booking',
        entityId: String(booking._id),
      });
    } else {
      await notifyRoles(String(booking.restaurantId), ['WAITER', 'MANAGER'], {
        type: 'BOOKING_REMINDER',
        title,
        body,
        entityType: 'Booking',
        entityId: String(booking._id),
      });
    }
    sent += 1;
  }
  return sent;
}

async function reserveUpcomingTables(): Promise<number> {
  const now = new Date();
  const horizon = new Date(now.getTime() + 90 * 60_000);
  const bookings = await BookingModel.find({
    status: 'CONFIRMED',
    startAt: { $gte: now, $lte: horizon },
  })
    .select('restaurantId tableId')
    .lean();

  if (!bookings.length) return 0;
  const tableIds = bookings.map((b) => b.tableId);
  const available = await TableModel.find({
    _id: { $in: tableIds },
    status: 'AVAILABLE',
    activeSessionId: null,
  })
    .select('_id')
    .lean();

  let marked = 0;
  for (const table of available) {
    await setTableStatus(table._id, 'RESERVED');
    marked += 1;
  }
  return marked;
}

export function startScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick().catch((err) => console.error('[scheduler] tick failed:', err));
  }, TICK_MS);
  timer.unref?.();
  void tick().catch((err) => console.error('[scheduler] initial tick failed:', err));
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
