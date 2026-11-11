import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Banknote, CheckCheck, CircleUser, Hand, Inbox, PlusCircle, ScrollText, Share2, Timer, Users } from 'lucide-react';
import { invalidate, useQuery } from '../../lib/query';
import { http, errMsg } from '../../lib/api';
import type { CustomerRequest, WaiterTable } from '../../lib/types';
import { REQUEST_LABEL, TABLE_STATUS_META } from '../../lib/statusMaps';
import { inr, minutesSince, timeAgo } from '../../lib/format';
import { Button, Card, EmptyState, LinkButton, Pill, Spinner, StatTile } from '../../components/ui';
import { toast } from '../../store/toasts';
import { useAuth } from '../../store/auth';
import { BillAction, ClearAction, TableTicket } from './TableTicket';

interface Shift {
  tablesAssigned: number;
  ordersToday: number;
  salesToday: number;
  awaitingPickup: number;
  openRequests: number;
  shiftStartedAt: string;
  bookings: number;
}

export function WaiterFloor() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { data: shift } = useQuery<Shift>('waiter:summary', '/waiters/me/summary');
  const { data: floor, loading } = useQuery<{ data: WaiterTable[] }>('floor:map', '/waiters/map');
  const { data: calls } = useQuery<{ data: CustomerRequest[] }>('requests:list', '/waiters/requests');
  const [ticketId, setTicketId] = useState<string | null>(null);

  const tables = floor?.data ?? [];
  // The floor is open: every waiter works every table, so the home screen lists every seated
  // party and names who opened it — a punch on a colleague's table is still your work.
  const seated = tables.filter((t) => t.session);
  const openCalls = (calls?.data ?? []).filter((r) => r.status !== 'DONE');
  const myCalls = openCalls.filter((r) => r.mine);
  // The drawer reads its table from the live floor list, so a bill the counter just accepted
  // appears inside it without the waiter closing and reopening.
  const ticket = ticketId ? tables.find((t) => t._id === ticketId) ?? null : null;

  async function claim(t: WaiterTable) {
    try {
      await http.post(`/waiters/tables/${t._id}/claim`);
      invalidate('floor');
      invalidate('tables');
      toast(`Table ${t.number} is yours`, 'success');
    } catch (e) {
      invalidate('floor');
      toast(errMsg(e, 'Could not take that table'), 'error');
    }
  }

  if (loading && !floor) return <Spinner label="Loading your floor…" />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <StatTile label="Seated now" value={String(seated.length)} hint={`${shift?.tablesAssigned ?? 0} with your name`} />
        <StatTile label="Orders today" value={String(shift?.ordersToday ?? 0)} />
        <StatTile label="Sales today" value={inr(shift?.salesToday ?? 0)} tone="leaf" />
        <StatTile label="Ready to pick" value={String(shift?.awaitingPickup ?? 0)} tone="ember" hint="from the pass" />
      </div>

      <Card
        title={`Good service, ${user?.name.split(' ')[0]}`}
        subtitle={shift ? `Shift started ${timeAgo(shift.shiftStartedAt)} · ${shift.bookings} of your tables have bookings` : undefined}
        action={<Button size="sm" variant="primary" icon={<PlusCircle size={14} />} onClick={() => navigate('/floor/order')}>New order</Button>}
      >
        {seated.length ? (
          <ul className="divide-y divide-ink-100">
            {seated.map((t) => (
              <li key={t._id} className="px-3.5 py-3">
                <div className="flex items-center gap-3">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl font-display text-[13px] font-800 ${TABLE_STATUS_META[t.status].card} ${TABLE_STATUS_META[t.status].text}`}>
                    {t.number}
                  </span>
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="truncate text-[13.5px] font-semibold text-ink-900">
                      {t.session?.customerName || `Guest party`} · {t.session?.guestCount} pax
                      {!t.mine && (t.assignedWaiterName ? (
                        <span className="ml-1 text-[11.5px] font-semibold uppercase text-ink-500">with {t.assignedWaiterName}</span>
                      ) : (
                        <span className="ml-1 text-[11.5px] font-semibold uppercase text-ember-600">unclaimed</span>
                      ))}
                    </p>
                    <p className="truncate text-[12px] text-ink-500">
                      {t.activeOrders.length} order{t.activeOrders.length === 1 ? '' : 's'} · {inr(t.runningTotal)} on the tab
                      {t.session ? ` · opened ${timeAgo(t.session.openedAt)}` : ''}
                    </p>
                  </div>
                  {!!t.openRequests.length && (
                    <Pill className="bg-amber-50 text-amber-800 ring-amber-200">{t.openRequests.length} call</Pill>
                  )}
                  <span className="hidden shrink-0 font-display text-[14px] font-800 tabular-nums text-ink-900 sm:block">{inr(t.runningTotal)}</span>
                  <button onClick={() => navigate('/floor/map')} className="text-ink-300 hover:text-ink-700" aria-label="Open floor">
                    <ArrowRight size={16} />
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {!t.assignedWaiterId && (
                    <Button size="sm" variant="primary" icon={<Hand size={13} />} onClick={() => void claim(t)}>Take this table</Button>
                  )}
                  {!!t.activeOrders.length && (
                    <Button size="sm" variant="secondary" icon={<ScrollText size={13} />} onClick={() => setTicketId(t._id)}>Tickets</Button>
                  )}
                  <BillAction table={t} />
                  <ClearAction table={t} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon={<CircleUser size={26} />}
            title="Nobody is seated yet"
            body="Seat a party from the floor plan, or take a guest-seated table, and the tab shows up here."
            action={<Button size="sm" variant="secondary" icon={<Users size={14} />} onClick={() => navigate('/floor/map')}>Open floor plan</Button>}
          />
        )}
      </Card>

      <Card title="Guest calls" subtitle={myCalls.length ? `${myCalls.length} waiting on you · ${openCalls.length - myCalls.length} elsewhere` : 'Nothing pending'}>
        {openCalls.length ? (
          <ul className="divide-y divide-ink-100">
            {openCalls.slice(0, 12).map((r) => (
              <CallRow key={r._id} r={r} />
            ))}
          </ul>
        ) : (
          <EmptyState icon={<Inbox size={24} />} title="All quiet" body="No open requests from guests." />
        )}
      </Card>
      {ticket && <TableTicket table={ticket} onClose={() => setTicketId(null)} />}
    </div>
  );
}

function CallRow({ r }: { r: CustomerRequest }) {
  const waited = minutesSince(r.createdAt);
  const cash = r.type === 'CASH_PAYMENT';
  // A bill call is answered by cutting the bill and a clear by confirming the money — the till or
  // the office does both, so a waiter closing one would empty the queue with nothing collected.
  // Every other call is service, and on an open floor any waiter can answer it.
  const serviceCall = !cash && r.type !== 'BILL' && r.type !== 'TABLE_CLEAR';

  async function move(status: 'ACKNOWLEDGED' | 'DONE') {
    try {
      await http.patch(`/waiters/requests/${r._id}`, { status });
      invalidate('requests');
      invalidate('floor:map');
      if (status === 'DONE') toast('Request closed', 'success');
    } catch (e) {
      invalidate('requests');
      toast(errMsg(e, 'Could not update that request'), 'error');
    }
  }

  return (
    <li className="px-3.5 py-3">
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-[16px]">
          {REQUEST_LABEL[r.type]?.emoji ?? '✋'}
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13.5px] font-semibold text-ink-900">
            Table {r.tableNumber || '—'} · {REQUEST_LABEL[r.type]?.label ?? r.type}
            {cash && r.billGrandTotal ? ` · ${inr(r.billGrandTotal)}` : ''}
          </p>
          <p className={`truncate text-[12px] ${waited > 8 ? 'font-semibold text-red-600' : 'text-ink-500'}`}>
            {r.collectedAt
              ? 'cash taken · waiting on the counter'
              : r.note
                ? `${r.note} · `
                : ''}
            {!r.collectedAt && (
              <span className="inline-flex items-center gap-1"><Timer size={11} /> {waited}m ago</span>
            )}
          </p>
        </div>
        {cash ? (
          r.collectedAt ? (
            <Pill className="bg-leaf-50 text-leaf-800 ring-leaf-200">At the counter</Pill>
          ) : r.billGrandTotal ? (
            <CashCollect r={r} />
          ) : (
            <Pill className="bg-amber-50 text-amber-800 ring-amber-200">No bill yet</Pill>
          )
        ) : r.type === 'BILL' ? (
          r.billPublicToken ? (
            <LinkButton to={`/bill/${r.billPublicToken}`} size="sm" variant="primary" icon={<Share2 size={13} />}>
              Show QR{r.billGrandTotal ? ` · ${inr(r.billGrandTotal)}` : ''}
            </LinkButton>
          ) : (
            <Pill className="bg-blue-50 text-blue-800 ring-blue-200">
              {r.status === 'ACKNOWLEDGED' ? (r.handledByUserId ? 'Counter is on it' : 'Office is on it') : 'With the counter'}
            </Pill>
          )
        ) : r.type === 'TABLE_CLEAR' ? (
          <Pill className="bg-blue-50 text-blue-800 ring-blue-200">
            {r.status === 'ACKNOWLEDGED' ? 'Counter confirming' : 'With the counter'}
          </Pill>
        ) : (
          serviceCall && (
            <>
              {r.status === 'OPEN' && (
                <Button size="sm" variant="secondary" onClick={() => void move('ACKNOWLEDGED')}>I'm on it</Button>
              )}
              <Button size="sm" variant="success" icon={<CheckCheck size={14} />} onClick={() => void move('DONE')}>Done</Button>
            </>
          )
        )}
      </div>
    </li>
  );
}

/** The waiter only records the notes; the drawer is closed by the counter. */
function CashCollect({ r }: { r: CustomerRequest }) {
  const total = r.billGrandTotal ?? 0;
  const [open, setOpen] = useState(false);
  const [tendered, setTendered] = useState('');
  const [busy, setBusy] = useState(false);
  const amount = Number(tendered || total);
  const short = amount < total;

  async function take() {
    setBusy(true);
    try {
      await http.post(`/waiters/requests/${r._id}/collect`, { tendered: amount });
      invalidate('requests');
      invalidate('floor:map');
      toast(`Collected ${inr(amount)} — carry it to the counter`, 'success');
    } catch (e) {
      toast(errMsg(e, 'Could not record the cash'), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Button size="sm" variant="primary" icon={<Banknote size={14} />} onClick={() => setOpen(true)}>
        Take {inr(total)}
      </Button>
    );
  }

  return (
    <div className="mt-2.5 rounded-xl bg-ink-50 p-2.5 ring-1 ring-ink-200">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          inputMode="decimal"
          value={tendered}
          onChange={(e) => setTendered(e.target.value.replace(/[^\d.]/g, ''))}
          placeholder={String(total.toFixed(2))}
          className="w-28 rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold tabular-nums outline-none focus:border-ember-400"
        />
        <span className="text-[12px] text-ink-500">{amount >= total ? `change ${inr(amount - total)}` : 'not enough'}</span>
        <Button size="sm" variant="primary" loading={busy} disabled={short} onClick={() => void take()} className="ml-auto">
          Take it
        </Button>
        <button onClick={() => setOpen(false)} className="text-[12px] font-semibold text-ink-400 hover:text-ink-700">
          Cancel
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {[total, Math.ceil(total / 100) * 100, Math.ceil(total / 500) * 500, Math.ceil(total / 1000) * 1000]
          .filter((v, i, arr) => i === 0 || v !== arr[i - 1])
          .map((v) => (
            <button
              key={v}
              onClick={() => setTendered(String(v))}
              className="rounded-lg bg-white px-2 py-1 text-[11.5px] font-semibold tabular-nums text-ink-700 ring-1 ring-ink-200 hover:ring-ember-300"
            >
              {inr(v)}
            </button>
          ))}
      </div>
    </div>
  );
}
