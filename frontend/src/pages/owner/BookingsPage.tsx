import { useMemo, useState } from 'react';
import { CalendarPlus, ChevronLeft, ChevronRight, Phone, Search, Users } from 'lucide-react';
import { invalidate, useQuery } from '../../lib/query';
import { http, errMsg } from '../../lib/api';
import type { Booking, Paginated, Table, User } from '../../lib/types';
import { BOOKING_STATUS_META } from '../../lib/statusMaps';
import { clockTime, dayMonth, inr } from '../../lib/format';
import { Button, Card, EmptyState, Field, Input, Modal, Pill, SegmentedControl, Select, Spinner, StatTile } from '../../components/ui';
import { can, useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';

const VIEWS = [
  { value: 'today', label: 'Today' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'all', label: 'All' },
];

const NEXT: Record<string, { to: string; label: string }[]> = {
  PENDING: [{ to: 'CONFIRMED', label: 'Confirm' }, { to: 'CANCELLED', label: 'Decline' }],
  CONFIRMED: [{ to: 'ARRIVED', label: 'Arrived' }, { to: 'NO_SHOW', label: 'No show' }],
  ARRIVED: [{ to: 'SEATED', label: 'Seat them' }],
  SEATED: [{ to: 'COMPLETED', label: 'Close' }],
};

export function BookingsPage() {
  const { user } = useAuth();
  const writable = can(user?.role, 'bookings:write');
  const [view, setView] = useState<(typeof VIEWS)[number]['value']>('today');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const params: Record<string, unknown> = { limit: 100 };
  if (view === 'today') params.date = date;
  if (view === 'upcoming') params.upcomingOnly = true;
  if (debounced) params.search = debounced;

  const { data, loading } = useQuery<Paginated<Booking>>('bookings:list', '/bookings', params);
  const rows = data?.data ?? [];

  const grouped = useMemo(() => {
    const map = new Map<string, Booking[]>();
    for (const b of rows) {
      const key = b.startAt.slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), b]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  const expected = rows.filter((b) => ['PENDING', 'CONFIRMED', 'ARRIVED'].includes(b.status)).length;
  const seated = rows.filter((b) => b.status === 'SEATED' || b.status === 'ARRIVED').length;

  async function move(b: Booking, status: string) {
    try {
      await http.patch(`/bookings/${b._id}/status`, { status });
      invalidate('bookings');
      toast(`${b.customerName} · ${status.toLowerCase()}`, 'success');
    } catch (e) {
      invalidate('bookings');
      toast(errMsg(e, 'That transition is not allowed'), 'error');
    }
  }

  function shiftDate(days: number) {
    const d = new Date(`${date}T00:00:00`);
    d.setDate(d.getDate() + days);
    setDate(d.toISOString().slice(0, 10));
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="In the book" value={String(data?.total ?? 0)} hint={view === 'today' ? dayMonth(date) : view === 'upcoming' ? 'still to come' : 'all time'} />
        <StatTile label="Expecting" value={String(expected)} tone="ember" hint="to arrive" />
        <StatTile label="Seated now" value={String(seated)} tone="leaf" />
      </div>

      <Card
        title="Bookings"
        subtitle="Confirm, seat and close tables"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SegmentedControl size="sm" options={VIEWS} value={view} onChange={setView} />
            {view === 'today' && (
              <span className="inline-flex items-center gap-0.5 rounded-xl border border-ink-200 bg-white px-1 py-0.5">
                <button onClick={() => shiftDate(-1)} className="grid h-7 w-7 place-items-center rounded-lg hover:bg-ink-100" aria-label="Previous day"><ChevronLeft size={14} /></button>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-7 border-0 bg-transparent px-1 text-[12.5px] font-semibold text-ink-800 focus:outline-none" />
                <button onClick={() => shiftDate(1)} className="grid h-7 w-7 place-items-center rounded-lg hover:bg-ink-100" aria-label="Next day"><ChevronRight size={14} /></button>
              </span>
            )}
            <div className="relative">
              <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
              <Input value={search} onChange={(e) => { setSearch(e.target.value); setDebounced(e.target.value); }} placeholder="Name or phone" className="h-8 w-40 pl-7 text-[13px]" />
            </div>
            {writable && <Button size="sm" variant="primary" icon={<CalendarPlus size={14} />} onClick={() => setAddOpen(true)}>Add booking</Button>}
          </div>
        }
      >
        {loading && !data ? (
          <Spinner />
        ) : !grouped.length ? (
          <EmptyState icon={<Users size={26} />} title="Nothing booked" body={view === 'today' ? `No reservations for ${dayMonth(date)}.` : 'No bookings match this view.'} />
        ) : (
          grouped.map(([day, list]) => (
            <div key={day}>
              <p className="border-b border-ink-100 bg-ink-50 px-3.5 py-1.5 text-[11.5px] font-bold uppercase tracking-wide text-ink-500">
                {dayMonth(list[0].startAt)}
              </p>
              <ul className="divide-y divide-ink-100">
                {list.map((b) => (
                  <li key={b._id} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                    <span className="w-14 shrink-0 font-display text-[15px] font-800 tabular-nums text-ink-900">{clockTime(b.startAt)}</span>
                    <div className="min-w-0 flex-1 leading-tight">
                      <p className="truncate text-[13.5px] font-semibold text-ink-900">{b.customerName}</p>
                      <p className="truncate text-[12px] text-ink-500">
                        {b.guests} guests{b.tableNumber ? ` · table ${b.tableNumber}` : ''}{b.tableSection ? ` · ${b.tableSection}` : ''} · {b.durationMinutes}m
                      </p>
                      {b.notes && <p className="mt-0.5 truncate text-[11.5px] italic text-amber-700">{b.notes}</p>}
                    </div>
                    <a href={`tel:${b.customerPhone}`} className="hidden items-center gap-1 text-[12px] font-medium text-ink-500 hover:text-ember-600 sm:inline-flex">
                      <Phone size={12} /> {b.customerPhone}
                    </a>
                    <Pill className={BOOKING_STATUS_META[b.status].cls}>{BOOKING_STATUS_META[b.status].label}</Pill>
                    {writable && (NEXT[b.status] ?? []).map((a) => (
                      <Button key={a.to} size="sm" variant={a.to === 'CANCELLED' || a.to === 'NO_SHOW' ? 'danger' : 'primary'} onClick={() => void move(b, a.to)}>
                        {a.label}
                      </Button>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </Card>

      {addOpen && <AddBookingModal onClose={() => setAddOpen(false)} />}
    </div>
  );
}

function AddBookingModal({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    guests: 2,
    date: new Date().toISOString().slice(0, 10),
    time: '19:30',
    notes: '',
    tableId: '',
    assignedWaiterId: '',
  });
  const [busy, setBusy] = useState(false);
  const { data: tables } = useQuery<{ data: Table[] }>('tables', '/tables');
  const { data: staff } = useQuery<{ data: User[] }>('staff', '/staff');
  const waiters = (staff?.data ?? []).filter((u) => u.role === 'WAITER' && u.status === 'ACTIVE');

  async function save() {
    if (!form.customerName.trim() || form.customerPhone.trim().length < 6) {
      toast('Name and phone are needed', 'error');
      return;
    }
    setBusy(true);
    try {
      await http.post('/bookings', {
        customerName: form.customerName.trim(),
        customerPhone: form.customerPhone.trim(),
        customerEmail: form.customerEmail.trim() || undefined,
        guests: form.guests,
        startAt: new Date(`${form.date}T${form.time}:00`).toISOString(),
        notes: form.notes || undefined,
        tableId: form.tableId || undefined,
        assignedWaiterId: form.assignedWaiterId || undefined,
      });
      invalidate('bookings');
      toast('Booking added', 'success');
      onClose();
    } catch (e) { toast(errMsg(e, 'Could not book that table'), 'error'); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="New booking" subtitle="Held for 15 minutes past the slot"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Book it</Button></>}>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Guest" required className="sm:col-span-2">
          <Input value={form.customerName} onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))} placeholder="Ishita Rao" />
        </Field>
        <Field label="Phone" required><Input value={form.customerPhone} onChange={(e) => setForm((f) => ({ ...f, customerPhone: e.target.value }))} inputMode="tel" /></Field>
        <Field label="Email"><Input value={form.customerEmail} onChange={(e) => setForm((f) => ({ ...f, customerEmail: e.target.value }))} inputMode="email" /></Field>
        <Field label="Date"><Input type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} /></Field>
        <Field label="Time"><Input type="time" value={form.time} onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))} /></Field>
        <Field label="Guests"><Input type="number" min={1} max={40} value={form.guests} onChange={(e) => setForm((f) => ({ ...f, guests: Number(e.target.value) }))} /></Field>
        <Field label="Table" hint="Leave auto to let us assign">
          <Select value={form.tableId} onChange={(e) => setForm((f) => ({ ...f, tableId: e.target.value }))}>
            <option value="">Any free table</option>
            {(tables?.data ?? []).map((t) => <option key={t._id} value={t._id}>Table {t.number} · seats {t.capacity}</option>)}
          </Select>
        </Field>
        <Field label="Waiter" className="sm:col-span-2">
          <Select value={form.assignedWaiterId} onChange={(e) => setForm((f) => ({ ...f, assignedWaiterId: e.target.value }))}>
            <option value="">Unassigned</option>
            {waiters.map((w) => <option key={w._id} value={w._id}>{w.name}</option>)}
          </Select>
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Anniversary, needs a high chair…" />
        </Field>
      </div>
      <p className="mt-2 text-[12px] text-ink-500">Booking is created as pending — confirm it once you call the guest. {inr(0)} deposit.</p>
    </Modal>
  );
}
