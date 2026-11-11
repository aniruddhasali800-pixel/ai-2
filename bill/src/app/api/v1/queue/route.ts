import { handle, requireSignedGet } from '@/lib/api/handle';
import { claimQueue, openQueue } from '@/lib/intents';

/**
 * The verification queue, for Sizzle's owner dashboard to read. Who may look is decided by
 * Sizzle's permission check before it calls; nothing here mutates.
 */
export async function GET(req: Request) {
  return handle(async () => {
    await requireSignedGet(req);
    const [claims, open] = await Promise.all([claimQueue(), openQueue()]);
    return { ok: true, awaitingVerification: claims, open: open.filter((intent) => !claims.some((c) => c.id === intent.id)) };
  });
}
