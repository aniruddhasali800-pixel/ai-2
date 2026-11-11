import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, Minus, Plus, ShoppingBag, Store, UtensilsCrossed } from 'lucide-react';
import { useQuery } from '../../lib/query';
import { http, errMsg, mediaUrl } from '../../lib/api';
import type { GuestMenu as GuestMenuData } from '../../lib/types';
import { inr } from '../../lib/format';
import { Button, Spinner, VegDot } from '../../components/ui';
import { toast } from '../../store/toasts';

interface Line {
  productId: string;
  qty: number;
  addonIds: string[];
  notes: string;
}

export function GuestMenu() {
  const { tableToken = '' } = useParams();
  const navigate = useNavigate();
  const { data, loading, error } = useQuery<GuestMenuData>(`guest:menu:${tableToken}`, `/public/menu/${tableToken}`);
  const [openCat, setOpenCat] = useState<string | null>(null);
  const [cart, setCart] = useState<Record<string, Line>>({});
  const [starting, setStarting] = useState(false);

  const products = data?.products ?? [];
  const categories = data?.categories ?? [];
  const activeCat = openCat ?? categories[0]?._id ?? '';
  const visible = useMemo(() => products.filter((p) => p.categoryId === activeCat), [products, activeCat]);

  const cartLines = Object.values(cart).filter((l) => l.qty > 0);
  const cartCount = cartLines.reduce((n, l) => n + l.qty, 0);
  const cartTotal = cartLines.reduce((sum, l) => {
    const p = products.find((x) => x._id === l.productId);
    const addons = l.addonIds.reduce((a, id) => a + (data?.addons.find((x) => x._id === id)?.price ?? 0), 0);
    return sum + ((p?.price ?? 0) + addons) * l.qty;
  }, 0);

  function qtyOf(id: string) {
    return cart[id]?.qty ?? 0;
  }
  function bump(p: { _id: string; price: number }, delta: number) {
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
      const has = line.addonIds.includes(addonId);
      return { ...c, [id]: { ...line, addonIds: has ? line.addonIds.filter((a) => a !== addonId) : [...line.addonIds, addonId] } };
    });
  }

  async function startOrdering() {
    if (!cartLines.length) return;
    setStarting(true);
    try {
      let token = data?.session?.publicToken;
      if (!token) {
        const { data: res } = await http.post<{ session: { publicToken: string } }>('/public/table-sessions', {
          tableToken,
        });
        token = res.session.publicToken;
      }
      const items = cartLines.map((l) => ({ productId: l.productId, qty: l.qty, addonIds: l.addonIds, notes: l.notes || undefined }));
      await http.post(`/public/session/${token}/orders`, { items });
      navigate(`/s/${token}`);
    } catch (e) {
      toast(errMsg(e, 'Could not send your order'), 'error');
    } finally {
      setStarting(false);
    }
  }

  if (loading && !data) return <Spinner label="Opening the menu…" />;
  if (error) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 text-center">
        <Store size={26} className="mx-auto mb-3 text-ink-300" />
        <p className="font-display text-lg font-700 text-ink-900">Menu unavailable</p>
        <p className="mt-1.5 text-sm text-ink-500">{error}</p>
      </div>
    );
  }

  const r = data!.restaurant;
  const closed = !r.acceptingOrders;

  return (
    <div className="min-h-screen bg-ink-50 pb-32">
      <header className="relative overflow-hidden bg-ink-900 px-5 pb-14 pt-6 text-white">
        <div className="flex items-center gap-2 text-[12px] font-semibold text-ink-300">
          <Link to={`/t/${tableToken}`} className="inline-flex items-center gap-1 hover:text-white">
            <ArrowLeft size={14} /> {r.name}
          </Link>
        </div>
        <h1 className="mt-6 font-display text-[26px] font-800 leading-tight tracking-tight">{r.branding?.tagline ?? 'Order from your table'}</h1>
        <p className="mt-1.5 text-[13px] text-ink-300">
          Table {data!.table.number}
          {data!.table.section ? ` · ${data!.table.section}` : ''} · {data!.table.status === 'AVAILABLE' ? 'just seated' : 'welcome back'}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-[12px] text-ink-400">
          <span className="inline-flex items-center gap-1.5">
            <Clock size={13} /> {r.hours?.open}–{r.hours?.close}
          </span>
          {r.phone && <span>☎ {r.phone}</span>}
          {r.address?.city && <span>{r.address.city}</span>}
        </div>
        {closed && (
          <p className="mt-4 rounded-xl bg-amber-400/15 px-3 py-2 text-[13px] font-medium text-amber-200">
            The kitchen is resting right now. Browse away — ordering opens shortly.
          </p>
        )}
      </header>

      <nav className="sticky top-0 z-20 -mt-8 overflow-x-auto whitespace-nowrap rounded-2xl bg-white px-2 py-2 shadow-md ring-1 ring-ink-200/70">
        {categories.map((c) => (
          <button
            key={c._id}
            onClick={() => setOpenCat(c._id)}
            className={`mr-1 rounded-xl px-3 py-1.5 text-[13px] font-semibold transition-colors ${
              activeCat === c._id ? 'bg-ink-900 text-white' : 'text-ink-600 hover:bg-ink-100'
            }`}
          >
            {c.name}
          </button>
        ))}
      </nav>

      <main className="mx-auto max-w-2xl px-4">
        <h2 className="mb-2 mt-6 font-display text-[17px] font-700 text-ink-900">
          {categories.find((c) => c._id === activeCat)?.name ?? 'Menu'}
        </h2>
        <ul className="divide-y divide-ink-100 overflow-hidden rounded-2xl bg-white ring-1 ring-ink-200/70">
          {visible.map((p) => {
            const q = qtyOf(p._id);
            const addons = (p.addonIds ?? []).map((id) => data!.addons.find((a) => a._id === id)).filter(Boolean) as { _id: string; name: string; price: number }[];
            return (
              <li key={p._id} className="px-4 py-3.5">
                <div className="flex items-start gap-3">
                  {p.imageUrl ? (
                    <img src={mediaUrl(p.imageUrl)} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
                  ) : (
                    <span className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-ink-100 text-ink-300">
                      <UtensilsCrossed size={19} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <VegDot isVeg={p.isVeg} />
                      <span className="min-w-0 truncate text-[14.5px] font-semibold text-ink-900">{p.name}</span>
                    </div>
                    {p.description && <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-ink-500">{p.description}</p>}
                    <div className="mt-1.5 flex items-center gap-2 text-[12.5px]">
                      <span className="font-display font-700 text-ink-900">{inr(p.price)}</span>
                      {!!p.prepMinutes && <span className="text-ink-400">· {p.prepMinutes} min</span>}
                      {!!p.tags?.length && (
                        <span className="truncate text-ink-400">· {p.tags.slice(0, 2).join(', ')}</span>
                      )}
                    </div>
                    {!!addons.length && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {addons.map((a) => {
                          const on = (cart[p._id]?.addonIds ?? []).includes(a._id);
                          return (
                            <button
                              key={a._id}
                              onClick={() => toggleAddon(p._id, a._id)}
                              className={`rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 transition-colors ${
                                on ? 'bg-ember-500 text-white ring-ember-600' : 'bg-white text-ink-600 ring-ink-200 hover:bg-ink-50'
                              }`}
                            >
                              {on ? '✓' : '+'} {a.name} {inr(a.price)}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
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
                  </div>
                </div>
              </li>
            );
          })}
          {!visible.length && (
            <li className="px-4 py-10 text-center text-[13px] text-ink-500">Nothing on this section yet.</li>
          )}
        </ul>

        <p className="mt-4 text-center text-[11.5px] leading-relaxed text-ink-500">
          Prices in {r.currency}. Taxes of {r.taxPercent}%{r.serviceChargePercent ? ` and a ${r.serviceChargePercent}% service charge` : ''} apply.
          <br />
          <Link to={`/book/${r.slug}`} className="font-semibold text-ember-600 underline-offset-2 hover:underline">
            Book a table
          </Link>
        </p>
      </main>

      {!!cartCount && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-ink-200 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-ember-50 text-ember-600">
              <ShoppingBag size={17} />
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-[13px] font-semibold text-ink-900">{cartCount} item{cartCount > 1 ? 's' : ''}</p>
              <p className="text-[12px] text-ink-500">{inr(cartTotal)} before taxes</p>
            </div>
            <Button variant="primary" loading={starting} onClick={startOrdering} className="px-5">
              Place order
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
