import { useState } from 'react';
import { Banknote, Ban, CheckCheck, Package, Phone, Printer, Receipt, Truck, User } from 'lucide-react';
import { DishThumb, Drawer, Button, Pill, StatusDot, VegDot } from '../../components/ui';
import { useQuery, invalidate } from '../../lib/query';
import { http, errMsg, mediaUrl } from '../../lib/api';
import type { Order } from '../../lib/types';
import {
  ORDER_STATUS_META,
  SOURCE_META,
  NEXT_ORDER_STATUS,
  FULFILMENT_LABEL,
  PAYMENT_MODE_LABEL,
  stationLabel,
} from '../../lib/statusMaps';
import { inr2, inr, clockTime, dateTime } from '../../lib/format';
import { toast } from '../../store/toasts';

/** Reads a ticket and exposes the mutations the staff buttons fire. */
export function useOrderTicket(orderId: string) {
  const { data: order, loading } = useQuery<Order>(`orders:detail:${orderId}`, `/orders/${orderId}`);
  const [busy, setBusy] = useState<string | null>(null);

  async function setStatus(next: Order['status'], reason?: string) {
    if (!order) return;
    setBusy(next);
    try {
      await http.patch(`/orders/${order._id}/status`, { status: next, reason });
      invalidate('orders');
      toast(`${order.orderNumber} → ${ORDER_STATUS_META[next].label}`, 'success');
    } catch (e) {
      toast(errMsg(e, 'Could not update ticket'), 'error');
    } finally {
      setBusy(null);
    }
  }

  /**
   * The moment a bag leaves the counter the guest's address stops being a promise,
   * so the name of whoever carries it goes on the ticket with the handover.
   */
  async function handOver(next: Order['status'], question = 'Who is taking this bag?') {
    if (!order) return;
    const rider = window.prompt(question, order.riderName || '')?.trim();
    if (!rider) return;
    setBusy(next);
    try {
      await http.patch(`/orders/${order._id}/status`, { status: next, riderName: rider });
      invalidate('orders');
      toast(`${order.orderNumber} handed to ${rider}`, 'success');
    } catch (e) {
      toast(errMsg(e, 'Could not update ticket'), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function issueBill() {
    if (!order) return;
    setBusy('BILL');
    try {
      const { data } = await http.post<{ bill: { _id: string; billNumber: string } }>('/billing', { orderId: order._id });
      invalidate('bills');
      invalidate('orders');
      toast(`Bill ${data.bill.billNumber} issued`, 'success');
    } catch (e) {
      toast(errMsg(e, 'Could not issue bill'), 'error');
    } finally {
      setBusy(null);
    }
  }

  return { order, loading, busy, setStatus, handOver, issueBill };
}

export type OrderTicket = ReturnType<typeof useOrderTicket>;

export function TicketHeading({ order }: { order: Order }) {
  const meta = ORDER_STATUS_META[order.status];
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 font-display text-2xl font-800 text-ink-900">
        {order.orderNumber}
        <Pill className={meta.cls}>
          <StatusDot className={meta.dot} />
          {meta.label}
        </Pill>
      </h2>
      <p className="flex items-center gap-2 text-[12.5px] text-ink-500">
        <span className="rounded bg-ink-100 px-1.5 py-0.5 font-bold uppercase text-ink-600">{SOURCE_META[order.source]?.label}</span>
        <span>{dateTime(order.placedAt)}</span>
        {order.customerName && <span>· {order.customerName}</span>}
      </p>
    </div>
  );
}

export function TicketSections({ order }: { order: Order }) {
  const deliverTo = [order.customerAddress, order.customerCity].filter(Boolean).join(', ');
  const channel = order.fulfilment && order.fulfilment !== 'DINE_IN' ? FULFILMENT_LABEL[order.fulfilment] : '';
  const howPaying = order.paymentMode ? PAYMENT_MODE_LABEL[order.paymentMode] : '';

  return (
    <div className="space-y-5">
      {(channel || howPaying) && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          {channel && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-ink-900 px-2.5 py-1 font-semibold text-white">
              {order.fulfilment === 'DELIVERY' ? <Truck size={12} /> : <Package size={12} />} {channel}
            </span>
          )}
          {howPaying && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-semibold ring-1 ${
                order.paymentMode === 'CASH_ON_DELIVERY' ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-leaf-50 text-leaf-700 ring-leaf-500/30'
              }`}
            >
              <Banknote size={12} /> {howPaying}
            </span>
          )}
          {order.riderName && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-2.5 py-1 font-semibold text-blue-800 ring-1 ring-blue-200">
              <User size={12} /> {order.riderName}
            </span>
          )}
        </div>
      )}

      <div className="card divide-y divide-ink-100">
        {order.items.map((it, i) => (
          <div key={i} className="flex items-start gap-3 px-3.5 py-2.5">
            <DishThumb name={it.name} src={it.imageUrl ? mediaUrl(it.imageUrl) : undefined} isVeg={it.isVeg ?? true} size={46} />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <VegDot isVeg={it.isVeg ?? true} />
                <span className="text-[14px] font-semibold text-ink-900">{it.qty} × {it.name}</span>
              </span>
              <span className="text-[11.5px] text-ink-500">{stationLabel(it.station)} · {inr(it.price)} ea</span>
              {it.addons?.length > 0 && <span className="block text-[12px] text-ink-500">+ {it.addons.map((a) => `${a.name} ${inr(a.price)}`).join(', ')}</span>}
              {it.notes && <span className="mt-1 block rounded bg-amber-50 px-2 py-1 text-[12px] text-amber-800 ring-1 ring-amber-200">{it.notes}</span>}
            </span>
            <span className="shrink-0 font-display text-[14px] font-700 tabular-nums text-ink-900">{inr2(it.lineTotal)}</span>
          </div>
        ))}
        <div className="space-y-1 px-3.5 py-3 text-[13px]">
          <Line label="Subtotal" value={inr2(order.subtotal)} />
          {order.discountAmount > 0 && <Line label={`Discount${order.discountNote ? ` · ${order.discountNote}` : ''}`} value={`− ${inr2(order.discountAmount)}`} />}
          {order.serviceCharge > 0 && <Line label="Service charge" value={inr2(order.serviceCharge)} />}
          <Line label="GST" value={inr2(order.taxTotal)} />
          {order.roundOff !== 0 && <Line label="Round off" value={inr2(order.roundOff)} />}
          <div className="mt-2 flex items-baseline justify-between border-t border-ink-100 pt-2">
            <span className="font-display text-[15px] font-700 text-ink-900">Total</span>
            <span className="font-display text-lg font-800 tabular-nums text-ink-900">{inr2(order.grandTotal)}</span>
          </div>
        </div>
      </div>

      {order.notes && <p className="rounded-lg bg-ink-100 px-3 py-2 text-[13px] text-ink-600">Note: {order.notes}</p>}

      {(order.customerAddress || order.customerCity || order.customerPhone) && (
        <div className="rounded-xl bg-amber-50 px-3.5 py-3 ring-1 ring-amber-200">
          <p className="label text-amber-700">Deliver to</p>
          <p className="mt-1 text-[13.5px] font-semibold text-amber-900">{order.customerName || 'Guest'}</p>
          {deliverTo && <p className="mt-0.5 text-[13px] leading-snug text-amber-800">{deliverTo}</p>}
          {order.customerPhone && (
            <a
              href={`tel:${order.customerPhone}`}
              className="mt-1.5 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-amber-900 underline decoration-amber-400 underline-offset-2"
            >
              <Phone size={12} /> {order.customerPhone}
            </a>
          )}
        </div>
      )}

      <section>
        <h4 className="label">Timeline</h4>
        <ol className="space-y-2 border-l-2 border-ink-200 pl-4">
          {order.statusHistory.map((h, i) => (
            <li key={i} className="relative text-[13px]">
              <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full bg-ink-300" />
              <span className="font-semibold text-ink-800">{ORDER_STATUS_META[h.status]?.label}</span>
              <span className="ml-2 text-ink-500">{clockTime(h.at)}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

export function TicketActions({ ticket, onBilled }: { ticket: OrderTicket; onBilled?: () => void }) {
  const { order, busy, setStatus, handOver, issueBill } = ticket;
  if (!order) return null;
  const nexts = NEXT_ORDER_STATUS[order.status];
  const leaving = order.fulfilment === 'DELIVERY' || order.fulfilment === 'PICKUP';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {nexts.map((n) => {
        const pass = n === 'SERVED' && leaving;
        return (
          <Button
            key={n}
            variant={n === 'CANCELLED' ? 'danger' : n === 'SERVED' || n === 'COMPLETED' ? 'success' : 'primary'}
            size="sm"
            loading={busy === n}
            icon={n === 'CANCELLED' ? <Ban size={13} /> : pass ? <Truck size={13} /> : <CheckCheck size={13} />}
            onClick={() => {
              if (pass) return void handOver(n, order.fulfilment === 'DELIVERY' ? 'Which rider is taking this bag?' : 'Who collected it?');
              setStatus(n, n === 'CANCELLED' ? window.prompt('Reason for cancelling?') || 'Cancelled by staff' : undefined);
            }}
          >
            {pass ? (order.fulfilment === 'DELIVERY' ? 'Hand to rider' : 'Hand over') : ORDER_STATUS_META[n].label}
          </Button>
        );
      })}
      {order.paymentStatus === 'UNPAID' && order.status !== 'CANCELLED' && (
        <Button variant="secondary" size="sm" icon={<Receipt size={13} />} loading={busy === 'BILL'} onClick={() => void issueBill().then(onBilled)}>
          Issue bill
        </Button>
      )}
      <Button variant="ghost" size="sm" icon={<Printer size={13} />} onClick={() => window.print()}>
        Print
      </Button>
    </div>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between text-ink-600">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

export function OrderDetail({ orderId, onClose, onChanged }: { orderId: string; onClose: () => void; onChanged?: () => void }) {
  const ticket = useOrderTicket(orderId);
  const { order } = ticket;
  const meta = order ? ORDER_STATUS_META[order.status] : null;

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        order && meta ? (
          <span className="flex items-center gap-2">
            {order.orderNumber}
            <Pill className={meta.cls}>
              <StatusDot className={meta.dot} />
              {meta.label}
            </Pill>
          </span>
        ) : (
          'Ticket'
        )
      }
    >
      {!order && <p className="py-8 text-center text-[13px] text-ink-500">Loading ticket…</p>}
      {order && (
        <div className="space-y-5">
          <TicketSections order={order} />
          <div className="sticky bottom-0 -mx-5 border-t border-ink-100 bg-white px-5 py-3">
            <TicketActions ticket={ticket} onBilled={onChanged} />
          </div>
        </div>
      )}
    </Drawer>
  );
}
