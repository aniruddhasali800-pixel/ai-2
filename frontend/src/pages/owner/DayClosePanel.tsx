import { useState } from 'react';
import { CalendarCheck2, Download, FileClock, Loader2, Save } from 'lucide-react';
import { errMsg, http } from '../../lib/api';
import { invalidate, useQuery } from '../../lib/query';
import { clockTime, count, dayMonth, inr, num } from '../../lib/format';
import { ORDER_STATUS_META, SOURCE_META } from '../../lib/statusMaps';
import type { DayCloseReport, DayCloseSummary, OrderStatus } from '../../lib/types';
import { BarRows, DayBars, Donut } from '../../components/charts';
import { Button, Card, Pill, Spinner, StatTile } from '../../components/ui';
import { DataTable } from '../../components/DataTable';
import { toast } from '../../store/toasts';

const PAID = 'bg-leaf-100 text-leaf-600 ring-leaf-500/30';
const OWED = 'bg-amber-50 text-amber-800 ring-amber-200';
const VOID = 'bg-red-50 text-red-700 ring-red-200';

/** The restaurant's own calendar day, whatever the browser's clock is set to. */
function istToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}

function statusPill(status: string): string {
  if (status === 'PAID' || status === 'COMPLETED') return PAID;
  if (status === 'REFUNDED' || status === 'VOID' || status === 'CANCELLED') return VOID;
  return OWED;
}

/**
 * The end-of-day close. A finished day is read from the file that was written when it closed; today is
 * built live and marked as not yet signed off, so nobody mistakes a running total for a finished one.
 */
export function DayClosePanel() {
  const [date, setDate] = useState(istToday());
  const [busy, setBusy] = useState<'close' | 'csv' | null>(null);

  const { data: closed } = useQuery<DayCloseSummary[]>('dayclose:list', '/reports/day-close/list');
  const { data: report, loading } = useQuery<DayCloseReport>('dayclose:day', '/reports/day-close', { date });

  async function closeTheDay() {
    setBusy('close');
    try {
      await http.post('/reports/day-close', { date });
      invalidate('dayclose:');
      const running = date >= istToday();
      toast(
        running ? `Today saved as a snapshot · ${date}` : `Day closed · ${date}`,
        'success',
        running
          ? 'The evening is still being billed, so this file is a copy of the day so far.'
          : 'Written to the report folder and downloadable as a spreadsheet.',
      );
    } catch (err) {
      toast('Could not close the day', 'error', errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  async function downloadCsv() {
    setBusy('csv');
    try {
      const res = await http.get('/reports/day-close/csv', { params: { date }, responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sizzle-${date}-day-close.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast('Could not build the spreadsheet', 'error', errMsg(err));
    } finally {
      setBusy(null);
    }
  }

  if (loading && !report) return <Spinner label="Gathering the day…" />;
  if (!report) return null;

  const t = report.totals;
  // A file written before midnight is only a snapshot, so a day reads as closed once it is over *and*
  // saved — never from the mere existence of a file, which is how a lunchtime close would lie.
  const running = report.date >= istToday();
  const signed = !running && report.stored;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[13px] text-ink-600">
          <FileClock size={15} className="text-ink-400" />
          <input
            type="date"
            value={date}
            max={istToday()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-[13px] font-semibold text-ink-800"
          />
        </label>

        {running ? (
          <Pill className={OWED}>Still running</Pill>
        ) : signed ? (
          <Pill className={PAID}>
            <CalendarCheck2 size={12} /> Closed at {clockTime(report.generatedAt)}
          </Pill>
        ) : (
          <Pill className={OWED}>Day over, not saved yet</Pill>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="secondary" icon={<Download size={14} />} onClick={downloadCsv} disabled={busy === 'csv'}>
            Spreadsheet
          </Button>
          <Button
            size="sm"
            icon={busy === 'close' ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            onClick={closeTheDay}
            disabled={busy === 'close'}
          >
            {running ? (report.stored ? 'Update today’s snapshot' : 'Save today’s snapshot') : report.stored ? 'Re-close the day' : 'Close this day'}
          </Button>
        </div>
      </div>

      {!!closed?.length && (
        <div className="flex flex-wrap gap-1.5">
          {closed.slice(0, 14).map((one) => (
            <button
              key={one.date}
              onClick={() => setDate(one.date)}
              className={`rounded-full px-2.5 py-1 text-[11.5px] font-semibold ring-1 ring-inset transition-colors ${
                one.date === date ? 'bg-ink-900 text-white ring-ink-900' : 'bg-white text-ink-600 ring-ink-200 hover:ring-ink-400'
              }`}
            >
              {dayMonth(one.date)} · {inr(one.revenue)}
            </button>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Revenue"
          value={inr(t.revenue)}
          delta={report.versus.revenueDeltaPct}
          hint={`vs ${inr(report.versus.revenue)} on ${dayMonth(report.versus.date)}`}
          tone="ember"
        />
        <StatTile label="Paid orders" value={num(t.orders)} hint={`${inr(t.avgOrderValue)} average ticket`} />
        <StatTile
          label="Covers seated"
          value={num(t.covers)}
          hint={report.occupancy.length ? `${num(report.occupancy[0].avgMinutes)} min average sitting` : 'No sitting closed yet'}
        />
        <StatTile
          label="Money in the drawer"
          value={inr(t.collected)}
          hint={`${inr(t.refunded)} refunded · ${inr(t.net)} net`}
          tone="leaf"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Bills raised" value={num(t.bills)} hint={`${count(report.orders.length, 'order')} placed`} />
        <StatTile
          label="Still unpaid"
          value={inr(t.unpaidAmount)}
          hint={t.unpaidBills ? `${count(t.unpaidBills, 'bill')} to chase` : 'Everything settled'}
          tone={t.unpaidBills ? 'ink' : 'leaf'}
        />
        <StatTile label="GST collected" value={inr(t.tax)} hint={`+ ${inr(t.serviceCharge)} service, ${inr(t.discount)} given away`} />
        <StatTile
          label="Claims to verify"
          value={num(report.awaitingVerification.count)}
          hint={inr(report.awaitingVerification.amount)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Hour by hour" subtitle="Revenue across the day">
          <div className="p-3">
            <DayBars
              height={170}
              format={(n) => inr(n)}
              bars={report.hourly.map((h) => ({ label: `${h.hour}`, value: h.revenue }))}
            />
          </div>
        </Card>
        <Card title="How it was paid" subtitle="Cash, UPI and card">
          <div className="flex flex-col items-center gap-3 p-4">
            <Donut
              data={report.methods.map((m) => ({ label: m.method, value: m.amount }))}
              center={{ top: inr(t.collected), bottom: <span className="text-[11px] text-ink-500">collected</span> }}
            />
            <ul className="w-full space-y-1 text-[12.5px]">
              {report.methods.map((m) => (
                <li key={m.method} className="flex items-center justify-between">
                  <span className="text-ink-600">{m.method}</span>
                  <span className="font-semibold tabular-nums text-ink-900">
                    {inr(m.amount)} <span className="font-normal text-ink-400">· {m.count}</span>
                  </span>
                </li>
              ))}
              {!report.methods.length && <li className="text-center text-ink-500">Nothing settled on this day.</li>}
            </ul>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="What sold" subtitle="Dishes by revenue">
          <div className="p-4">
            <BarRows rows={report.topProducts.slice(0, 10).map((p) => ({ label: p.name, value: p.revenue, sub: count(p.qty, 'plate') }))} />
          </div>
        </Card>
        <Card title="Who sold it" subtitle="Waiter-attributed revenue">
          <div className="p-4">
            <BarRows
              rows={report.waiters.map((w) => ({ label: w.name, value: w.revenue, sub: count(w.orders, 'order') }))}
              emptyText="No waiter-attributed orders this day."
            />
          </div>
        </Card>
        <Card title="Kitchen draw" subtitle="Stock the recipes took out">
          <div className="p-4">
            <BarRows
              format={(n) => num(n, 2)}
              rows={report.stock.used.slice(0, 10).map((s) => ({ label: s.item, value: s.qty, sub: s.unit }))}
              emptyText="Nothing left the pantry."
            />
          </div>
        </Card>
        <Card title="Low stock this evening" subtitle="Reorder before the next service">
          <div className="p-4">
            <BarRows
              format={(n) => num(n, 2)}
              rows={report.stock.low.map((s) => ({ label: s.item, value: s.stock, sub: `${s.unit} · level ${s.threshold}` }))}
              emptyText="The pantry is stocked."
            />
          </div>
        </Card>
      </div>

      <Card
        title="Every bill"
        subtitle={`${count(report.bills.length, 'bill')} · ${inr(report.bills.reduce((s, b) => s + b.grandTotal, 0))} billed`}
      >
        <DataTable
          rows={report.bills.map((b) => ({ ...b, _id: b.billId }))}
          empty="No bills were raised on this day."
          columns={[
            { key: 'billNumber', header: 'Bill', render: (r) => <span className="font-semibold text-ink-900">{r.billNumber}</span> },
            { key: 'issuedAt', header: 'Time', render: (r) => clockTime(r.issuedAt), hideBelow: 'sm' },
            { key: 'table', header: 'Table', render: (r) => r.tableNumber || '—', hideBelow: 'sm' },
            { key: 'customer', header: 'Customer', render: (r) => r.customerName || '—', hideBelow: 'md' },
            { key: 'raisedBy', header: 'Raised by', render: (r) => r.issuedBy || '—', hideBelow: 'lg' },
            { key: 'orders', header: 'Orders', align: 'right', render: (r) => num(r.orders), hideBelow: 'md' },
            { key: 'tax', header: 'GST', align: 'right', render: (r) => inr(r.taxTotal), hideBelow: 'lg' },
            { key: 'discount', header: 'Discount', align: 'right', render: (r) => inr(r.discountAmount), hideBelow: 'lg' },
            { key: 'grandTotal', header: 'Total', align: 'right', render: (r) => <span className="font-semibold tabular-nums">{inr(r.grandTotal)}</span> },
            {
              key: 'paid',
              header: 'Settled',
              align: 'right',
              render: (r) => (r.collected ? `${inr(r.collected)} ${r.methods.join('+')}` : '—'),
              hideBelow: 'sm',
            },
            {
              key: 'status',
              header: 'Status',
              render: (r) => <Pill className={statusPill(r.paymentStatus)}>{r.paymentStatus.toLowerCase()}</Pill>,
            },
          ]}
        />
      </Card>

      <Card title="Every order" subtitle={`${count(report.orders.length, 'ticket')} placed · ${num(t.cancelledOrders)} cancelled`}>
        <DataTable
          rows={report.orders.map((o) => ({ ...o, _id: o.orderId }))}
          empty="No orders were placed on this day."
          columns={[
            { key: 'orderNumber', header: 'Order', render: (r) => <span className="font-semibold text-ink-900">{r.orderNumber}</span> },
            { key: 'placedAt', header: 'Placed', render: (r) => clockTime(r.placedAt), hideBelow: 'sm' },
            { key: 'source', header: 'Source', render: (r) => SOURCE_META[r.source as keyof typeof SOURCE_META]?.label ?? r.source, hideBelow: 'md' },
            { key: 'table', header: 'Table', render: (r) => r.tableNumber || '—', hideBelow: 'sm' },
            { key: 'waiter', header: 'Waiter', render: (r) => r.waiter || '—', hideBelow: 'lg' },
            { key: 'lines', header: 'Lines', align: 'right', render: (r) => `${r.items} / ${r.quantity}`, hideBelow: 'md' },
            { key: 'discount', header: 'Discount', align: 'right', render: (r) => inr(r.discountAmount), hideBelow: 'lg' },
            { key: 'grandTotal', header: 'Total', align: 'right', render: (r) => <span className="font-semibold tabular-nums">{inr(r.grandTotal)}</span> },
            {
              key: 'status',
              header: 'Status',
              render: (r) => <Pill className={ORDER_STATUS_META[r.status as OrderStatus]?.cls ?? 'bg-ink-100 text-ink-600 ring-ink-300'}>{ORDER_STATUS_META[r.status as OrderStatus]?.label ?? r.status}</Pill>,
            },
            {
              key: 'payment',
              header: 'Payment',
              render: (r) => <Pill className={statusPill(r.paymentStatus)}>{r.paymentStatus.toLowerCase()}</Pill>,
              hideBelow: 'md',
            },
          ]}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Tax breakup" subtitle="What this day owes the exchequer">
          <div className="p-4">
            <BarRows
              rows={report.taxBreakup.map((x) => ({ label: `${x.label} @ ${x.percent}%`, value: x.amount }))}
              emptyText="No taxable sales."
            />
          </div>
        </Card>
        <Card title="Stock movements" subtitle="Every pantry entry and exit">
          <ul className="divide-y divide-ink-100">
            {report.stock.movements.slice(0, 12).map((m, i) => (
              <li key={`${m.item}-${i}`} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                <span className="w-14 shrink-0 text-ink-500">{clockTime(m.at)}</span>
                <span className="font-medium text-ink-800">{m.item}</span>
                <Pill className={m.type === 'RECEIPT' ? PAID : m.type === 'WASTE' ? VOID : 'bg-ink-100 text-ink-600 ring-ink-300'}>
                  {m.type.toLowerCase()}
                </Pill>
                <span className="ml-auto tabular-nums text-ink-700">
                  {num(m.qty, 2)} {m.unit}
                </span>
                <span className="w-24 shrink-0 text-right tabular-nums text-ink-500">left {num(m.balanceAfter, 2)}</span>
              </li>
            ))}
            {!report.stock.movements.length && <li className="px-4 py-8 text-center text-[13px] text-ink-500">The pantry did not move.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
