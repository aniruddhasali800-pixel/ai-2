import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChefHat, CircleDot, Receipt, RefreshCw, Bell, Flame } from 'lucide-react';
import { useQuery, invalidate } from '../../lib/query';
import { http, errMsg } from '../../lib/api';
import { joinSession, leaveSession, useRealtimePrefix } from '../../lib/socket';
import type { GuestSession as GuestSessionData, OrderItem } from '../../lib/types';
import { ORDER_STATUS_META, REQUEST_LABEL } from '../../lib/statusMaps';
import { clockTime, inr, timeAgo } from '../../lib/format';
import { Button, Spinner, VegDot } from '../../components/ui';
import { toast } from '../../store/toasts';

const CALLS = ['CALL_WAITER', 'WATER', 'PLATE', 'CUTLERY', 'NAPKIN'] as const;

/** What a posted request comes back with — a settle tap carries the bill it just made. */
interface GuestRequestResult {
  _id: string;
  type: string;
  bill: { _id: string; billNumber: string; grandTotal: number; publicToken: string } | null;
}

export function GuestSession() {
  const { publicToken = '' } = useParams();
  const key = `guest:session:${publicToken}`;
  const { data, loading, error } = useQuery<GuestSessionData>(key, `/public/session/${publicToken}`);

  useEffect(() => {
    joinSession(publicToken);
    return () => leaveSession(publicToken);
  }, [publicToken]);

  useRealtimePrefix(['order.', 'request.', 'bill.', 'session.'], () => {
    invalidate('guest:session');
    invalidate('guest:menu');
  });

  if (loading && !data) return <Spinner label="Loading your table…" />;
  if (error) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 text-center">
        <CircleDot size={24} className="mx-auto mb-3 text-ink-300" />
        <p className="font-display text-lg font-700 text-ink-900">This table session has ended</p>
        <p className="mt-1.5 text-sm text-ink-500">{error}</p>
        <Link to="/login" className="mt-5 inline-block text-sm font-semibold text-ember-600">Back to sign in</Link>
      </div>
    );
  }

  const s = data!;
  const openOrders = s.orders.filter((o) => !['COMPLETED', 'CANCELLED'].includes(o.status));

  return (
    <div className="min-h-screen bg-ink-50 pb-10">
      <header className="bg-ink-900 px-5 pb-8 pt-6 text-white">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-ember-400">Live table</p>
        <h1 className="mt-1 font-display text-[24px] font-800 leading-tight tracking-tight">
          Table {s.table?.number ?? '—'}
        </h1>
        <p className="mt-1 text-[13px] text-ink-300">
          {s.session.guestCount} guests · seated {clockTime(s.session.openedAt)}
        </p>
        <div className="mt-4 flex items-end justify-between">
          <div>
            <p className="text-[11.5px] uppercase tracking-wide text-ink-400">Running total</p>
            <p className="font-display text-[30px] font-800 leading-none tabular-nums">{inr(s.runningTotal)}</p>
            <p className="mt-1 text-[11.5px] text-ink-400">including taxes and service charge</p>
          </div>
          <button
            onClick={() => invalidate('guest')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] font-semibold text-ink-200 hover:bg-white/5"
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4">
        {s.bill && (
          <Link
            to={`/bill/${s.bill.publicToken}`}
            className="mt-4 flex items-center gap-3 rounded-2xl border border-leaf-500/40 bg-leaf-50 px-4 py-3.5"
          >
            <Receipt size={19} className="text-leaf-700" />
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-[13.5px] font-bold text-leaf-800">Your bill is ready</p>
              <p className="text-[12px] text-leaf-700">{s.bill.billNumber} · {inr(s.bill.grandTotal)}</p>
            </div>
            <span className="text-[12px] font-semibold text-leaf-700">View →</span>
          </Link>
        )}

        <section className="mt-5">
          <h2 className="mb-2 flex items-center gap-1.5 font-display text-[15px] font-700 text-ink-900">
            <ChefHat size={15} className="text-ember-500" /> In the kitchen
          </h2>
          <ul className="space-y-2.5">
            {openOrders.map((o) => (
              <li key={o._id} className="overflow-hidden rounded-2xl bg-white ring-1 ring-ink-200/70">
                <div className="flex items-center gap-2 border-b border-ink-100 px-4 py-2.5">
                  <span className="font-display text-[14px] font-800 text-ink-900">{o.orderNumber}</span>
                  <StatusPill status={o.status} />
                  <span className="ml-auto text-[12px] tabular-nums text-ink-500">{inr(o.grandTotal)}</span>
                </div>
                <ul className="divide-y divide-ink-50">
                  {o.items.map((it, i) => (
                    <li key={i} className="flex items-start gap-2.5 px-4 py-2.5">
                      <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded bg-ink-900 text-[11px] font-bold text-white">
                        {it.qty}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <VegDot isVeg={(it as OrderItem & { isVeg?: boolean }).isVeg ?? true} />
                          <span className="truncate text-[13.5px] font-semibold text-ink-900">{it.name}</span>
                        </div>
                        {!!it.addons?.length && (
                          <p className="text-[12px] text-ink-500">+ {it.addons.map((a) => a.name).join(', ')}</p>
                        )}
                        {!!it.notes && <p className="mt-0.5 text-[12px] italic text-amber-700">{it.notes}</p>}
                      </div>
                    </li>
                  ))}
                </ul>
                {o.status === 'READY' && (
                  <p className="bg-leaf-600 px-4 py-2 text-[12.5px] font-bold text-white">
                    Ready — your waiter is on the way
                  </p>
                )}
              </li>
            ))}
            {!openOrders.length && (
              <li className="rounded-2xl bg-white px-4 py-8 text-center text-[13px] text-ink-500 ring-1 ring-ink-200/70">
                Nothing cooking right now. Add something from the menu.
              </li>
            )}
          </ul>
        </section>

        <section className="mt-6">
          <h2 className="mb-2 flex items-center gap-1.5 font-display text-[15px] font-700 text-ink-900">
            <Bell size={15} className="text-ember-500" /> Ask your waiter
          </h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {CALLS.map((c) => (
              <RequestButton key={c} type={c} token={publicToken} label={REQUEST_LABEL[c]?.label ?? c} emoji={REQUEST_LABEL[c]?.emoji ?? '✋'} />
            ))}
            <RequestButton
              type="BILL"
              token={publicToken}
              variant="primary"
              label="Bill please"
              emoji={REQUEST_LABEL.BILL.emoji}
            />
            <RequestButton
              type="CASH_PAYMENT"
              token={publicToken}
              variant="primary"
              label="Pay by cash"
              emoji={REQUEST_LABEL.CASH_PAYMENT.emoji}
            />
          </div>
          {!!s.requests.length && (
            <ul className="mt-3 space-y-1.5">
              {s.requests.map((r) => (
                <li key={r._id} className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-[12.5px] ring-1 ring-ink-200/70">
                  <span>{REQUEST_LABEL[r.type]?.emoji ?? '✋'}</span>
                  <span className="font-medium text-ink-800">{REQUEST_LABEL[r.type]?.label ?? r.type}</span>
                  <span className="ml-auto text-ink-400">
                    {r.collectedAt
                      ? `cash taken · ${inr(r.tendered ?? 0)} at the counter`
                      : r.status === 'ACKNOWLEDGED'
                        ? 'on the way'
                        : timeAgo(r.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="mt-6 text-center text-[12px] text-ink-500">
          {s.session.status === 'BILL_REQUESTED' ? (
            <span className="inline-flex items-center gap-1 font-semibold text-amber-700">
              <Flame size={12} /> Bill requested — the counter has been notified
            </span>
          ) : (
            'Extra hunger? Scan the table code again — until the kitchen starts, it joins the order you have running.'
          )}
        </p>
      </main>
    </div>
  );
}

function StatusPill({ status }: { status: keyof typeof ORDER_STATUS_META }) {
  const m = ORDER_STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ring-1 ring-inset ${m.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} /> {m.label}
    </span>
  );
}

function RequestButton({
  type,
  token,
  label,
  emoji,
  variant = 'secondary',
}: {
  type: string;
  token: string;
  label: string;
  emoji: string;
  variant?: 'primary' | 'secondary';
}) {
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function send() {
    setBusy(true);
    try {
      const { data } = await http.post<GuestRequestResult>(`/public/session/${token}/requests`, { type });
      invalidate('guest:session');
      // Billing the table is the whole point of the tap, so go straight to the total.
      if (data.bill) navigate(`/bill/${data.bill.publicToken}`);
      else toast(data.type === 'BILL' || data.type === 'CASH_PAYMENT' ? 'The counter has been told' : 'Your waiter has been notified', 'success');
    } catch (e) {
      toast(errMsg(e, 'Could not send that'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant={variant} loading={busy} onClick={send} className="h-auto justify-start gap-2 py-3 text-[13px]">
      <span className="text-[15px] leading-none">{emoji}</span> {label}
    </Button>
  );
}
