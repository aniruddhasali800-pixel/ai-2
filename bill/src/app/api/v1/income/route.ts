import { handle, requireSignedGet } from '@/lib/api/handle';
import { defaultRange, incomeSummary } from '@/lib/income';

/**
 * Income, derived on demand from the PAID rows. `days` (1-366) or explicit from/to in ISO form.
 */
export async function GET(req: Request) {
  return handle(async () => {
    await requireSignedGet(req);
    const url = new URL(req.url);
    const daysRaw = url.searchParams.get('days');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    let range = defaultRange(daysRaw ? Math.min(366, Math.max(1, Number(daysRaw) || 30)) : 30);
    if (from && to) {
      const startDate = new Date(from);
      const endDate = new Date(to);
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        return { ok: false, code: 'BAD_REQUEST', message: 'from and to must be dates' };
      }
      range = { from: startDate, to: endDate };
    }
    return { ok: true, income: await incomeSummary(range) };
  });
}
