import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowUpRight, CalendarClock, ChefHat, ReceiptText, ShoppingBasket, Timer } from 'lucide-react';
import { AnimatedNumber, Card, EmptyState, LinkButton, Pill, Skeleton, StatusDot } from '../../components/ui';
import { BarRows, DayBars, Donut } from '../../components/charts';
import { useQuery } from '../../lib/query';
import { inr, timeAgo } from '../../lib/format';
import { ORDER_STATUS_META, SOURCE_META, TABLE_STATUS_META } from '../../lib/statusMaps';
import type { DashboardData, TableStatus } from '../../lib/types';
import { useAuth } from '../../store/auth';

interface KitchenStats {
  pending: number;
  preparing: number;
  ready: number;
  completedToday: number;
}

export function DashboardPage() {
  const { restaurant } = useAuth();
  const { data, loading } = useQuery<DashboardData>('dashboard', '/reports/dashboard');
  const { data: kitchen } = useQuery<KitchenStats>('kds-stats', '/kitchen/stats');

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[104px]" />)}
        </div>
        <Skeleton className="h-72" />
      </div>
    );
  }
  if (!data) return <EmptyState title="No dashboard data" body="Sign in with an owner or manager account to see the floor." />;

  const openTables = data.tables.filter((t) => t.status !== 'AVAILABLE' && t.status !== 'CLEANING').reduce((s, t) => s + t.count, 0);
  const totalTables = data.tables.reduce((s, t) => s + t.count, 0);
  const busiest = [...data.hourly].sort((a, b) => b.revenue - a.revenue)[0];
  const peakOrders = Math.max(1, ...data.hourly.map((h) => h.orders));
  const spark = data.week.map((w) => w.revenue);

  return (
    <div className="space-y-5">
      {/* Headline strip */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          label="Revenue today"
          value={<AnimatedNumber value={data.today.revenue} format={inr} />}
          delta={data.today.trendPct}
          hint={<span>vs {inr(data.yesterday.revenue)} yesterday</span>}
          spark={spark}
        />
        <Tile
          label="Orders today"
          value={<AnimatedNumber value={data.today.orders} format={(n) => Math.round(n).toLocaleString('en-IN')} />}
          hint={<span>Avg order {inr(data.today.avgOrderValue)}</span>}
        />
        <Tile
          label="Tables occupied"
          value={<span>{openTables}<span className="text-ink-400">/{totalTables}</span></span>}
          hint={<span>{data.live.openSessions} open sessions</span>}
        />
        <Tile
          label="Awaiting settlement"
          value={<AnimatedNumber value={data.live.unpaidAmount} format={inr} />}
          hint={<span>{data.live.unpaidBills} unpaid bills</span>}
          tone="warn"
        />
      </div>

      {/* Live operations rail */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Kitchen & floor right now" subtitle="Click a count to open the rail" className="xl:col-span-2">
          <div className="grid grid-cols-2 gap-px bg-ink-100 sm:grid-cols-4">
            <LiveStat to="/app/orders?status=PLACED" label="New" value={kitchen?.pending ?? 0} tone="ember" />
            <LiveStat to="/app/orders?status=PREPARING" label="Firing" value={kitchen?.preparing ?? 0} tone="blue" />
            <LiveStat to="/kds" label="Ready to pass" value={kitchen?.ready ?? 0} tone="leaf" icon={<ChefHat size={13} />} />
            <LiveStat to="/app/tables" label="Unpaid bills" value={data.live.unpaidBills} tone="amber" icon={<ReceiptText size={13} />} />
          </div>
          <div className="px-4 pb-4 pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h4 className="text-[13px] font-semibold text-ink-700">Orders by hour (today)</h4>
              {busiest && (
                <span className="inline-flex items-center gap-1 text-[12px] text-ink-500">
                  <Timer size={12} /> busiest at {String(busiest.hour).padStart(2, '0')}:00
                </span>
              )}
            </div>
            <div className="flex items-end gap-1" style={{ height: 118 }}>
              {data.hourly.slice(6).map((h) => (
                <div key={h.hour} className="group relative flex h-full flex-1 flex-col justify-end" title={`${String(h.hour).padStart(2, '0')}:00 · ${h.orders} orders`}>
                  <div
                    className="rounded-t-[4px] bg-ember-200 transition-colors group-hover:bg-ember-500"
                    style={{ height: `${Math.max(2, (h.orders / peakOrders) * 100)}%` }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wider text-ink-400">
              <span>06:00</span><span>14:00</span><span>23:00</span>
            </div>
          </div>
        </Card>

        <Card title="Floor status" subtitle="Live table map rollup">
          {data.tables.length ? (
            <div className="p-4">
              <Donut
                size={150}
                thickness={20}
                center={{ top: totalTables, bottom: 'tables' }}
                data={data.tables.map((t) => ({
                  label: TABLE_STATUS_META[t.status as TableStatus]?.label ?? t.status,
                  value: t.count,
                  color: donutColor(t.status),
                }))}
              />
            </div>
          ) : (
            <EmptyState title="No tables yet" body="Add tables to start seating guests." action={<LinkButton to="/app/tables" size="sm" variant="primary">Set up tables</LinkButton>} />
          )}
        </Card>
      </div>

      {/* Seven-day trend + top movers */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card
          title="Last 7 days"
          subtitle={`${inr(data.week.reduce((s, w) => s + w.revenue, 0))} billed across ${data.week.reduce((s, w) => s + w.orders, 0)} orders`}
          action={<LinkButton to="/app/reports" size="sm" variant="ghost" icon={<ArrowUpRight size={14} />}>Reports</LinkButton>}
          className="xl:col-span-2"
        >
          <div className="p-4">
            <DayBars bars={data.week.map((w) => ({ label: w.label.slice(5), value: w.revenue }))} height={168} />
          </div>
        </Card>
        <Card title="Top sellers" subtitle="By revenue, last 14 days">
          <div className="p-4">
            <BarRows rows={data.topItems.slice(0, 6).map((t) => ({ label: t.name, value: t.revenue, sub: `×${t.qty}` }))} />
          </div>
        </Card>
      </div>

      {/* Recent tickets + alerts */}
      <div className="grid gap-4 xl:grid-cols-3">
        <Card
          title="Recent tickets"
          action={<LinkButton to="/app/orders" size="sm" variant="ghost">All orders</LinkButton>}
          className="xl:col-span-2"
        >
          <ul className="divide-y divide-ink-100">
            {!data.recentOrders.length && <li className="px-4 py-8 text-center text-[13px] text-ink-500">No orders yet today.</li>}
            {data.recentOrders.map((o) => {
              const meta = ORDER_STATUS_META[o.status];
              return (
                <li key={o._id}>
                  <Link to={`/app/orders/${o._id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-ink-50">
                    <span className="font-display text-[13px] font-700 tabular-nums text-ink-900">{o.orderNumber}</span>
                    <span className="hidden w-20 shrink-0 text-[12px] text-ink-500 sm:block">{SOURCE_META[o.source]?.label}</span>
                    <span className="min-w-0 flex-1 truncate text-[13px] text-ink-600">{o.customerName || '—'}</span>
                    <Pill className={meta.cls}><StatusDot className={meta.dot} />{meta.label}</Pill>
                    <span className="w-20 shrink-0 text-right font-display text-[13px] font-700 tabular-nums text-ink-900">{inr(o.grandTotal)}</span>
                    <span className="hidden w-16 shrink-0 text-right text-[11.5px] text-ink-400 md:block">{timeAgo(o.createdAt)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="space-y-4">
          <Card title="Stock alerts" subtitle={restaurant?.name} action={<LinkButton to="/app/inventory" size="sm" variant="ghost" icon={<ShoppingBasket size={14} />}>Inventory</LinkButton>}>
            {data.lowStock.count ? (
              <ul className="divide-y divide-ink-100">
                {data.lowStock.items.slice(0, 5).map((i) => (
                  <li key={i._id} className="flex items-center gap-2.5 px-4 py-2.5">
                    <AlertTriangle size={15} className="shrink-0 text-amber-500" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-800">{i.name}</span>
                    <span className="shrink-0 text-[12px] tabular-nums text-ink-500">{i.stock} {i.unit}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-6 text-center text-[13px] text-ink-500">Every item is above its threshold.</p>
            )}
          </Card>

          <Card title="Next 24 hours" subtitle="Bookings still to seat">
            <div className="flex items-baseline gap-2 px-4 py-5">
              <CalendarClock size={18} className="text-ember-500" />
              <span className="font-display text-2xl font-800 text-ink-900">{data.upcomingBookings}</span>
              <span className="text-[13px] text-ink-500">pending or confirmed</span>
            </div>
            <div className="px-4 pb-4">
              <LinkButton to="/app/bookings" size="sm" className="w-full">Open booking book</LinkButton>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  delta,
  hint,
  spark,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  delta?: number;
  hint?: React.ReactNode;
  spark?: number[];
  tone?: 'default' | 'warn';
}) {
  return (
    <div className={`card relative overflow-hidden p-4 ${tone === 'warn' ? 'ring-1 ring-amber-200' : ''}`}>
      <span className="label">{label}</span>
      <div className="mt-1.5 font-display text-[27px] font-800 leading-none tracking-tight text-ink-900">{value}</div>
      <div className="mt-2 flex items-center gap-2 text-[12px] text-ink-500">
        {delta !== undefined && (
          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold ${delta >= 0 ? 'bg-leaf-100 text-leaf-600' : 'bg-red-50 text-red-700'}`}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        {hint}
      </div>
      {spark && spark.length > 1 && (
        <svg viewBox="0 0 84 26" className="absolute bottom-3 right-3 h-6 w-21 opacity-60" style={{ width: 84 }}>
          <path
            d={spark
              .map((v, i) => {
                const max = Math.max(...spark);
                const min = Math.min(...spark);
                const x = (i / (spark.length - 1)) * 84;
                const y = 24 - ((v - min) / (max - min || 1)) * 22;
                return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
              })
              .join(' ')}
            fill="none"
            stroke="#ea580c"
            strokeWidth={1.75}
            strokeLinecap="round"
          />
        </svg>
      )}
    </div>
  );
}

function LiveStat({
  to,
  label,
  value,
  tone,
  icon,
}: {
  to: string;
  label: string;
  value: number;
  tone: 'ember' | 'leaf' | 'amber' | 'blue';
  icon?: React.ReactNode;
}) {
  const cls = {
    ember: 'text-ember-600',
    leaf: 'text-leaf-600',
    amber: 'text-amber-600',
    blue: 'text-blue-600',
  }[tone];
  return (
    <Link to={to} className="group bg-white px-4 py-3.5 transition-colors hover:bg-ink-50">
      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500">
        {icon}
        {label}
      </span>
      <span className={`mt-1 block font-display text-2xl font-800 tabular-nums ${cls}`}>{value}</span>
    </Link>
  );
}

function donutColor(status: string): string {
  const map: Record<string, string> = {
    AVAILABLE: '#d6d3d1',
    RESERVED: '#8b5cf6',
    OCCUPIED: '#292524',
    ORDERING: '#ea580c',
    FOOD_READY: '#22c55e',
    BILL_REQUESTED: '#facc15',
    PAYMENT_PENDING: '#d97706',
    CLEANING: '#a8a29e',
  };
  return map[status] ?? '#78716c';
}
