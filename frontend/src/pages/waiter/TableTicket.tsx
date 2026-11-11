import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCheck, Receipt, Share2, Truck } from 'lucide-react';
import { invalidate, patch, useQuery } from '../../lib/query';
import { http, errMsg } from '../../lib/api';
import type { Order, WaiterTable } from '../../lib/types';
import { ORDER_STATUS_META, statusLabel } from '../../lib/statusMaps';
import { clockTime, inr } from '../../lib/format';
import { Button, Drawer, Pill, Spinner, StatusDot, VegDot } from '../../components/ui';
import { toast } from '../../store/toasts';
import { useAuth } from '../../store/auth';

/**
 * The bill step of a table. A waiter asks; the counter or the office answers, and the answer is a
 * real bill — so the floor's job after that is to put the QR in front of the guest.
 */
export function BillAction({ table }: { table: WaiterTable }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const billCall = table.openRequests.find((r) => r.type === 'BILL' && r.status !== 'DONE');
  const token = billCall?.billPublicToken ?? null;

  if (token) {
    return (
      <Button
        size="sm"
        variant="primary"
        icon={<Share2 size={13} />}
        onClick={() => navigate(`/bill/${token}`)}
      >
        Show QR
      </Button>
    );
  }

  if (billCall) {
    return (
      <Pill className="shrink-0 bg-blue-50 text-blue-800 ring-blue-200">
        {billCall.status === 'ACKNOWLEDGED' ? 'Counter is on it' : 'Bill asked'}
      </Pill>
    );
  }

  async function ask() {
    setBusy(true);
    try {
      await http.post('/waiters/requests', { tableId: table._id, type: 'BILL' });
      invalidate('requests');
      invalidate('floor');
      toast(`Bill call sent for table ${table.number} — the counter and the office have it`, 'success');
    } catch (e) {
      toast(errMsg(e, 'Could not raise the bill call'), 'error');
      invalidate('floor');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button size="sm" variant="secondary" loading={busy} icon={<Receipt size={13} />} onClick={() => void ask()}>
      Bill
    </Button>
  );
}

/**
 * Turning a table over belongs to the counter: the waiter says it is ready, the till confirms
 * nothing is owed, and only then does the table go free.
 */
export function ClearAction({ table }: { table: WaiterTable }) {
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const isWaiter = user?.role === 'WAITER';
  const clearCall = table.openRequests.find((r) => r.type === 'TABLE_CLEAR' && r.status !== 'DONE');

  async function run() {
    setBusy(true);
    try {
      if (isWaiter) {
        await http.post('/waiters/requests', { tableId: table._id, type: 'TABLE_CLEAR' });
        toast(`Asked the counter to free table ${table.number}`, 'success');
      } else {
        await http.post(`/waiters/tables/${table._id}/clear`);
        toast(`Table ${table.number} cleared and free`, 'success');
      }
      invalidate('requests');
      invalidate('floor');
      invalidate('tables');
    } catch (e) {
      invalidate('floor');
      toast(errMsg(e, isWaiter ? 'Could not raise the clear' : 'Could not clear that table'), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (clearCall) {
    return (
      <Pill className="shrink-0 bg-blue-50 text-blue-800 ring-blue-200">
        {clearCall.status === 'ACKNOWLEDGED' ? 'Counter confirming' : 'Clear asked'}
      </Pill>
    );
  }

  return (
    <Button size="sm" variant="ghost" loading={busy} icon={<Truck size={13} />} onClick={() => void run()}>
      {isWaiter ? 'Ask to free' : 'Clear'}
    </Button>
  );
}

/** Everything the table has eaten, per ticket, with the hand-offs the waiter is allowed to make. */
export function TableTicket({ table, onClose }: { table: WaiterTable; onClose: () => void }) {
  const { user } = useAuth();
  const { data, loading } = useQuery<{ data: Order[] }>(`orders:table:${table._id}`, '/orders', {
    tableId: table._id,
    active: 'true',
    limit: '20',
  });
  const orders = data?.data ?? [];
  const [busy, setBusy] = useState<string | null>(null);

  async function serve(order: Order, next: Order['status']) {
    setBusy(order._id);
    // The ticket moves on the screen before the server agrees, then snaps back if it refuses.
    patch<{ data: Order[] }>(`orders:table:${table._id}`, (cur) =>
      cur ? { ...cur, data: cur.data.map((o) => (o._id === order._id ? { ...o, status: next } : o)) } : cur,
    );
    try {
      await http.patch(`/orders/${order._id}/status`, { status: next });
      invalidate('orders');
      invalidate('floor');
      toast(`${order.orderNumber} → ${statusLabel('order', next)}`, 'success');
    } catch (e) {
      patch<{ data: Order[] }>(`orders:table:${table._id}`, (cur) =>
        cur ? { ...cur, data: cur.data.map((o) => (o._id === order._id ? { ...o, status: order.status } : o)) } : cur,
      );
      toast(errMsg(e, 'Could not move that ticket'), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      title={
        <div>
          <h2 className="font-display text-lg font-700 text-ink-900">Table {table.number}</h2>
          <p className="mt-0.5 text-[11.5px] font-normal text-ink-500">
            {table.session ? `${table.session.guestCount} guests · ${inr(table.runningTotal)} on the tab` : 'No open session'}
            {!!table.assignedWaiterName && !table.mine && ` · opened by ${table.assignedWaiterName}`}
          </p>
        </div>
      }
      footer={
        <div className="flex items-center justify-end gap-2">
          <ClearAction table={table} />
          <BillAction table={table} />
        </div>
      }
    >
      {loading && !data ? (
        <div className="p-6">
          <Spinner label="Loading the tickets…" />
        </div>
      ) : !orders.length ? (
        <p className="px-4 py-8 text-center text-[13px] text-ink-500">Nothing has been punched on this table yet.</p>
      ) : (
        <ul className="divide-y divide-ink-100">
          {orders.map((o) => {
            const meta = ORDER_STATUS_META[o.status];
            // Only the hand-offs the server lets this account make are offered.
            const canServe = user?.role !== 'KITCHEN' && (o.status === 'READY' || o.status === 'SERVED');
            return (
              <li key={o._id} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className="font-display text-[13.5px] font-800 text-ink-900">{o.orderNumber}</span>
                  <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${meta?.cls ?? 'bg-ink-100 text-ink-600 ring-ink-200'}`}>
                    <StatusDot className={meta?.dot ?? 'bg-ink-400'} /> {meta?.label ?? o.status}
                  </span>
                  <span className="ml-auto text-[12.5px] font-semibold tabular-nums text-ink-700">{inr(o.grandTotal)}</span>
                </div>
                <p className="mt-0.5 text-[11.5px] text-ink-400">
                  {o.source.replace(/_/g, ' ').toLowerCase()} · placed {clockTime(o.placedAt)}
                  {o.waiterId && o.waiterId === user?._id ? ' · yours' : ''}
                </p>
                <ul className="mt-2 space-y-1">
                  {o.items.map((line) => (
                    <li key={`${line.productId}-${line.name}`} className="flex items-center gap-2 text-[12.5px] text-ink-700">
                      {line.isVeg !== undefined && <VegDot isVeg={line.isVeg} />}
                      <span className="min-w-0 flex-1 truncate">
                        {line.qty} × {line.name}
                        {line.notes ? <span className="text-ink-400"> · {line.notes}</span> : ''}
                      </span>
                      <span className="tabular-nums text-ink-500">{inr(line.lineTotal)}</span>
                    </li>
                  ))}
                </ul>
                {canServe && (
                  <div className="mt-2.5">
                    <Button
                      size="sm"
                      variant={o.status === 'READY' ? 'primary' : 'secondary'}
                      loading={busy === o._id}
                      icon={<CheckCheck size={13} />}
                      onClick={() => void serve(o, o.status === 'READY' ? 'SERVED' : 'COMPLETED')}
                    >
                      {o.status === 'READY' ? `Food is on the table` : 'Guest has left'}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Drawer>
  );
}
