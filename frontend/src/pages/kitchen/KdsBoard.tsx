import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Flame, Microwave, PauseCircle, PlayCircle, Inbox, ScanLine } from 'lucide-react';
import { useQuery, patch } from '../../lib/query';
import { http } from '../../lib/api';
import type { Order, OrderStatus, Paginated, Station } from '../../lib/types';
import { SOURCE_META, stationLabel } from '../../lib/statusMaps';
import { minutesSince } from '../../lib/format';
import { Button, SegmentedControl } from '../../components/ui';
import { toast } from '../../store/toasts';

const BOARD_COLUMNS: { key: OrderStatus; label: string; accent: string; next?: OrderStatus; nextLabel?: string }[] = [
  { key: 'PLACED', label: 'New', accent: 'border-t-ember-500', next: 'ACCEPTED', nextLabel: 'Start' },
  { key: 'ACCEPTED', label: 'Queued', accent: 'border-t-amber-500', next: 'PREPARING', nextLabel: 'Fire' },
  { key: 'PREPARING', label: 'On the fire', accent: 'border-t-blue-500', next: 'READY', nextLabel: 'Ready' },
  // No action here: the pass ends at READY. A waiter or the till carries the ticket off the board,
  // so a "hand off" button on the cook's screen could only ever be refused by the server.
  { key: 'READY', label: 'Ready to pass', accent: 'border-t-leaf-500' },
];

const STATIONS: (Station | 'ALL')[] = ['ALL', 'MAIN', 'GRILL', 'TANDOOR', 'FRY', 'BAR', 'DESSERT'];

export function KdsBoard() {
  const [params, setParams] = useSearchParams();
  // A scanned sticker or ticket arrives with the table or ticket named, so the cook is
  // not left hunting for it down a long pass.
  const focusTable = params.get('table') ?? '';
  const focusOrder = params.get('order') ?? '';
  const [station, setStation] = useState<Station | 'ALL'>('ALL');
  const { data } = useQuery<{ data: Order[] }>('kds:orders', '/kitchen/orders');

  const orders = useMemo(() => {
    const all = data?.data ?? [];
    const byStation = station === 'ALL' ? all : all.filter((o) => o.items.some((i) => i.station === station));
    if (focusOrder) return byStation.filter((o) => o._id === focusOrder || o.orderNumber.toLowerCase() === focusOrder.toLowerCase());
    if (focusTable) return byStation.filter((o) => (o.tableNumber ?? '') === focusTable);
    return byStation;
  }, [data, station, focusOrder, focusTable]);

  const scannedTo = focusOrder || focusTable;
  const clearFocus = () => {
    const next = new URLSearchParams(params);
    next.delete('table');
    next.delete('order');
    setParams(next, { replace: true });
  };

  const move = async (order: Order, next: OrderStatus) => {
    // optimistic: drop from current column, appear in next instantly
    patch<{ data: Order[] }>('kds:orders', (cur) =>
      cur ? { data: cur.data.map((o) => (o._id === order._id ? { ...o, status: next } : o)) } : cur,
    );
    try {
      await http.patch(`/kitchen/orders/${order._id}/status`, { status: next });
      toast(`${order.orderNumber} → ${next.toLowerCase()}`, 'success');
    } catch {
      patch<{ data: Order[] }>('kds:orders', (cur) =>
        cur ? { data: cur.data.map((o) => (o._id === order._id ? { ...o, status: order.status } : o)) } : cur,
      );
      toast('Could not update the ticket', 'error');
    }
  };

  const totals = {
    tickets: orders.length,
    covers: orders.reduce((s, o) => s + o.items.reduce((n, i) => n + i.qty, 0), 0),
  };

  return (
    <div>
      {scannedTo && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-ember-500/40 bg-ember-500/10 px-3.5 py-2.5">
          <ScanLine size={15} className="text-ember-300" />
          <p className="min-w-0 flex-1 text-[12.5px] font-semibold text-ink-100">
            {focusTable ? `Showing Table ${focusTable}` : `Showing ticket ${focusOrder}`} — straight from your scan
          </p>
          <button
            onClick={clearFocus}
            className="rounded-lg border border-white/20 px-2.5 py-1 text-[12px] font-semibold text-ink-200 hover:bg-white/10"
          >
            Show the whole board
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl
          size="sm"
          value={station}
          onChange={setStation}
          options={STATIONS.map((s) => ({ value: s, label: s === 'ALL' ? 'All stations' : stationLabel(s) }))}
        />
        <div className="flex items-center gap-4 text-[12px] text-ink-400">
          <span className="inline-flex items-center gap-1.5"><Inbox size={14} /> {totals.tickets} live tickets</span>
          <span className="inline-flex items-center gap-1.5"><Flame size={14} /> {totals.covers} items firing</span>
        </div>
      </div>

      {!data && <div className="grid place-items-center py-20 text-ink-500">Warming the pass…</div>}
      {data && orders.length === 0 && (
        <div className="grid place-items-center rounded-2xl border border-dashed border-white/15 py-20 text-center">
          <CheckCircle2 size={34} className="mb-2 text-leaf-500" />
          <p className="font-display text-lg font-700 text-ink-200">{scannedTo ? 'That ticket is off the pass' : 'Board is clear'}</p>
          <p className="max-w-md text-[13px] leading-relaxed text-ink-500">
            {scannedTo
              ? 'It has already been cooked and handed off, or it belongs to another station. The full board is one tap away.'
              : 'New tickets land here the moment a guest or waiter sends them.'}
          </p>
          {scannedTo && (
            <Button variant="secondary" className="mt-3" onClick={clearFocus}>
              Show the whole board
            </Button>
          )}
        </div>
      )}

      {(!scannedTo || orders.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-4">
          {BOARD_COLUMNS.map((col) => {
            const list = orders
              .filter((o) => o.status === col.key)
              .sort((a, b) => new Date(a.placedAt).getTime() - new Date(b.placedAt).getTime());
            return (
              <section key={col.key} className={`rounded-2xl border border-white/10 border-t-4 bg-white/[0.03] ${col.accent}`}>
                <header className="flex items-center justify-between px-3.5 py-3">
                  <h2 className="font-display text-[14px] font-700 uppercase tracking-wide text-ink-200">{col.label}</h2>
                  <span className="grid h-6 min-w-6 place-items-center rounded-full bg-white/10 px-1.5 text-[12px] font-bold text-white">{list.length}</span>
                </header>
                <div className="space-y-3 px-3 pb-3 lg:max-h-[calc(100vh-15rem)] lg:overflow-y-auto">
                  {list.map((o) => (
                    <Ticket key={o._id} order={o} next={col.next} nextLabel={col.nextLabel} onAdvance={move} activeStation={station} />
                  ))}
                  {!list.length && <p className="px-1 py-6 text-center text-[12px] text-ink-600">Nothing here</p>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Ticket({
  order,
  next,
  nextLabel,
  onAdvance,
  activeStation,
}: {
  order: Order;
  next?: OrderStatus;
  nextLabel?: string;
  onAdvance: (order: Order, next: OrderStatus) => void;
  activeStation: Station | 'ALL';
}) {
  const mins = minutesSince(order.placedAt);
  const late = mins >= 20;
  const dropoff = [order.customerAddress, order.customerCity].filter(Boolean).join(', ');
  const veg = order.items.filter((it) => it.isVeg ?? true);
  const nonVeg = order.items.filter((it) => !(it.isVeg ?? true));
  return (
    <article className={`animate-in overflow-hidden rounded-xl border bg-ink-900 shadow-lg ${late ? 'border-red-500/50' : 'border-white/10'}`}>
      <header className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        {order.tableNumber ? (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ember-500 font-display text-[14px] font-800 leading-none text-white">
            {order.tableNumber}
          </span>
        ) : null}
        <span className="font-display text-[15px] font-800 text-white">{order.orderNumber}</span>
        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-ink-300">
          {SOURCE_META[order.source]?.label}
        </span>
        <span className={`ml-auto inline-flex items-center gap-1 text-[12px] font-semibold tabular-nums ${late ? 'text-red-400' : 'text-ink-400'}`}>
          {late && <Flame size={12} className="pulse" />}
          {mins}m
        </span>
      </header>
      {!!dropoff && (
        <div className="border-b border-white/10 bg-ember-500/10 px-3 py-1.5 text-[11.5px] leading-snug">
          <p className="font-semibold text-ember-200">{dropoff}</p>
          {order.customerPhone && <p className="text-ink-400">{order.customerName || 'Guest'} · {order.customerPhone}</p>}
        </div>
      )}
      {/* A ticket never mixes veg onto a non-veg plate, so the pass reads the two sides apart. */}
      <div className="grid gap-x-3 xl:grid-cols-2">
        <TicketSide order={order} items={veg} tone="leaf" activeStation={activeStation} />
        <TicketSide order={order} items={nonVeg} tone="rose" activeStation={activeStation} />
      </div>
      {next && (
        <button
          onClick={() => onAdvance(order, next)}
          className="flex w-full items-center justify-center gap-1.5 bg-ember-500 py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-ember-600 active:bg-ember-700"
        >
          {nextLabel === 'Ready' ? <PlayCircle size={15} /> : <Microwave size={15} />} {nextLabel}
        </button>
      )}
      {order.status === 'READY' && (
        <div className="flex items-center justify-center gap-1.5 bg-leaf-600 py-2 text-[12px] font-bold text-white">
          <PauseCircle size={14} /> Waiting for pickup
        </div>
      )}
    </article>
  );
}

function TicketSide({
  order,
  items,
  tone,
  activeStation,
}: {
  order: Order;
  items: Order['items'];
  tone: 'leaf' | 'rose';
  activeStation: Station | 'ALL';
}) {
  if (!items.length) return null;
  return (
    <div className="border-b border-white/5 last:border-b-0 xl:border-b-0">
      <p
        className={`m-2 flex items-center gap-1.5 rounded px-2 py-1 text-[10.5px] font-800 uppercase tracking-[0.12em] ${
          tone === 'leaf' ? 'bg-leaf-500/15 text-leaf-300' : 'bg-rose-500/15 text-rose-300'
        }`}
      >
        <span className={`h-2.5 w-2.5 rounded-[3px] border ${tone === 'leaf' ? 'border-leaf-500 bg-leaf-500' : 'border-rose-500 bg-rose-500'}`} />
        {tone === 'leaf' ? 'Veg' : 'Non-veg'} · {items.reduce((n, i) => n + i.qty, 0)}
      </p>
      <ul className="divide-y divide-white/5">
        {items.map((it, idx) => (
          <li
            key={`${order._id}-${idx}`}
            className={`flex items-start gap-2 px-3 py-2 ${activeStation !== 'ALL' && it.station === activeStation ? 'bg-ember-500/10' : ''}`}
          >
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded bg-ember-500 text-[11px] font-bold text-white">{it.qty}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold leading-tight text-ink-100">{it.name}</span>
              {it.addons?.length > 0 && <span className="block text-[11.5px] text-ink-400">+ {it.addons.map((a) => a.name).join(', ')}</span>}
              {it.notes && <span className="mt-0.5 block rounded bg-amber-500/15 px-1.5 py-0.5 text-[11.5px] font-medium text-amber-300">{it.notes}</span>}
              {it.station !== 'MAIN' && <span className="mt-0.5 block text-[10.5px] uppercase tracking-wide text-ink-500">{stationLabel(it.station)}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
