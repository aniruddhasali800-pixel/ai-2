import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Banknote, CheckCircle2, ChevronRight, Clock, CreditCard, Receipt, Truck, Utensils } from 'lucide-react';
import { invalidate, useQuery } from '../../lib/query';
import { http, errMsg, mediaUrl } from '../../lib/api';
import { joinOrder, leaveOrder, useRealtimePrefix } from '../../lib/socket';
import type { AppTicket } from '../../lib/types';
import { ORDER_STATUS_META, FULFILMENT_LABEL, stageShortLabel, ticketStageCopy } from '../../lib/statusMaps';
import { clockTime, inr, timeAgo } from '../../lib/format';
import { DishThumb, MerchantMark, Spinner, VegDot } from '../../components/ui';
import { rememberTracked } from '../../lib/tracked';
import { toast } from '../../store/toasts';
import { useTitle } from '../../hooks/useTitle';

const STAGES = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED'] as const;

export function AppTrack() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { data: ticket, loading, error } = useQuery<AppTicket>(`app:ticket:${token}`, `/public/apps/orders/${token}`);
  const [busy, setBusy] = useState(false);

  useTitle(ticket ? `Order ${ticket.orderNumber}` : 'Track your order');

  useEffect(() => {
    if (!token) return;
    joinOrder(token);
    return () => leaveOrder(token);
  }, [token]);

  // The kitchen, the counter and the gateway all live on different screens — this
  // page is a window onto them, not a record to refresh by hand.
  useRealtimePrefix(['order.', 'bill.', 'payment.'], () => invalidate(`app:ticket:${token}`));

  // The landing page lists these tickets without asking the network again, so every
  // stage change has to land in storage while this page is merely open.
  useEffect(() => {
    if (!ticket) return;
    rememberTracked({
      token,
      orderNumber: ticket.orderNumber,
      status: ticket.status,
      fulfilment: ticket.fulfilment,
      at: ticket.placedAt,
    });
  }, [token, ticket?.orderNumber, ticket?.status, ticket?.fulfilment]);

  if (loading && !ticket) return <Spinner label="Finding your order…" />;
  if (error || !ticket) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 text-center">
        <Clock size={26} className="mx-auto mb-3 text-ink-300" />
        <p className="font-display text-lg font-700 text-ink-900">That link has gone quiet</p>
        <p className="mt-1.5 text-sm text-ink-500">{error ?? 'The order may have been closed out.'}</p>
        <Link to="/eat" className="mt-4 inline-flex items-center gap-1 text-[13px] font-semibold text-ember-600">
          Order something else <ChevronRight size={14} />
        </Link>
      </div>
    );
  }

  const meta = ORDER_STATUS_META[ticket.status];
  const chip = stageShortLabel(ticket.status, ticket.fulfilment);
  const done = ticket.status === 'COMPLETED' || ticket.status === 'CANCELLED';
  const unpaid = ticket.paymentStatus === 'UNPAID' && ticket.status !== 'CANCELLED';
  const onDelivery = ticket.paymentMode === 'CASH_ON_DELIVERY';
  const due = ticket.bill?.grandTotal ?? ticket.grandTotal;

  async function payByCard(method: 'UPI' | 'CARD') {
    setBusy(true);
    try {
      await http.post(`/public/apps/orders/${token}/checkout`, { method });
      navigate(`/pay/mock?t=${token}`);
    } catch (e) {
      toast(errMsg(e, 'Could not open the checkout'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink-50 pb-10">
      <header className="bg-ink-900 px-4 pb-14 pt-4 text-white">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <MerchantMark name="Sizzle" logoSrc="/icons/favicon.svg" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate font-display text-[15px] font-800">{ticket.restaurant?.name ?? 'Sizzle'}</p>
            <p className="truncate text-[11.5px] text-ink-400">
              {ticket.orderNumber} · {FULFILMENT_LABEL[ticket.fulfilment]} · placed {timeAgo(ticket.placedAt)}
            </p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11.5px] font-bold ring-1 ${meta.cls}`}>{chip}</span>
        </div>
      </header>

      <main className="mx-auto -mt-10 max-w-md space-y-3 px-4">
        <section className="card p-4">
          <p className="font-display text-[19px] font-800 leading-tight text-ink-900">{ticketStageCopy(ticket.status, ticket.fulfilment)}</p>
          <p className="mt-1 text-[12.5px] text-ink-500">
            {ticket.status === 'CANCELLED'
              ? 'This ticket was cancelled — talk to the counter if that surprises you.'
              : done
                ? onDelivery
                  ? 'Cash was collected on the way. Thanks for ordering in.'
                  : 'All settled. Thanks for ordering in.'
                : 'This page updates by itself — keep it open.'}
          </p>
          <ol className="mt-3.5 flex items-center gap-1">
            {STAGES.map((s, i) => {
              const at = STAGES.indexOf(ticket.status as (typeof STAGES)[number]);
              const passed = ticket.status !== 'CANCELLED' && at >= i;
              return (
                <li key={s} className="flex-1">
                  <span className={`block h-1.5 rounded-full ${passed ? 'bg-ember-500' : 'bg-ink-200'}`} />
                  <span className={`mt-1.5 block text-center text-[9.5px] font-bold uppercase tracking-wide ${passed ? 'text-ink-700' : 'text-ink-400'}`}>
                    {s === 'PLACED' ? 'Sent' : s === 'ACCEPTED' ? 'In' : s === 'PREPARING' ? 'Cook' : s === 'READY' ? 'Ready' : s === 'SERVED' ? 'Out' : 'Done'}
                  </span>
                </li>
              );
            })}
          </ol>
        </section>

        {ticket.fulfilment === 'DELIVERY' && (
          <section className="card flex items-start gap-3 p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-900 text-ember-400">
              <Truck size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold text-ink-900">{ticket.riderName ? `${ticket.riderName} is on the way` : 'Waiting for a rider'}</p>
              <p className="mt-0.5 text-[12px] leading-snug text-ink-500">
                {[ticket.customerAddress, ticket.customerCity].filter(Boolean).join(', ') || 'Your address'}
              </p>
            </div>
          </section>
        )}

        {ticket.fulfilment === 'PICKUP' && (
          <section className="card flex items-start gap-3 p-4">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-900 text-ember-400">
              <Utensils size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13.5px] font-semibold text-ink-900">Collect at the counter</p>
              <p className="mt-0.5 text-[12px] text-ink-500">Show the kitchen this ticket number when it lands.</p>
            </div>
          </section>
        )}

        <section className="card divide-y divide-ink-100">
          {ticket.items.map((it, i) => (
            <div key={i} className="flex items-start gap-2.5 px-3.5 py-2.5">
              <DishThumb name={it.name} src={it.imageUrl ? mediaUrl(it.imageUrl) : undefined} isVeg={it.isVeg ?? true} size={46} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-[13.5px] font-semibold text-ink-900">
                  <VegDot isVeg={it.isVeg ?? true} /> {it.qty} × {it.name}
                </p>
                {!!it.addons?.length && <p className="text-[11.5px] text-ink-500">+ {it.addons.map((a) => a.name).join(', ')}</p>}
                {it.notes && <p className="text-[11.5px] text-amber-700">{it.notes}</p>}
              </div>
              <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink-700">{inr(it.lineTotal)}</span>
            </div>
          ))}
          <div className="space-y-1 px-3.5 py-3 text-[12.5px]">
            <Row label="Food" value={inr(ticket.subtotal)} />
            {!!ticket.serviceCharge && <Row label="Service charge" value={inr(ticket.serviceCharge)} />}
            <Row label="GST" value={inr(ticket.taxTotal)} />
            <div className="mt-1.5 flex items-baseline justify-between border-t border-ink-100 pt-1.5">
              <span className="font-display text-[14px] font-800 text-ink-900">Total</span>
              <span className="font-display text-[17px] font-800 tabular-nums text-ink-900">{inr(ticket.grandTotal)}</span>
            </div>
          </div>
        </section>

        {unpaid ? (
          <section className="card p-4">
            <h2 className="font-display text-[16px] font-800 text-ink-900">Payment</h2>
            {onDelivery ? (
              <p className="mt-1 flex items-start gap-2 text-[12.5px] leading-snug text-ink-600">
                <Banknote size={15} className="mt-0.5 shrink-0 text-amber-600" />
                Keep {inr(due)} ready — the rider takes cash at the door.
              </p>
            ) : ticket.bill ? (
              <>
                <p className="mt-1 text-[12.5px] text-ink-500">
                  {ticket.bill.billNumber} is issued and waiting. Nothing is charged until you say so.
                </p>
                <div className="mt-3 space-y-2">
                  <Link
                    to={`/bill/${ticket.bill.publicToken}`}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-ember-600/40 bg-ember-500 text-[14.5px] font-bold text-white transition-[background,transform] hover:bg-ember-600 active:scale-[0.99]"
                  >
                    <Receipt size={16} /> Pay {inr(due)} by UPI
                  </Link>
                  {ticket.paymentMode === 'CARD' && (
                    <button
                      onClick={() => void payByCard('CARD')}
                      disabled={busy}
                      className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-ink-300 bg-white text-[14px] font-bold text-ink-800 transition-colors hover:bg-ink-50 disabled:opacity-60"
                    >
                      <CreditCard size={16} />
                      {busy ? 'Opening the checkout…' : 'Pay by card'}
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="mt-1 text-[12.5px] leading-snug text-ink-500">
                {inr(due)} on the way. The counter raises the bill as your bag is packed, and the pay button appears here by itself.
              </p>
            )}
          </section>
        ) : (
          ticket.paymentStatus === 'PAID' && (
            <section className="card flex items-center gap-2.5 bg-leaf-50 p-4 text-leaf-800 ring-1 ring-leaf-500/30">
              <CheckCircle2 size={19} className="shrink-0" />
              <div className="leading-tight">
                <p className="text-[13.5px] font-bold">Paid — thank you</p>
                <p className="text-[12px] text-leaf-700">{ticket.completedAt ? clockTime(ticket.completedAt) : ''}</p>
              </div>
            </section>
          )
        )}

        <section className="card p-4">
          <h2 className="label">The kitchen so far</h2>
          <ol className="space-y-2 border-l-2 border-ink-200 pl-4">
            {ticket.statusHistory.map((h, i) => (
              <li key={i} className="relative text-[13px]">
                <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-ink-300" />
                <span className="font-semibold text-ink-800">{stageShortLabel(h.status, ticket.fulfilment)}</span>
                <span className="ml-2 text-ink-500">{clockTime(h.at)}</span>
              </li>
            ))}
          </ol>
        </section>

        <Link to="/eat" className="flex items-center justify-center gap-1 pt-1 text-[13px] font-semibold text-ink-500 hover:text-ember-600">
          Order again from this kitchen <ChevronRight size={14} />
        </Link>
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-ink-500">{label}</span>
      <span className="font-medium tabular-nums text-ink-800">{value}</span>
    </div>
  );
}
