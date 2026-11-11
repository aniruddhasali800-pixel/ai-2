import { requireStaff } from '@/lib/auth/session';
import { defaultRange, incomeSummary } from '@/lib/income';
import { formatINR } from '@/lib/money';
import { StaffHeader } from '@/components/StaffHeader';

const day = (date: Date): string =>
  new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' }).format(date);

export default async function IncomePage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireStaff();
  const { days } = await searchParams;
  const span = Math.min(366, Math.max(1, Number(days ?? 30) || 30));
  const range = defaultRange(span);
  const income = await incomeSummary(range);

  return (
    <div className="flex flex-col gap-5">
      <StaffHeader />
      <header>
        <h1 className="text-2xl font-semibold">Income</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Last {span} days · counted only when a person with the statement confirmed the transfer. Nothing here is a
          projection.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <div className="card">
          <p className="label">Collected</p>
          <p className="mt-1 text-2xl font-semibold">{formatINR(income.collectedPaise)}</p>
          <p className="text-xs text-[var(--muted)]">{income.count} bills</p>
        </div>
        <div className="card">
          <p className="label">Claimed, not yet checked</p>
          <p className="mt-1 text-2xl font-semibold">{formatINR(income.awaitingVerification.amountPaise)}</p>
          <p className="text-xs text-[var(--muted)]">{income.awaitingVerification.count} waiting on someone</p>
        </div>
        <div className="card">
          <p className="label">Still open</p>
          <p className="mt-1 text-2xl font-semibold">{formatINR(income.openRequests.amountPaise)}</p>
          <p className="text-xs text-[var(--muted)]">{income.openRequests.count} unpaid bills</p>
        </div>
        <div className="card">
          <p className="label">Failed or cancelled</p>
          <p className="mt-1 text-2xl font-semibold">{formatINR(income.failedOrCancelled.amountPaise)}</p>
          <p className="text-xs text-[var(--muted)]">
            {income.failedOrCancelled.count} — never counted as income
          </p>
        </div>
      </div>

      <section className="card">
        <p className="label">Day by day</p>
        {income.days.length ? (
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-[var(--muted)]">
              <tr>
                <th className="font-normal">Day</th>
                <th className="font-normal">Bills</th>
                <th className="font-normal text-right">Collected</th>
              </tr>
            </thead>
            <tbody>
              {income.days
                .slice()
                .reverse()
                .map((row) => (
                  <tr key={row.day} className="border-t border-[var(--line)]">
                    <td className="py-1">{row.day}</td>
                    <td>{row.count}</td>
                    <td className="text-right">{formatINR(row.amountPaise)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-2 text-sm text-[var(--muted)]">Nothing confirmed in this window yet.</p>
        )}
      </section>

      <section className="card">
        <p className="label">Who confirmed it</p>
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {income.byVerifier.map((row) => (
            <li key={row.name} className="flex justify-between">
              <span>{row.name}</span>
              <span>
                {formatINR(row.amountPaise)} · {row.count}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Range {day(range.from)} – {day(range.to)} · source split:{' '}
          {income.bySource.map((row) => `${row.source} ${formatINR(row.amountPaise)}`).join(' · ') || 'nothing yet'}
        </p>
      </section>
    </div>
  );
}
