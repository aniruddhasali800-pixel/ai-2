import { Router } from 'express';
import QRCode from 'qrcode';
import { z } from 'zod';
import { TableModel, TableSessionModel, UserModel } from '../../models';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import { ApiError } from '../../utils/httpError';
import { randomToken } from '../../utils/tokens';
import { env } from '../../config/env';
import { emit, Events } from '../../realtime/emit';
import { serializeTable, setTableStatus } from '../../services/table.service';
import { recordAudit } from '../../services/audit.service';
import { TABLE_STATUSES } from '../../types/constants';
import { queryOf } from '../../utils/query';

export const tablesRouter = Router();

tablesRouter.use(requireAuth);

function qrUrlFor(qrToken: string) {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, '')}/t/${qrToken}`;
}

tablesRouter.get(
  '/',
  requirePermission('tables:read'),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const tables = await TableModel.find({ restaurantId }).sort({ section: 1, number: 1 }).lean();
    const sessions = await TableSessionModel.find({
      restaurantId,
      status: { $ne: 'CLOSED' },
    }).lean();
    const sessionByTable = new Map(sessions.map((s) => [String(s.tableId), s]));

    res.json({
      data: tables.map((table) => ({
        ...serializeTable(table),
        qrUrl: qrUrlFor(table.qrToken),
        session: (() => {
          const session = sessionByTable.get(String(table._id));
          if (!session) return null;
          return {
            _id: String(session._id),
            publicToken: session.publicToken,
            status: session.status,
            guestCount: session.guestCount,
            customerName: session.customerName,
            openedAt: session.openedAt,
          };
        })(),
      })),
    });
  }),
);

tablesRouter.post(
  '/',
  requirePermission('tables:write'),
  validate({
    body: z.object({
      number: z.string().min(1).max(12),
      capacity: z.number().int().min(1).max(40),
      section: z.string().max(40).optional(),
      description: z.string().max(160).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const exists = await TableModel.findOne({ restaurantId, number: req.body.number }).lean();
    if (exists) throw ApiError.conflict(`Table ${req.body.number} already exists`);

    const table = await TableModel.create({
      restaurantId,
      number: req.body.number,
      capacity: req.body.capacity,
      section: req.body.section ?? 'Main',
      description: req.body.description ?? '',
      qrToken: randomToken(12),
    });
    emit.toRestaurant(restaurantId, Events.TABLE_UPDATED, serializeTable(table.toObject()));
    res.status(201).json({ ...serializeTable(table.toObject()), qrUrl: qrUrlFor(table.qrToken) });
  }),
);

tablesRouter.patch(
  '/:id',
  requirePermission('tables:write'),
  validate({
    params: z.object({ id: z.string() }),
    body: z.object({
      number: z.string().min(1).max(12).optional(),
      capacity: z.number().int().min(1).max(40).optional(),
      section: z.string().max(40).optional(),
      description: z.string().max(160).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const table = await TableModel.findOneAndUpdate(
      { _id: req.params.id, restaurantId: req.auth!.restaurantId },
      req.body,
      { new: true },
    ).lean();
    if (!table) throw ApiError.notFound('Table not found');
    emit.toRestaurant(req.auth!.restaurantId, Events.TABLE_UPDATED, serializeTable(table));
    res.json({ ...serializeTable(table), qrUrl: qrUrlFor(table.qrToken) });
  }),
);

tablesRouter.delete(
  '/:id',
  requirePermission('tables:write'),
  validate({ params: z.object({ id: z.string() }) }),
  asyncHandler(async (req, res) => {
    const table = await TableModel.findOne({ _id: req.params.id, restaurantId: req.auth!.restaurantId }).lean();
    if (!table) throw ApiError.notFound('Table not found');
    if (table.activeSessionId) throw ApiError.conflict('Close the running table session first');
    await TableModel.deleteOne({ _id: table._id });
    emit.toRestaurant(req.auth!.restaurantId, Events.TABLE_UPDATED, { _id: String(table._id), deleted: true });
    res.json({ ok: true });
  }),
);

tablesRouter.patch(
  '/:id/status',
  requirePermission('tables:write'),
  validate({ params: z.object({ id: z.string() }), body: z.object({ status: z.enum(TABLE_STATUSES) }) }),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const table = await TableModel.findOne({ _id: req.params.id, restaurantId }).lean();
    if (!table) throw ApiError.notFound('Table not found');

    const extra: Record<string, unknown> = {};
    if (req.body.status === 'AVAILABLE') {
      extra.lastCleanedAt = new Date();
      extra.activeSessionId = null;
      // The seat is free, so nobody works it. Left behind, the name on a cleared table
      // sends the next guest's QR seating to a waiter who has gone home — and locks the
      // rest of the floor out of claiming it.
      extra.assignedWaiterId = null;
      await TableSessionModel.updateMany(
        { tableId: table._id, status: { $ne: 'CLOSED' } },
        { status: 'CLOSED', closedAt: new Date() },
      );
      emit.toRestaurant(restaurantId, Events.TABLE_CLEANED, { tableId: String(table._id), number: table.number });
    }
    const updated = await setTableStatus(table._id, req.body.status, extra);
    res.json(updated);
  }),
);

tablesRouter.post(
  '/:id/assign-waiter',
  requirePermission('tables:write'),
  validate({ params: z.object({ id: z.string() }), body: z.object({ waiterId: z.string().nullable() }) }),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    if (req.body.waiterId) {
      const waiter = await UserModel.findOne({ _id: req.body.waiterId, restaurantId, role: 'WAITER' }).lean();
      if (!waiter) throw ApiError.badRequest('Pick an active waiter from your team');
    }
    const table = await TableModel.findOneAndUpdate(
      { _id: req.params.id, restaurantId },
      { assignedWaiterId: req.body.waiterId },
      { new: true },
    ).lean();
    if (!table) throw ApiError.notFound('Table not found');
    emit.toRestaurant(restaurantId, Events.TABLE_UPDATED, serializeTable(table));
    res.json(serializeTable(table));
  }),
);

tablesRouter.post(
  '/:id/regenerate-qr',
  requirePermission('tables:write'),
  validate({ params: z.object({ id: z.string() }) }),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const table = await TableModel.findOneAndUpdate(
      { _id: req.params.id, restaurantId },
      { qrToken: randomToken(12) },
      { new: true },
    ).lean();
    if (!table) throw ApiError.notFound('Table not found');
    await recordAudit({
      restaurantId,
      actorId: req.auth!.userId,
      actorName: req.auth!.name,
      action: 'table.qr_regenerated',
      entityType: 'Table',
      entityId: String(table._id),
      metadata: { number: table.number },
    });
    res.json({ ...serializeTable(table), qrUrl: qrUrlFor(table.qrToken) });
  }),
);

/** Desktop-ready QR image (data URL) plus the printable target URL. */
tablesRouter.get(
  '/:id/qr',
  requirePermission('tables:read'),
  validate({ params: z.object({ id: z.string() }), query: z.object({ size: z.coerce.number().min(120).max(900).optional() }) }),
  asyncHandler(async (req, res) => {
    const table = await TableModel.findOne({ _id: req.params.id, restaurantId: req.auth!.restaurantId }).lean();
    if (!table) throw ApiError.notFound('Table not found');
    const url = qrUrlFor(table.qrToken);
    const size = queryOf<{ size?: number }>(req).size ?? 420;
    const dataUrl = await QRCode.toDataURL(url, {
      width: size,
      margin: 1,
      color: { dark: '#1c1917', light: '#ffffff' },
    });
    res.json({ tableId: String(table._id), number: table.number, url, dataUrl });
  }),
);

/** Tables for the logged-in waiter with live session + current order context. */
tablesRouter.get(
  '/my-map',
  requirePermission('tables:read'),
  asyncHandler(async (req, res) => {
    const restaurantId = req.auth!.restaurantId;
    const tables = await TableModel.find({ restaurantId }).sort({ section: 1, number: 1 }).lean();
    res.json({
      data: tables.map((table) => ({
        ...serializeTable(table),
        mine: req.auth!.role !== 'WAITER' || String(table.assignedWaiterId ?? '') === req.auth!.userId,
      })),
    });
  }),
);
