import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Banknote, CreditCard, Hourglass, Inbox, Printer, RotateCcw, Search, Smartphone } from 'lucide-react';
import { invalidate, useQuery } from '../../lib/query';
import { http, errMsg } from '../../lib/api';
import type { Bill, Order, Paginated, Payment, UpiCharge } from '../../lib/types';
import { BILL_STATUS_META, PAYMENT_STATUS_META } from '../../lib/statusMaps';
import { clockTime, dateTime, initials, inr } from '../../lib/format';
import { Button, Card, Drawer, EmptyState, Field, Input, Modal, SegmentedControl, Select, Spinner, StatTile, Textarea } from '../../components/ui';
import { UpiQr } from '../../components/UpiQr';
import { can, useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';

const RANGES = [
  { value: 'unpaid', label: 'To collect' },
  { value: 'today', label: 'Today' },
  { value: 'all', label: 'All bills' },
];

export function BillsPage() {
  const { user } = useAuth();
  const settle = can(user?.role, 'payments:write');
  const [params] = useSearchParams();
  const scanned = params.get('search') ?? params.get('bill');
  // A scan is about the now, so it starts on today's bills rather than the unpaid filter.
  const [range, setRange] = useState<(typeof RANGES)[number]['value']>(scanned ? 'today' : 'unpaid');
  const [search, setSearch] = useState(params.get('search') ?? '');
  const [debounced, setDebounced] = useState(params.get('search') ?? '');
  // A scanned bill QR lands here with the bill already named, so the drawer opens itself.
  const [openId, setOpenId] = useState<string | null>(params.get('bill'));

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 280);
    return () => clearTimeout(t);
  }, [search]);

  const query: Record<string, unknown> = { limit: 60 };
  if (range === 'unpaid') query.unpaidOnly = true;
  if (range === 'today') query.todayOnly = true;
  if (debounced) query.search = debounced;

  const { data, loading } = useQuery<Paginated<Bill>>('bills:list', '/billing', query);
  const bills = data?.data ?? [];
  const outstanding = bills.filter((b) => b.paymentStatus === 'UNPAID').reduce((s, b) => s + b.grandTotal, 0);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="To collect" value={inr(outstanding)} tone="ember" hint={`${bills.filter((b) => b.paymentStatus === 'UNPAID').length} open bill${bills.filter((b) => b.paymentStatus === 'UNPAID').length === 1 ? '' : 's'}`} />
        <StatTile label="Bills in view" value={String(data?.total ?? 0)} hint={range === 'unpaid' ? 'unpaid only' : range === 'today' ? 'issued today' : 'all time'} />
        <StatTile label="Collected today" value={<TodayCollected />} tone="leaf" />
      </div>

      <Card
        title="Bills"
        subtitle="Tap a bill to settle it"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SegmentedControl size="sm" options={RANGES} value={range} onChange={setRange} />
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Bill, table or guest" className="h-8 w-44 pl-7 text-[13px]" />
            </div>
          </div>
        }
      >
        {loading && !data ? (
          <Spinner />
        ) : !bills.length ? (
          <EmptyState icon={<Inbox size={26} />} title="No bills here" body={range === 'unpaid' ? 'Everything issued so far has been paid. Nice.' : 'Nothing matches this filter.'} />
        ) : (
          <ul className="divide-y divide-ink-100">
            {bills.map((b) => (
              <li key={b._id} className="flex items-center gap-3 px-3.5 py-3 transition-colors hover:bg-ember-50/40">
                <button onClick={() => setOpenId(b._id)} className="min-w-0 flex-1 text-left">
                  <p className="flex items-center gap-2">
                    <span className="font-display text-[14px] font-800 text-ink-900">{b.billNumber}</span>
                    {b.tableNumber && <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10.5px] font-bold uppercase text-ink-500">{b.tableNumber}</span>}
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-ink-500">
                    {b.customerName || 'Guest'} · {clockTime(b.issuedAt)} · {b.orderIds.length} order{b.orderIds.length > 1 ? 's' : ''}
                  </p>
                </button>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide ring-1 ring-inset ${BILL_STATUS_META[b.status].cls}`}>
                  {BILL_STATUS_META[b.status].label}
                </span>
                <span className="w-20 shrink-0 text-right font-display text-[15px] font-800 tabular-nums text-ink-900">{inr(b.grandTotal)}</span>
                {settle && b.paymentStatus === 'UNPAID' && (
                  <Button size="sm" variant="primary" onClick={() => setOpenId(b._id)}>Settle</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <BillDrawer billId={openId} onClose={() => setOpenId(null)} canSettle={settle} />
    </div>
  );
}

function TodayCollected() {
  const { data } = useQuery<Paginated<Payment>>('payments:today', '/payments', { status: 'SUCCEEDED', limit: 100 });
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const sum = (data?.data ?? []).filter((p) => new Date(p.createdAt) >= today).reduce((s, p) => s + p.amount, 0);
  return <>{inr(sum)}</>;
}

interface BillDetail {
  bill: Bill;
  orders: {
    _id: string;
    orderNumber: string;
    source: Order['source'];
    customerName: string;
    customerPhone: string;
    customerAddress?: string;
    customerCity?: string;
    items: { name: string; qty: number; lineTotal: number }[];
    grandTotal: number;
  }[];
  payments: Payment[];
  upi: UpiCharge | null;
}

function BillDrawer({ billId, onClose, canSettle }: { billId: string | null; onClose: () => void; canSettle: boolean }) {
  const [detail, setDetail] = useState<BillDetail | null>(null);
  const [mode, setMode] = useState<'cash' | 'online' | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!billId) { setDetail(null); return; }
    let live = true;
    http.get<BillDetail>(`/billing/${billId}`).then((r) => live && setDetail(r.data)).catch((e) => toast(errMsg(e, 'Could not load the bill'), 'error'));
    return () => { live = false; };
  }, [billId]);

  async function reload() {
    if (!billId) return;
    const { data } = await http.get<BillDetail>(`/billing/${billId}`);
    setDetail(data);
    invalidate('bills');
    invalidate('payments');
  }

  if (!billId) return null;
  const b = detail?.bill;
  // A guest's "I've paid" lands here as a claim. It must be visible before any other button.
  const claimed = detail?.payments.find((p) => p.status === 'VERIFICATION_PENDING');
  const deliverTo = detail?.orders.find((o) => o.customerAddress || o.customerCity);
  const deliveryNote = deliverTo ? [deliverTo.customerAddress, deliverTo.customerCity].filter(Boolean).join(', ') : '';
  const deliveryPhone = deliverTo?.customerPhone ?? '';

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        title={b ? b.billNumber : 'Bill'}
        footer={
          b && b.paymentStatus === 'UNPAID' && canSettle ? (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="primary" icon={<Banknote size={15} />} onClick={() => setMode('cash')}>Cash</Button>
              <Button variant="dark" icon={<CreditCard size={15} />} onClick={() => setMode('online')}>Card / UPI</Button>
            </div>
          ) : b ? (
            <Button variant="secondary" className="w-full" icon={<Printer size={15} />} onClick={() => printBill(b, deliveryNote, detail?.upi?.qrDataUrl ?? '')}>Print again</Button>
          ) : null
        }
      >
        {!b ? (
          <Spinner />
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-ink-50 p-3.5">
              <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-500">{b.paymentStatus !== 'UNPAID' ? 'Settled amount' : 'Amount due'}</p>
              <p className="font-display text-[28px] font-800 leading-none tabular-nums text-ink-900">{inr(b.grandTotal)}</p>
              <p className="mt-1.5 text-[12px] text-ink-500">
                {b.tableNumber ? `Table ${b.tableNumber} · ` : ''}{b.customerName || 'Guest'} · issued {dateTime(b.issuedAt)}
              </p>
            </div>

            {detail!.orders.map((o) => (
              <div key={o._id}>
                <p className="label">{o.orderNumber}</p>
                <ul className="mt-1 divide-y divide-ink-100 rounded-xl ring-1 ring-ink-200">
                  {o.items.map((it, i) => (
                    <li key={i} className="flex items-center gap-2.5 px-3 py-2 text-[13px]">
                      <span className="w-6 tabular-nums text-ink-500">{it.qty}×</span>
                      <span className="min-w-0 flex-1 truncate text-ink-800">{it.name}</span>
                      <span className="tabular-nums text-ink-700">{inr(it.lineTotal)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}

            <div className="space-y-1 text-[13px]">
              <Line label="Subtotal" value={inr(b.subtotal)} />
              {!!b.discountAmount && <Line label="Discount" value={`− ${inr(b.discountAmount)}`} />}
              {!!b.serviceCharge && <Line label="Service charge" value={inr(b.serviceCharge)} />}
              {b.taxBreakup.map((t) => <Line key={t.label} label={`${t.label} ${t.percent}%`} value={inr(t.amount)} />)}
              {!!b.roundOff && <Line label="Round off" value={inr(b.roundOff)} />}
            </div>

            {!!deliveryNote && (
              <div className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12.5px] leading-snug text-amber-900 ring-1 ring-amber-200">
                <p className="font-bold uppercase tracking-wide text-[10.5px] text-amber-700">Deliver to</p>
                <p className="mt-0.5 font-medium">{deliveryNote}</p>
                {deliveryPhone && <p className="text-amber-800">{deliveryPhone}</p>}
              </div>
            )}

            {detail!.upi && b.paymentStatus === 'UNPAID' && <UpiQr charge={detail!.upi} />}

            {claimed && (
              <div className="flex flex-wrap items-center gap-2.5 rounded-xl bg-blue-50 px-3.5 py-3 text-[12.5px] leading-snug text-blue-900 ring-1 ring-blue-200">
                <Hourglass size={16} className="shrink-0" />
                <p className="min-w-0 flex-1">
                  The guest says {inr(claimed.amount)} has been sent to this UPI account. It is a claim,
                  not money — open the statement, then confirm it with the UTR or reject it.
                </p>
                {canSettle && (
                  <Link to="/app/payments" className="shrink-0 rounded-lg bg-blue-600 px-2.5 py-1.5 text-[12px] font-semibold text-white hover:bg-blue-700">
                    Verify it
                  </Link>
                )}
              </div>
            )}

            {!!b.publicToken && (
              <button
                onClick={() => { void navigator.clipboard?.writeText(`${window.location.origin}/bill/${b.publicToken}`); toast('Guest bill link copied', 'success'); }}
                className="w-full rounded-xl border border-dashed border-ink-300 px-3 py-2 text-[12.5px] font-medium text-ink-600 hover:bg-ink-50"
              >
                Copy the guest bill link
              </button>
            )}

            {!!detail!.payments.length && (
              <div>
                <p className="label">Payments</p>
                <ul className="mt-1 space-y-1.5">
                  {detail!.payments.map((p) => (
                    <li key={p._id} className="flex items-center gap-2 rounded-xl ring-1 ring-ink-200 px-3 py-2 text-[13px]">
                      <span className="font-semibold text-ink-800">{p.method}</span>
                      {p.provider && <span className="text-ink-400">{p.provider}</span>}
                      <span className={`ml-auto rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase ring-1 ring-inset ${PAYMENT_STATUS_META[p.status].cls}`}>
                        {PAYMENT_STATUS_META[p.status].label}
                      </span>
                      <span className="w-16 text-right font-medium tabular-nums">{inr(p.amount)}</span>
                      {canRefund(p) && <RefundButton payment={p} onDone={reload} />}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Drawer>

      {b && mode === 'cash' && <CashModal bill={b} onClose={() => setMode(null)} onDone={async () => { setMode(null); await reload(); }} />}
      {b && mode === 'online' && <OnlineModal bill={b} charge={detail!.upi} onClose={() => setMode(null)} onDone={async () => { setMode(null); await reload(); }} />}
    </>
  );
}

function canRefund(p: Payment) {
  return (p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED') && can(useAuth.getState().user?.role, 'payments:refund');
}

function RefundButton({ payment, onDone }: { payment: Payment; onDone: () => Promise<void> }) {
  const [amount, setAmount] = useState(payment.amount);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  async function go() {
    setBusy(true);
    try {
      await http.post(`/payments/${payment._id}/refund`, { amount, reason });
      toast('Refund recorded', 'success');
      setOpen(false);
      await onDone();
    } catch (e) { toast(errMsg(e, 'Refund failed'), 'error'); } finally { setBusy(false); }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="text-ink-400 hover:text-red-600" title="Refund"><RotateCcw size={14} /></button>
      <Modal open={open} onClose={() => setOpen(false)} title="Refund payment" subtitle={`${payment.method} · ${inr(payment.amount)}`} width="max-w-sm"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button variant="danger" loading={busy} onClick={go}>Refund</Button></>}>
        <div className="space-y-3">
          <Field label="Amount (₹)"><Input type="number" value={amount} max={payment.amount} onChange={(e) => setAmount(Number(e.target.value))} /></Field>
          <Field label="Reason"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Guest left the charger, wrong entry…" /></Field>
        </div>
      </Modal>
    </>
  );
}

function CashModal({ bill, onClose, onDone }: { bill: Bill; onClose: () => void; onDone: () => Promise<void> }) {
  const [tendered, setTendered] = useState(bill.grandTotal);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const change = Math.max(0, tendered - bill.grandTotal);

  async function go() {
    setBusy(true);
    try {
      const { data } = await http.post<{ payment: Payment }>(`/billing/${bill._id}/cash`, { tendered, note: note || undefined });
      toast(`${inr(bill.grandTotal)} collected · change ${inr(data.payment.change ?? 0)}`, 'success');
      await onDone();
    } catch (e) { toast(errMsg(e, 'Could not record the payment'), 'error'); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="Cash settlement" subtitle={`${bill.billNumber} · ${inr(bill.grandTotal)}`} width="max-w-sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={go} icon={<Banknote size={15} />}>Confirm cash</Button></>}>
      <div className="space-y-3">
        <Field label="Cash tendered (₹)">
          <Input type="number" value={tendered} onChange={(e) => setTendered(Number(e.target.value))} autoFocus />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {[bill.grandTotal, 100, 200, 500, 1000, 2000].map((n, i) => (
            <button key={i} onClick={() => setTendered(n)} className="rounded-lg border border-ink-200 px-2.5 py-1 text-[12.5px] font-semibold text-ink-700 hover:bg-ink-50">
              {i === 0 ? 'Exact' : inr(n)}
            </button>
          ))}
        </div>
        <div className="flex items-baseline justify-between rounded-xl bg-ink-900 px-3.5 py-3 text-white">
          <span className="text-[12.5px] font-semibold uppercase tracking-wide text-ink-300">Change due</span>
          <span className="font-display text-[22px] font-800 tabular-nums">{inr(change)}</span>
        </div>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Drawer slip reference…" /></Field>
      </div>
    </Modal>
  );
}

function OnlineModal({ bill, charge, onClose, onDone }: { bill: Bill; charge: UpiCharge | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [method, setMethod] = useState<'CARD' | 'UPI' | 'ONLINE'>('UPI');
  const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState<Payment | null>(null);

  async function start() {
    setBusy(true);
    try {
      const { data } = await http.post<Payment>(`/billing/${bill._id}/online`, { method });
      setPayment(data);
    } catch (e) { toast(errMsg(e, 'Could not start the payment'), 'error'); } finally { setBusy(false); }
  }

  async function simulate(outcome: 'SUCCESS' | 'FAILURE') {
    if (!payment) return;
    setBusy(true);
    try {
      await http.post(`/payments/${payment._id}/simulate`, { outcome });
      toast(outcome === 'SUCCESS' ? 'Payment captured' : 'Payment failed', outcome === 'SUCCESS' ? 'success' : 'error');
      await onDone();
    } catch (e) { toast(errMsg(e, 'Gateway call failed'), 'error'); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="Card / UPI payment" subtitle={`${bill.billNumber} · ${inr(bill.grandTotal)}`} width="max-w-sm"
      footer={payment ? <Button variant="ghost" onClick={onClose}>Close</Button> : <><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="dark" loading={busy} onClick={start}>Start payment</Button></>}>
      {!payment ? (
        <div className="space-y-3">
          <Field label="Method">
            <Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              <option value="UPI">UPI</option>
              <option value="CARD">Card</option>
              <option value="ONLINE">Netbanking</option>
            </Select>
          </Field>
          {method === 'UPI' && charge && <UpiQr charge={charge} />}
        </div>
      ) : payment.provider === 'UPI_DIRECT' ? (
        <div className="space-y-3">
          {charge && <UpiQr charge={charge} />}
          <div className="rounded-xl bg-ink-50 px-3.5 py-3 text-[13px]">
            <p className="font-semibold text-ink-900">{payment.method} · direct to the restaurant’s UPI account</p>
            <p className="mt-0.5 text-ink-500">{charge?.upiId ?? payment.providerOrderId}</p>
            {payment.checkoutUrl && (
              <a href={payment.checkoutUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block break-all text-[12px] font-semibold text-ember-600 hover:underline">
                The guest’s payment page
              </a>
            )}
          </div>
          {/* Direct UPI has no gateway to ask: only a person with the statement can settle it. */}
          <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-amber-900 ring-1 ring-amber-200">
            Nothing on this screen can mark the money as arrived. When the transfer shows in the account, confirm it with
            the UTR under Payments; if the guest taps “I’ve paid” first, the claim appears there too.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-xl bg-ink-50 px-3.5 py-3 text-[13px]">
            <p className="font-semibold text-ink-900">{payment.method} · {payment.provider || 'MOCK'}</p>
            <p className="mt-0.5 text-ink-500">Intent {payment.transactionId ?? payment._id}</p>
            {payment.checkoutUrl && <p className="mt-1 break-all text-[12px] text-ink-500">{payment.checkoutUrl}</p>}
          </div>
          <p className="text-[12.5px] text-ink-500">The gateway is in mock mode on this build, so confirm the outcome the terminal reported:</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="success" loading={busy} onClick={() => simulate('SUCCESS')} icon={<Smartphone size={15} />}>Approved</Button>
            <Button variant="danger" loading={busy} onClick={() => simulate('FAILURE')}>Declined</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-ink-500">{label}</span>
      <span className="tabular-nums text-ink-800">{value}</span>
    </div>
  );
}

function printBill(b: Bill, deliverTo = '', qr = '') {
  const w = window.open('', '_blank');
  if (!w) return;
  const merchant = useAuth.getState().restaurant?.name ?? 'Sizzle';
  w.document.write(
    `<title>${b.billNumber}</title><body style="font-family:ui-sans-serif,system-ui;padding:24px;max-width:340px;margin:auto">` +
    `<div style="display:flex;align-items:center;gap:8px;margin:0 0 2px">` +
    `<span style="display:inline-grid;place-items:center;width:34px;height:34px;border-radius:8px;background:#111827;color:#f59e0b;font-weight:800;font-size:12px">${escapeHtml(initials(merchant))}</span>` +
    `<span style="font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#ea580c;font-size:12px">Sizzle</span></div>` +
    `<h3 style="margin:8px 0 4px">${escapeHtml(merchant)}</h3>` +
    `<p style="margin:0 0 12px;font-size:12px">${b.billNumber} · Table ${b.tableNumber || '—'}</p>` +
    (deliverTo ? `<p style="font-size:12px;margin:0 0 12px"><b>Deliver to:</b> ${escapeHtml(deliverTo)}</p>` : '') +
    `<p style="font-size:16px;font-weight:700;margin:12px 0">Total ${inr(b.grandTotal)}</p>` +
    (qr ? `<img src="${qr}" width="160" height="160" alt="UPI QR"><p style="font-size:11px;margin:4px 0 12px">Scan to pay ${inr(b.grandTotal)}</p>` : '') +
    `<p style="font-size:12px">${b.paymentStatus === 'PAID' ? 'PAID' : 'UNPAID'}</p></body>`,
  );
  w.document.close();
  void http.post(`/billing/${b._id}/print`).catch(() => undefined);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
}
