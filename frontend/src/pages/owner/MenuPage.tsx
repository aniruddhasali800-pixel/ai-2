import { useMemo, useState } from 'react';
import { ImagePlus, Plus, Trash2, Pencil, Star } from 'lucide-react';
import { useQuery, invalidate, patch } from '../../lib/query';
import { http, errMsg, mediaUrl } from '../../lib/api';
import type { Addon, Category, MenuBundle, Product, Station } from '../../lib/types';
import { Button, Card, EmptyState, Field, Input, Modal, Pill, Select, Textarea, Toggle, VegDot } from '../../components/ui';
import { ImagePicker } from '../../components/ImagePicker';
import { inr } from '../../lib/format';
import { stationLabel } from '../../lib/statusMaps';
import { can } from '../../store/auth';
import { useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';

const STATION_LIST: Station[] = ['MAIN', 'GRILL', 'FRY', 'TANDOOR', 'BAR', 'DESSERT'];

export function MenuPage() {
  const { user } = useAuth();
  const editable = can(user?.role, 'menu:write');
  const { data, loading } = useQuery<MenuBundle>('menu', '/menu');
  const [tab, setTab] = useState<'items' | 'categories' | 'addons'>('items');
  const [catFilter, setCatFilter] = useState('');
  const [editing, setEditing] = useState<Product | 'new' | null>(null);
  const [catModal, setCatModal] = useState<Category | 'new' | null>(null);
  const [addonModal, setAddonModal] = useState<Addon | 'new' | null>(null);

  const products = useMemo(() => {
    let list = data?.products ?? [];
    if (catFilter) list = list.filter((p) => p.categoryId === catFilter);
    return list;
  }, [data, catFilter]);

  if (loading && !data) return <Card><p className="p-8 text-center text-[13px] text-ink-500">Loading menu…</p></Card>;
  if (!data) return <EmptyState title="Menu unavailable" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-xl bg-ink-200/70 p-1 text-sm">
          {(['items', 'categories', 'addons'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded-lg px-3 py-1.5 font-semibold capitalize ${tab === t ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600'}`}>
              {t}
            </button>
          ))}
        </div>
        {editable && (
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => (tab === 'items' ? setEditing('new') : tab === 'categories' ? setCatModal('new') : setAddonModal('new'))}>
            Add {tab === 'items' ? 'item' : tab === 'categories' ? 'category' : 'add-on'}
          </Button>
        )}
      </div>

      {tab === 'items' && (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1">
            <Chip active={!catFilter} onClick={() => setCatFilter('')}>All ({data.products.length})</Chip>
            {data.categories.map((c) => (
              <Chip key={c._id} active={catFilter === c._id} onClick={() => setCatFilter(c._id)}>
                {c.name} ({data.products.filter((p) => p.categoryId === c._id).length})
              </Chip>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {products.map((p) => (
              <article key={p._id} className={`card flex flex-col overflow-hidden ${!p.isActive ? 'opacity-55' : ''}`}>
                <div className="flex items-center gap-3 p-3">
                  <Thumb url={p.imageUrl} veg={p.isVeg} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <VegDot isVeg={p.isVeg} />
                      <h3 className="truncate font-display text-[15px] font-700 text-ink-900">{p.name}</h3>
                    </div>
                    <p className="mt-0.5 truncate text-[12px] text-ink-500">{data.categories.find((c) => c._id === p.categoryId)?.name} · {stationLabel(p.station)}</p>
                  </div>
                  <span className="shrink-0 font-display text-[15px] font-800 text-ink-900">{inr(p.price)}</span>
                </div>
                {p.description && <p className="px-3 text-[12px] leading-snug text-ink-500">{p.description}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-1.5 px-3 pb-3 pt-1">
                  <Pill className="bg-ink-100 text-ink-600 ring-ink-200">{p.prepMinutes}m</Pill>
                  {p.taxPercent != null && <Pill className="bg-ink-100 text-ink-600 ring-ink-200">GST {p.taxPercent}%</Pill>}
                  {p.tags?.slice(0, 2).map((t) => <Pill key={t} className="bg-ember-50 text-ember-700 ring-ember-200"><Star size={9} />{t}</Pill>)}
                  {!p.isActive && <Pill className="bg-stone-100 text-stone-600 ring-stone-300">Hidden</Pill>}
                  {editable && (
                    <div className="ml-auto flex gap-1">
                      <button onClick={() => setEditing(p)} className="rounded-md p-1.5 text-ink-400 hover:bg-ink-100 hover:text-ink-800"><Pencil size={14} /></button>
                      {p.isActive ? (
                        <Toggle checked onChange={() => toggleActive(p)} label="Hide from menu" />
                      ) : (
                        <button
                          onClick={() => toggleActive(p)}
                          className="rounded-md px-2 py-1 text-[10px] font-semibold uppercase text-stone-500 hover:bg-ink-100"
                          title="Reveal on menu"
                        >
                          off
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </>
      )}

      {tab === 'categories' && (
        <Card>
          <ul className="divide-y divide-ink-100">
            {data.categories.map((c) => (
              <li key={c._id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink-900">{c.name}</p>
                  <p className="text-[12px] text-ink-500">{data.products.filter((p) => p.categoryId === c._id).length} items · order {c.sortOrder}</p>
                </div>
                {!c.isActive && <Pill className="bg-stone-100 text-stone-600 ring-stone-300">Hidden</Pill>}
                {editable && (
                  <>
                    <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setCatModal(c)}>Edit</Button>
                    <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => removeCategory(c)}>Delete</Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {tab === 'addons' && (
        <Card>
          <ul className="divide-y divide-ink-100">
            {data.addons.map((a) => (
              <li key={a._id} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1 font-medium text-ink-900">{a.name}</span>
                {!a.isActive && <Pill className="bg-stone-100 text-stone-600 ring-stone-300">Off</Pill>}
                <span className="font-display font-700 text-ink-900">{inr(a.price)}</span>
                {editable && <Button size="sm" variant="ghost" icon={<Pencil size={13} />} onClick={() => setAddonModal(a)}>Edit</Button>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {editing && <ProductModal product={editing} categories={data.categories} addons={data.addons} onClose={() => setEditing(null)} />}
      {catModal && <CategoryModal category={catModal} onClose={() => setCatModal(null)} />}
      {addonModal && <AddonModal addon={addonModal} onClose={() => setAddonModal(null)} />}
    </div>
  );
}

async function toggleActive(p: Product) {
  patch<MenuBundle>('menu', (cur) => (cur ? { ...cur, products: cur.products.map((x) => (x._id === p._id ? { ...x, isActive: !x.isActive } : x)) } : cur));
  try {
    await http.patch(`/menu/products/${p._id}`, { isActive: !p.isActive });
    invalidate('menu');
  } catch (e) {
    toast(errMsg(e, 'Could not update item'), 'error');
    invalidate('menu');
  }
}

async function removeCategory(c: Category) {
  if (!window.confirm(`Delete category "${c.name}"?`)) return;
  try {
    await http.delete(`/menu/categories/${c._id}`);
    toast('Category removed', 'success');
    invalidate('menu');
  } catch (e) {
    toast(errMsg(e, 'Could not delete category'), 'error');
  }
}

function Chip({ children, active, onClick }: { children: React.ReactNode; active?: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold ring-1 ring-inset transition-colors ${active ? 'bg-ink-900 text-white ring-ink-900' : 'bg-white text-ink-600 ring-ink-200 hover:bg-ink-50'}`}>
      {children}
    </button>
  );
}

function Thumb({ url, veg }: { url: string; veg: boolean }) {
  if (!url) return <div className={`grid h-12 w-12 shrink-0 place-items-center rounded-lg ${veg ? 'bg-leaf-100 text-leaf-600' : 'bg-red-50 text-red-600'}`}><ImagePlus size={18} /></div>;
  return <img src={mediaUrl(url)} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover ring-1 ring-ink-200" />;
}

function ProductModal({ product, categories, addons, onClose }: { product: Product | 'new'; categories: Category[]; addons: Addon[]; onClose: () => void }) {
  const isNew = product === 'new';
  const p = isNew ? null : (product as Product);
  const [form, setForm] = useState({
    name: p?.name ?? '',
    categoryId: p?.categoryId ?? categories[0]?._id ?? '',
    description: p?.description ?? '',
    price: p?.price == null ? '' : String(p.price),
    imageUrl: p?.imageUrl ?? '',
    isVeg: p?.isVeg ?? true,
    station: (p?.station ?? 'MAIN') as Station,
    prepMinutes: String(p?.prepMinutes ?? 15),
    taxPercent: p?.taxPercent ?? null,
    tags: (p?.tags ?? []).join(', '),
    addonIds: p?.addonIds ?? [],
  });
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const set = (k: keyof typeof form, v: unknown) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors([]);
  };

  /**
   * Checked here because a rejected request would otherwise arrive as "Some fields are invalid" and the
   * owner would have no idea which box to fix.
   */
  function problems(): string[] {
    const price = Number(form.price);
    const prep = Number(form.prepMinutes);
    const tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
    const out: string[] = [];
    if (form.name.trim().length < 2) out.push('Give the item a name of at least two letters.');
    if (!form.categoryId) out.push('This kitchen has no category to file the item under — add one on the Categories tab first.');
    if (form.price.trim() === '' || Number.isNaN(price) || price < 0) out.push('Add a price, or 0 if the item is free.');
    if (form.prepMinutes.trim() !== '' && (!Number.isInteger(prep) || prep < 1 || prep > 180)) {
      out.push('Prep time is a whole number of minutes between 1 and 180.');
    }
    if (form.taxPercent !== null && Number.isNaN(Number(form.taxPercent))) out.push('GST is a number between 0 and 28, or blank for the restaurant default.');
    if (form.taxPercent != null && (Number(form.taxPercent) < 0 || Number(form.taxPercent) > 28)) out.push('GST is between 0 and 28 percent.');
    if (tags.length > 12) out.push('Twelve tags is the most one item can carry.');
    if (tags.some((t) => t.length > 24)) out.push('Keep every tag to 24 characters or fewer.');
    return out;
  }

  async function save() {
    const blocking = problems();
    if (blocking.length) {
      setErrors(blocking);
      return;
    }
    setBusy(true);
    try {
      const body = {
        ...form,
        name: form.name.trim(),
        price: Number(form.price),
        // A cleared prep field asks for the default rather than zero minutes, which the kitchen rejects.
        prepMinutes: form.prepMinutes.trim() === '' ? undefined : Number(form.prepMinutes),
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      };
      if (isNew) await http.post('/menu/products', body);
      else await http.patch(`/menu/products/${(p as Product)._id}`, body);
      toast(isNew ? 'Item added' : 'Item updated', 'success');
      invalidate('menu');
      onClose();
    } catch (e) {
      setErrors([errMsg(e, 'Could not save item')]);
      toast(errMsg(e, 'Could not save item'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? 'New menu item' : 'Edit item'} width="max-w-2xl" footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save item</Button></>}>
      <div className="grid gap-3.5 sm:grid-cols-2">
        {errors.length > 0 && (
          <div className="sm:col-span-2 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700 ring-1 ring-red-200">
            <ul className="list-disc space-y-0.5 pl-4">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        )}
        <Field label="Name" required className="sm:col-span-2"><Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Butter chicken" /></Field>
        <Field label="Category"><Select value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>{categories.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}</Select></Field>
        <Field label="Price (₹)" required><Input type="number" min={0} value={form.price} onChange={(e) => set('price', e.target.value)} placeholder="e.g. 260" /></Field>
        <Field label="Station"><Select value={form.station} onChange={(e) => set('station', e.target.value)}>{STATION_LIST.map((s) => <option key={s} value={s}>{stationLabel(s)}</option>)}</Select></Field>
        <Field label="Prep time (min)" hint="Blank means the kitchen default of 15 minutes."><Input type="number" min={1} max={180} value={form.prepMinutes} onChange={(e) => set('prepMinutes', e.target.value)} /></Field>
        <Field label="GST % (blank = default)"><Input type="number" min={0} max={28} value={form.taxPercent ?? ''} onChange={(e) => set('taxPercent', e.target.value === '' ? null : Number(e.target.value))} /></Field>
        <ImagePicker label="Dish photo" value={form.imageUrl} onChange={(v) => set('imageUrl', v)} className="sm:col-span-2" />
        <Field label="Description" className="sm:col-span-2"><Textarea value={form.description} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="Tags (comma separated)" className="sm:col-span-2"><Input value={form.tags} onChange={(e) => set('tags', e.target.value)} placeholder="signature, spicy" /></Field>
        <Field label="Add-ons" className="sm:col-span-2">
          <div className="flex flex-wrap gap-2">
            {addons.map((a) => {
              const on = form.addonIds.includes(a._id);
              return (
                <button key={a._id} onClick={() => set('addonIds', on ? form.addonIds.filter((x) => x !== a._id) : [...form.addonIds, a._id])}
                  className={`rounded-full px-3 py-1.5 text-[12.5px] font-semibold ring-1 ring-inset ${on ? 'bg-ember-500 text-white ring-ember-500' : 'bg-white text-ink-600 ring-ink-200'}`}>
                  {a.name} +{inr(a.price)}
                </button>
              );
            })}
          </div>
        </Field>
        <div className="sm:col-span-2"><Toggle checked={form.isVeg} onChange={(v) => set('isVeg', v)} label="Vegetarian" /></div>
      </div>
    </Modal>
  );
}

function CategoryModal({ category, onClose }: { category: Category | 'new'; onClose: () => void }) {
  const isNew = category === 'new';
  const c = isNew ? null : (category as Category);
  const [form, setForm] = useState({ name: c?.name ?? '', description: c?.description ?? '', sortOrder: c?.sortOrder ?? 0, isActive: c?.isActive ?? true });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      if (isNew) await http.post('/menu/categories', form);
      else await http.patch(`/menu/categories/${(c as Category)._id}`, form);
      toast('Category saved', 'success');
      invalidate('menu');
      onClose();
    } catch (e) { toast(errMsg(e, 'Could not save'), 'error'); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={isNew ? 'New category' : 'Edit category'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="space-y-3.5">
        <Field label="Name" required><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
        <Field label="Description"><Input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></Field>
        <Field label="Sort order"><Input type="number" value={form.sortOrder} onChange={(e) => setForm((f) => ({ ...f, sortOrder: Number(e.target.value) }))} /></Field>
        <Toggle checked={form.isActive} onChange={(v) => setForm((f) => ({ ...f, isActive: v }))} label="Visible on menu" />
      </div>
    </Modal>
  );
}

function AddonModal({ addon, onClose }: { addon: Addon | 'new'; onClose: () => void }) {
  const isNew = addon === 'new';
  const a = isNew ? null : (addon as Addon);
  const [form, setForm] = useState({ name: a?.name ?? '', price: a?.price ?? 0, isActive: a?.isActive ?? true });
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      if (isNew) await http.post('/menu/addons', form);
      else await http.patch(`/menu/addons/${(a as Addon)._id}`, form);
      toast('Add-on saved', 'success');
      invalidate('menu');
      onClose();
    } catch (e) { toast(errMsg(e, 'Could not save'), 'error'); } finally { setBusy(false); }
  }
  return (
    <Modal open onClose={onClose} title={isNew ? 'New add-on' : 'Edit add-on'} footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="space-y-3.5">
        <Field label="Name" required><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} /></Field>
        <Field label="Price (₹)"><Input type="number" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: Number(e.target.value) }))} /></Field>
        <Toggle checked={form.isActive} onChange={(v) => setForm((f) => ({ ...f, isActive: v }))} label="Active" />
      </div>
    </Modal>
  );
}
