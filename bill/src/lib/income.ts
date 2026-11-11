import { db } from './db';
import { formatINR } from './money';

/**
 * Income is derived, never stored: a PAID intent whose money a person confirmed.
 * Claims, failures and cancellations are counted separately so they can never inflate a total.
 */
export interface IncomeRange {
  from: Date;
  to: Date;
}

export interface IncomeDay {
  day: string;
  amountPaise: number;
  count: number;
}

export interface IncomeSummary {
  range: IncomeRange;
  collectedPaise: number;
  collectedLabel: string;
  count: number;
  bySource: { source: string; amountPaise: number; count: number }[];
  byVerifier: { name: string; amountPaise: number; count: number }[];
  awaitingVerification: { amountPaise: number; count: number };
  openRequests: { amountPaise: number; count: number };
  failedOrCancelled: { amountPaise: number; count: number };
  days: IncomeDay[];
}

const IST = 'Asia/Kolkata';

function dayKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function defaultRange(days = 30): IncomeRange {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

export async function incomeSummary(range: IncomeRange): Promise<IncomeSummary> {
  const paid = await db.order.findMany({
    where: { paymentStatus: 'PAID', paidAt: { gte: range.from, lte: range.to } },
    select: { totalInPaise: true, source: true, paidAt: true, verifiedBy: { select: { name: true } } },
    orderBy: { paidAt: 'asc' },
  });

  const days = new Map<string, IncomeDay>();
  const bySource = new Map<string, { source: string; amountPaise: number; count: number }>();
  const byVerifier = new Map<string, { name: string; amountPaise: number; count: number }>();
  let collectedPaise = 0;

  for (const row of paid) {
    const amount = row.totalInPaise;
    collectedPaise += amount;
    const key = dayKey(row.paidAt ?? range.from);
    const bucket = days.get(key) ?? { day: key, amountPaise: 0, count: 0 };
    bucket.amountPaise += amount;
    bucket.count += 1;
    days.set(key, bucket);

    const source = bySource.get(row.source) ?? { source: row.source, amountPaise: 0, count: 0 };
    source.amountPaise += amount;
    source.count += 1;
    bySource.set(row.source, source);

    const verifier = row.verifiedBy?.name ?? 'Unrecorded';
    const vBucket = byVerifier.get(verifier) ?? { name: verifier, amountPaise: 0, count: 0 };
    vBucket.amountPaise += amount;
    vBucket.count += 1;
    byVerifier.set(verifier, vBucket);
  }

  const tally = async (statuses: string[]) => {
    const rows = await db.order.findMany({
      where: { paymentStatus: { in: statuses } },
      select: { totalInPaise: true },
    });
    return { amountPaise: rows.reduce((sum, row) => sum + row.totalInPaise, 0), count: rows.length };
  };

  return {
    range,
    collectedPaise,
    collectedLabel: formatINR(collectedPaise),
    count: paid.length,
    days: [...days.values()],
    bySource: [...bySource.values()].sort((a, b) => b.amountPaise - a.amountPaise),
    byVerifier: [...byVerifier.values()].sort((a, b) => b.amountPaise - a.amountPaise).slice(0, 8),
    awaitingVerification: await tally(['PAYMENT_VERIFICATION_PENDING']),
    openRequests: await tally(['PENDING']),
    failedOrCancelled: await tally(['FAILED', 'CANCELLED']),
  };
}
