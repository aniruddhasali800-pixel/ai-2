import { handle, requireSignedJson } from '@/lib/api/handle';
import { createBillIntent, PayeeNotConfiguredError, type BillIntentInput } from '@/lib/intents';

/**
 * Sizzle calls this the moment a bill is finalised. Keyed on `externalBillId`, so a retried
 * bill cannot open a second QR for the same table.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await requireSignedJson<Partial<BillIntentInput>>(req);
    if (!body?.externalBillId) return { ok: false, code: 'BAD_REQUEST', message: 'externalBillId is required' };
    try {
      const created = await createBillIntent({
        externalBillId: String(body.externalBillId),
        externalBillNumber: String(body.externalBillNumber ?? ''),
        externalRestaurantId: body.externalRestaurantId ? String(body.externalRestaurantId) : null,
        externalTableNumber: body.externalTableNumber ? String(body.externalTableNumber) : null,
        customerLabel: String(body.customerLabel ?? 'Guest'),
        amountRupees: Number(body.amountRupees),
        items: Array.isArray(body.items) ? body.items.slice(0, 60) : [],
        note: body.note ? String(body.note) : null,
      });
      return { ok: true, reused: created.reused, intent: created.view };
    } catch (error) {
      if (error instanceof PayeeNotConfiguredError) {
        return { ok: false, code: 'PAYEE_NOT_CONFIGURED', message: error.message };
      }
      throw error;
    }
  });
}
