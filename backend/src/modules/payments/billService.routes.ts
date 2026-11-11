import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../utils/asyncHandler';
import { validate } from '../../middleware/validate';
import { requirePermission } from '../../middleware/rbac';
import { ApiError } from '../../utils/httpError';
import { recordAudit } from '../../services/audit.service';
import {
  BillServiceError,
  billServiceEnabled,
  claimBillIntent,
  readIncome,
  readPayee,
  readQueue,
  savePayee,
  settleBillIntent,
  type BillStaffActor,
} from '../../integrations/billService';
import { raiseBillIntent } from '../../services/billing.service';
import { emit, Events } from '../../realtime/emit';

/**
 * The payment dashboard, served from Sizzle and backed by the bill service.
 *
 * Two rules decide who gets what: the queue and the income are read-only for every role allowed
 * near money, and the payee UPI ID — the one field that redirects a customer's money — sits behind
 * `settings:write`, which only an OWNER holds. A manager sees the claim, the amount and the
 * statement check, and acts on none of it. The service enforces the same rules again on its side,
 * because this screen is not the only door into it.
 */
export const billServiceRouter = Router();

function actorFor(req: { auth?: { role: string; name: string; userId: string } }): BillStaffActor {
  const auth = req.auth!;
  return { role: auth.role as BillStaffActor['role'], name: auth.name, id: auth.userId };
}

/** The service's refusal (a manager at the settle button, a closed request, a bad UPI ID) is the
 * message the screen should show — not a generic gateway failure. */
async function relay<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof BillServiceError) throw new ApiError(error.status ?? 502, error.message);
    throw error;
  }
}

billServiceRouter.get(
  '/overview',
  requirePermission('payments:read'),
  validate({ query: z.object({ days: z.coerce.number().int().min(1).max(366).optional() }) }),
  asyncHandler(async (req, res) => {
    if (!billServiceEnabled()) {
      res.json({
        enabled: false,
        reason: 'No payment service is paired with this deployment, so bills fall back to this tenant’s own UPI handle.',
      });
      return;
    }
    const days = Number(req.query.days ?? 30);
    const [queue, income, payee] = await Promise.all([relay(readQueue), relay(() => readIncome(days)), relay(readPayee)]);
    res.json({ enabled: true, queue, income: income.income, payee: payee.settings, days });
  }),
);

billServiceRouter.post(
  '/claims/:ref/settle',
  requirePermission('payments:write'),
  validate({
    params: z.object({ ref: z.string().min(1).max(64) }),
    body: z.object({ utr: z.string().trim().min(4).max(40) }),
  }),
  asyncHandler(async (req, res) => {
    const result = await relay(() => settleBillIntent(req.params.ref, actorFor(req), { utr: req.body.utr }));
    await recordAudit({
      restaurantId: req.auth!.restaurantId,
      actorId: req.auth!.userId,
      actorName: req.auth!.name,
      action: 'payment.verified',
      entityType: 'Payment',
      entityId: result.intent.id,
      metadata: { utr: req.body.utr, amountRupees: result.intent.amountRupees, note: result.intent.note },
    });
    // A named person has just read this amount out of the bank statement, so every open till, bill
    // list and report has to stop showing it as waiting. Without the announcement the money is
    // settled on the server and still queued on the screen.
    emit.toRestaurant(req.auth!.restaurantId, Events.PAYMENT_SUCCEEDED, {
      amount: result.intent.amountRupees,
      method: 'UPI',
      ref: result.intent.id,
    });
    res.json(result.intent);
  }),
);

billServiceRouter.post(
  '/claims/:ref/reject',
  requirePermission('payments:write'),
  validate({
    params: z.object({ ref: z.string().min(1).max(64) }),
    body: z.object({ reason: z.string().trim().min(3).max(120) }),
  }),
  asyncHandler(async (req, res) => {
    const result = await relay(() =>
      settleBillIntent(req.params.ref, actorFor(req), { outcome: 'FAILED', reason: req.body.reason }),
    );
    await recordAudit({
      restaurantId: req.auth!.restaurantId,
      actorId: req.auth!.userId,
      actorName: req.auth!.name,
      action: 'payment.rejected',
      entityType: 'Payment',
      entityId: result.intent.id,
      metadata: { reason: req.body.reason },
    });
    // The other device's queue still holds this claim as waiting until it hears the answer.
    emit.toRestaurant(req.auth!.restaurantId, Events.PAYMENT_FAILED, {
      amount: result.intent.amountRupees,
      reason: req.body.reason,
      ref: result.intent.id,
    });
    res.json(result.intent);
  }),
);

/** A waiter or cashier passing on what the guest told them. A claim, never a payment. */
billServiceRouter.post(
  '/claims/:ref/claim',
  requirePermission('payments:write'),
  validate({ params: z.object({ ref: z.string().min(1).max(64) }) }),
  asyncHandler(async (req, res) => {
    const result = await relay(() => claimBillIntent(req.params.ref, actorFor(req)));
    // So the counter on the other tablet sees the relayed claim appear without a reload.
    emit.toRestaurant(req.auth!.restaurantId, Events.PAYMENT_CLAIMED, { ref: result.intent.id });
    res.json(result.intent);
  }),
);

billServiceRouter.get(
  '/payee',
  requirePermission('settings:read'),
  asyncHandler(async (_req, res) => {
    res.json(await relay(readPayee));
  }),
);

/**
 * Moving the payee redirects every future customer's money, so it needs the owner's own session
 * and the full UPI ID retyped — a payee never changes as a side effect of something else on the
 * form. The service checks the role again before it writes.
 */
billServiceRouter.patch(
  '/payee',
  requirePermission('settings:write'),
  validate({
    body: z.object({
      vpa: z.string().trim().min(6).max(256),
      payeeName: z.string().trim().min(2).max(50),
      businessName: z.string().trim().max(60).optional(),
      enabled: z.boolean().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const result = await relay(() => savePayee(actorFor(req), req.body));
    await recordAudit({
      restaurantId: req.auth!.restaurantId,
      actorId: req.auth!.userId,
      actorName: req.auth!.name,
      action: 'payment.payee_changed',
      entityType: 'Settings',
      entityId: 'payee',
      // The address itself never enters the audit trail — only what the service will show.
      metadata: { payeeMasked: result.settings.payeeMasked, payeeName: result.settings.payeeName },
    });
    // Every guest's pay-now page and every bill screen show this handle, so the change has to travel.
    emit.toRestaurant(req.auth!.restaurantId, Events.SETTINGS_UPDATED, {});
    res.json(result.settings);
  }),
);

/** The counter's retry button: the same request a finalised bill opens by itself. */
billServiceRouter.post(
  '/intents',
  requirePermission('payments:write'),
  validate({ body: z.object({ billId: z.string().min(1).max(64) }) }),
  asyncHandler(async (req, res) => {
    const view = await raiseBillIntent(req.auth!.restaurantId, req.body.billId);
    res.status(201).json(view);
  }),
);
