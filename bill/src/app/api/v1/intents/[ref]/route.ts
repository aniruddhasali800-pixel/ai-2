import { ApiError, handle, requireSignedGet } from '@/lib/api/handle';
import { findIntentAny, intentView } from '@/lib/intents';

/**
 * Status of one intent, by intent id, Sizzle bill id or token. Signed, because the answer
 * carries the payee and the line items.
 */
export async function GET(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  return handle(async () => {
    await requireSignedGet(req);
    const { ref } = await params;
    const record = await findIntentAny(decodeURIComponent(ref));
    if (!record) throw new ApiError(404, 'No such payment request');
    const events = record.paymentEvents;
    const view = await intentView(record);
    return { ok: true, intent: view, events };
  });
}
