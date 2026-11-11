import { requireAction } from '@/lib/auth/session';
import { settingsView } from '@/lib/settings';
import { StaffHeader } from '@/components/StaffHeader';
import { PayeeForm } from '@/components/PayeeForm';

export default async function SettingsPage() {
  const owner = await requireAction('settings');
  const settings = await settingsView();

  return (
    <div className="flex flex-col gap-5">
      <StaffHeader />
      <header>
        <h1 className="text-2xl font-semibold">Payment settings</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Signed in as {owner.name}. Only an owner can move the payee, because changing it sends every future
          customer&apos;s money somewhere else. Sizzle&apos;s owner dashboard asks for the same change here.
        </p>
      </header>

      <PayeeForm
        businessName={settings.businessName}
        payeeName={settings.payeeName}
        payeeMasked={settings.payeeMasked}
        enabled={settings.enabled}
        updatedByName={settings.updatedByName}
        updatedAt={settings.updatedAt ? settings.updatedAt.toISOString().slice(0, 16).replace('T', ' ') : null}
      />

      <section className="card">
        <p className="label">What this does not touch</p>
        <ul className="mt-2 list-disc pl-5 text-sm text-[var(--muted)]">
          <li>Bills already issued keep the payee they were printed with, so a stale QR still pays the right place.</li>
          <li>Cash and card at the counter are settled in Sizzle, not here.</li>
          <li>Nothing is paid by this service — it holds the address and the queue, and never the money.</li>
        </ul>
      </section>
    </div>
  );
}
