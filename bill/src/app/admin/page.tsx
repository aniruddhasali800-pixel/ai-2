import { requireStaff, roleCan } from '@/lib/auth/session';
import { claimQueue, openQueue, type IntentView } from '@/lib/intents';
import { formatINR } from '@/lib/money';
import { payeeHealth } from '@/lib/settings';
import { StaffHeader } from '@/components/StaffHeader';
import { VerifyControls } from '@/components/VerifyControls';

const time = (date: Date | null): string =>
  date
    ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }).format(date)
    : '—';

function Row({ intent, canVerify }: { intent: IntentView; canVerify: boolean }) {
  const claimed = intent.paymentStatus === 'PAYMENT_VERIFICATION_PENDING';
  return (
    <article className="card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-lg font-semibold">
          {intent.tableNumber ? `Table ${intent.tableNumber}` : intent.customerLabel}
        </p>
        <p className="text-lg font-semibold">{formatINR(intent.amountPaise)}</p>
      </div>
      <p className="text-sm text-[var(--muted)]">
        Bill {intent.code} · from {intent.source === 'SIZZLE' ? 'Sizzle' : 'this counter'} ·{' '}
        {claimed ? `claimed at ${time(intent.updatedAt)}` : `waiting since ${time(intent.updatedAt)}`}
      </p>
      <p className="mt-1 text-sm">
        Paid to {intent.payeeName} · {intent.payeeVpaMasked}
      </p>
      {intent.items.length ? (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[var(--muted)]">
          {intent.items.map((item, index) => (
            <li key={`${item.name}-${index}`}>
              {item.quantity} × {item.name}
            </li>
          ))}
        </ul>
      ) : null}

      {!claimed ? (
        <p className="mt-3 text-sm text-[var(--muted)]">
          The guest has not said they paid yet. Nothing to check until they do.
        </p>
      ) : canVerify ? (
        <VerifyControls
          intentId={intent.id}
          code={intent.code}
          amountLabel={formatINR(intent.amountPaise)}
          payeeMasked={intent.payeeVpaMasked}
        />
      ) : (
        <p className="mt-3 text-sm">
          <span className="pill pill-claim">Read only for your role</span>
          <span className="mt-2 block text-[var(--muted)]">
            You can see the claim and everything about it. Confirming it needs the statement, so it belongs to the
            counter or the owner.
          </span>
        </p>
      )}
    </article>
  );
}

export default async function QueuePage() {
  const staff = await requireStaff();
  const claims = await claimQueue();
  const openAll = await openQueue();
  const open = openAll.filter((intent) => !claims.some((claim) => claim.id === intent.id));
  const canVerify = roleCan(staff.role, 'verify');
  const health = await payeeHealth();

  return (
    <div className="flex flex-col gap-5">
      <StaffHeader />

      <header>
        <h1 className="text-2xl font-semibold">Payment verification</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          {claims.length
            ? `${claims.length} claim${claims.length === 1 ? '' : 's'} waiting on your UPI statement.`
            : 'No claims waiting. Guests see their own bill page until then.'}
        </p>
      </header>

      {health !== 'configured' ? (
        <p className="notice">
          {health === 'unreadable'
            ? 'The stored payee could not be decrypted with this build’s key, so no new QR can be issued. Re-enter the UPI ID in Payment settings.'
            : 'No UPI ID is configured yet, so bills cannot be paid here. Set it in Payment settings.'}
        </p>
      ) : null}

      {!canVerify ? (
        <p className="notice">
          You are signed in as {staff.role}. This queue is read-only for you: seeing what guests claim is your job,
          deciding whether the money arrived is not.
        </p>
      ) : null}

      {claims.length ? claims.map((intent) => <Row key={intent.id} intent={intent} canVerify={canVerify} />) : null}

      {open.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="label">Open requests · {open.length}</h2>
          {open.map((intent) => (
            <Row key={intent.id} intent={intent} canVerify={false} />
          ))}
        </section>
      ) : null}
    </div>
  );
}
