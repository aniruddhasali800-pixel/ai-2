import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Broom, Hand, PlusCircle, ScrollText, Search, Share2, UserPlus } from 'lucide-react';
import { invalidate, useQuery } from '../../lib/query';
import { http, errMsg } from '../../lib/api';
import type { User, WaiterTable } from '../../lib/types';
import { ORDER_STATUS_META, REQUEST_LABEL, TABLE_STATUS_META } from '../../lib/statusMaps';
import { clockTime, inr, timeAgo } from '../../lib/format';
import { Button, Field, Input, Modal, SegmentedControl, Select, Spinner, StatusDot } from '../../components/ui';
import { can, useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';
import { BillAction, ClearAction, TableTicket } from './TableTicket';

type Filter = 'all' | 'mine' | 'seated' | 'open';

export function FloorMap() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const writable = can(user?.role, 'tables:write');
  const { data, loading } = useQuery<{ data: WaiterTable[] }>('floor:map', '/waiters/map');
  const { data: staff } = useQuery<{ data: User[] }>('staff', '/staff');
  const [filter, setFilter] = useState<Filter>('all');
  const [find, setFind] = useState('');
  const [seating, setSeating] = useState<WaiterTable | null>(null);
  const [transferring, setTransferring] = useState<WaiterTable | null>(null);
  const [ticketId, setTicketId] = useState<string | null>(null);

  const tables = data?.data ?? [];
  // A guest at the door asks "where is my order" and only knows their table number, so the floor
  // has to answer from that alone — and answer it for whichever waiter is standing here, not only
  // for the one who took the party.
  const found = useMemo(() => {
    const q = find.trim().toLowerCase();
    if (!q) return [];
    return tables.filter((t) =>
      t.number.toLowerCase().replace(/^table /, '') === q
        || t.number.toLowerCase().includes(q)
        || t.section.toLowerCase().includes(q)
        || (t.session?.customerName ?? '').toLowerCase().includes(q)
        || t.activeOrders.some((o) => o.orderNumber.toLowerCase().includes(q)),
    );
  }, [tables, find]);
  const shown = useMemo(
    () =>
      tables.filter((t) =>
        filter === 'all' ? true
          : filter === 'mine' ? t.mine
            : filter === 'seated' ? Boolean(t.session)
              : !t.session,
      ).filter((t) => !find.trim() || found.some((m) => m._id === t._id)),
    [tables, filter, find, found],
  );
  const waiters = (staff?.data ?? []).filter((u) => u.role === 'WAITER' && u.status === 'ACTIVE');
  // The drawer reads its table out of the live map, so a bill the counter just accepted shows up
  // without the waiter closing and reopening it.
  const ticket = ticketId ? tables.find((t) => t._id === ticketId) ?? null : null;

  if (loading && !data) return <Spinner label="Loading the floor…" />;

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

  async function shareMenu(t: WaiterTable) {
    const url = `${window.location.origin}/t/${t.qrToken}`;
    if (navigator.share) {
      try { await navigator.share({ title: `Table ${t.number} menu`, url }); return; } catch { /* dismissed */ }
    }
    void navigator.clipboard?.writeText(url);
    toast('Menu link copied', 'success');
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-2.5 ring-1 ring-ink-200">
        <label className="flex items-center gap-2">
          <Search size={15} className="shrink-0 text-ink-400" />
          <input
            value={find}
            onChange={(e) => setFind(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && found.length === 1) setTicketId(found[0]._id); }}
            placeholder="Where is my order — a table number, a guest, a ticket"
            aria-label="Find a table"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-ink-400"
          />
          {!!find && (
            <button onClick={() => setFind('')} className="shrink-0 text-[11.5px] font-semibold uppercase text-ink-400 hover:text-ink-700">
              Clear
            </button>
          )}
        </label>
        {!!find.trim() && (
          found.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {found.slice(0, 6).map((t) => (
                <li key={t._id}>
                  <button
                    onClick={() => setTicketId(t._id)}
                    className="rounded-lg bg-ink-50 px-2.5 py-1.5 text-left text-[12px] text-ink-700 ring-1 ring-ink-200 transition-colors hover:bg-ink-100"
                  >
                    <span className="font-display text-[12.5px] font-800 text-ink-900">Table {t.number}</span>
                    {t.session ? ` · ${t.activeOrders.length} fire${t.activeOrders.length === 1 ? '' : 's'} · ${inr(t.runningTotal)}` : ' · no party seated'}
                    {!!t.assignedWaiterName && !t.mine && <span className="text-ink-500"> · with {t.assignedWaiterName}</span>}
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12.5px] text-ink-500">
              Nothing on the floor matches “{find}”. The number printed on the table card works, and so does the name the party sat under.
            </p>
          )
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All ${tables.length}` },
            { value: 'mine', label: 'Mine' },
            { value: 'seated', label: 'Seated' },
            { value: 'open', label: 'Free' },
          ]}
        />
        <Button size="sm" variant="primary" icon={<PlusCircle size={14} />} onClick={() => navigate('/floor/order')}>New order</Button>
      </div>

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((t) => {
          const meta = TABLE_STATUS_META[t.status];
          const late = t.session && timeAgo(t.session.openedAt).includes('h');
          const isWaiter = user?.role === 'WAITER';
          // No party at the table does not mean a free table: cleaning refuses a seating, and a
          // reservation is being held. The card has to say which of the three the waiter is looking at.
          const idleHint =
            t.status === 'CLEANING' ? 'not wiped down yet' : t.status === 'RESERVED' ? 'held for a booking' : 'ready to seat';
          return (
            <article key={t._id} className={`overflow-hidden rounded-2xl border shadow-sm ${meta.card}`}>
              <header className={`flex items-center gap-2 px-3.5 py-2.5 ${meta.text}`}>
                <span className="font-display text-[16px] font-800 leading-none">{t.number}</span>
                <span className="text-[11.5px] opacity-80">{t.section} · {t.capacity}p</span>
                {t.mine && <span className="ml-auto rounded bg-black/15 px-1.5 py-0.5 text-[10px] font-bold uppercase">Mine</span>}
                {!t.mine && !!t.assignedWaiterName && (
                  <span className="ml-auto rounded bg-black/10 px-1.5 py-0.5 text-[10px] font-bold uppercase opacity-80">
                    with {t.assignedWaiterName}
                  </span>
                )}
              </header>
              <div className="bg-white/95 px-3.5 py-3">
                {t.session ? (
                  <>
                    <p className="truncate text-[13px] font-semibold text-ink-900">
                      {t.session.customerName || 'Walk-in'} · {t.session.guestCount} guests
                    </p>
                    <p className="mt-0.5 text-[12px] text-ink-500">
                      opened {clockTime(t.session.openedAt)}
                      {late ? ' · long sitting' : ''} · tab <span className="font-semibold text-ink-800">{inr(t.runningTotal)}</span>
                    </p>
                    {!!t.activeOrders.length && (
                      <ul className="mt-1.5 space-y-1">
                        {t.activeOrders.slice(0, 3).map((o) => {
                          const om = ORDER_STATUS_META[o.status];
                          return (
                            <li key={o._id}>
                              <button
                                type="button"
                                onClick={() => setTicketId(t._id)}
                                className="flex w-full items-center gap-1.5 rounded-lg bg-ink-50 px-2 py-1 text-left text-[11.5px] transition-colors hover:bg-ink-100"
                              >
                                <span className="shrink-0 font-semibold text-ink-800">{o.orderNumber}</span>
                                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold ring-1 ring-inset ${om?.cls ?? 'bg-ink-100 text-ink-600 ring-ink-200'}`}>
                                  <StatusDot className={om?.dot ?? 'bg-ink-400'} /> {om?.label ?? o.status}
                                </span>
                                <span className="truncate text-ink-400">{o.itemCount} item{o.itemCount === 1 ? '' : 's'}</span>
                                <span className="ml-auto shrink-0 tabular-nums text-ink-600">{inr(o.grandTotal)}</span>
                              </button>
                            </li>
                          );
                        })}
                        {t.activeOrders.length > 3 && (
                          <li className="px-2 text-[11px] text-ink-400">+{t.activeOrders.length - 3} more on this table</li>
                        )}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className="text-[13px] text-ink-500">{meta.label} · {idleHint}</p>
                )}

                {!!t.openRequests.length && (
                  <ul className="mt-2 space-y-1">
                    {t.openRequests.map((r) => (
                      <li key={r._id} className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-2 py-1 text-[11.5px] font-semibold text-amber-800">
                        <span>{REQUEST_LABEL[r.type]?.emoji ?? '✋'}</span>
                        {REQUEST_LABEL[r.type]?.label ?? r.type}
                        <span className="ml-auto font-normal text-amber-700">{timeAgo(r.createdAt)}</span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {t.session ? (
                    <>
                      {isWaiter && !t.assignedWaiterId && (
                        <Button size="sm" variant="primary" icon={<Hand size={13} />} onClick={() => void claim(t)}>Take this table</Button>
                      )}
                      <Button size="sm" variant="secondary" icon={<PlusCircle size={13} />} onClick={() => navigate(`/floor/order?table=${t._id}`)}>Add</Button>
                      {!!t.activeOrders.length && (
                        <Button size="sm" variant="secondary" icon={<ScrollText size={13} />} onClick={() => setTicketId(t._id)}>Tickets</Button>
                      )}
                      <Button size="sm" variant="secondary" icon={<Share2 size={13} />} onClick={() => void shareMenu(t)}>Menu</Button>
                      <BillAction table={t} />
                      <ClearAction table={t} />
                    </>
                  ) : (
                    <>
                      {writable && t.status !== 'CLEANING' && (
                        <Button size="sm" variant="primary" icon={<UserPlus size={13} />} onClick={() => setSeating(t)}>Seat</Button>
                      )}
                      {writable && t.status !== 'AVAILABLE' && <ClearAction table={t} />}
                    </>
                  )}
                  {can(user?.role, 'staff:read') && !!t.session && (
                    <Button size="sm" variant="ghost" icon={<Broom size={13} />} onClick={() => setTransferring(t)}>Transfer</Button>
                  )}
                </div>
              </div>
            </article>
          );
        })}
        {!shown.length && <p className="col-span-full py-10 text-center text-sm text-ink-500">No tables match that filter.</p>}
      </div>

      {seating && <SeatModal table={seating} onClose={() => setSeating(null)} />}
      {transferring && <TransferModal table={transferring} waiters={waiters} onClose={() => setTransferring(null)} />}
      {ticket && <TableTicket table={ticket} onClose={() => setTicketId(null)} />}
    </div>
  );
}

function SeatModal({ table, onClose }: { table: WaiterTable; onClose: () => void }) {
  const [guests, setGuests] = useState(Math.min(2, table.capacity));
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  async function seat() {
    setBusy(true);
    try {
      const { data } = await http.post<{ publicToken: string }>(`/waiters/tables/${table._id}/seat`, {
        guestCount: guests,
        customerName: name || undefined,
      });
      invalidate('floor');
      invalidate('tables');
      toast(`Table ${table.number} seated`, 'success');
      onClose();
      if (navigator.share) {
        void navigator.share({ title: `Table ${table.number}`, url: `${window.location.origin}/s/${data.publicToken}` }).catch(() => undefined);
      }
    } catch (e) { toast(errMsg(e, 'Could not seat them'), 'error'); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`Seat table ${table.number}`} subtitle={`${table.section} · seats up to ${table.capacity}`} width="max-w-sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={seat}>Seat guests</Button></>}>
      <div className="space-y-3">
        <Field label="Guests">
          <div className="flex gap-1.5">
            {Array.from({ length: Math.min(10, table.capacity) }, (_, i) => i + 1).map((n) => (
              <button key={n} onClick={() => setGuests(n)}
                className={`h-9 flex-1 rounded-lg text-[13px] font-bold transition-colors ${guests === n ? 'bg-ink-900 text-white' : 'border border-ink-200 bg-white text-ink-700 hover:bg-ink-50'}`}>
                {n}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Name (optional)"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Mehta" /></Field>
      </div>
    </Modal>
  );
}

function TransferModal({ table, waiters, onClose }: { table: WaiterTable; waiters: User[]; onClose: () => void }) {
  const [waiterId, setWaiterId] = useState(waiters.find((w) => w._id !== table.assignedWaiterId)?._id ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      await http.post(`/waiters/tables/${table._id}/transfer`, { waiterId, reason: reason || undefined });
      invalidate('floor');
      invalidate('tables');
      toast(`Table ${table.number} handed over`, 'success');
      onClose();
    } catch (e) { toast(errMsg(e, 'Transfer failed'), 'error'); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={`Hand over table ${table.number}`} width="max-w-sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={!waiterId} onClick={go}>Transfer</Button></>}>
      <div className="space-y-3">
        <Field label="New waiter">
          <Select value={waiterId} onChange={(e) => setWaiterId(e.target.value)}>
            <option value="">Choose a colleague…</option>
            {waiters.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
          </Select>
        </Field>
        <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="They know the regulars" /></Field>
      </div>
    </Modal>
  );
}
