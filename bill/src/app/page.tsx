import Link from 'next/link';
import { payeeHealth, settingsView } from '@/lib/settings';
import { claimQueue } from '@/lib/intents';
import { formatINR } from '@/lib/money';

// The counts on this page are the point of it; a build-time snapshot would lie.
export const dynamic = 'force-dynamic';

export default async function ServiceStatusPage() {
  const [settings, health, claims] = await Promise.all([settingsView(), payeeHealth(), claimQueue()]);
  const awaiting = claims.reduce((sum, intent) => sum + intent.amountPaise, 0);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <p className="label">Sizzle Pay</p>
        <h1 className="text-2xl font-semibold">Direct UPI collection for {settings.businessName}</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          This service holds the restaurant&apos;s own UPI address, the QR on every bill, and the queue of payments
          that need a human with a bank statement. Money goes straight from the guest to the restaurant — nothing is
          held here, and no gateway takes a cut.
        </p>
      </header>

      <section className="card flex flex-col gap-2">
        <p className="label">State</p>
        <p className="text-sm">
          Payee: <strong>{settings.payeeMasked}</strong>{' '}
          {health === 'configured' ? '(ready)' : health === 'unreadable' ? '(needs re-entering)' : '(not set)'}
        </p>
        <p className="text-sm">
          Claims waiting for verification: <strong>{claims.length}</strong>
          {claims.length ? ` · ${formatINR(awaiting)}` : ''}
        </p>
        <p className="text-sm">Collection {settings.enabled ? 'is on' : 'is switched off'}.</p>
      </section>

      <nav className="flex flex-wrap gap-2">
        <Link href="/login" className="btn btn-primary">
          Staff sign in
        </Link>
        <span className="text-sm text-[var(--muted)] self-center">
          Guests do not come here — they use the code printed on their table&apos;s bill.
        </span>
      </nav>
    </div>
  );
}
