import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CalendarCheck, Check, Clock, MapPin, Users } from 'lucide-react';
import { http, errMsg, mediaUrl } from '../../lib/api';
import { Button, Field, Input, Select, Spinner } from '../../components/ui';
import { toast } from '../../store/toasts';
import { useTitle } from '../../hooks/useTitle';
import { dayMonth } from '../../lib/format';

interface PublicRestaurant {
  _id: string;
  name: string;
  slug: string;
  phone?: string;
  address?: { line1?: string; city?: string };
  branding?: { tagline?: string; coverUrl?: string };
  hours?: { open: string; close: string };
  settings?: { bookingEnabled?: boolean; bookingSlotMinutes?: number; bookingDurationMinutes?: number };
}

interface Slot {
  available: boolean;
  reason: string | null;
  tables: { _id: string; number: string; capacity: number; section?: string }[];
}

type Slots = Record<string, Slot>;

export function PublicBooking() {
  const { slug = '' } = useParams();
  const [restaurant, setRestaurant] = useState<PublicRestaurant | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [guests, setGuests] = useState(2);
  const [slots, setSlots] = useState<Slots>({});
  const [picked, setPicked] = useState<{ startAt: string; tableId?: string } | null>(null);
  const [form, setForm] = useState({ customerName: '', customerPhone: '', customerEmail: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useTitle(restaurant ? `Book a table at ${restaurant.name}` : 'Book a table');

  // Load branding once per slug.
  useEffect(() => {
    let live = true;
    http
      .get<PublicRestaurant>(`/public/restaurant/${slug}`)
      .then((r) => live && setRestaurant(r.data))
      .catch(() => live && setRestaurant(null))
      .finally(() => live && setLoaded(true));
    return () => { live = false; };
  }, [slug]);

  const slotTimes = useMemo(() => {
    const open = restaurant?.hours?.open ?? '12:00';
    const close = restaurant?.hours?.close ?? '23:00';
    const step = restaurant?.settings?.bookingSlotMinutes ?? 30;
    const [oh, om] = open.split(':').map(Number);
    const [ch] = close.split(':').map(Number);
    const out: string[] = [];
    for (let m = oh * 60 + (om || 0); m + 60 <= ch * 60; m += step) {
      out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    }
    return out;
  }, [restaurant]);

  // Probe every slot whenever the date, party size or venue changes.
  const probeKey = restaurant?._id ?? '';
  useEffect(() => {
    if (!probeKey) return;
    let live = true;
    setPicked(null);
    setSlots({});
    void (async () => {
      const results: Slots = {};
      await Promise.all(
        slotTimes.map(async (t) => {
          const startAt = new Date(`${date}T${t}:00`).toISOString();
          try {
            const { data } = await http.get<Slot>(`/public/bookings/availability`, {
              params: { restaurantId: probeKey, startAt, guests },
            });
            results[t] = data;
          } catch {
            results[t] = { available: false, reason: 'Closed', tables: [] };
          }
        }),
      );
      if (live) setSlots(results);
    })();
    return () => { live = false; };
  }, [probeKey, date, guests, slotTimes]);

  async function submit() {
    if (!picked || !restaurant) return;
    if (!form.customerName.trim() || form.customerPhone.trim().length < 6) {
      toast('Add your name and phone number', 'error');
      return;
    }
    setBusy(true);
    try {
      const { data } = await http.post<{ booking: { _id: string }; table: { number: string } | null }>(
        '/public/bookings',
        {
          restaurantId: restaurant._id,
          startAt: picked.startAt,
          tableId: picked.tableId,
          guests,
          ...form,
        },
      );
      setDone(data.table?.number ?? '');
    } catch (e) {
      toast(errMsg(e, 'That slot just got taken — pick another'), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <Spinner label="Loading…" />;
  if (!restaurant) {
    return (
      <div className="mx-auto max-w-md px-5 py-20 text-center">
        <p className="font-display text-lg font-700 text-ink-900">We could not find that restaurant</p>
        <p className="mt-1.5 text-sm text-ink-500">Check the link from your booking page or ask the venue for a fresh one.</p>
      </div>
    );
  }

  if (done !== null) {
    return (
      <div className="mx-auto grid min-h-screen max-w-md place-items-center px-5">
        <div className="w-full rounded-2xl bg-white p-6 text-center shadow-lg ring-1 ring-ink-200">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-leaf-100 text-leaf-700">
            <Check size={22} />
          </span>
          <h1 className="mt-4 font-display text-xl font-800 text-ink-900">Request sent</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
            {restaurant.name} will confirm your table for {guests} on {picked ? dayMonth(picked.startAt) : ''} shortly.
            {done ? ` We have pencilled in table ${done}.` : ''}
          </p>
          <Button variant="secondary" className="mt-5 w-full" onClick={() => { setDone(null); setForm({ customerName: '', customerPhone: '', customerEmail: '', notes: '' }); setPicked(null); }}>
            Book another table
          </Button>
        </div>
      </div>
    );
  }

  const bookingOff = restaurant.settings?.bookingEnabled === false;

  return (
    <div className="min-h-screen bg-ink-50 pb-12">
      <header
        className="bg-ink-900 px-5 pb-12 pt-7 text-white"
        style={restaurant.branding?.coverUrl ? { backgroundImage: `linear-gradient(rgba(28,25,23,.82),rgba(28,25,23,.92)),url(${mediaUrl(restaurant.branding.coverUrl)})`, backgroundSize: 'cover' } : undefined}
      >
        <p className="font-display text-[12px] font-800 uppercase tracking-[0.2em] text-ember-400">{restaurant.name}</p>
        <h1 className="mt-1.5 font-display text-[26px] font-800 leading-tight tracking-tight">
          {restaurant.branding?.tagline ?? 'Reserve your table'}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[12.5px] text-ink-300">
          {restaurant.address?.line1 && <span className="inline-flex items-center gap-1.5"><MapPin size={13} /> {restaurant.address.line1}{restaurant.address.city ? `, ${restaurant.address.city}` : ''}</span>}
          {restaurant.hours && <span className="inline-flex items-center gap-1.5"><Clock size={13} /> {restaurant.hours.open}–{restaurant.hours.close}</span>}
          {restaurant.phone && <span>☎ {restaurant.phone}</span>}
        </div>
      </header>

      <main className="mx-auto -mt-6 max-w-md px-4">
        <div className="rounded-2xl bg-white p-4 shadow-lg ring-1 ring-ink-200">
          {bookingOff ? (
            <p className="py-6 text-center text-sm text-ink-500">This restaurant is not taking online bookings right now. Call {restaurant.phone ?? 'us'} instead.</p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Date">
                  <Input type="date" value={date} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setDate(e.target.value)} />
                </Field>
                <Field label="Guests">
                  <Select value={String(guests)} onChange={(e) => setGuests(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5, 6, 8, 10, 12].map((n) => (
                      <option key={n} value={n}>{n} {n === 1 ? 'guest' : 'guests'}</option>
                    ))}
                  </Select>
                </Field>
              </div>

              <p className="mt-3 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-500">
                <Users size={12} /> Pick a time
              </p>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5 sm:grid-cols-4">
                {slotTimes.map((t) => {
                  const s = slots[t];
                  const on = picked?.startAt.endsWith(t) ?? false;
                  return (
                    <button
                      key={t}
                      disabled={!s || !s.available}
                      onClick={() => {
                        const startAt = new Date(`${date}T${t}:00`).toISOString();
                        setPicked({ startAt, tableId: s.tables[0]?._id });
                      }}
                      className={`rounded-xl border px-2 py-2 text-[13px] font-semibold transition-colors ${
                        on
                          ? 'border-ember-600 bg-ember-500 text-white'
                          : s?.available
                            ? 'border-ink-200 bg-white text-ink-800 hover:border-ember-300 hover:bg-ember-50'
                            : 'cursor-not-allowed border-ink-100 bg-ink-50 text-ink-300 line-through'
                      }`}
                    >
                      {t}
                    </button>
                  );
                })}
                {!slotTimes.length && <p className="col-span-3 py-3 text-sm text-ink-500">No slots today.</p>}
              </div>

              {picked && (
                <div className="mt-4 space-y-3 border-t border-ink-100 pt-4">
                  <Field label="Your name" required>
                    <Input value={form.customerName} onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))} placeholder="Ananya Sharma" />
                  </Field>
                  <Field label="Phone" required>
                    <Input value={form.customerPhone} onChange={(e) => setForm((f) => ({ ...f, customerPhone: e.target.value }))} placeholder="98XXXXXXXX" inputMode="tel" />
                  </Field>
                  <Field label="Email (optional)">
                    <Input value={form.customerEmail} onChange={(e) => setForm((f) => ({ ...f, customerEmail: e.target.value }))} inputMode="email" />
                  </Field>
                  <Field label="Anything we should know?">
                    <Input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Birthday, high chair, quiet corner…" />
                  </Field>
                  <Button variant="primary" size="lg" className="w-full" loading={busy} onClick={submit} icon={<CalendarCheck size={16} />}>
                    Request this table
                  </Button>
                  <p className="text-center text-[11.5px] text-ink-500">Nothing is charged now — the host confirms by phone.</p>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
