import { BookingModel, TableModel } from '../models';
import { emit, Events } from '../realtime/emit';
import { ApiError } from '../utils/httpError';
import { notifyRoles } from './notification.service';
import { openSession, setTableStatus } from './table.service';
import { recordAudit } from './audit.service';
import { BOOKING_TRANSITIONS, type BookingStatus, type Role } from '../types/constants';

const BLOCKING_STATUSES: BookingStatus[] = ['PENDING', 'CONFIRMED', 'ARRIVED', 'SEATED'];

interface Actor {
  userId: string | null;
  role: Role | 'SYSTEM';
  name: string;
}

function bookingEventName(status: BookingStatus): string {
  const map: Record<BookingStatus, string> = {
    PENDING: Events.BOOKING_CREATED,
    CONFIRMED: 'booking.confirmed',
    ARRIVED: 'booking.arrived',
    SEATED: 'booking.seated',
    COMPLETED: 'booking.completed',
    CANCELLED: 'booking.cancelled',
    NO_SHOW: 'booking.no_show',
  };
  return map[status];
}

export async function checkAvailability(opts: {
  restaurantId: string;
  startAt: Date;
  durationMinutes: number;
  guests: number;
  tableId?: string;
  excludeBookingId?: string;
}) {
  const endAt = new Date(opts.startAt.getTime() + opts.durationMinutes * 60_000);
  if (opts.startAt.getTime() < Date.now() - 5 * 60_000) {
    throw ApiError.badRequest('Please pick a time in the future');
  }

  const conflictQuery: Record<string, unknown> = {
    restaurantId: opts.restaurantId,
    status: { $in: BLOCKING_STATUSES },
    startAt: { $lt: endAt },
    $expr: {
      $gt: [{ $add: ['$startAt', { $multiply: ['$durationMinutes', 60_000] }] }, opts.startAt],
    },
  };
  if (opts.excludeBookingId) conflictQuery._id = { $ne: opts.excludeBookingId };

  if (opts.tableId) {
    const table = await TableModel.findOne({ _id: opts.tableId, restaurantId: opts.restaurantId }).lean();
    if (!table) throw ApiError.notFound('Table not found');
    const conflict = await BookingModel.findOne({ ...conflictQuery, tableId: table._id }).lean();
    return {
      available: !conflict && table.capacity >= opts.guests,
      reason: conflict
        ? `Table ${table.number} is already booked at that time`
        : table.capacity < opts.guests
          ? `Table ${table.number} seats ${table.capacity} guests`
          : null,
      tableId: String(table._id),
    };
  }

  const tables = await TableModel.find({ restaurantId: opts.restaurantId, capacity: { $gte: opts.guests } })
    .sort({ capacity: 1, number: 1 })
    .lean();
  const conflicts = await BookingModel.find({ ...conflictQuery, tableId: { $in: tables.map((t) => t._id) } })
    .select('tableId')
    .lean();
  const busy = new Set(conflicts.map((c) => String(c.tableId)));
  const free = tables.filter((t) => !busy.has(String(t._id)));
  return {
    available: free.length > 0,
    reason: free.length ? null : 'No table is free for that slot',
    tables: free.map((t) => ({ _id: String(t._id), number: t.number, capacity: t.capacity, section: t.section })),
  };
}

export async function createBooking(opts: {
  restaurantId: string;
  tableId?: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  notes?: string;
  startAt: Date;
  durationMinutes?: number;
  guests: number;
  source: 'CUSTOMER' | 'STAFF';
  actor?: Actor;
  assignedWaiterId?: string;
}) {
  const durationMinutes = opts.durationMinutes ?? 90;
  let tableId = opts.tableId;

  const availability = await checkAvailability({
    restaurantId: opts.restaurantId,
    startAt: opts.startAt,
    durationMinutes,
    guests: opts.guests,
    tableId,
  });
  if (!availability.available) {
    throw ApiError.conflict(availability.reason ?? 'That slot is not available', availability);
  }
  if (!tableId && 'tables' in availability && availability.tables?.length) {
    tableId = availability.tables[0]._id;
  }
  if (!tableId) throw ApiError.conflict('No table is available for that slot');

  const status: BookingStatus = opts.source === 'STAFF' ? 'CONFIRMED' : 'PENDING';
  const booking = await BookingModel.create({
    restaurantId: opts.restaurantId,
    tableId,
    customerName: opts.customerName,
    customerPhone: opts.customerPhone,
    customerEmail: opts.customerEmail ?? '',
    notes: opts.notes ?? '',
    startAt: opts.startAt,
    durationMinutes,
    guests: opts.guests,
    status,
    source: opts.source,
    createdByUserId: opts.actor?.userId ?? null,
    assignedWaiterId: opts.assignedWaiterId ?? null,
    statusHistory: [{ status, at: new Date(), byUserId: opts.actor?.userId ?? null }],
  });

  emit.toRestaurant(opts.restaurantId, Events.BOOKING_CREATED, booking.toObject());
  await notifyRoles(opts.restaurantId, ['MANAGER', 'WAITER'], {
    type: 'BOOKING_CREATED',
    title: `Booking · ${opts.customerName}`,
    body: `${opts.guests} guest(s) · ${opts.startAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`,
    entityType: 'Booking',
    entityId: String(booking._id),
  });

  if (opts.source === 'STAFF' && opts.actor) {
    await recordAudit({
      restaurantId: opts.restaurantId,
      actorId: opts.actor.userId,
      actorName: opts.actor.name,
      action: 'booking.created',
      entityType: 'Booking',
      entityId: String(booking._id),
      metadata: { customerName: opts.customerName, guests: opts.guests, startAt: opts.startAt.toISOString() },
    });
  }
  return booking.toObject();
}

export async function listBookings(
  restaurantId: string,
  filter: { date?: string; from?: Date; to?: Date; status?: BookingStatus; upcomingOnly?: boolean; page?: number; limit?: number },
) {
  const query: Record<string, unknown> = { restaurantId };
  if (filter.date) {
    const start = new Date(`${filter.date}T00:00:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    query.startAt = { $gte: start, $lt: end };
  } else if (filter.from || filter.to) {
    query.startAt = {
      ...(filter.from ? { $gte: filter.from } : {}),
      ...(filter.to ? { $lte: filter.to } : {}),
    };
  }
  if (filter.upcomingOnly) {
    query.startAt = { $gte: new Date(Date.now() - 30 * 60_000) };
    query.status = { $in: ['PENDING', 'CONFIRMED', 'ARRIVED', 'SEATED'] };
  }
  if (filter.status) query.status = filter.status;

  const page = Math.max(1, filter.page ?? 1);
  const limit = Math.min(100, Math.max(1, filter.limit ?? 50));
  const [data, total] = await Promise.all([
    BookingModel.find(query).sort({ startAt: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    BookingModel.countDocuments(query),
  ]);
  return { data, total, page, limit };
}

const TRANSITION_ROLES: Record<BookingStatus, (Role | 'SYSTEM')[]> = {
  PENDING: [],
  CONFIRMED: ['WAITER', 'MANAGER', 'OWNER', 'CASHIER'],
  ARRIVED: ['WAITER', 'MANAGER', 'OWNER', 'CASHIER'],
  SEATED: ['WAITER', 'MANAGER', 'OWNER', 'CASHIER'],
  COMPLETED: ['WAITER', 'MANAGER', 'OWNER', 'CASHIER'],
  CANCELLED: ['MANAGER', 'OWNER', 'CASHIER'],
  NO_SHOW: ['WAITER', 'MANAGER', 'OWNER', 'CASHIER'],
};

export async function transitionBooking(opts: {
  restaurantId: string;
  bookingId: string;
  next: BookingStatus;
  actor: Actor;
}) {
  const booking = await BookingModel.findOne({ _id: opts.bookingId, restaurantId: opts.restaurantId });
  if (!booking) throw ApiError.notFound('Booking not found');
  if (booking.status === opts.next) return booking.toObject();
  if (!BOOKING_TRANSITIONS[booking.status as BookingStatus].includes(opts.next)) {
    throw ApiError.conflict(`Cannot move a booking from ${booking.status} to ${opts.next}`);
  }
  if (!TRANSITION_ROLES[opts.next].includes(opts.actor.role)) {
    throw ApiError.forbidden(`Your role cannot mark a booking as ${opts.next.toLowerCase()}`);
  }

  booking.status = opts.next;
  booking.statusHistory.push({ status: opts.next, at: new Date(), byUserId: (opts.actor.userId ?? null) as never });
  await booking.save();

  if (opts.next === 'ARRIVED' || opts.next === 'CONFIRMED') {
    const soon = booking.startAt.getTime() - Date.now() < 90 * 60_000;
    if (soon) {
      const table = await TableModel.findById(booking.tableId).lean();
      if (table && table.status === 'AVAILABLE') await setTableStatus(table._id, 'RESERVED');
    }
  }
  if (opts.next === 'SEATED') {
    await openSession({
      restaurantId: opts.restaurantId,
      tableId: String(booking.tableId),
      guestCount: booking.guests,
      customerName: booking.customerName,
      via: 'STAFF',
    });
  }
  if (['CANCELLED', 'NO_SHOW', 'COMPLETED'].includes(opts.next)) {
    const table = await TableModel.findById(booking.tableId).lean();
    if (table && table.status === 'RESERVED' && !table.activeSessionId) {
      await setTableStatus(table._id, 'AVAILABLE');
    }
  }

  const payload = booking.toObject();
  emit.toRestaurant(opts.restaurantId, bookingEventName(opts.next), payload);
  emit.toRestaurant(opts.restaurantId, Events.BOOKING_UPDATED, payload);

  if (opts.next === 'NO_SHOW' || opts.next === 'CANCELLED') {
    await recordAudit({
      restaurantId: opts.restaurantId,
      actorId: opts.actor.userId,
      actorName: opts.actor.name,
      action: `booking.${opts.next.toLowerCase()}`,
      entityType: 'Booking',
      entityId: String(booking._id),
      metadata: { customerName: booking.customerName, startAt: booking.startAt.toISOString() },
    });
    await notifyRoles(opts.restaurantId, ['MANAGER'], {
      type: 'BOOKING_CREATED',
      title: `Booking ${opts.next === 'NO_SHOW' ? 'marked no-show' : 'cancelled'}`,
      body: `${booking.customerName} · ${booking.startAt.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}`,
      entityType: 'Booking',
      entityId: String(booking._id),
    });
  }

  return payload;
}
