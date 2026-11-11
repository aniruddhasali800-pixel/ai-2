import { useState } from 'react';
import { Banknote, BadgeCheck, Clock, Landmark, SearchX, ShieldCheck, Wallet } from 'lucide-react';
import { http, errMsg } from '../../lib/api';
import { useQuery } from '../../lib/query';
import { can, useAuth } from '../../store/auth';
import type { ServiceIntent, ServiceOverview, ServicePayee } from '../../lib/types';
import { dateTime, inr, timeAgo } from '../../lib/format';
import { Button, Card, EmptyState, Field, Input, Modal, Pill, SegmentedControl, Spinner, StatTile, Toggle } from '../../components/ui';
import { toast } from '../../store/toasts';

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

/** Paise is what the payment service counts in; rupees is what this screen shows. */
const rupees = (paise: number | undefined) => inr((paise ?? 0) / 100);

export function PaymentsPage() {
  const { user } = useAuth();
  const role = user?.role;
  const isOwner = can(role, 'settings:write');
  // The bill service refuses a manager here, so the buttons are not offered either. A manager's
  // screen is the queue with the statement open next to it.
  const canVerify = role === 'OWNER' || role === 'CASHIER';
  const [range, setRange] = useState('30');
  const [intent, setIntent] = useState<{ intent: ServiceIntent; mode: 'verify' | 'reject' } | null>(null);
  const [payeeOpen, setPayeeOpen] = useState(false);

  const { data, loading, error, refetch } = useQuery<ServiceOverview>('payments:overview', '/payments/service/overview', {
    days: Number(range),
  });

  if (loading && !data) return <Spinner label="Reading the payment service…" />;

  if (error && !data) {
    return (
      <Card title="Payments" subtitle="Direct UPI collection">
        <div className="space-y-3 p-4">
          <p className="rounded-xl bg-red-50 px-3.5 py-3 text-[13px] leading-relaxed text-red-800 ring-1 ring-red-200">{error}</p>
          <p className="text-[12.5px] leading-relaxed text-ink-500">
            Bills are unaffected: they still print the QR this tenant falls back to, and the counter still settles cash.
            Nothing here is marked paid on the strength of a screen that could not be read.
          </p>
          <Button size="sm" variant="secondary" onClick={refetch}>Try again</Button>
        </div>
      </Card>
    );
  }

  if (!data?.enabled) {
    return (
      <Card title="Payments" subtitle="Direct UPI collection">
        <div className="p-4">
          <p className="rounded-xl bg-ink-50 px-3.5 py-3 text-[13px] leading-relaxed text-ink-600">
            {data?.reason ?? 'No payment service is paired with this deployment.'}
          </p>
          <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-500">
            Bills still print a QR — it uses this restaurant’s own UPI ID from Settings, and the counter settles it the
            same way: cash at the till, or the payment confirmed only after somebody has seen the money.
          </p>
        </div>
      </Card>
    );
  }

  const claims = data.queue?.awaitingVerification ?? [];
  const open = data.queue?.open ?? [];
  const income = data.income;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Seen in the account" value={rupees(income?.collectedPaise)} tone="leaf" icon={<BadgeCheck size={16} />} hint={`${income?.count ?? 0} payment${income?.count === 1 ? '' : 's'}`} />
        <StatTile label="Awaiting a check" value={rupees(income?.awaitingVerification.amountPaise)} tone="ember" icon={<Clock size={16} />} hint={`${income?.awaitingVerification.count ?? 0} claimed`} />
        <StatTile label="Still open" value={rupees(income?.openRequests.amountPaise)} icon={<Wallet size={16} />} hint={`${income?.openRequests.count ?? 0} QR out there`} />
        <StatTile label="Failed or closed" value={rupees(income?.failedOrCancelled.amountPaise)} icon={<Landmark size={16} />} hint={`${income?.failedOrCancelled.count ?? 0} not collected`} />
      </div>

      <Card
        title="Needs a statement check"
        subtitle="The guest says they paid. Nobody has seen the money yet."
        action={<SegmentedControl size="sm" options={RANGES} value={range} onChange={setRange} />}
      >
        {!claims.length ? (
          <EmptyState icon={<BadgeCheck size={26} />} title="Nothing waiting" body="Every claim raised has been answered from the bank statement." />
        ) : (
          <ul className="divide-y divide-ink-100">
            {claims.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2">
                    <span className="font-display text-[14px] font-800 text-ink-900">{c.externalBillNumber ?? c.code}</span>
                    {c.tableNumber && (
                      <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10.5px] font-bold uppercase text-ink-500">Table {c.tableNumber}</span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-ink-500">
                    {c.customerLabel || 'Guest'} · {c.payeeVpaMasked} · claimed {c.updatedAt ? timeAgo(c.updatedAt) : 'just now'}
                  </p>
                </div>
                <span className="w-20 shrink-0 text-right font-display text-[15px] font-800 tabular-nums text-ink-900">{inr(c.amountRupees)}</span>
                {canVerify ? (
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" variant="success" icon={<BadgeCheck size={14} />} onClick={() => setIntent({ intent: c, mode: 'verify' })}>
                      In the statement
                    </Button>
                    <Button size="sm" variant="ghost" icon={<SearchX size={14} />} onClick={() => setIntent({ intent: c, mode: 'reject' })}>
                      Not there
                    </Button>
                  </div>
                ) : (
                  <Pill className="bg-blue-50 text-blue-700 ring-blue-200">Read only</Pill>
                )}
              </li>
            ))}
          </ul>
        )}
        {!canVerify && (
          <p className="border-t border-ink-100 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-500">
            Confirming money needs the owner or the cashier: whoever checks signs the payment off with the UTR they read
            from the statement, and that name stays on the record.
          </p>
        )}
      </Card>

      <Card title="QRs still in the wild" subtitle="Issued with a bill, nobody has claimed them">
        {!open.length ? (
          <EmptyState icon={<Banknote size={26} />} title="No open requests" body="Every UPI request raised is answered." />
        ) : (
          <ul className="divide-y divide-ink-100">
            {open.map((o) => (
              <li key={o.id} className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
                <span className="min-w-0 flex-1 truncate font-medium text-ink-800">
                  {o.externalBillNumber ?? o.code}
                  {o.tableNumber ? ` · Table ${o.tableNumber}` : ''}
                  {o.customerLabel ? ` · ${o.customerLabel}` : ''}
                </span>
                {o.payUrl && (
                  <a href={o.payUrl} target="_blank" rel="noreferrer" className="shrink-0 text-[12px] font-semibold text-ember-600 hover:underline">
                    Payment page
                  </a>
                )}
                <span className="w-16 shrink-0 text-right font-semibold tabular-nums text-ink-900">{inr(o.amountRupees)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Collected" subtitle={`Verified payments in the last ${data.days ?? range} days`}>
          <div className="p-4">
            <Bars rows={(income?.days ?? []).slice(-10).map((d) => ({ label: d.day, amount: d.amountPaise, hint: `${d.count} payment${d.count === 1 ? '' : 's'}` }))} />
          </div>
        </Card>

        <Card title="Who confirmed the money" subtitle="Every settled payment carries the name and UTR of the person that checked">
          <div className="p-4">
            {!income?.byVerifier.length ? (
              <p className="text-[13px] text-ink-500">Nothing settled in this window.</p>
            ) : (
              <ul className="space-y-1.5 text-[13px]">
                {income.byVerifier.map((v) => (
                  <li key={v.name} className="flex items-center justify-between gap-3 rounded-xl bg-ink-50 px-3 py-2">
                    <span className="truncate font-medium text-ink-800">{v.name}</span>
                    <span className="shrink-0 tabular-nums text-ink-500">{v.count} · {rupees(v.amountPaise)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>
      </div>

      <PayeeCard payee={data.payee} canEdit={isOwner} onOpen={() => setPayeeOpen(true)} />

      {intent && (
        <DecisionModal
          intent={intent.intent}
          mode={intent.mode}
          onClose={() => setIntent(null)}
          onDone={() => {
            setIntent(null);
            refetch();
          }}
        />
      )}
      {payeeOpen && data.payee && (
        <PayeeModal current={data.payee} onClose={() => setPayeeOpen(false)} onSaved={() => { setPayeeOpen(false); refetch(); }} />
      )}
    </div>
  );
}

function Bars({ rows }: { rows: { label: string; amount: number; hint: string }[] }) {
  const top = Math.max(...rows.map((r) => r.amount), 1);
  if (!rows.length) return <p className="text-[13px] text-ink-500">No payments in this window.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[92px_1fr_auto] items-center gap-3 text-[12px]">
          <span className="tabular-nums text-ink-500">{r.label}</span>
          <span className="h-2 overflow-hidden rounded-full bg-ink-100">
            <span className="block h-full rounded-full bg-leaf-500" style={{ width: `${Math.max(3, (r.amount / top) * 100)}%` }} />
          </span>
          <span className="shrink-0 tabular-nums font-semibold text-ink-800">{rupees(r.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

function PayeeCard({ payee, canEdit, onOpen }: { payee?: ServicePayee; canEdit: boolean; onOpen: () => void }) {
  return (
    <Card title="Where the money lands" subtitle="The UPI ID printed on every bill’s QR" className="lg:col-span-2">
      <div className="flex flex-wrap items-center gap-4 p-4">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2">
            <span className="font-display text-[16px] font-800 text-ink-900">{payee?.payeeName ?? '—'}</span>
            <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase ring-1 ring-inset ${payee?.enabled ? 'bg-leaf-50 text-leaf-700 ring-leaf-500/30' : 'bg-stone-100 text-stone-600 ring-stone-300'}`}>
              {payee?.enabled ? 'Collecting' : 'Paused'}
            </span>
          </p>
          <p className="mt-0.5 text-[13px] text-ink-500">
            {payee?.payeeMasked ?? 'Not set'}
            {payee?.businessName ? ` · ${payee.businessName}` : ''}
          </p>
          <p className="mt-2 max-w-prose text-[12px] leading-relaxed text-ink-500">
            The full address is never shown here and never leaves the payment service unmasked. Changing it takes the
            owner’s own session, the UPI ID retyped in full, and an audit entry — a QR already in a guest’s hand keeps
            the address it was printed with.
          </p>
        </div>
        {canEdit ? (
          <Button size="sm" variant="primary" icon={<ShieldCheck size={14} />} onClick={onOpen}>Authorise change</Button>
        ) : (
          <Pill className="bg-blue-50 text-blue-700 ring-blue-200">Owner only</Pill>
        )}
      </div>
    </Card>
  );
}

function PayeeModal({ current, onClose, onSaved }: { current: ServicePayee; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    vpa: '',
    payeeName: current.payeeName,
    businessName: current.businessName,
    enabled: current.enabled,
  });
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      await http.patch('/payments/service/payee', {
        vpa: form.vpa.trim(),
        payeeName: form.payeeName.trim(),
        businessName: form.businessName.trim() || undefined,
        enabled: form.enabled,
      });
      toast(form.enabled ? 'Payee saved — new bills use it, printed QRs do not' : 'Payee saved — collection is paused', 'success');
      onSaved();
    } catch (e) {
      toast(errMsg(e, 'The payment service refused that'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Change the payee UPI ID"
      subtitle={`Currently ${current.payeeMasked}`}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={form.vpa.trim().length < 6 || form.payeeName.trim().length < 2} onClick={go}>
            Save payee
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <Field label="New UPI ID" required hint="Type it in full — the stored address is only ever shown masked.">
          <Input value={form.vpa} onChange={(e) => setForm((f) => ({ ...f, vpa: e.target.value }))} placeholder="restaurant-name@bank" autoFocus />
        </Field>
        <Field label="Name the guest sees" required>
          <Input value={form.payeeName} onChange={(e) => setForm((f) => ({ ...f, payeeName: e.target.value }))} />
        </Field>
        <Field label="Business name" hint="Shown on the payment service’s own screens">
          <Input value={form.businessName} onChange={(e) => setForm((f) => ({ ...f, businessName: e.target.value }))} />
        </Field>
        <div className="flex items-center justify-between gap-4 rounded-xl bg-ink-50 px-3.5 py-3">
          <p className="text-[12.5px] leading-snug text-ink-600">
            <span className="font-semibold text-ink-800">Collect UPI on new bills</span>
            <br />Paused means a finalised bill prints no QR; the counter takes cash instead.
          </p>
          <Toggle checked={form.enabled} onChange={(v) => setForm((f) => ({ ...f, enabled: v }))} />
        </div>
        <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
          This is the one setting that redirects a customer’s money. Check the new address in a UPI app before you save
          it, and tell the counter the day it changes.
        </p>
      </div>
    </Modal>
  );
}

function DecisionModal({ intent, mode, onClose, onDone }: { intent: ServiceIntent; mode: 'verify' | 'reject'; onClose: () => void; onDone: () => void }) {
  const [utr, setUtr] = useState('');
  const [reason, setReason] = useState('Not found in the statement');
  const [busy, setBusy] = useState(false);
  const verifying = mode === 'verify';

  async function go() {
    setBusy(true);
    try {
      await http.post(`/payments/service/claims/${intent.id}/${verifying ? 'settle' : 'reject'}`, verifying ? { utr: utr.trim() } : { reason });
      toast(verifying ? `${inr(intent.amountRupees)} marked as received` : 'Claim rejected — the bill stays open', verifying ? 'success' : 'error');
      onDone();
    } catch (e) {
      toast(errMsg(e, 'The payment service refused that'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={verifying ? 'Confirm the money arrived' : 'Reject this claim'}
      subtitle={`${intent.externalBillNumber ?? intent.code} · ${inr(intent.amountRupees)} to ${intent.payeeVpaMasked}`}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant={verifying ? 'success' : 'danger'} loading={busy} disabled={verifying ? utr.trim().length < 4 : reason.trim().length < 3} onClick={go}>
            {verifying ? 'Mark as received' : 'Reject'}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div className="rounded-xl bg-ink-50 px-3.5 py-3 text-[12.5px] leading-relaxed text-ink-600">
          <p className="font-semibold text-ink-800">{intent.customerLabel || 'Guest'}{intent.tableNumber ? ` · Table ${intent.tableNumber}` : ''}</p>
          <p className="mt-0.5">Claimed {intent.updatedAt ? dateTime(intent.updatedAt) : 'recently'} · note “{intent.note}”</p>
        </div>
        {verifying ? (
          <>
            <Field label="UTR / statement reference" required hint="The 12-digit reference the bank printed. It is kept as the proof.">
              <Input value={utr} onChange={(e) => setUtr(e.target.value)} placeholder="682109274512" autoFocus inputMode="numeric" />
            </Field>
            <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
              Only tick this after the transfer is visible in the account. This closes the bill and frees the table.
            </p>
          </>
        ) : (
          <Field label="What the statement shows" required>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}
