import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Armchair,
  Banknote,
  Check,
  Clock,
  CreditCard,
  Download,
  MapPin,
  Minus,
  Plus,
  QrCode,
  ShoppingBag,
  Smartphone,
  Store,
  Truck,
} from 'lucide-react';
import { useQuery, invalidate } from '../../lib/query';
import { http, errMsg, mediaUrl } from '../../lib/api';
import type { AppMenu, AppOrderResult, AppSeat, AppSitResult, PublicMenuItem } from '../../lib/types';
import { inr } from '../../lib/format';
import { MerchantMark, Spinner, VegDot, DishThumb as UiDishThumb } from '../../components/ui';
import { QrScanner } from '../../components/QrScanner';
import { toast } from '../../store/toasts';
import { useTitle } from '../../hooks/useTitle';
import { useInstallPrompt } from '../../hooks/useInstallPrompt';

type Mode = 'DELIVERY' | 'DINE_IN';
type Stage = 'home' | 'seat' | 'menu' | 'checkout';
type PayMode = 'UPI' | 'CARD' | 'CASH_ON_DELIVERY';

/** A seat the guest claimed by scanning the sticker or tapping the free list. */
interface Seat {
  number: string;
  section: string;
  publicToken: string;
  guests: number;
}

interface Line {
  productId: string;
  qty: number;
  addonIds: string[];
  notes: string;
}

const GUEST_KEY = 'sizzle.app.guest';
const SEAT_KEY = 'sizzle.app.seat';

/** The table stays claimed between visits — nobody wants to re-scan a sticker twice. */
function savedSeat(slug: string): Seat | null {
  try {
    const raw = localStorage.getItem(SEAT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Seat & { slug?: string };
    return parsed.slug === slug ? { number: parsed.number, section: parsed.section, publicToken: parsed.publicToken, guests: parsed.guests || 1 } : null;
  } catch {
    return null;
  }
}

/** The guest remembers their own details between visits, like any real app. */
function savedGuest() {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as { name?: string; phone?: string; address?: string; city?: string };
  } catch {
    return null;
  }
}

/** A guest gave their name once; the next visit should not ask for it again. */
function rememberName(name: string) {
  if (name.trim().length < 2) return;
  localStorage.setItem(GUEST_KEY, JSON.stringify({ ...(savedGuest() ?? {}), name: name.trim() }));
}

export function CustomerApp() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const { data, loading, error } = useQuery<AppMenu>(`app:menu:${slug}`, `/public/apps/menu/${slug}`);
  const [stage, setStage] = useState<Stage>('home');
  const [mode, setMode] = useState<Mode>('DELIVERY');
  const [cart, setCart] = useState<Record<string, Line>>({});
  const [seat, setSeat] = useState<Seat | null>(() => savedSeat(slug));
  const { canInstall, promptInstall, installed, needsManualInstall } = useInstallPrompt();

  useTitle(data ? `${data.restaurant.name} · Order` : 'Order food');

  const r = data?.restaurant;
  const closed = !r?.acceptingOrders;
  const lines = Object.values(cart).filter((l) => l.qty > 0);
  const count = lines.reduce((n, l) => n + l.qty, 0);
  const subtotal = lines.reduce((sum, l) => {
    const p = data?.products.find((x) => x._id === l.productId);
    const addons = l.addonIds.reduce((a, id) => a + (data?.addons.find((x) => x._id === id)?.price ?? 0), 0);
    return sum + ((p?.price ?? 0) + addons) * l.qty;
  }, 0);

  if (loading && !data) return <Spinner label="Opening the menu…" />;
  if (error || !r) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 text-center">
        <Store size={26} className="mx-auto mb-3 text-ink-300" />
        <p className="font-display text-lg font-700 text-ink-900">This kitchen is not on Sizzle yet</p>
        <p className="mt-1.5 text-sm text-ink-500">{error ?? 'No menu to show here.'}</p>
      </div>
    );
  }

  function choose(next: Mode) {
    setMode(next);
    if (next === 'DINE_IN' && !seat) return setStage('seat');
    setStage('menu');
  }

  function seated(next: Seat) {
    setSeat(next);
    localStorage.setItem(SEAT_KEY, JSON.stringify({ ...next, slug }));
    setMode('DINE_IN');
    setStage('menu');
  }

  return (
    <div className="min-h-screen bg-ink-50 pb-36">
      <header className="bg-ink-900 px-4 pb-16 pt-4 text-white">
        <div className="mx-auto flex max-w-2xl items-center gap-3">
          <MerchantMark name={r.name} logoSrc={r.branding?.logoUrl ? mediaUrl(r.branding.logoUrl) : undefined} />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate font-display text-[15px] font-800">{r.name}</p>
            <p className="truncate text-[11.5px] text-ink-400">{r.branding?.tagline || r.address?.city || 'On Sizzle'}</p>
          </div>
          {canInstall && (
            <button
              onClick={() => void promptInstall()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-[12px] font-semibold text-white ring-1 ring-white/20 transition-colors hover:bg-white/20"
            >
              <Download size={13} /> Install
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto -mt-12 max-w-2xl px-4">
        {stage === 'home' && (
          <div className="space-y-3">
            <HomePicker r={r} seated={seat} onPick={choose} onReturnToTable={seat ? () => { setMode('DINE_IN'); setStage('menu'); } : undefined} />
            <InstallHint installed={installed} needsManualInstall={needsManualInstall} canInstall={canInstall} onInstall={() => void promptInstall()} />
          </div>
        )}
        {stage === 'seat' && (
          <SeatStage slug={slug} onBack={() => setStage('home')} onSeated={seated} />
        )}
        {stage === 'menu' && (
          <MenuStage
            data={data}
            mode={mode}
            seat={seat}
            cart={cart}
            closed={closed}
            onBack={() => setStage('home')}
            setCart={setCart}
          />
        )}
        {stage === 'checkout' && (
          <CheckoutStage
            data={data}
            mode={mode}
            seat={seat}
            lines={lines}
            subtotal={subtotal}
            onBack={() => setStage('menu')}
            onPlaced={(token) => navigate(`/track/${token}`)}
            onSeatedOrder={(sessionToken) => navigate(`/s/${sessionToken}`)}
            onLostSeat={() => {
              localStorage.removeItem(SEAT_KEY);
              setSeat(null);
              setStage('seat');
            }}
          />
        )}
      </main>

      {stage === 'menu' && !!count && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-ember-50 text-ember-600">
              <ShoppingBag size={17} />
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-[13px] font-semibold text-ink-900">
                {count} item{count > 1 ? 's' : ''} · {mode === 'DELIVERY' ? 'to your door' : `to Table ${seat?.number ?? ''}`}
              </p>
              <p className="text-[12px] text-ink-500">{inr(subtotal)} before taxes</p>
            </div>
            <button
              onClick={() => setStage('checkout')}
              className="h-10 rounded-[10px] border border-ember-600/40 bg-ember-500 px-5 text-[14px] font-bold text-white shadow-sm transition-[background,transform] hover:bg-ember-600 active:scale-[0.98]"
            >
              Checkout
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function HomePicker({
  r,
  seated,
  onPick,
  onReturnToTable,
}: {
  r: AppMenu['restaurant'];
  seated: Seat | null;
  onPick: (m: Mode) => void;
  onReturnToTable?: () => void;
}) {
  return (
    <div className="space-y-3">
      {r.hours && (
        <p className="flex items-center justify-center gap-1.5 pt-1 text-[12px] font-semibold text-ink-500">
          <Clock size={12} /> Open {r.hours.open}–{r.hours.close}
        </p>
      )}
      {seated && onReturnToTable && (
        <button
          onClick={onReturnToTable}
          className="card flex w-full items-center gap-3 border-l-4 border-l-ember-500 p-3.5 text-left transition-shadow hover:shadow-md"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-900 font-display text-[13px] font-800 text-ember-400">
            {seated.number}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-bold text-ink-900">Back to Table {seated.number}</span>
            <span className="block text-[12px] text-ink-500">Your table is still open — add another round or ask for the bill</span>
          </span>
          <ArrowLeft size={15} className="shrink-0 rotate-180 text-ink-400" />
        </button>
      )}
      <ModeCard
        icon={<Truck size={20} />}
        title="Home delivery"
        body="Type the address once — we keep it for next time and ride to your door."
        disabled={!r.deliveryEnabled}
        onClick={() => onPick('DELIVERY')}
      />
      <ModeCard
        icon={<Armchair size={20} />}
        title="Choose your seat"
        body="Point the camera at the sticker on your table, or tap a free seat from the floor. The kitchen sees it at once."
        onClick={() => onPick('DINE_IN')}
      />
      <p className="pt-1 text-center text-[11.5px] leading-relaxed text-ink-500">
        <Link to={`/book/${r.slug}`} className="font-semibold text-ember-600 underline-offset-2 hover:underline">
          Book a table
        </Link>{' '}
        if you would rather reserve one first.
      </p>
    </div>
  );
}

function ModeCard({
  icon,
  title,
  body,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="card flex w-full items-start gap-3.5 p-4 text-left transition-[transform,box-shadow] hover:shadow-md active:scale-[0.995] disabled:opacity-55"
    >
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ink-900 text-ember-400">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[17px] font-800 text-ink-900">{title}</span>
        <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-500">{body}</span>
      </span>
    </button>
  );
}

/** iOS never fires an install prompt, so the only honest install button is a sentence. */
function InstallHint({
  installed,
  needsManualInstall,
  canInstall,
  onInstall,
}: {
  installed: boolean;
  needsManualInstall: boolean;
  canInstall: boolean;
  onInstall: () => void;
}) {
  const [gone, setGone] = useState(() => localStorage.getItem('sizzle.app.install') === 'hidden');
  if (installed || gone || (!needsManualInstall && !canInstall)) return null;

  return (
    <div className="flex items-start gap-3 rounded-2xl bg-ink-900 px-4 py-3 text-white">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 text-ember-400">
        <Smartphone size={17} />
      </span>
      <div className="min-w-0 flex-1 leading-snug">
        <p className="text-[13px] font-semibold">
          {needsManualInstall ? 'Put this on your home screen' : 'Install the Sizzle app'}
        </p>
        <p className="mt-0.5 text-[11.5px] text-ink-400">
          {needsManualInstall
            ? 'In Safari: tap Share, then "Add to Home Screen". It opens full screen, with your address already saved.'
            : 'One tap and it lives beside your other apps — menu, cart and orders offline in a flash.'}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        {canInstall && (
          <button
            onClick={onInstall}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ember-500 px-2.5 py-1.5 text-[12px] font-bold text-white transition-colors hover:bg-ember-600"
          >
            <Download size={12} /> Install
          </button>
        )}
        <button
          onClick={() => {
            localStorage.setItem('sizzle.app.install', 'hidden');
            setGone(true);
          }}
          className="text-[11px] font-medium text-ink-400 hover:text-white"
        >
          Not now
        </button>
      </div>
    </div>
  );
}

/**
 * Sitting down: the camera reads the sticker on the table, or the guest taps a free
 * table off the floor list. Both end with the same session the sticker page opens, so
 * the waiter's floor and the kitchen board change the moment a body lands in a chair.
 */
function SeatStage({ slug, onBack, onSeated }: { slug: string; onBack: () => void; onSeated: (s: Seat) => void }) {
  const { data, loading, refetch } = useQuery<{ seats: AppSeat[] }>(`app:seats:${slug}`, `/public/apps/${slug}/seats`);
  const [name, setName] = useState(savedGuest()?.name ?? '');
  const [party, setParty] = useState(2);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');

  const sections = useMemo(() => {
    const by = new Map<string, AppSeat[]>();
    for (const seat of data?.seats ?? []) by.set(seat.section, [...(by.get(seat.section) ?? []), seat]);
    return [...by.entries()];
  }, [data]);

  async function sit(code: string) {
    if (busy) return;
    setBusy(true);
    setProblem('');
    try {
      const { data: res } = await http.post<AppSitResult>(`/public/apps/${slug}/sit`, {
        code,
        guestCount: party,
        customerName: name.trim().slice(0, 80) || undefined,
      });
      rememberName(name);
      onSeated({
        number: res.table.number,
        section: res.table.section,
        publicToken: res.session.publicToken,
        guests: res.session.guestCount,
      });
    } catch (e) {
      setProblem(errMsg(e, 'We did not recognise that seat'));
      refetch();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-500 hover:text-ink-900">
        <ArrowLeft size={14} /> Choose your seat
      </button>

      <div className="card space-y-3 p-4">
        <h2 className="font-display text-[16px] font-800 text-ink-900">Who is sitting down?</h2>
        <Field label="Your name">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Anita Kulkarni" className={inputCls} />
        </Field>
        <div>
          <span className="label">How many of you</span>
          <div className="mt-1.5 flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1 rounded-lg bg-ink-900 p-0.5 text-white">
              <button onClick={() => setParty((p) => Math.max(1, p - 1))} className="grid h-8 w-8 place-items-center rounded-md hover:bg-white/10" aria-label="One fewer">
                <Minus size={14} />
              </button>
              <span className="w-7 text-center text-[14px] font-bold tabular-nums">{party}</span>
              <button onClick={() => setParty((p) => Math.min(20, p + 1))} className="grid h-8 w-8 place-items-center rounded-md hover:bg-white/10" aria-label="One more">
                <Plus size={14} />
              </button>
            </span>
            <span className="text-[12px] text-ink-500">guest{party > 1 ? 's' : ''}</span>
          </div>
        </div>
      </div>

      <QrScanner hint="Point at the sticker on your table" onCode={(code) => void sit(code)} />

      {problem && (
        <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12.5px] font-medium text-amber-800 ring-1 ring-amber-200">
          {problem}
        </p>
      )}

      <div className="card p-4">
        <p className="text-[13px] font-semibold text-ink-800">No sticker in reach?</p>
        <p className="mt-0.5 text-[12px] leading-snug text-ink-500">
          These tables are free right now — tap one and it is held for you while the waiter comes over.
        </p>

        {loading && !data && <p className="mt-3 text-[12.5px] text-ink-500">Checking the floor…</p>}
        {!!data && !data.seats.length && (
          <p className="mt-3 rounded-xl bg-ink-50 px-3 py-2.5 text-[12.5px] text-ink-600">
            Every seat is taken at the moment. Send it home as a delivery instead, or ask at the counter.
          </p>
        )}

        {sections.map(([section, seats]) => (
          <div key={section} className="mt-3.5">
            <p className="label">{section}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {seats.map((s) => (
                <button
                  key={s.id}
                  disabled={busy}
                  onClick={() => void sit(s.seatCode)}
                  className="min-w-[84px] rounded-xl bg-white px-3 py-2 text-left ring-1 ring-ink-200 transition-colors hover:bg-ink-50 disabled:opacity-50"
                >
                  <span className="block font-display text-[13.5px] font-800 text-ink-900">Table {s.number}</span>
                  <span className="block text-[11px] text-ink-500">seats {s.capacity}</span>
                </button>
              ))}
            </div>
          </div>
        ))}

        {busy && <p className="mt-3 text-[12.5px] font-semibold text-ember-700">Taking your seat…</p>}
      </div>
    </div>
  );
}

function MenuStage({
  data,
  mode,
  seat,
  cart,
  closed,
  onBack,
  setCart,
}: {
  data: AppMenu;
  mode: Mode;
  seat: Seat | null;
  cart: Record<string, Line>;
  closed: boolean;
  onBack: () => void;
  setCart: React.Dispatch<React.SetStateAction<Record<string, Line>>>;
}) {
  const { categories, products, addons } = data;
  const [openCat, setOpenCat] = useState(categories[0]?._id ?? '');
  const [expanded, setExpanded] = useState<string | null>(null);
  const visible = useMemo(() => products.filter((p) => p.categoryId === openCat), [products, openCat]);

  function bump(p: PublicMenuItem, delta: number) {
    setCart((c) => {
      const line = c[p._id] ?? { productId: p._id, qty: 0, addonIds: [], notes: '' };
      const qty = Math.max(0, line.qty + delta);
      const next = { ...c, [p._id]: { ...line, qty } };
      if (qty === 0) delete next[p._id];
      return next;
    });
  }
  function toggleAddon(id: string, addonId: string) {
    setCart((c) => {
      const line = c[id] ?? { productId: id, qty: 1, addonIds: [], notes: '' };
      const on = line.addonIds.includes(addonId);
      return { ...c, [id]: { ...line, qty: line.qty || 1, addonIds: on ? line.addonIds.filter((x) => x !== addonId) : [...line.addonIds, addonId] } };
    });
  }
  function setNotes(id: string, notes: string) {
    setCart((c) => ({ ...c, [id]: { ...(c[id] ?? { productId: id, qty: 1, addonIds: [], notes: '' }), qty: (c[id]?.qty ?? 0) || 1, notes } }));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-500 hover:text-ink-900">
          <ArrowLeft size={14} /> {mode === 'DELIVERY' ? 'Home delivery' : 'Choose your seat'}
        </button>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-[11.5px] font-semibold text-ink-600 ring-1 ring-ink-200">
          {mode === 'DELIVERY' ? <MapPin size={11} /> : <Armchair size={11} />}
          {mode === 'DELIVERY' ? 'To your door' : `Table ${seat?.number ?? '—'}`}
        </span>
      </div>

      {closed && (
        <p className="rounded-xl bg-amber-50 px-3.5 py-2.5 text-[12.5px] font-medium text-amber-800 ring-1 ring-amber-200">
          The kitchen is resting right now. Browse away — ordering opens shortly.
        </p>
      )}

      <nav className="sticky top-0 z-20 -mx-1 overflow-x-auto whitespace-nowrap rounded-2xl bg-white/95 px-1.5 py-1.5 shadow-sm ring-1 ring-ink-200/70 backdrop-blur">
        {categories.map((c) => (
          <button
            key={c._id}
            onClick={() => setOpenCat(c._id)}
            className={`mr-1 rounded-xl px-3 py-1.5 text-[13px] font-semibold transition-colors ${
              openCat === c._id ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100'
            }`}
          >
            {c.name}
          </button>
        ))}
      </nav>

      <ul className="space-y-2.5">
        {visible.map((p) => {
          const q = cart[p._id]?.qty ?? 0;
          const open = expanded === p._id;
          const extras = (p.addonIds ?? []).map((id) => addons.find((a) => a._id === id)).filter(Boolean) as typeof addons;
          return (
            <li key={p._id} className="card overflow-hidden">
              <div className="flex gap-3 p-2.5">
                <DishThumb p={p} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <VegDot isVeg={p.isVeg} />
                    <h3 className="min-w-0 truncate text-[14.5px] font-semibold text-ink-900">{p.name}</h3>
                  </div>
                  {p.description && <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-500">{p.description}</p>}
                  <div className="mt-1 flex items-center gap-2 text-[12px]">
                    <span className="font-display text-[14px] font-800 text-ink-900">{inr(p.price)}</span>
                    {!!p.prepMinutes && <span className="text-ink-400">· {p.prepMinutes} min</span>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end justify-between">
                  {q === 0 ? (
                    <button
                      disabled={closed}
                      onClick={() => bump(p, 1)}
                      className="h-8 rounded-lg border border-ember-600/40 bg-ember-50 px-3 text-[13px] font-bold text-ember-700 transition-colors hover:bg-ember-100 disabled:opacity-40"
                    >
                      Add
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-ink-900 p-0.5 text-white">
                      <button onClick={() => bump(p, -1)} className="grid h-7 w-7 place-items-center rounded-md hover:bg-white/10" aria-label="One fewer">
                        <Minus size={13} />
                      </button>
                      <span className="w-5 text-center text-[13px] font-bold tabular-nums">{q}</span>
                      <button onClick={() => bump(p, 1)} className="grid h-7 w-7 place-items-center rounded-md hover:bg-white/10" aria-label="One more">
                        <Plus size={13} />
                      </button>
                    </span>
                  )}
                  <button
                    onClick={() => setExpanded(open ? null : p._id)}
                    className="mt-auto text-[11.5px] font-semibold text-ink-400 hover:text-ember-600"
                  >
                    {open ? 'Close' : extras.length ? 'Add-ons' : 'Note'}
                  </button>
                </div>
              </div>

              {open && (
                <div className="space-y-2.5 border-t border-ink-100 bg-ink-50/60 px-3 py-2.5">
                  {!!extras.length && (
                    <div className="flex flex-wrap gap-1.5">
                      {extras.map((a) => {
                        const on = (cart[p._id]?.addonIds ?? []).includes(a._id);
                        return (
                          <button
                            key={a._id}
                            onClick={() => toggleAddon(p._id, a._id)}
                            className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ring-1 transition-colors ${
                              on ? 'bg-ember-500 text-white ring-ember-600' : 'bg-white text-ink-600 ring-ink-200 hover:bg-ink-50'
                            }`}
                          >
                            {on ? <Check size={10} className="mr-0.5 inline" /> : '+'} {a.name} {inr(a.price)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <input
                    value={cart[p._id]?.notes ?? ''}
                    onChange={(e) => setNotes(p._id, e.target.value)}
                    placeholder="Anything the kitchen should know — extra spicy, no onion…"
                    className="w-full rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-[12.5px] text-ink-800 placeholder:text-ink-400 focus:border-ember-400 focus:outline-none"
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <p className="pt-1 text-center text-[11.5px] leading-relaxed text-ink-500">
        Prices in {data.restaurant.currency}. Taxes of {data.restaurant.taxPercent}%
        {data.restaurant.serviceChargePercent ? ` and a ${data.restaurant.serviceChargePercent}% service charge` : ''} apply.
      </p>
    </div>
  );
}

/** A dish with a photo shows it; a dish without one still looks like part of the menu. */
function DishThumb({ p }: { p: PublicMenuItem }) {
  return <UiDishThumb name={p.name} src={p.imageUrl ? mediaUrl(p.imageUrl) : undefined} isVeg={p.isVeg} />;
}

function CheckoutStage({
  data,
  mode,
  seat,
  lines,
  subtotal,
  onBack,
  onPlaced,
  onSeatedOrder,
  onLostSeat,
}: {
  data: AppMenu;
  mode: Mode;
  seat: Seat | null;
  lines: Line[];
  subtotal: number;
  onBack: () => void;
  onPlaced: (trackingToken: string) => void;
  onSeatedOrder: (sessionToken: string) => void;
  onLostSeat: () => void;
}) {
  const dineIn = mode === 'DINE_IN';
  const saved = savedGuest();
  const [form, setForm] = useState({
    name: saved?.name ?? '',
    phone: saved?.phone ?? '',
    address: saved?.address ?? '',
    city: saved?.city ?? data.restaurant.address?.city ?? '',
    notes: '',
    pay: 'CASH_ON_DELIVERY' as PayMode,
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function place() {
    if (dineIn && !seat) {
      onLostSeat();
      return toast('We lost your table — scan the sticker again', 'error');
    }
    if (!dineIn && form.name.trim().length < 2) return toast('Tell us who this is for', 'error');
    if (!dineIn && form.phone.replace(/\D/g, '').length < 8) return toast('A reachable phone number, please', 'error');
    if (mode === 'DELIVERY' && form.address.trim().length < 8) return toast('Home delivery needs a full address', 'error');

    const items = lines.map((l) => ({ productId: l.productId, qty: l.qty, addonIds: l.addonIds, notes: l.notes || undefined }));
    setBusy(true);
    try {
      if (dineIn && seat) {
        await http.post(`/public/session/${seat.publicToken}/orders`, {
          items,
          customerName: form.name.trim().slice(0, 80) || undefined,
          notes: form.notes.trim() || undefined,
        });
        rememberName(form.name.trim());
        onSeatedOrder(seat.publicToken);
      } else {
        const { data: res } = await http.post<AppOrderResult>(`/public/apps/orders/${data.restaurant.slug}`, {
          fulfilment: mode,
          paymentMode: form.pay,
          customerName: form.name.trim(),
          customerPhone: form.phone.trim(),
          customerAddress: mode === 'DELIVERY' ? form.address.trim() : '',
          customerCity: form.city.trim(),
          notes: form.notes.trim() || undefined,
          items,
        });
        localStorage.setItem(
          GUEST_KEY,
          JSON.stringify({ name: form.name, phone: form.phone, address: form.address, city: form.city }),
        );
        onPlaced(res.order.trackingToken);
      }
      invalidate(`app:menu:${data.restaurant.slug}`);
    } catch (e) {
      const message = errMsg(e, 'Could not place that order');
      toast(message, 'error');
      if (dineIn && /closed|already been issued|table session|match/i.test(message)) onLostSeat();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-500 hover:text-ink-900">
        <ArrowLeft size={14} /> Back to the menu
      </button>

      {seat && (
        <div className="card flex items-center gap-3 p-3.5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-900 font-display text-[13px] font-800 text-ember-400">
            {seat.number}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-[14px] font-bold text-ink-900">Table {seat.number} · {seat.section}</p>
            <p className="text-[12px] text-ink-500">{seat.guests} guest{seat.guests > 1 ? 's' : ''} · the bill comes to the table</p>
          </div>
          <button
            onClick={onLostSeat}
            className="shrink-0 text-[11.5px] font-semibold text-ink-400 hover:text-ember-600"
          >
            Change seat
          </button>
        </div>
      )}

      <div className="card space-y-3 p-4">
        <h2 className="font-display text-[16px] font-800 text-ink-900">
          {dineIn ? 'Who is at the table?' : 'Where is it going?'}
        </h2>
        <Field label="Your name">
          <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Anita Kulkarni" className={inputCls} />
        </Field>
        {!dineIn && (
          <Field label="Phone">
            <input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="+91 98200 12345" className={inputCls} />
          </Field>
        )}
        {mode === 'DELIVERY' && (
          <>
            <Field label="Delivery address">
              <textarea value={form.address} onChange={(e) => set('address', e.target.value)} rows={3} placeholder="Flat 402, Aishwaryam Residency, Kalyani Nagar" className={inputCls} />
            </Field>
            <Field label="City">
              <input value={form.city} onChange={(e) => set('city', e.target.value)} className={inputCls} />
            </Field>
          </>
        )}
        <Field label="Note for the kitchen">
          <input
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
            placeholder={dineIn ? 'Serve the drinks first' : 'Ring the bell twice'}
            className={inputCls}
          />
        </Field>
      </div>

      {!dineIn && (
        <div className="card p-4">
          <h2 className="font-display text-[16px] font-800 text-ink-900">Payment</h2>
          <p className="mt-0.5 text-[12px] text-ink-500">
            Nothing is charged from this screen. Settle it by UPI or card below, or hand the cash to the rider.
          </p>
          <div className="mt-3 space-y-2">
            <PayOption
              icon={<QrCode size={16} />}
              title="UPI"
              body="A scannable QR with the exact amount, ready the moment the order is in."
              active={form.pay === 'UPI'}
              onClick={() => set('pay', 'UPI')}
            />
            <PayOption
              icon={<CreditCard size={16} />}
              title="Card"
              body="Opens on the restaurant's secure checkout. No card number is ever typed here."
              active={form.pay === 'CARD'}
              onClick={() => set('pay', 'CARD')}
            />
            <PayOption
              icon={<Banknote size={16} />}
              title="Cash on delivery"
              body="Hand the money to the rider when the bag arrives."
              active={form.pay === 'CASH_ON_DELIVERY'}
              onClick={() => set('pay', 'CASH_ON_DELIVERY')}
            />
          </div>
        </div>
      )}

      {dineIn && (
        <p className="rounded-xl bg-ink-100 px-3.5 py-2.5 text-[12px] leading-snug text-ink-600">
          Your waiter already knows you are seated. Each round lands on this table and adds to one bill — tap
          <span className="font-semibold"> Bill please</span> on the table screen when you are ready to close out.
        </p>
      )}

      <div className="card divide-y divide-ink-100">
        {lines.map((l, i) => {
          const p = data.products.find((x) => x._id === l.productId);
          const extras = l.addonIds.reduce((a, id) => a + (data.addons.find((x) => x._id === id)?.price ?? 0), 0);
          if (!p) return null;
          return (
            <div key={i} className="flex items-start gap-2.5 px-3.5 py-2.5">
              <DishThumb p={p} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold text-ink-900">{p.name}</p>
                {!!l.addonIds.length && (
                  <p className="text-[11.5px] text-ink-500">
                    + {l.addonIds.map((id) => data.addons.find((a) => a._id === id)?.name ?? '').filter(Boolean).join(', ')}
                  </p>
                )}
                {l.notes && <p className="text-[11.5px] text-amber-700">{l.notes}</p>}
              </div>
              <span className="shrink-0 text-[13px] font-semibold tabular-nums text-ink-700">{l.qty} × {inr(p.price + extras)}</span>
            </div>
          );
        })}
        <div className="flex items-center justify-between px-3.5 py-3">
          <span className="text-[12.5px] text-ink-500">{dineIn ? 'This round' : 'Food total'}</span>
          <span className="font-display text-[16px] font-800 tabular-nums text-ink-900">{inr(subtotal)}</span>
        </div>
      </div>

      <button
        onClick={() => void place()}
        disabled={busy}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-ember-600/40 bg-ember-500 text-[15px] font-bold text-white shadow-sm transition-[background,transform] hover:bg-ember-600 active:scale-[0.99] disabled:opacity-60"
      >
        {dineIn ? <Armchair size={17} /> : <Smartphone size={17} />}
        {busy ? 'Sending to the kitchen…' : dineIn ? `Send to Table ${seat?.number ?? ''}` : 'Confirm order'}
      </button>
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-ink-200 bg-white px-3 py-2 text-[13.5px] text-ink-900 placeholder:text-ink-400 focus:border-ember-400 focus:outline-none';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function PayOption({
  icon,
  title,
  body,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-start gap-3 rounded-xl px-3 py-2.5 text-left ring-1 transition-colors ${
        active ? 'bg-ink-50 ring-ink-900' : 'bg-white ring-ink-200 hover:bg-ink-50'
      }`}
    >
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${active ? 'bg-ink-900 text-ember-400' : 'bg-ink-100 text-ink-500'}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold text-ink-900">{title}</span>
        <span className="block text-[11.5px] leading-snug text-ink-500">{body}</span>
      </span>
      <span className={`mt-1 grid h-4 w-4 shrink-0 place-items-center rounded-full ring-1 ${active ? 'bg-ink-900 ring-ink-900' : 'ring-ink-300'}`}>
        {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
      </span>
    </button>
  );
}
