import { useState } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, Minus, Plus, Search, TrendingDown } from 'lucide-react';
import { invalidate, useQuery } from '../../lib/query';
import { http, errMsg } from '../../lib/api';
import type { InventoryItem, InventoryTx, InventoryTxType, InventoryUnit } from '../../lib/types';
import { inr, num, dateTime } from '../../lib/format';
import { Button, Card, EmptyState, Field, Input, Modal, Pill, SegmentedControl, Select, Spinner, StatTile } from '../../components/ui';
import { can, useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';

const UNITS: InventoryUnit[] = ['KG', 'G', 'L', 'ML', 'PCS', 'PACKET'];
const TX_LABEL: Record<InventoryTxType, string> = {
  DEDUCTION: 'Used',
  RECEIPT: 'Received',
  ADJUSTMENT: 'Adjusted',
  WASTE: 'Waste',
  RETURN: 'Returned',
};

export function InventoryPage() {
  const { user } = useAuth();
  const writable = can(user?.role, 'inventory:write');
  const [tab, setTab] = useState<'items' | 'moves'>('items');
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [adjusting, setAdjusting] = useState<InventoryItem | null>(null);
  const [adding, setAdding] = useState(false);

  const itemParams: Record<string, unknown> = {};
  if (search) itemParams.search = search;
  if (lowOnly) itemParams.lowOnly = true;

  const { data, loading } = useQuery<{ data: InventoryItem[]; summary: { items: number; lowStock: number; stockValue: number } }>(
    'inventory:items', '/inventory', itemParams,
  );
  const { data: moves, loading: movesLoading } = useQuery<{ data: InventoryTx[]; total: number }>('inventory:tx', '/inventory/transactions', { limit: 60 });

  const items = data?.data ?? [];
  const summary = data?.summary;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Tracked items" value={String(summary?.items ?? 0)} icon={<Boxes size={16} />} />
        <StatTile label="Below reorder" value={String(summary?.lowStock ?? 0)} tone={summary?.lowStock ? 'ember' : 'default'} hint="order from your supplier" icon={<TrendingDown size={16} />} />
        <StatTile label="Stock value" value={inr(summary?.stockValue ?? 0)} tone="leaf" hint="at last cost price" />
      </div>

      <Card
        title={tab === 'items' ? 'Stock on hand' : 'Stock movements'}
        subtitle={tab === 'items' ? 'Recipe usage deducts automatically as orders close' : 'Every receipt, waste entry and adjustment'}
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <SegmentedControl size="sm" value={tab} onChange={setTab} options={[{ value: 'items', label: 'Items' }, { value: 'moves', label: 'Moves' }]} />
            {tab === 'items' && (
              <>
                <div className="relative">
                  <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className="h-8 w-36 pl-7 text-[13px]" />
                </div>
                <button onClick={() => setLowOnly((v) => !v)}
                  className={`h-8 rounded-lg px-2.5 text-[12.5px] font-semibold ring-1 transition-colors ${lowOnly ? 'bg-ember-500 text-white ring-ember-600' : 'bg-white text-ink-600 ring-ink-200 hover:bg-ink-50'}`}>
                  Low only
                </button>
                {writable && <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setAdding(true)}>New item</Button>}
              </>
            )}
          </div>
        }
      >
        {tab === 'items' ? (
          loading && !data ? <Spinner /> : !items.length ? (
            <EmptyState icon={<Boxes size={26} />} title="Nothing tracked" body="Add your first raw material to start counting usage." />
          ) : (
            <ul className="divide-y divide-ink-100">
              {items.map((it) => (
                <li key={it._id} className="flex items-center gap-3 px-3.5 py-3">
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="truncate text-[13.5px] font-semibold text-ink-900">{it.name}</p>
                    <p className="truncate text-[12px] text-ink-500">
                      {it.supplier || 'No supplier'} · {inr(it.costPerUnit)}/{it.unit.toLowerCase()}
                    </p>
                  </div>
                  <div className="w-28 shrink-0 text-right">
                    <p className={`font-display text-[15px] font-800 tabular-nums ${it.isLow ? 'text-red-600' : 'text-ink-900'}`}>
                      {num(it.stock, it.unit === 'G' || it.unit === 'ML' ? 0 : 2)} <span className="text-[11px] font-600 uppercase text-ink-400">{it.unit}</span>
                    </p>
                    <p className="text-[11px] text-ink-400">reorder at {num(it.lowStockThreshold, 0)}</p>
                  </div>
                  <div className="w-16 shrink-0">
                    <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
                      <div
                        className={`h-full rounded-full ${it.isLow ? 'bg-red-500' : 'bg-leaf-500'}`}
                        style={{ width: `${Math.max(4, Math.min(100, (it.stock / Math.max(1, it.lowStockThreshold * 2.5)) * 100))}%` }}
                      />
                    </div>
                  </div>
                  {it.isLow && <Pill className="bg-red-50 text-red-700 ring-red-200"><AlertTriangle size={11} /> Low</Pill>}
                  {writable && (
                    <div className="flex shrink-0 gap-1">
                      <Button size="sm" variant="secondary" onClick={() => setAdjusting(it)}>Adjust</Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(it)}>Edit</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )
        ) : movesLoading && !moves ? <Spinner /> : (
          <ul className="divide-y divide-ink-100">
            {(moves?.data ?? []).map((m) => (
              <li key={m._id} className="flex items-center gap-3 px-3.5 py-2.5 text-[13px]">
                <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${m.qty > 0 && m.type !== 'WASTE' ? 'bg-leaf-50 text-leaf-700' : 'bg-red-50 text-red-700'}`}>
                  {m.type === 'RECEIPT' ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium text-ink-900">{m.itemName}</span>
                <span className="hidden w-24 shrink-0 text-ink-500 sm:block">{TX_LABEL[m.type]}</span>
                <span className="w-20 shrink-0 text-right tabular-nums text-ink-800">
                  {m.type === 'RECEIPT' ? '+' : '−'}{num(Math.abs(m.qty), 2)} {m.unit}
                </span>
                <span className="hidden w-20 shrink-0 text-right tabular-nums text-ink-500 sm:block">{num(m.balanceAfter, 1)} left</span>
                <span className="hidden w-36 shrink-0 truncate text-right text-[11.5px] text-ink-400 lg:block">{dateTime(m.createdAt)}</span>
              </li>
            ))}
            {!moves?.data.length && <li className="px-4 py-10 text-center text-[13px] text-ink-500">No stock movements recorded yet.</li>}
          </ul>
        )}
      </Card>

      {adding && <ItemModal onClose={() => setAdding(false)} />}
      {editing && <ItemModal item={editing} onClose={() => setEditing(null)} />}
      {adjusting && <AdjustModal item={adjusting} onClose={() => setAdjusting(null)} />}
    </div>
  );
}

function ItemModal({ item, onClose }: { item?: InventoryItem; onClose: () => void }) {
  const [form, setForm] = useState({
    name: item?.name ?? '',
    unit: item?.unit ?? 'KG',
    stock: item?.stock ?? 0,
    lowStockThreshold: item?.lowStockThreshold ?? 0,
    costPerUnit: item?.costPerUnit ?? 0,
    supplier: item?.supplier ?? '',
  });
  const [busy, setBusy] = useState(false);
  const isEdit = Boolean(item);

  async function save() {
    if (form.name.trim().length < 2) { toast('Give the item a name', 'error'); return; }
    setBusy(true);
    try {
      if (isEdit) await http.patch(`/inventory/${item!._id}`, form);
      else await http.post('/inventory', form);
      invalidate('inventory');
      toast(isEdit ? 'Item updated' : `${form.name} is now tracked`, 'success');
      onClose();
    } catch (e) { toast(errMsg(e, 'Could not save that'), 'error'); } finally { setBusy(false); }
  }

  async function retire() {
    setBusy(true);
    try {
      await http.delete(`/inventory/${item!._id}`);
      invalidate('inventory');
      toast('Stopped tracking that item', 'info');
      onClose();
    } catch (e) { toast(errMsg(e, 'Could not remove it'), 'error'); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit ${item!.name}` : 'New stock item'} width="max-w-md"
      footer={<>
        {isEdit && <Button variant="danger" className="mr-auto" loading={busy} onClick={retire}>Stop tracking</Button>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" loading={busy} onClick={save}>Save</Button>
      </>}>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Name" required className="sm:col-span-2">
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Paneer (cubes)" />
        </Field>
        <Field label="Unit">
          <Select value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value as InventoryUnit }))}>
            {UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </Select>
        </Field>
        <Field label="Cost per unit (₹)">
          <Input type="number" value={form.costPerUnit} onChange={(e) => setForm((f) => ({ ...f, costPerUnit: Number(e.target.value) }))} />
        </Field>
        <Field label="Reorder level" hint={isEdit ? 'Changing stock needs an adjustment entry' : undefined}>
          <Input type="number" value={form.lowStockThreshold} onChange={(e) => setForm((f) => ({ ...f, lowStockThreshold: Number(e.target.value) }))} />
        </Field>
        <Field label="Opening stock"><Input type="number" value={form.stock} disabled={isEdit} onChange={(e) => setForm((f) => ({ ...f, stock: Number(e.target.value) }))} /></Field>
        <Field label="Supplier" className="sm:col-span-2">
          <Input value={form.supplier} onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))} placeholder="Sharma Dairy, Kothrud" />
        </Field>
      </div>
    </Modal>
  );
}

function AdjustModal({ item, onClose }: { item: InventoryItem; onClose: () => void }) {
  const [type, setType] = useState<InventoryTxType>('RECEIPT');
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function go() {
    setBusy(true);
    try {
      await http.post(`/inventory/${item._id}/adjust`, { type, qty, note: note || undefined });
      invalidate('inventory');
      toast(`${item.name} adjusted`, 'success');
      onClose();
    } catch (e) { toast(errMsg(e, 'Adjustment rejected'), 'error'); } finally { setBusy(false); }
  }

  const signed = ['RECEIPT', 'RETURN'].includes(type) ? item.stock + qty : item.stock - qty;

  return (
    <Modal open onClose={onClose} title={`Adjust ${item.name}`} subtitle={`${num(item.stock, 2)} ${item.unit} on hand`} width="max-w-sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={go}>Record</Button></>}>
      <div className="space-y-3.5">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(TX_LABEL) as InventoryTxType[]).map((t) => (
            <button key={t} onClick={() => setType(t)}
              className={`rounded-lg px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors ${type === t ? 'bg-ink-900 text-white' : 'bg-white text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50'}`}>
              {TX_LABEL[t]}
            </button>
          ))}
        </div>
        <Field label={`Quantity (${item.unit})`}>
          <div className="flex items-center gap-2">
            <IconButtonMinus onClick={() => setQty((q) => Math.max(0.1, +(q - 1).toFixed(2)))} />
            <Input type="number" value={qty} onChange={(e) => setQty(Number(e.target.value))} className="text-center" />
            <button onClick={() => setQty((q) => q + 1)} className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-ink-300 bg-white text-ink-600 hover:bg-ink-50" aria-label="Increase">
              <Plus size={15} />
            </button>
          </div>
        </Field>
        <Field label="Note"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Milkmaid 20L can, invoice 412" /></Field>
        <p className={`rounded-xl px-3 py-2 text-[12.5px] font-medium ${signed < 0 ? 'bg-red-50 text-red-700' : 'bg-ink-50 text-ink-600'}`}>
          {signed < 0 ? 'This would push stock below zero — enter the quantity that actually left the store.' : `New balance will be ${num(signed, 2)} ${item.unit}.`}
        </p>
      </div>
    </Modal>
  );
}

function IconButtonMinus({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-ink-300 bg-white text-ink-600 hover:bg-ink-50" aria-label="Decrease">
      <Minus size={15} />
    </button>
  );
}
