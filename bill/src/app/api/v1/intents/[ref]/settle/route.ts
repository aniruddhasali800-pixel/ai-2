import { ApiError, handle, requireSignedJson, text } from '@/lib/api/handle';
import { findIntentAny, rejectByStaff, settleByStaff, TransitionError } from '@/lib/intents';
import { StatusError } from '@/lib/payments/status';
import { actorFromBody, assertAllowed } from '@/lib/api/actor';
import { mirroredStaffId } from '@/lib/staff';

interface SettleBody {
  utr?: string;
  reason?: string;
  outcome?: 'PAID' | 'FAILED';
  actor?: { role?: string; name?: string; id?: string };
}

/**
 * The money answer. Someone with the bank statement in front of them confirms a transfer, and
 * the UTR they type is kept as the proof. A manager is refused here by design.
 */
export async function POST(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  return handle(async () => {
    const body = await requireSignedJson<SettleBody>(req);
    const actor = actorFromBody(body);
    assertAllowed(actor, 'verify');
    const { ref } = await params;
    const intent = await findIntentAny(decodeURIComponent(ref));
    if (!intent) throw new ApiError(404, 'No such payment request');
    const staff = { id: await mirroredStaffId(actor), name: actor.name };

    try {
      const result =
        body.outcome === 'FAILED'
          ? await rejectByStaff(intent.id, body.reason ? String(body.reason).slice(0, 120) : 'Not found in the statement', staff)
          : await settleByStaff(intent.id, text(body.utr, 'utr', 40), staff);
      return { ok: true, intent: result.view, callback: result.callback };
    } catch (error) {
      if (error instanceof StatusError || error instanceof TransitionError) throw new ApiError(409, error.message);
      throw error;
    }
  });
}
