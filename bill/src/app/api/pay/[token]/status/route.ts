import { handle, ApiError } from '@/lib/api/handle';
import { findIntentByToken } from '@/lib/intents';

/**
 * What the pay page polls. The token is the credential, so the answer is deliberately two
 * strings — no payee, no UTR, no line items, nothing a stranger could read off a shared screen.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  return handle(async () => {
    const { token } = await params;
    const record = await findIntentByToken(decodeURIComponent(token));
    if (!record) throw new ApiError(404, 'No such payment request');
    return {
      paymentStatus: record.paymentStatus,
      paidAt: record.paidAt ? record.paidAt.toISOString() : null,
    };
  });
}
