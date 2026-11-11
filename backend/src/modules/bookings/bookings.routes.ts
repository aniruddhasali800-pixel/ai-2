import { Router } from 'express';
import { z } from 'zod';
import { BookingModel, TableModel, UserModel } from '../../models';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { ApiError } from '../../utils/httpError';
import { emit, Events } from '../../realtime/emit';
import { checkAvailability, createBooking, listBookings, transitionBooking } from '../../services/booking.service';
import { BOOKING_STATUSES } from '../../types/constants';
import { queryOf, zFlag } from '../../utils/query';

export const bookingsRouter = Router();

bookingsRouter.use(requireAuth);

const listQuerySchema = z.object({
  date: z.string().optional(),
  status: z.enum(BOOKING_STATUSES).optional(),
  upcomingOnly: zFlag.optional(),
  search: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

type ListQuery = z.infer<typeof listQuerySchema>;

bookingsRouter.get(
  '/',
  requirePermission('bookings:read'),
  validate({ query: listQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = queryOf<ListQuery>(req);
    const result = await listBookings(req.auth!.restaurantId, {
      date: q.date,
      status: q.status,
      upcomingOnly: q.upcomingOnly,
      page: q.page,
      limit: q.limit,
    });

    const tableIds = [...new Set(result.data.map((b) => String(b.tableId)).filter(Boolean))];
    const tables = tableIds.length ? await TableModel.find({ _id: { $in: tableIds } }).select('number section capacity').lean() : [];
    const tableById = new Map(tables.map((t) => [String(t._id), t]));

    const waiterIds = [...new Set(result.data.map((b) => String(b.assignedWaiterId ?? '')).filter(Boolean))];
    const waiters = waiterIds.length ? await UserModel.find({ _id: { $in: waiterIds } }).select('name').lean() : [];
    const waiterById = new Map(waiters.map((w) => [String(w._id), w.name]));

    const needle = q.search?.toLowerCase();
    const data = result.data
      .filter((booking) =>
        !needle
          ? true
          : booking.customerName.toLowerCase().includes(needle) || booking.customerPhone.includes(needle),
      )
      .map((booking) => ({
        ...booking,
        tableNumber: tableById.get(String(booking.tableId))?.number ?? '',
        tableSection: tableById.get(String(booking.tableId))?.section ?? '',
        assignedWaiterName: waiterById.get(String(booking.assignedWaiterId ?? '')) ?? null,
      }));

    res.json({ ...result, data });
  }),
);

const availabilityQuerySchema = z.object({
  startAt: z.string().min(10),
  guests: z.coerce.number().int().min(1).max(40),
  durationMinutes: z.coerce.number().int().min(15).max(300).optional(),
  tableId: z.string().optional(),
});

type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

bookingsRouter.get(
  '/availability',
  requirePermission('bookings:read'),
  validate({ query: availabilityQuerySchema }),
  asyncHandler(async (req, res) => {
    const q = queryOf<AvailabilityQuery>(req);
    const result = await checkAvailability({
      restaurantId: req.auth!.restaurantId,
      startAt: new Date(q.startAt),
      durationMinutes: q.durationMinutes ?? 90,
      guests: q.guests,
      tableId: q.tableId,
    });
    res.json(result);
  }),
);

bookingsRouter.post(
  '/',
  requirePermission('bookings:write'),
  validate({
    body: z.object({
      customerName: z.string().min(2).max(80),
      customerPhone: z.string().min(6).max(20),
      customerEmail: z.string().email().max(120).optional(),
      startAt: z.string().min(10),
      guests: z.number().int().min(1).max(40),
      durationMinutes: z.number().int().min(15).max(300).optional(),
      tableId: z.string().optional(),
      assignedWaiterId: z.string().optional(),
      notes: z.string().max(300).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    if (req.body.assignedWaiterId) {
      const waiter = await UserModel.findOne({ _id: req.body.assignedWaiterId, restaurantId, role: 'WAITER', status: 'ACTIVE' }).lean();
      if (!waiter) throw ApiError.badRequest('Pick an active waiter from your team');
    }

    const booking = await createBooking({
      restaurantId,
      tableId: req.body.tableId,
      customerName: req.body.customerName,
      customerPhone: req.body.customerPhone,
      customerEmail: req.body.customerEmail,
      notes: req.body.notes,
      startAt: new Date(req.body.startAt),
      durationMinutes: req.body.durationMinutes,
      guests: req.body.guests,
      source: 'STAFF',
      actor: { userId: req.auth!.userId, role: req.auth!.role, name: req.auth!.name },
      assignedWaiterId: req.body.assignedWaiterId,
    });
    res.status(201).json(booking);
  }),
);

bookingsRouter.patch(
  '/:id/status',
  requirePermission('bookings:write'),
  validate({
    params: z.object({ id: z.string() }),
    body: z.object({ status: z.enum(BOOKING_STATUSES) }),
  }),
  asyncHandler(async (req, res) => {
    const booking = await transitionBooking({
      restaurantId: req.auth!.restaurantId,
      bookingId: req.params.id,
      next: req.body.status,
      actor: { userId: req.auth!.userId, role: req.auth!.role, name: req.auth!.name },
    });
    res.json(booking);
  }),
);

bookingsRouter.patch(
  '/:id',
  requirePermission('bookings:write'),
  validate({
    params: z.object({ id: z.string() }),
    body: z.object({
      customerName: z.string().min(2).max(80).optional(),
      customerPhone: z.string().min(6).max(20).optional(),
      customerEmail: z.string().email().max(120).optional(),
      startAt: z.string().min(10).optional(),
      guests: z.number().int().min(1).max(40).optional(),
      durationMinutes: z.number().int().min(15).max(300).optional(),
      notes: z.string().max(300).optional(),
      assignedWaiterId: z.string().nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const booking = await BookingModel.findOne({ _id: req.params.id, restaurantId });
    if (!booking) throw ApiError.notFound('Booking not found');
    if (['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(booking.status)) {
      throw ApiError.conflict('This booking is already closed');
    }

    const { startAt, ...rest } = req.body;
    if (startAt || rest.guests || rest.durationMinutes) {
      const availability = await checkAvailability({
        restaurantId,
        startAt: startAt ? new Date(startAt) : booking.startAt,
        durationMinutes: rest.durationMinutes ?? booking.durationMinutes,
        guests: rest.guests ?? booking.guests,
        tableId: String(booking.tableId),
        excludeBookingId: String(booking._id),
      });
      if (!availability.available) throw ApiError.conflict(availability.reason ?? 'That slot is not available');
    }

    if (startAt) booking.startAt = new Date(startAt);
    if (rest.customerName !== undefined) booking.customerName = rest.customerName;
    if (rest.customerPhone !== undefined) booking.customerPhone = rest.customerPhone;
    if (rest.customerEmail !== undefined) booking.customerEmail = rest.customerEmail;
    if (rest.guests !== undefined) booking.guests = rest.guests;
    if (rest.durationMinutes !== undefined) booking.durationMinutes = rest.durationMinutes;
    if (rest.notes !== undefined) booking.notes = rest.notes;
    if (rest.assignedWaiterId !== undefined) booking.assignedWaiterId = (rest.assignedWaiterId ?? null) as never;

    await booking.save();
    const payload = booking.toObject();
    emit.toRestaurant(restaurantId, Events.BOOKING_UPDATED, payload);
    res.json(payload);
  }),
);
