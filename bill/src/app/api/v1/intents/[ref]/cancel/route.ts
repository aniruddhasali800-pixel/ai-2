import { ApiError, handle, requireSignedJson } from '@/lib/api/handle';
import { cancelIntent, findIntentAny, intentView } from '@/lib/intents';
import { actorFromBody, assertAllowed } from '@/lib/api/actor';
import { isTerminal, StatusError, type PaymentStatus } from '@/lib/payments/status';

/**
 * Take a QR out of circulation: the bill was settled another way, or voided. Deliberately not
 * open to a manager, who only reads.
 */
export async function POST(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  return handle(async () => {
    const body = await requireSignedJson<{ reason?: string; actor?: { role?: string; name?: string; id?: string } }>(req);
    const actor = actorFromBody(body);
    assertAllowed(actor, 'verify');
    const { ref } = await params;
    const intent = await findIntentAny(decodeURIComponent(ref));
    if (!intent) throw new ApiError(404, 'No such payment request');
    if (isTerminal(intent.paymentStatus as PaymentStatus)) return { ok: true, intent: await intentView(intent), note: 'Already finished' };

    try {
      const result = await cancelIntent(intent.id, 'STAFF', {
        staff: { id: actor.id, name: actor.name },
        reason: body.reason ? String(body.reason).slice(0, 120) : 'Settled another way',
      });
      return { ok: true, intent: result.view };
    } catch (error) {
      if (error instanceof StatusError) throw new ApiError(409, error.message);
      throw error;
    }
  });
}
