import { Types } from 'mongoose';
import { TableModel, TableSessionModel } from '../models';
import { emit, Events } from '../realtime/emit';
import { ApiError } from '../utils/httpError';
import { randomToken } from '../utils/tokens';
import type { TableStatus } from '../types/constants';

export async function setTableStatus(tableId: string | Types.ObjectId, status: TableStatus, extra: Record<string, unknown> = {}) {
  const table = await TableModel.findByIdAndUpdate(tableId, { status, ...extra }, { new: true }).lean();
  if (table) emit.toRestaurant(String(table.restaurantId), Events.TABLE_UPDATED, serializeTable(table));
  return table;
}

/**
 * Puts this waiter's name on the table, but only while no name is on it yet.
 *
 * The floor shows "with Sneha" so a colleague knows who is running a party and a guest asking
 * "where is my order" gets an answer. It is a label and not a lock: nobody is refused work on a
 * table that already shows a name. The write is conditional so that two phones tapping the same
 * free table at the same instant settle on one name instead of overwriting each other.
 */
export async function takeTableForWaiter(opts: {
  restaurantId: string;
  tableId: string;
  waiterId: string;
}): Promise<{ holder: string | null; number: string }> {
  const mine = await TableModel.findOneAndUpdate(
    { _id: opts.tableId, restaurantId: opts.restaurantId, assignedWaiterId: null },
    { assignedWaiterId: opts.waiterId },
    { new: true },
  ).lean();
  if (mine) {
    emit.toRestaurant(opts.restaurantId, Events.TABLE_UPDATED, serializeTable(mine));
    return { holder: opts.waiterId, number: mine.number };
  }
  const table = await TableModel.findOne({ _id: opts.tableId, restaurantId: opts.restaurantId })
    .select('number assignedWaiterId')
    .lean();
  if (!table) throw ApiError.notFound('Table not found');
  return { holder: table.assignedWaiterId ? String(table.assignedWaiterId) : null, number: table.number };
}

export function serializeTable(table: Record<string, any>) {
  return {
    _id: String(table._id),
    number: table.number,
    capacity: table.capacity,
    section: table.section,
    description: table.description,
    status: table.status,
    qrToken: table.qrToken,
    activeSessionId: table.activeSessionId ? String(table.activeSessionId) : null,
    assignedWaiterId: table.assignedWaiterId ? String(table.assignedWaiterId) : null,
    lastCleanedAt: table.lastCleanedAt ?? null,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
  };
}

export async function openSession(opts: {
  restaurantId: string;
  tableId: string;
  guestCount?: number;
  customerName?: string;
  via?: 'QR' | 'STAFF';
}) {
  const table = await TableModel.findOne({ _id: opts.tableId, restaurantId: opts.restaurantId });
  if (!table) throw ApiError.notFound('Table not found');

  if (table.activeSessionId) {
    const existing = await TableSessionModel.findOne({
      _id: table.activeSessionId,
      status: { $ne: 'CLOSED' },
    });
    if (existing) {
      if (opts.guestCount && opts.guestCount > 0) existing.guestCount = opts.guestCount;
      if (opts.customerName) existing.customerName = opts.customerName;
      existing.lastActivityAt = new Date();
      await existing.save();
      return existing;
    }
  }

  const session = await TableSessionModel.create({
    restaurantId: opts.restaurantId,
    tableId: table._id,
    publicToken: randomToken(16),
    guestCount: opts.guestCount ?? 1,
    customerName: opts.customerName ?? '',
    openedVia: opts.via ?? 'QR',
    status: 'OPEN',
  });

  table.activeSessionId = session._id;
  table.status = 'OCCUPIED';
  await table.save();

  emit.toRestaurant(opts.restaurantId, Events.TABLE_UPDATED, serializeTable(table.toObject()));
  emit.toRestaurant(opts.restaurantId, Events.SESSION_UPDATED, { sessionId: String(session._id), tableId: String(table._id) });
  return session;
}

export async function touchSession(sessionId: string | Types.ObjectId) {
  await TableSessionModel.updateOne({ _id: sessionId }, { lastActivityAt: new Date() });
}

export async function sessionSummary(sessionId: string, restaurantId: string) {
  const session = await TableSessionModel.findOne({ _id: sessionId, restaurantId }).lean();
  if (!session) throw ApiError.notFound('Table session not found');
  return session;
}

export async function closeSession(sessionId: string | Types.ObjectId) {
  const session = await TableSessionModel.findByIdAndUpdate(
    sessionId,
    { status: 'CLOSED', closedAt: new Date() },
    { new: true },
  ).lean();
  if (session) {
    await setTableStatus(session.tableId, 'CLEANING');
    emit.toSession(session.publicToken, Events.SESSION_UPDATED, { sessionId: String(session._id), status: 'CLOSED' });
  }
  return session;
}
