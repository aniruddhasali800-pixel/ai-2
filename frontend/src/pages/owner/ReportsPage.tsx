import { useState } from 'react';
import { Download, TrendingUp } from 'lucide-react';
import { useQuery } from '../../lib/query';
import type { OperationsReport, PaymentReport, ProductReport, SalesReport } from '../../lib/types';
import { SOURCE_META } from '../../lib/statusMaps';
import { inr, num, dayMonth } from '../../lib/format';
import { BarRows, Donut, DayBars, AreaChart } from '../../components/charts';
import { Button, Card, SegmentedControl, StatTile, Spinner, Tabs } from '../../components/ui';
import { DayClosePanel } from './DayClosePanel';
import { useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: 'Quarter' },
  { value: '365', label: 'Year' },
];

const VIEWS: { value: 'trends' | 'endOfDay'; label: string }[] = [
  { value: 'trends', label: 'Trends' },
  { value: 'endOfDay', label: 'End of day' },
];

export function ReportsPage() {
  const { restaurant } = useAuth();
  const [view, setView] = useState<'trends' | 'endOfDay'>('trends');
  const [days, setDays] = useState('30');
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month' | 'year'>('day');

  // The close only reads one day, so the range reports stay unloaded until the trend tab is opened.
  const trends = view === 'trends';
  const { data: sales, loading: l1 } = useQuery<SalesReport>('reports:sales', '/reports/sales', { days, granularity }, { enabled: trends });
  const { data: products } = useQuery<ProductReport>('reports:products', '/reports/products', { days }, { enabled: trends });
  const { data: payments } = useQuery<PaymentReport>('reports:payments', '/reports/payments', { days }, { enabled: trends });
  const { data: ops } = useQuery<OperationsReport>('reports:operations', '/reports/operations', { days }, { enabled: trends });

  if (trends && l1 && !sales) return <Spinner label="Crunching the numbers…" />;

  const t = sales?.totals;
  const dineIn = sales?.channels.find((c) => c.channel === 'DINE_IN');

  return (
    <div className="space-y-4">
      <Tabs tabs={VIEWS} active={view} onChange={setView} />

      {view === 'endOfDay' && <DayClosePanel />}

      {trends && (
        <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SegmentedControl size="sm" options={RANGES} value={days} onChange={setDays} />
        <div className="flex items-center gap-2">
          <SegmentedControl
            size="sm"
            value={granularity}
            onChange={setGranularity}
            options={[
              { value: 'day', label: 'Daily' },
              { value: 'week', label: 'Weekly' },
              { value: 'month', label: 'Monthly' },
              { value: 'year', label: 'Yearly' },
            ]}
          />
          <Button size="sm" variant="secondary" icon={<Download size={14} />} onClick={() => exportCsv(sales, restaurant?.name ?? 'sizzle')}>CSV</Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Revenue" value={inr(t?.revenue ?? 0)} hint={`${num(t?.orders ?? 0)} orders`} tone="ember" icon={<TrendingUp size={16} />} />
        <StatTile label="Average ticket" value={inr(t?.avgOrderValue ?? 0)} hint={dineIn ? `${num(dineIn.orders)} dine-in covers` : undefined} />
        <StatTile label="GST collected" value={inr(t?.tax ?? 0)} hint="split below" />
        <StatTile label="Discounts given" value={inr(t?.discount ?? 0)} hint={`+ ${inr(t?.serviceCharge ?? 0)} service`} tone="leaf" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Revenue trend" subtitle={`${sales?.series.length ?? 0} ${granularity} buckets`}>
          <div className="p-3">
            <AreaChart points={(sales?.series ?? []).map((s) => ({ label: s.label, value: s.revenue }))} />
          </div>
        </Card>

        <Card title="Channels" subtitle="Where the money came from">
          <div className="flex flex-col items-center gap-3 p-4">
            <Donut
              data={(sales?.channels ?? []).map((c) => ({ label: c.channel.replace('_', ' '), value: c.revenue }))}
              center={{ top: inr(t?.revenue ?? 0), bottom: <span className="text-[11px] text-ink-500">total</span> }}
            />
            <ul className="w-full space-y-1 text-[12.5px]">
              {(sales?.channels ?? []).map((c) => (
                <li key={c.channel} className="flex items-center justify-between">
                  <span className="capitalize text-ink-600">{c.channel.replace('_', ' ')}</span>
                  <span className="font-semibold tabular-nums text-ink-900">{inr(c.revenue)} <span className="font-normal text-ink-400">· {c.orders}</span></span>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Top sellers" subtitle="By revenue in this window">
          <div className="p-4">
            <BarRows rows={(products?.topProducts ?? []).slice(0, 8).map((p) => ({ label: p.name, value: p.revenue, sub: `${p.qty} sold` }))} />
          </div>
        </Card>
        <Card title="Slow movers" subtitle="Candidates for a price or menu change">
          <div className="p-4">
            <BarRows rows={(products?.slowMovers ?? []).slice(0, 8).map((p) => ({ label: p.name, value: p.revenue, sub: `${p.qty} sold` }))} emptyText="Everything is selling." />
          </div>
        </Card>
        <Card title="By category" subtitle="Mix across the menu">
          <div className="p-4">
            <BarRows rows={(products?.categories ?? []).map((c) => ({ label: c.category, value: c.revenue, sub: `${c.qty} plates` }))} />
          </div>
        </Card>
        <Card title="Order sources" subtitle="QR, waiters, takeaway and aggregators">
          <div className="p-4">
            <BarRows
              rows={(sales?.sources ?? []).map((s) => ({ label: SOURCE_META[s.source]?.label ?? s.source, value: s.revenue, sub: `${s.orders}` }))}
            />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Payment split" subtitle="Cash, card and UPI">
          <div className="p-4">
            <BarRows
              rows={(payments?.byMethod ?? []).map((m) => ({ label: m.method, value: m.amount, sub: `${m.count} txns` }))}
              emptyText="No payments captured yet."
            />
            <div className="mt-3 space-y-1 border-t border-ink-100 pt-3 text-[12.5px]">
              <Row label="Collected" value={inr(payments?.totals.collected ?? 0)} />
              <Row label="Refunded" value={inr(payments?.totals.refunded ?? 0)} />
              <Row label="Net" value={inr(payments?.totals.net ?? 0)} strong />
            </div>
          </div>
        </Card>

        <Card title="Team performance" subtitle="Orders and revenue per waiter">
          <div className="p-4">
            <BarRows rows={(ops?.waiters ?? []).map((w) => ({ label: w.name, value: w.revenue, sub: `${w.orders} orders` }))} emptyText="No waiter-attributed orders." />
          </div>
        </Card>

        <Card title="Collections by cashier" subtitle="Who took the money">
          <div className="p-4">
            <BarRows rows={(payments?.cashierPerformance ?? []).map((c) => ({ label: c.name, value: c.collected, sub: `${c.count} bills` }))} emptyText="Nothing settled yet." />
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Busy hours" subtitle="Orders placed per hour of day">
          <div className="p-3">
            <DayBars
              height={160}
              format={(n) => `${num(n)} orders`}
              bars={(sales?.hourly ?? []).map((h) => ({ label: `${h.hour}h`, value: h.orders }))}
            />
          </div>
        </Card>
        <Card title="Tax breakup" subtitle="What we owe the exchequer">
          <div className="p-4">
            <BarRows
              format={(n) => `${inr(n)}`}
              rows={(ops?.taxBreakup ?? []).map((x) => ({ label: `${x.label} @ ${x.percent}%`, value: x.amount }))}
              emptyText="No taxable sales in this range."
            />
          </div>
        </Card>
        <Card title="Occupancy" subtitle="Sessions, guests and average sitting time">
          <ul className="divide-y divide-ink-100">
            {(ops?.occupancy ?? []).slice(0, 10).map((o) => (
              <li key={o.date} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <span className="w-24 shrink-0 font-medium text-ink-800">{dayMonth(o.date)}</span>
                <span className="text-ink-500">{o.sessions} sittings</span>
                <span className="ml-auto tabular-nums text-ink-700">{o.guests} guests</span>
                <span className="w-20 shrink-0 text-right tabular-nums text-ink-500">{num(o.avgMinutes)}m avg</span>
              </li>
            ))}
            {!ops?.occupancy.length && <li className="px-4 py-8 text-center text-[13px] text-ink-500">No closed sessions yet.</li>}
          </ul>
        </Card>
        <Card title="Bookings funnel" subtitle="How reservations are landing">
          <div className="flex flex-col items-center gap-3 p-4">
            <Donut data={(ops?.bookings ?? []).map((b) => ({ label: b.status, value: b.count }))} thickness={18} size={150} />
            <ul className="grid w-full grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">
              {(ops?.bookings ?? []).map((b) => (
                <li key={b.status} className="flex justify-between"><span className="text-ink-500">{b.status.toLowerCase()}</span><span className="font-semibold tabular-nums">{b.count}</span></li>
              ))}
              {!ops?.bookings.length && <li className="col-span-2 text-center text-ink-500">No bookings yet.</li>}
            </ul>
          </div>
        </Card>
      </div>
        </>
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-ink-500">{label}</span>
      <span className={strong ? 'font-display font-800 tabular-nums text-ink-900' : 'tabular-nums text-ink-700'}>{value}</span>
    </div>
  );
}

function exportCsv(sales: SalesReport | undefined, name: string) {
  if (!sales?.series.length) { toast('Nothing to export yet', 'info'); return; }
  const lines = ['date,revenue,orders', ...sales.series.map((s) => `${s.label},${s.revenue},${s.orders}`)];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.toLowerCase().replace(/\s+/g, '-')}-sales.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
