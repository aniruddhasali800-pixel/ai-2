import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requireAuth } from '../../middleware/auth';
import { requirePermission } from '../../middleware/rbac';
import {
  buildDayClose,
  dayCloseCsv,
  dayWindow,
  listDayCloses,
  readDayClose,
  writeDayClose,
} from '../../services/dayClose.service';
import { emit, Events } from '../../realtime/emit';
import {
  dashboard,
  operationsReport,
  paymentReport,
  productReport,
  resolveRange,
  salesReport,
} from '../../services/report.service';
import { queryOf } from '../../utils/query';

export const reportsRouter = Router();

reportsRouter.use(requireAuth);

const rangeQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  days: z.coerce.number().int().min(1).max(366).optional(),
});

const salesQuery = rangeQuery.extend({
  granularity: z.enum(['day', 'week', 'month', 'year']).optional(),
});

/** An Indian business day, named the way the archive names its folders. */
const DATE_LABEL = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD form');

type RangeQuery = z.infer<typeof rangeQuery>;
type SalesQuery = z.infer<typeof salesQuery>;

reportsRouter.get(
  '/dashboard',
  requirePermission('reports:read'),
  asyncHandler(async (req, res) => {
    res.json(await dashboard(req.auth!.restaurantId));
  }),
);

reportsRouter.get(
  '/sales',
  requirePermission('reports:read'),
  validate({ query: salesQuery }),
  asyncHandler(async (req, res) => {
    const q = queryOf<SalesQuery>(req);
    const { from, to } = resolveRange(q.from, q.to, q.days ?? 7);
    res.json(await salesReport(req.auth!.restaurantId, { from, to, granularity: q.granularity }));
  }),
);

reportsRouter.get(
  '/products',
  requirePermission('reports:read'),
  validate({ query: rangeQuery }),
  asyncHandler(async (req, res) => {
    const q = queryOf<RangeQuery>(req);
    const { from, to } = resolveRange(q.from, q.to, q.days ?? 30);
    res.json(await productReport(req.auth!.restaurantId, from, to));
  }),
);

reportsRouter.get(
  '/payments',
  requirePermission('reports:read'),
  validate({ query: rangeQuery }),
  asyncHandler(async (req, res) => {
    const q = queryOf<RangeQuery>(req);
    const { from, to } = resolveRange(q.from, q.to, q.days ?? 30);
    res.json(await paymentReport(req.auth!.restaurantId, from, to));
  }),
);

reportsRouter.get(
  '/operations',
  requirePermission('reports:read'),
  validate({ query: rangeQuery }),
  asyncHandler(async (req, res) => {
    const q = queryOf<RangeQuery>(req);
    const { from, to } = resolveRange(q.from, q.to, q.days ?? 30);
    res.json(await operationsReport(req.auth!.restaurantId, from, to));
  }),
);

const dayCloseQuery = z.object({ date: DATE_LABEL.optional() });
type DayCloseQuery = z.infer<typeof dayCloseQuery>;

/**
 * The day's close. A closed day is served from the file it was written to, so the numbers an owner
 * approved at 8 pm are the numbers they see next week; an open day is built from the live records and
 * marked as such, because nothing has been signed off yet.
 */
reportsRouter.get(
  '/day-close',
  requirePermission('reports:read'),
  validate({ query: dayCloseQuery }),
  asyncHandler(async (req, res) => {
    const q = queryOf<DayCloseQuery>(req);
    const window = dayWindow(q.date);
    const stored = await readDayClose(req.auth!.restaurantId, window.date);
    res.json(stored ? { ...stored, stored: true } : { ...(await buildDayClose(req.auth!.restaurantId, window.date)), stored: false });
  }),
);

/** The days already written to the drive, newest first. */
reportsRouter.get(
  '/day-close/list',
  requirePermission('reports:read'),
  asyncHandler(async (req, res) => {
    res.json(await listDayCloses(req.auth!.restaurantId));
  }),
);

/** The same close as a spreadsheet, for the file the owner keeps off the system. */
reportsRouter.get(
  '/day-close/csv',
  requirePermission('reports:read'),
  validate({ query: dayCloseQuery }),
  asyncHandler(async (req, res) => {
    const q = queryOf<DayCloseQuery>(req);
    const window = dayWindow(q.date);
    const report = (await readDayClose(req.auth!.restaurantId, window.date)) ?? (await buildDayClose(req.auth!.restaurantId, window.date));
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="sizzle-${window.date}-day-close.csv"`);
    res.send(dayCloseCsv(report));
  }),
);

/**
 * Closes a day now. The write replaces the pair on the drive, so a bill entered after the automatic
 * 8 pm sweep still reaches the report the owner reads.
 */
reportsRouter.post(
  '/day-close',
  requirePermission('reports:read'),
  validate({ body: dayCloseQuery }),
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as DayCloseQuery;
    const report = await writeDayClose(req.auth!.restaurantId, body.date);
    // Another device open on the same reports has no reason to poll a file that just changed, so the
    // close announces itself; without it a manager's screen goes on showing the pre-close numbers.
    emit.toRestaurant(req.auth!.restaurantId, Events.DAY_CLOSE_UPDATED, { date: report.date });
    res.json(report);
  }),
);
