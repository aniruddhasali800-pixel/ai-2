import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpDown, Eye, RefreshCw, Search, Ban, CheckCheck } from 'lucide-react';
import { useQuery, invalidate } from '../../lib/query';
import { http } from '../../lib/api';
import type { Order, Paginated } from '../../lib/types';
import { ORDER_STATUS_META, SOURCE_META } from '../../lib/statusMaps';
import { inr, clockTime, dayMonth } from '../../lib/format';
import { Button, Card, Input, Pill, SegmentedControl, StatusDot, EmptyState } from '../../components/ui';
import { toast } from '../../store/toasts';
import { OrderDetail } from './OrderDetail';

const RANGES = [
  { value: 'active', label: 'Live' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7 days' },
  { value: 'all', label: 'All' },
];

const STATUS_FILTERS = ['', 'PLACED', 'PREPARING', 'READY', 'SERVED', 'COMPLETED', 'CANCELLED'];

export function OrdersPage() {
  const [params, setParams] = useSearchParams();
  const [range, setRange] = useState<(typeof RANGES)[number]['value']>('active');
  const [status, setStatus] = useState(params.get('status') ?? '');
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [openId, setOpenId] = useState<string | null>(params.get('open'));

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 280);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => setStatus(params.get('status') ?? ''), [params]);

  const query: Record<string, unknown> = { limit: 60 };
  if (status) query.status = status;
  if (source) query.source = source;
  if (debounced) query.search = debounced;
  if (range === 'active') query.active = 'true';
  if (range === 'today' || range === '7d') {
    const from = new Date();
    if (range === '7d') from.setDate(from.getDate() - 6);
    from.setHours(range === 'today' ? 0 : 0, 0, 0);
    query.from = from.toISOString();
  }

  const key = `orders:list:${JSON.stringify(query)}`;
  const { data, loading, refetch } = useQuery<Paginated<Order>>(key, '/orders', query);
  const rows = data?.data ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-center gap-2.5 p-3">
          <SegmentedControl value={range} onChange={setRange} options={RANGES} size="sm" />
          <div className="flex items-center gap-1 overflow-x-auto">
            {STATUS_FILTERS.map((s) => (
              <button
                key={s || 'all'}
                onClick={() => { setStatus(s); setParams(s ? { status: s } : {}); }}
                className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ring-1 ring-inset transition-colors ${
                  status === s ? 'bg-ink-900 text-white ring-ink-900' : 'bg-white text-ink-600 ring-ink-200 hover:bg-ink-50'
                }`}
              >
                {s ? ORDER_STATUS_META[s as keyof typeof ORDER_STATUS_META].label : 'Any status'}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Ticket no. or guest"
                className="h-9 w-44 pl-8 text-[13px]"
              />
            </div>
            <Button size="sm" variant="ghost" icon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />} onClick={refetch}>
              Refresh
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        {!rows.length && !loading ? (
          <EmptyState
            icon={<ArrowUpDown size={26} />}
            title={range === 'active' ? 'No live tickets' : 'No orders in this window'}
            body="Change the filters above, or seat a table to start taking orders."
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {rows.map((o) => {
              const meta = ORDER_STATUS_META[o.status];
              return (
                <li key={o._id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 transition-colors hover:bg-ink-50">
                  <button onClick={() => setOpenId(o._id)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <span className="font-display text-[15px] font-800 tabular-nums text-ink-900">{o.orderNumber}</span>
                    <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-ink-600">
                      {SOURCE_META[o.source]?.short}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-600">
                      {o.customerName || 'Walk-in'}{o.customerCity ? ` · ${o.customerCity}` : ''} · {o.items.length} line{o.items.length === 1 ? '' : 's'}
                    </span>
                  </button>
                  <Pill className={meta.cls}><StatusDot className={meta.dot} />{meta.label}</Pill>
                  {o.paymentStatus === 'PAID' && <Pill className="bg-leaf-100 text-leaf-600 ring-leaf-500/30">Paid</Pill>}
                  {o.paymentStatus === 'REFUNDED' && <Pill className="bg-stone-100 text-stone-600 ring-stone-300">Refunded</Pill>}
                  <span className="hidden w-14 shrink-0 text-right text-[12px] tabular-nums text-ink-400 sm:block">{clockTime(o.placedAt)}</span>
                  <span className="w-20 shrink-0 text-right font-display text-[15px] font-700 tabular-nums text-ink-900">{inr(o.grandTotal)}</span>
                  <div className="flex shrink-0 gap-1">
                    {o.status === 'PLACED' && (
                      <Button
                        size="sm"
                        variant="primary"
                        icon={<CheckCheck size={13} />}
                        onClick={() => advance(o, 'ACCEPTED')}
                      >
                        Accept
                      </Button>
                    )}
                    {['PLACED', 'ACCEPTED'].includes(o.status) && (
                      <Button size="sm" variant="ghost" icon={<Ban size={13} />} onClick={() => cancel(o)}>
                        <span className="sr-only">Cancel</span>
                      </Button>
                    )}
                    <Button size="sm" variant="secondary" icon={<Eye size={13} />} onClick={() => setOpenId(o._id)}>
                      <span className="sr-only">View</span>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <p className="px-1 text-[12px] text-ink-400">
        {rows.length ? `Showing ${rows.length} of ${data?.total ?? rows.length} tickets` : ''} · order numbers run per tenant ·{' '}
        <Link to="/app" className="text-ink-500 hover:text-ink-800">back to dashboard</Link>
      </p>

      {openId && <OrderDetail orderId={openId} onClose={() => setOpenId(null)} onChanged={() => invalidate('orders')} />}
    </div>
  );

  async function advance(o: Order, status: Order['status']) {
    try {
      await http.patch(`/orders/${o._id}/status`, { status });
      toast(`${o.orderNumber} accepted`, 'success');
      invalidate('orders');
    } catch {
      toast('Could not update ticket', 'error');
    }
  }

  async function cancel(o: Order) {
    const reason = window.prompt(`Cancel ${o.orderNumber}? Add a short reason.`);
    if (reason === null) return;
    try {
      await http.patch(`/orders/${o._id}/status`, { status: 'CANCELLED', reason: reason || 'Cancelled by staff' });
      toast(`${o.orderNumber} cancelled`, 'info');
      invalidate('orders');
    } catch {
      toast('Could not cancel ticket', 'error');
    }
  }
}

export function formatDay(d: string) {
  return dayMonth(d);
}
