import { ApiError, handle, requireFields, requireSignedGet, requireSignedJson, text } from '@/lib/api/handle';
import { actorFromBody, assertAllowed } from '@/lib/api/actor';
import { mirroredStaffId } from '@/lib/staff';
import { savePayee, settingsView } from '@/lib/settings';
import { db } from '@/lib/db';

/** Masked only. The plaintext payee never leaves this service except into a QR. */
export async function GET(req: Request) {
  return handle(async () => {
    await requireSignedGet(req);
    return { ok: true, settings: await settingsView() };
  });
}

/**
 * Moving the payee is the one change that redirects every future customer's money, so it is
 * owner-only, and the caller must send the full UPI ID again — a payee never changes as a
 * side effect of editing something else.
 */
export async function PATCH(req: Request) {
  return handle(async () => {
    const body = await requireSignedJson<{
      vpa?: string;
      payeeName?: string;
      businessName?: string;
      enabled?: boolean;
      actor?: { role?: string; name?: string; id?: string };
    }>(req);
    requireFields(body, ['vpa', 'payeeName', 'businessName', 'enabled', 'actor']);
    const actor = actorFromBody(body);
    assertAllowed(actor, 'settings');

    const view = await savePayee({
      vpa: text(body.vpa, 'vpa', 256),
      payeeName: text(body.payeeName, 'payeeName', 50),
      businessName: body.businessName ? String(body.businessName).slice(0, 60) : undefined,
      enabled: typeof body.enabled === 'boolean' ? body.enabled : undefined,
      // The writer is mirrored here, so the change is attributable by name in the settings audit.
      actorId: (await mirroredStaffId(actor)) ?? (await ownerUserId()),
    });
    return { ok: true, settings: view };
  });
}

async function ownerUserId(): Promise<string> {
  const owner = await db.user.findFirst({ where: { role: 'OWNER' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
  if (!owner) throw new ApiError(500, 'This service has no OWNER account — run npm run db:seed');
  return owner.id;
}
