import { ApiError, handle, requireSignedJson } from '@/lib/api/handle';
import { transitionPayment } from '@/lib/intents';
import { StatusError } from '@/lib/payments/status';
import { actorFromBody, assertAllowed } from '@/lib/api/actor';

/**
 * "I have paid." This is a claim, not a payment — the state machine lets any actor raise it,
 * and it can only ever reach PAYMENT_VERIFICATION_PENDING.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await requireSignedJson<{ token?: string; actor?: { role?: string; name?: string; id?: string } }>(req);
    const actor = actorFromBody(body);
    assertAllowed(actor, 'view');
    const token = String(body.token ?? '');
    if (!token) throw new ApiError(400, 'token is required');

    try {
      const result = await transitionPayment({
        ref: token,
        to: 'PAYMENT_VERIFICATION_PENDING',
        actor: 'CUSTOMER',
        actorId: actor.id,
        detail: `Raised from ${actor.name}'s screen`,
      });
      return { ok: true, intent: result.view, callback: result.callback };
    } catch (error) {
      if (error instanceof StatusError) throw new ApiError(409, error.message);
      throw error;
    }
  });
}
