import { Router } from 'express';
import { z } from 'zod';
import { BillModel, CustomerRequestModel, OrderModel, TableModel, TableSessionModel, UserModel } from '../../models';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { ApiError } from '../../utils/httpError';
import { emit, Events } from '../../realtime/emit';
import { openSession, serializeTable, setTableStatus, takeTableForWaiter } from '../../services/table.service';
import { notify, notifyRoles } from '../../services/notification.service';
import { createBill, recordCashPayment } from '../../services/billing.service';
import { recordAudit } from '../../services/audit.service';
import { REQUEST_TYPES, type Role } from '../../types/constants';

export const waitersRouter = Router();

waitersRouter.use(requireAuth);

/** Table map with live session, order totals and open requests per table. */
waitersRouter.get(
  '/map',
  requirePermission('tables:read'),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const [tables, sessions, orders, requests, waiters] = await Promise.all([
      TableModel.find({ restaurantId }).sort({ section: 1, number: 1 }).lean(),
      TableSessionModel.find({ restaurantId, status: { $ne: 'CLOSED' } }).lean(),
      OrderModel.find({
        restaurantId,
        status: { $in: ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED'] },
      })
        .select('orderNumber tableId tableSessionId status grandTotal items')
        .lean(),
      CustomerRequestModel.find({ restaurantId, status: { $ne: 'DONE' } }).lean(),
      UserModel.find({ restaurantId, role: 'WAITER', status: 'ACTIVE' }).select('name').lean(),
    ]);

    const sessionByTable = new Map(sessions.map((s) => [String(s.tableId), s]));
    const waiterNames = new Map(waiters.map((w) => [String(w._id), w.name]));
    const billIds = [...new Set(requests.filter((r) => r.billId).map((r) => String(r.billId)))];
    const bills = billIds.length
      ? await BillModel.find({ _id: { $in: billIds }, restaurantId }).select('billNumber grandTotal publicToken').lean()
      : [];
    const billById = new Map(bills.map((b) => [String(b._id), b]));

    res.json({
      data: tables.map((table) => {
        const session = sessionByTable.get(String(table._id));
        const tableOrders = orders.filter((o) => String(o.tableId) === String(table._id));
        return {
          ...serializeTable(table),
          assignedWaiterName: table.assignedWaiterId ? waiterNames.get(String(table.assignedWaiterId)) ?? null : null,
          mine: String(table.assignedWaiterId ?? '') === req.auth!.userId,
          session: session
            ? {
                _id: String(session._id),
                publicToken: session.publicToken,
                status: session.status,
                guestCount: session.guestCount,
                customerName: session.customerName,
                openedAt: session.openedAt,
              }
            : null,
          activeOrders: tableOrders.map((o) => ({
            _id: String(o._id),
            orderNumber: o.orderNumber,
            status: o.status,
            grandTotal: o.grandTotal,
            itemCount: o.items.reduce((sum, item) => sum + item.qty, 0),
          })),
          openRequests: requests
            .filter((r) => String(r.tableId) === String(table._id))
            .map((r) => {
              const bill = r.billId ? billById.get(String(r.billId)) : undefined;
              return {
                _id: String(r._id),
                type: r.type,
                note: r.note,
                status: r.status,
                createdAt: r.createdAt,
                // Once the counter has answered a bill call the ticket is on it, so the floor
                // card can show the QR instead of asking again.
                billNumber: bill?.billNumber ?? null,
                billGrandTotal: bill?.grandTotal ?? null,
                billPublicToken: bill?.publicToken ?? null,
              };
            }),
          runningTotal: tableOrders.reduce((sum, o) => sum + o.grandTotal, 0),
        };
      }),
    });
  }),
);

waitersRouter.get(
  '/requests',
  requirePermission('requests:read'),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const onlyOpen = req.query.open !== 'false';
    const requests = await CustomerRequestModel.find({
      restaurantId,
      ...(onlyOpen ? { status: { $ne: 'DONE' } } : {}),
    })
      .sort({ createdAt: -1 })
      .limit(60)
      .lean();

    const tables = await TableModel.find({ restaurantId }).select('number assignedWaiterId').lean();
    const tableById = new Map(tables.map((t) => [String(t._id), t]));
    // A cash round is collected against a figure, so the waiter screen has to show it.
    const billIds = [...new Set(requests.filter((r) => r.billId).map((r) => String(r.billId)))];
    const bills = billIds.length
      ? await BillModel.find({ _id: { $in: billIds }, restaurantId }).select('billNumber grandTotal publicToken').lean()
      : [];
    const billById = new Map(bills.map((b) => [String(b._id), b]));

    res.json({
      data: requests.map((r) => {
        const bill = r.billId ? billById.get(String(r.billId)) : undefined;
        return {
          ...r,
          tableNumber: tableById.get(String(r.tableId))?.number ?? '—',
          mine: String(tableById.get(String(r.tableId))?.assignedWaiterId ?? '') === req.auth!.userId,
          billNumber: bill?.billNumber ?? null,
          billGrandTotal: bill?.grandTotal ?? null,
          // The floor needs this to open the bill and show the guest the QR.
          billPublicToken: bill?.publicToken ?? null,
        };
      }),
    });
  }),
);

waitersRouter.patch(
  '/requests/:id',
  requirePermission('requests:write'),
  validate({
    params: z.object({ id: z.string() }),
    body: z.object({ status: z.enum(['ACKNOWLEDGED', 'DONE']) }),
  }),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const request = await CustomerRequestModel.findOne({ _id: req.params.id, restaurantId });
    if (!request) throw ApiError.notFound('Request not found');

    request.status = req.body.status;
    request.handledByUserId = req.auth!.userId as never;
    request.handledAt = req.body.status === 'DONE' ? new Date() : request.handledAt;
    await request.save();

    const payload = { ...request.toObject(), tableNumber: undefined };
    emit.toRestaurant(restaurantId, Events.REQUEST_UPDATED, payload);
    const session = await TableSessionModel.findById(request.tableSessionId).select('publicToken').lean();
    if (session) emit.toSession(session.publicToken, Events.REQUEST_UPDATED, payload);
    res.json(payload);
  }),
);

/**
 * The counter or the back office answers a call. A bill request is answered by cutting the bill
 * right here and pushing it back to the floor, which is what the waiter shows the guest to scan;
 * a clear request is answered by turning the table over. A waiter may raise these but not answer
 * them — otherwise the call leaves the queue with nobody having collected anything.
 */
waitersRouter.post(
  '/requests/:id/accept',
  requirePermission('requests:write'),
  validate({ params: z.object({ id: z.string() }) }),
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    if (auth.role === 'WAITER') throw ApiError.forbidden('The counter or the office answers these');
    const restaurantId = auth.restaurantId;
    if (!restaurantId) throw ApiError.forbidden('No restaurant context');
    const request = await CustomerRequestModel.findOne({ _id: req.params.id, restaurantId });
    if (!request) throw ApiError.notFound('Request not found');
    if (request.status === 'DONE') throw ApiError.conflict('That call is already closed');

    const table = await TableModel.findById(request.tableId).select('number assignedWaiterId').lean();
    const tableNumber = table?.number ?? '—';
    const waiterId = table?.assignedWaiterId ? String(table.assignedWaiterId) : null;
    const actor = { userId: auth.userId, role: auth.role, name: auth.name };
    const session = await TableSessionModel.findById(request.tableSessionId).select('publicToken').lean();

    const finish = async (status: 'ACKNOWLEDGED' | 'DONE') => {
      request.status = status;
      request.handledByUserId = auth.userId as never;
      request.handledAt = new Date();
      await request.save();
      const payload = { ...request.toObject(), tableNumber };
      emit.toRestaurant(restaurantId, Events.REQUEST_UPDATED, payload);
      if (session) emit.toSession(session.publicToken, Events.REQUEST_UPDATED, payload);
      return payload;
    };

    if (request.type === 'TABLE_CLEAR') {
      const { updated } = await freeTable(restaurantId, String(request.tableId), actor);
      const payload = await finish('DONE');
      await recordAudit({
        restaurantId,
        actorId: auth.userId,
        actorName: auth.name,
        action: 'table.cleared',
        entityType: 'Table',
        entityId: String(request.tableId),
        metadata: { number: tableNumber, via: 'clear request' },
      });
      if (waiterId && waiterId !== auth.userId) {
        await notify({
          restaurantId,
          recipientId: waiterId,
          type: 'SYSTEM',
          title: `Table ${tableNumber} is free`,
          body: 'The counter confirmed the clear — seat the next party whenever you like',
          entityType: 'Table',
          entityId: String(request.tableId),
        });
      }
      // Whoever actually asked gets the answer, which is not always the waiter holding the table.
      const raiserId = request.raisedByUserId ? String(request.raisedByUserId) : null;
      if (raiserId && raiserId !== auth.userId && raiserId !== waiterId) {
        await notify({
          restaurantId,
          recipientId: raiserId,
          type: 'SYSTEM',
          title: `Table ${tableNumber} is free`,
          body: `Cleared by ${auth.name}`,
          entityType: 'Table',
          entityId: String(request.tableId),
        });
      }
      return res.json({ request: payload, table: updated });
    }

    if (request.type !== 'BILL') {
      const payload = await finish('ACKNOWLEDGED');
      return res.json({ request: payload });
    }

    const unbilled = await OrderModel.countDocuments({
      restaurantId,
      tableSessionId: request.tableSessionId,
      status: { $ne: 'CANCELLED' },
      billId: null,
    });
    const owed = await BillModel.findOne({
      restaurantId,
      tableSessionId: request.tableSessionId,
      paymentStatus: 'UNPAID',
      status: 'ISSUED',
    }).lean();

    if (!unbilled && !owed) {
      // Nothing to bill and nothing unpaid: the party has already settled, so the call is answered
      // by closing it rather than by inventing a bill.
      const payload = await finish('DONE');
      if (waiterId && waiterId !== auth.userId) {
        await notify({
          restaurantId,
          recipientId: waiterId,
          type: 'BILL_REQUESTED',
          title: `Table ${tableNumber} is already settled`,
          body: 'Nothing was owed — clear the table when you get a moment',
          entityType: 'CustomerRequest',
          entityId: String(request._id),
        });
      }
      return res.json({ request: payload, settled: true });
    }

    const bill = await createBill({ restaurantId, actor, sessionId: String(request.tableSessionId) });
    request.billId = bill._id as never;
    const payload = await finish('ACKNOWLEDGED');
    emit.toRestaurant(restaurantId, Events.BILL_CREATED, { ...bill, tableNumber });
    if (session) emit.toSession(session.publicToken, Events.BILL_CREATED, bill);

    const billed = {
      type: 'BILL_REQUESTED' as const,
      title: `Bill ${bill.billNumber} is ready for table ${tableNumber}`,
      body: `₹${bill.grandTotal.toFixed(2)} · open it on your floor screen and show the QR`,
      entityType: 'Bill',
      entityId: String(bill._id),
      data: { billId: String(bill._id), billToken: bill.publicToken, tableId: String(request.tableId) },
    };
    // The bill goes to the hands that can show it: whoever raised the call, and the name on the
    // table. On an open floor those are not always the same waiter.
    const recipients = [...new Set([waiterId, String(request.raisedByUserId ?? '')].filter((id): id is string => !!id && id !== auth.userId))];
    if (recipients.length) {
      await Promise.all(recipients.map((id) => notify({ restaurantId, recipientId: id, ...billed })));
    } else {
      // Nobody on the floor had touched the table, so the bill call goes to whoever is standing there.
      await notifyRoles(restaurantId, ['WAITER'], billed);
    }
    res.json({ request: payload, bill, publicUrl: bill.publicToken });
  }),
);

const cashBody = z.object({ tendered: z.number().min(0).max(1_000_000) });

async function cashRequestOr404(restaurantId: string, id: string) {
  const request = await CustomerRequestModel.findOne({ _id: id, restaurantId });
  if (!request) throw ApiError.notFound('Request not found');
  if (request.type !== 'CASH_PAYMENT') throw ApiError.badRequest('Only a cash-payment request moves cash');
  if (request.status === 'DONE') throw ApiError.conflict('That cash round is already closed');
  if (!request.billId) throw ApiError.conflict('Issue the bill for this table first');
  const bill = await BillModel.findOne({ _id: request.billId, restaurantId });
  if (!bill) throw ApiError.notFound('Bill not found');
  return { request, bill };
}

/** A waiter took the notes at the table; the amount now waits for the counter. */
waitersRouter.post(
  '/requests/:id/collect',
  requirePermission('requests:write'),
  validate({ params: z.object({ id: z.string() }), body: cashBody }),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const { request, bill } = await cashRequestOr404(restaurantId, req.params.id);
    if (bill.paymentStatus !== 'UNPAID') throw ApiError.conflict('This bill is already settled');
    if (req.body.tendered < bill.grandTotal) {
      throw ApiError.badRequest(`Table ${bill.tableNumber} owes ${bill.grandTotal.toFixed(2)}`);
    }

    request.status = 'ACKNOWLEDGED';
    request.tendered = req.body.tendered;
    request.collectedByUserId = req.auth!.userId as never;
    request.collectedAt = new Date();
    request.handledByUserId = req.auth!.userId as never;
    await request.save();

    const session = await TableSessionModel.findById(request.tableSessionId).select('publicToken').lean();
    const payload = { ...request.toObject(), tableNumber: bill.tableNumber };
    emit.toRestaurant(restaurantId, Events.REQUEST_UPDATED, payload);
    if (session) emit.toSession(session.publicToken, Events.REQUEST_UPDATED, payload);

    await notify({
      restaurantId,
      recipientId: req.auth!.userId,
      type: 'CUSTOMER_REQUEST',
      title: `Carry ${req.body.tendered.toFixed(2)} to the counter`,
      body: `Table ${bill.tableNumber} · bill ${bill.billNumber}`,
      entityType: 'CustomerRequest',
      entityId: String(request._id),
    });
    await notifyRoles(restaurantId, ['CASHIER'], {
      type: 'CUSTOMER_REQUEST',
      title: `Cash of ${req.body.tendered.toFixed(2)} coming in for table ${bill.tableNumber}`,
      body: `${bill.billNumber} · ${req.auth!.name} collected it at the table`,
      entityType: 'CustomerRequest',
      entityId: String(request._id),
    });
    await recordAudit({
      restaurantId,
      actorId: req.auth!.userId,
      actorName: req.auth!.name,
      action: 'cash.collected',
      entityType: 'CustomerRequest',
      entityId: String(request._id),
      metadata: { billNumber: bill.billNumber, grandTotal: bill.grandTotal, tendered: req.body.tendered },
    });
    res.json(payload);
  }),
);

/** The counter counts the notes into the drawer — the bill settles and the table frees. */
waitersRouter.post(
  '/requests/:id/settle',
  requirePermission('payments:write'),
  validate({ params: z.object({ id: z.string() }), body: z.object({ note: z.string().max(160).optional() }) }),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const { request, bill } = await cashRequestOr404(restaurantId, req.params.id);

    const settled = await recordCashPayment({
      restaurantId,
      billId: String(bill._id),
      actor: { userId: req.auth!.userId, role: req.auth!.role, name: req.auth!.name },
      tendered: request.tendered ?? undefined,
      note: req.body.note ?? (request.collectedByUserId ? 'Collected at the table by the waiter' : ''),
    });

    request.status = 'DONE';
    request.handledByUserId = req.auth!.userId as never;
    request.handledAt = new Date();
    await request.save();

    const session = await TableSessionModel.findById(request.tableSessionId).select('publicToken').lean();
    const payload = { ...request.toObject(), tableNumber: bill.tableNumber };
    emit.toRestaurant(restaurantId, Events.REQUEST_UPDATED, payload);
    if (session) emit.toSession(session.publicToken, Events.REQUEST_UPDATED, payload);

    if (bill.tableId) {
      const table = await TableModel.findById(bill.tableId).select('number assignedWaiterId').lean();
      if (table?.assignedWaiterId) {
        await notify({
          restaurantId,
          recipientId: String(table.assignedWaiterId),
          type: 'PAYMENT_SUCCEEDED',
          title: `Table ${table.number} is settled`,
          body: 'The drawer is square — clear the table when you get a moment',
          entityType: 'Bill',
          entityId: String(bill._id),
        });
      }
    }

    res.json({ request: payload, ...settled });
  }),
);

/**
 * Every waiter may work every table. This only puts a name on a table that does not have one
 * yet, so the floor knows who to ask about a party — it is not a lock, and taking a table that
 * already shows a colleague is allowed.
 */
waitersRouter.post(
  '/tables/:id/claim',
  requirePermission('tables:write'),
  validate({ params: z.object({ id: z.string() }) }),
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const restaurantId = auth.restaurantId;
    const before = await TableModel.findOne({ _id: req.params.id, restaurantId }).select('assignedWaiterId').lean();
    if (!before) throw ApiError.notFound('Table not found');
    const held = await takeTableForWaiter({ restaurantId, tableId: req.params.id, waiterId: auth.userId });
    if (!before.assignedWaiterId && held.holder === auth.userId) {
      const table = await TableModel.findOne({ _id: req.params.id, restaurantId }).lean();
      await recordAudit({
        restaurantId,
        actorId: auth.userId,
        actorName: auth.name,
        action: 'table.claimed',
        entityType: 'Table',
        entityId: String(table?._id ?? req.params.id),
        metadata: { number: table?.number ?? '' },
      });
    }
    const table = await TableModel.findOne({ _id: req.params.id, restaurantId }).lean();
    res.json(serializeTable(table as Record<string, unknown>));
  }),
);

waitersRouter.post(
  '/tables/:id/seat',
  requirePermission('tables:write'),
  validate({
    params: z.object({ id: z.string() }),
    body: z.object({ guestCount: z.number().int().min(1).max(40).optional(), customerName: z.string().max(80).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const table = await TableModel.findOne({ _id: req.params.id, restaurantId });
    if (!table) throw ApiError.notFound('Table not found');
    if (table.status === 'CLEANING') throw ApiError.conflict('This table still needs cleaning');

    // Whoever seats a table that has no name on it yet gets the name, so the floor can answer
    // "who is looking after this party". It is a label, not a lock.
    if (req.auth!.role === 'WAITER') {
      await takeTableForWaiter({ restaurantId, tableId: req.params.id, waiterId: req.auth!.userId });
    }

    const session = await openSession({
      restaurantId,
      tableId: String(table._id),
      guestCount: req.body.guestCount,
      customerName: req.body.customerName,
      via: 'STAFF',
    });
    res.status(201).json({
      sessionId: String(session._id),
      publicToken: session.publicToken,
      guestCount: session.guestCount,
    });
  }),
);

/**
 * Turns a table over: the session closes, any calls it still had are answered, the waiter is
 * released and the table is free to seat again. Shared by the waiter's own Clear and by the
 * counter confirming a clear request.
 */
async function freeTable(restaurantId: string, tableId: string, actor: { userId: string; role: Role; name: string }) {
  const table = await TableModel.findOne({ _id: tableId, restaurantId });
  if (!table) throw ApiError.notFound('Table not found');

  const unpaid = await OrderModel.countDocuments({
    restaurantId,
    tableId: table._id,
    status: { $nin: ['CANCELLED', 'COMPLETED'] },
  });
  if (unpaid > 0) throw ApiError.conflict('Settle or cancel the running orders before clearing this table');

  await TableSessionModel.updateMany(
    { tableId: table._id, status: { $ne: 'CLOSED' } },
    { status: 'CLOSED', closedAt: new Date() },
  );
  // A cleared table must not keep ringing for calls made by the previous party.
  await CustomerRequestModel.updateMany(
    { restaurantId, tableId: table._id, status: { $ne: 'DONE' } },
    { status: 'DONE', handledAt: new Date(), handledByUserId: actor.userId },
  );
  // Release the waiter assignment so the table is available for anyone.
  await TableModel.findByIdAndUpdate(table._id, { assignedWaiterId: null });
  const updated = await setTableStatus(table._id, 'AVAILABLE', { activeSessionId: null, lastCleanedAt: new Date() });
  emit.toRestaurant(restaurantId, Events.TABLE_CLEANED, { tableId: String(table._id), number: table.number });
  return { table, updated };
}

waitersRouter.post(
  '/tables/:id/clear',
  requirePermission('tables:write'),
  validate({ params: z.object({ id: z.string() }) }),
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const { updated } = await freeTable(auth.restaurantId, req.params.id, {
      userId: auth.userId,
      role: auth.role,
      name: auth.name,
    });
    res.json(updated);
  }),
);

waitersRouter.post(
  '/tables/:id/transfer',
  requirePermission('tables:write'),
  validate({
    params: z.object({ id: z.string() }),
    body: z.object({ waiterId: z.string().min(1), reason: z.string().max(160).optional() }),
  }),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const table = await TableModel.findOne({ _id: req.params.id, restaurantId }).lean();
    if (!table) throw ApiError.notFound('Table not found');
    const waiter = await UserModel.findOne({ _id: req.body.waiterId, restaurantId, role: 'WAITER', status: 'ACTIVE' }).lean();
    if (!waiter) throw ApiError.badRequest('Pick an active waiter');

    const previousWaiterId = table.assignedWaiterId ? String(table.assignedWaiterId) : null;
    const updated = await TableModel.findByIdAndUpdate(table._id, { assignedWaiterId: waiter._id }, { new: true }).lean();
    if (!updated) throw ApiError.notFound('Table not found');

    emit.toRestaurant(restaurantId, Events.TABLE_UPDATED, serializeTable(updated));
    await notify({
      restaurantId,
      recipientId: String(waiter._id),
      type: 'SYSTEM',
      title: `Table ${table.number} is now yours`,
      body: req.body.reason ? `Transferred: ${req.body.reason}` : 'Table transferred to you',
      entityType: 'Table',
      entityId: String(table._id),
    });
    await recordAudit({
      restaurantId,
      actorId: req.auth!.userId,
      actorName: req.auth!.name,
      action: 'table.transferred',
      entityType: 'Table',
      entityId: String(table._id),
      metadata: { number: table.number, from: previousWaiterId, to: String(waiter._id), reason: req.body.reason ?? '' },
    });
    res.json(serializeTable(updated));
  }),
);

/** Personal shift summary for the mobile profile screen. */
waitersRouter.get(
  '/me/summary',
  requirePermission('tables:read'),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const waiterId = req.auth!.userId;

    const [tables, myOrders, readyOrders, openRequests, bookings] = await Promise.all([
      TableModel.countDocuments({ restaurantId, assignedWaiterId: waiterId }),
      OrderModel.find({
        restaurantId,
        waiterId,
        status: { $nin: ['CANCELLED'] },
        createdAt: { $gte: startOfDay },
      })
        .select('grandTotal')
        .lean(),
      OrderModel.countDocuments({ restaurantId, waiterId, status: 'READY' }),
      CustomerRequestModel.countDocuments({ restaurantId, status: { $ne: 'DONE' } }),
      TableModel.find({ restaurantId, assignedWaiterId: waiterId }).select('_id').lean(),
    ]);

    res.json({
      tablesAssigned: tables,
      ordersToday: myOrders.length,
      salesToday: myOrders.reduce((sum, o) => sum + o.grandTotal, 0),
      awaitingPickup: readyOrders,
      openRequests,
      shiftStartedAt: startOfDay,
      bookings: bookings.length,
    });
  }),
);

waitersRouter.get(
  '/live-orders',
  requirePermission('orders:read'),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const orders = await OrderModel.find({
      restaurantId,
      status: { $in: ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED'] },
      tableId: { $ne: null },
    })
      .sort({ placedAt: -1 })
      .limit(60)
      .lean();
    res.json({ data: orders });
  }),
);

const requestSchema = z.object({
  tableId: z.string().min(1),
  type: z.enum(REQUEST_TYPES),
  note: z.string().max(200).optional(),
});

waitersRouter.post(
  '/requests',
  requirePermission('requests:write'),
  validate({ body: requestSchema }),
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const restaurantId = auth.restaurantId;
    const table = await TableModel.findOne({ _id: req.body.tableId, restaurantId }).lean();
    if (!table) throw ApiError.notFound('Table not found');
    // A clear raised after the party has paid has no open session left to point at, so it borrows
    // the one that just closed rather than failing on a table the floor can plainly see.
    const session = table.activeSessionId
      ? { _id: table.activeSessionId }
      : await TableSessionModel.findOne({ restaurantId, tableId: table._id }).sort({ openedAt: -1 }).select('_id').lean();
    if (!session) throw ApiError.conflict('This table has no session to raise a call against');

    if (req.body.type === 'TABLE_CLEAR') {
      const unsettled = await OrderModel.countDocuments({
        restaurantId,
        tableId: table._id,
        status: { $nin: ['CANCELLED', 'COMPLETED'] },
      });
      if (unsettled > 0) {
        throw ApiError.conflict('Table ' + table.number + ' still has orders to bill — raise the bill call first');
      }
    }

    const request = await CustomerRequestModel.create({
      restaurantId,
      tableId: table._id,
      tableSessionId: session._id,
      type: req.body.type,
      note: req.body.note ?? '',
      raisedByUserId: auth.userId,
    });
    const payload = { ...request.toObject(), tableNumber: table.number };
    emit.toRestaurant(restaurantId, Events.REQUEST_CREATED, payload);
    // A call the floor raises is a promise that someone at the till or in the office will answer
    // it, so it has to reach their inbox and not only the screen they happen to have open.
    await notifyRoles(restaurantId, ['CASHIER', 'OWNER', 'MANAGER'], {
      type: req.body.type === 'BILL' ? 'BILL_REQUESTED' : 'CUSTOMER_REQUEST',
      title: `Table ${table.number} · ${req.body.type.replace(/_/g, ' ').toLowerCase()}`,
      body: req.body.note || `Raised by ${auth.name}`,
      entityType: 'CustomerRequest',
      entityId: String(request._id),
    });
    res.status(201).json(payload);
  }),
);
