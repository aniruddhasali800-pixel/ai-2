import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Minus, Plus, ShoppingBag, ShoppingBasket, Trash2, Users } from 'lucide-react';
import { invalidate, useQuery } from '../../lib/query';
import { http, errMsg } from '../../lib/api';
import type { MenuBundle, Order, Table, WaiterTable } from '../../lib/types';
import { inr } from '../../lib/format';
import { Button, Field, Input, Select, Spinner, VegDot } from '../../components/ui';
import { useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';

interface Draft {
  productId: string;
  name: string;
  price: number;
  qty: number;
  addonIds: string[];
  notes: string;
}

export function NewOrder() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { restaurant, user } = useAuth();
  const presetTable = params.get('table');
  const { data: menu, loading: menuLoading } = useQuery<MenuBundle>('menu', '/menu');
  const { data: floor } = useQuery<{ data: WaiterTable[] }>('floor:map', '/waiters/map');
  const { data: bare } = useQuery<{ data: Table[] }>('tables', '/tables');

  const [tableId, setTableId] = useState(presetTable ?? '');
  const [takeaway, setTakeaway] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [customerCity, setCustomerCity] = useState(restaurant?.address?.city ?? '');
  const [notes, setNotes] = useState('');
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft[]>([]);
  const [busy, setBusy] = useState(false);

  const products = menu?.products ?? [];
  const categories = (menu?.categories ?? []).filter((c) => products.some((p) => p.categoryId === c._id && c.isActive));
  const cat = activeCat ?? categories[0]?._id ?? '';
  const list = useMemo(() => products.filter((p) => p.categoryId === cat && p.isActive), [products, cat]);

  const isWaiter = user?.role === 'WAITER';
  const tables = (floor?.data ?? bare?.data ?? []) as (WaiterTable & { session?: { customerName?: string } | null })[];
  const seatable = tables.filter((t) => t.session || t.status === 'AVAILABLE' || t.status === 'RESERVED');

  // Every waiter works every table. The name on one says who opened the party, and a punch here
  // joins the ticket already running rather than starting a second one.
  const selectedTable = tableId ? tables.find((t) => t._id === tableId) : null;
  const otherWaiterTable =
    isWaiter && selectedTable?.assignedWaiterId && !selectedTable.mine ? (selectedTable as WaiterTable) : null;

  const total = draft.reduce((sum, d) => {
    const addons = d.addonIds.reduce((a, id) => a + (menu?.addons.find((x) => x._id === id)?.price ?? 0), 0);
    return sum + (d.price + addons) * d.qty;
  }, 0);

  function addLine(p: { _id: string; name: string; price: number }, addonId?: string) {
    setDraft((d) => {
      const idx = d.findIndex((x) => x.productId === p._id && !x.addonIds.length);
      if (idx >= 0 && !addonId) return d.map((x, i) => (i === idx ? { ...x, qty: x.qty + 1 } : x));
      return [...d, { productId: p._id, name: p.name, price: p.price, qty: 1, addonIds: addonId ? [addonId] : [], notes: '' }];
    });
  }
  function bumpLine(i: number, delta: number) {
    setDraft((d) => d.map((x, idx) => (idx === i ? { ...x, qty: Math.max(0, x.qty + delta) } : x)).filter((x) => x.qty > 0));
  }
  function toggleAddon(addonId: string, productId: string) {
    setDraft((d) => d.map((x) => {
      if (x.productId !== productId || !x.addonIds.includes(addonId)) return x;
      const addonIds = x.addonIds.filter((a) => a !== addonId);
      return addonIds.length || x.qty > 1 ? { ...x, addonIds } : null;
    }).filter(Boolean) as Draft[]);
  }

  async function place() {
    if (!draft.length) return;
    if (!takeaway && !tableId) { toast('Pick the table this goes to', 'error'); return; }
    setBusy(true);
    try {
      const body = {
        source: takeaway ? 'CASHIER' : 'DINE_IN_WAITER',
        tableId: takeaway ? null : tableId,
        tableSessionId: takeaway ? null : (tables.find((t) => t._id === tableId)?.activeSessionId ?? null),
        customerName: customerName || (takeaway ? 'Takeaway' : ''),
        ...(takeaway
          ? { customerPhone, customerAddress, customerCity }
          : {}),
        notes: notes || undefined,
        items: draft.map((d) => ({ productId: d.productId, qty: d.qty, addonIds: d.addonIds, notes: d.notes || undefined })),
      };
      const { data } = await http.post<Order & { merged?: boolean }>('/orders', body);
      invalidate('orders');
      invalidate('floor');
      invalidate('kds');
      invalidate('tables');
      toast(
        data.merged
          ? `Added to ${data.orderNumber} — that table has one fire running`
          : `${data.orderNumber} sent to the kitchen`,
        'success',
      );
      setDraft([]);
      setNotes('');
      if (takeaway) { setCustomerName(''); setCustomerPhone(''); setCustomerAddress(''); }
      navigate(takeaway ? '/pos' : '/floor');
    } catch (e) {
      toast(errMsg(e, 'The kitchen did not receive that'), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (menuLoading && !menu) return <Spinner label="Loading the menu…" />;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-3.5 ring-1 ring-ink-200">
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-[12rem] flex-1">
            <span className="label">Destination</span>
            <Select value={takeaway ? 'takeaway' : tableId} onChange={(e) => {
              if (e.target.value === 'takeaway') { setTakeaway(true); setTableId(''); }
              else { setTakeaway(false); setTableId(e.target.value); }
            }}>
              <option value="">Choose a table…</option>
              {seatable.map((t) => {
                const waiterName = (t as WaiterTable).assignedWaiterName;
                const named = waiterName && !(t as WaiterTable).mine ? ` · with ${waiterName}` : '';
                return (
                  <option key={t._id} value={t._id}>
                    {`Table ${t.number} · ${t.section}${t.session ? ` · ${(t.session as { customerName?: string }).customerName || 'seated'}` : ' · free'}${named}`}
                  </option>
                );
              })}
              <option value="takeaway">Takeaway / counter</option>
            </Select>
          </label>
          <Field label={takeaway ? 'Customer name' : 'Label (optional)'} className="min-w-[10rem] flex-1">
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder={takeaway ? 'For the bag' : 'Mr. Mehta'} />
          </Field>
          {takeaway && (
            <Field label="Phone" className="min-w-[9rem] flex-1">
              <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="For pickup call" inputMode="tel" />
            </Field>
          )}
          <Button variant={takeaway ? 'secondary' : 'dark'} size="sm" className="mb-1" onClick={() => { setTakeaway((v) => !v); setTableId(''); }}>
            {takeaway ? 'Switch to table' : 'Takeaway instead'}
          </Button>
        </div>
        {takeaway && (
          <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Field label="Delivery address" hint="Leave blank for counter pickup">
              <Input value={customerAddress} onChange={(e) => setCustomerAddress(e.target.value)} placeholder="Flat 402, Aishwaryam Residency, Kalyani Nagar" />
            </Field>
            <Field label="City">
              <Input value={customerCity} onChange={(e) => setCustomerCity(e.target.value)} placeholder="Pune" />
            </Field>
          </div>
        )}
      </div>

      {otherWaiterTable && !takeaway && (
        <div className="flex items-start gap-2.5 rounded-xl bg-ink-50 px-3.5 py-3 ring-1 ring-ink-200">
          <Users size={15} className="mt-0.5 shrink-0 text-ink-600" />
          <p className="text-[13px] text-ink-700">
            <span className="font-semibold">Table {otherWaiterTable.number} is being run by {otherWaiterTable.assignedWaiterName ?? 'a colleague'}.</span>{' '}
            Anything you punch here lands on the same ticket, so the party is billed once.
          </p>
        </div>
      )}

      <nav className="flex gap-1.5 overflow-x-auto pb-1">
        {categories.map((c) => (
          <button key={c._id} onClick={() => setActiveCat(c._id)}
            className={`shrink-0 rounded-xl px-3 py-1.5 text-[13px] font-semibold transition-colors ${
              cat === c._id ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50'
            }`}>
            {c.name}
          </button>
        ))}
      </nav>

      <ul className="divide-y divide-ink-100 overflow-hidden rounded-2xl bg-white ring-1 ring-ink-200">
        {list.map((p) => (
          <li key={p._id} className="flex items-start gap-3 px-3.5 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5">
                <VegDot isVeg={p.isVeg} />
                <span className="truncate text-[13.5px] font-semibold text-ink-900">{p.name}</span>
              </p>
              <p className="mt-0.5 text-[12px] text-ink-500">{inr(p.price)} · {p.prepMinutes}m · {p.station.toLowerCase()}</p>
              {!!p.addonIds?.length && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {p.addonIds.map((id) => {
                    const a = menu?.addons.find((x) => x._id === id);
                    if (!a) return null;
                    const on = draft.some((d) => d.productId === p._id && d.addonIds.includes(id));
                    return (
                      <button key={id} onClick={() => (on ? toggleAddon(id, p._id) : addLine(p, id))}
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 transition-colors ${on ? 'bg-ember-500 text-white ring-ember-600' : 'bg-white text-ink-600 ring-ink-200 hover:bg-ink-50'}`}>
                        + {a.name} {inr(a.price)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <Button size="sm" variant="secondary" icon={<Plus size={13} />} onClick={() => addLine(p)}>{inr(p.price)}</Button>
          </li>
        ))}
        {!list.length && <li className="px-4 py-10 text-center text-[13px] text-ink-500">Nothing active in this section.</li>}
      </ul>

      {draft.length > 0 && (
        <div className="sticky bottom-20 z-20 rounded-2xl bg-ink-900 p-3.5 text-white shadow-xl lg:bottom-4">
          <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide text-ink-300">
            <ShoppingBasket size={14} /> {draft.reduce((n, d) => n + d.qty, 0)} items
          </p>
          <ul className="mt-2 max-h-40 space-y-1.5 overflow-y-auto">
            {draft.map((d, i) => (
              <li key={`${d.productId}-${i}`} className="flex items-center gap-2 text-[13px]">
                <span className="w-5 text-ink-400">{d.qty}×</span>
                <span className="min-w-0 flex-1 truncate">{d.name}</span>
                {!!d.addonIds.length && <span className="truncate text-[11.5px] text-ink-400">+{d.addonIds.length}</span>}
                <span className="tabular-nums">{inr((d.price + d.addonIds.reduce((a, id) => a + (menu?.addons.find((x) => x._id === id)?.price ?? 0), 0)) * d.qty)}</span>
                <button onClick={() => bumpLine(i, -1)} className="grid h-6 w-6 place-items-center rounded hover:bg-white/10" aria-label="One fewer"><Minus size={12} /></button>
                <button onClick={() => bumpLine(i, 1)} className="grid h-6 w-6 place-items-center rounded hover:bg-white/10" aria-label="One more"><Plus size={12} /></button>
                <button onClick={() => setDraft((x) => x.filter((_, idx) => idx !== i))} className="grid h-6 w-6 place-items-center rounded text-ink-400 hover:bg-white/10" aria-label="Remove"><Trash2 size={12} /></button>
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center gap-2 border-t border-white/10 pt-2.5">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note for the kitchen…" className="h-9 flex-1 bg-white/10 text-white placeholder:text-ink-400" />
            <span className="font-display text-[16px] font-800 tabular-nums">{inr(total)}</span>
            <Button variant="primary" loading={busy} onClick={place} icon={<ShoppingBag size={15} />}>Send</Button>
          </div>
        </div>
      )}
    </div>
  );
}
