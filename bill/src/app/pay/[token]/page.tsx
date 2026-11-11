import { formatINR } from '@/lib/money';
import { findIntentByToken, intentView } from '@/lib/intents';
import { CUSTOMER_COPY } from '@/lib/payments/status';
import { settingsView } from '@/lib/settings';
import { PayPanel } from '@/components/PayPanel';

export default async function PayPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const record = await findIntentByToken(decodeURIComponent(token));
  const settings = await settingsView();

  if (!record) {
    return (
      <section className="card">
        <p className="text-xl font-semibold">This payment link is not one we know</p>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Codes are printed per bill. Ask the counter for a fresh one — an old link is never reused.
        </p>
      </section>
    );
  }

  const view = await intentView(record);
  const copy = CUSTOMER_COPY[view.paymentStatus];

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <p className="label">{settings.businessName}</p>
        <h1 className="text-2xl font-semibold">
          {view.tableNumber ? `Table ${view.tableNumber}` : view.customerLabel}
        </h1>
        <p className="text-sm text-[var(--muted)]">Bill {view.code}</p>
      </header>

      {view.payeeReadable ? (
        <PayPanel
          token={view.token}
          code={view.code}
          amountLabel={formatINR(view.amountPaise)}
          payeeName={view.payeeName}
          payeeMasked={view.payeeVpaMasked}
          payeeVpa={view.payeeVpa}
          qrDataUrl={view.qrDataUrl}
          upiUri={view.upiUri}
          note={view.note}
          status={view.paymentStatus}
          headline={copy.headline}
          detail={copy.detail}
          canClaim={view.paymentStatus === 'PENDING'}
          downloadable={Boolean(view.qrDataUrl)}
        />
      ) : (
        <p className="notice">
          This restaurant has not set its UPI ID yet, so there is no QR to pay into. Please pay at the counter.
        </p>
      )}

      {view.items.length ? (
        <div className="card">
          <p className="label">On this bill</p>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {view.items.map((item, index) => (
              <li key={`${item.name}-${index}`} className="flex justify-between gap-4">
                <span>
                  {item.quantity} × {item.name}
                </span>
                <span>{formatINR(item.lineTotalPaise)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 flex justify-between border-t border-[var(--line)] pt-2 font-semibold">
            <span>Total to pay</span>
            <span>{formatINR(view.amountPaise)}</span>
          </p>
          <p className="mt-1 text-xs text-[var(--muted)]">
            The total comes from the restaurant&apos;s bill, not from anything typed into this page.
          </p>
        </div>
      ) : null}
    </section>
  );
}
