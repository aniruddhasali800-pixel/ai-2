import { Banknote, CheckCheck, Inbox, ReceiptText } from 'lucide-react';
import { invalidate, useQuery } from '../../lib/query';
import { http, errMsg } from '../../lib/api';
import type { Bill, CustomerRequest, Payment } from '../../lib/types';
import { REQUEST_LABEL } from '../../lib/statusMaps';
import { inr, timeAgo } from '../../lib/format';
import { Button, Card, EmptyState, LinkButton, Pill, Spinner } from '../../components/ui';
import { toast } from '../../store/toasts';
import { can, useAuth } from '../../store/auth';

export function PosRequests() {
  const { user } = useAuth();
  const write = can(user?.role, 'requests:write');
  const bills = can(user?.role, 'billing:write');
  const settleCash = can(user?.role, 'payments:write');
  // The floor can raise a bill or a clear, but only the till and the office answer them.
  const answersCalls = write && user?.role !== 'WAITER';
  const { data, loading } = useQuery<{ data: CustomerRequest[] }>('requests:list', '/waiters/requests');
  const rows = data?.data ?? [];
  const billCalls = rows.filter((r) => r.type === 'BILL' && r.status !== 'DONE');
  const cashRounds = rows.filter((r) => r.type === 'CASH_PAYMENT' && r.status !== 'DONE');
  const clearCalls = rows.filter((r) => r.type === 'TABLE_CLEAR' && r.status !== 'DONE');
  const rest = rows.filter((r) => r.type !== 'BILL' && r.type !== 'CASH_PAYMENT' && r.type !== 'TABLE_CLEAR');

  async function done(r: CustomerRequest) {
    try {
      await http.patch(`/waiters/requests/${r._id}`, { status: 'DONE' });
      invalidate('requests');
      toast(`Table ${r.tableNumber ?? ''} request closed`, 'success');
    } catch (e) {
      invalidate('requests');
      toast(errMsg(e, 'Could not close that'), 'error');
    }
  }

  /** Guests or the floor pressed "Bill please" — the server totals the table, issues the bill, and
   *  pushes it back to whoever is carrying the table so they can show the guest the QR. */
  async function answer(r: CustomerRequest) {
    try {
      const { data: res } = await http.post<{ bill?: Bill; settled?: boolean }>(`/waiters/requests/${r._id}/accept`, {});
      invalidate('requests');
      invalidate('bills');
      invalidate('tables');
      invalidate('floor');
      toast(
        res.settled
          ? `Table ${r.tableNumber ?? ''} was already settled`
          : res.bill
            ? `Bill ${res.bill.billNumber} issued for table ${r.tableNumber ?? ''} — the floor has it`
            : `Table ${r.tableNumber ?? ''} is free`,
        'success',
      );
    } catch (e) {
      invalidate('requests');
      toast(errMsg(e, 'Could not answer that call'), 'error');
    }
  }

  /** The waiter counted the notes into this request; the drawer closes here. */
  async function settle(r: CustomerRequest) {
    try {
      const { data: res } = await http.post<{ payment: Payment }>(`/waiters/requests/${r._id}/settle`, {});
      invalidate('requests');
      invalidate('bills');
      invalidate('tables');
      const change = res.payment.change ?? 0;
      toast(
        `${r.billNumber ?? 'Bill'} paid · table ${r.tableNumber ?? ''}${change ? ` · change ${inr(change)}` : ''}`,
        'success',
      );
    } catch (e) {
      toast(errMsg(e, 'Could not settle that cash round'), 'error');
    }
  }

  if (loading && !data) return <Spinner label="Loading guest calls…" />;

  return (
    <div className="space-y-4">
      <RequestGroup
        title="Cash from tables"
        hint="A waiter collected these notes — confirm the amount and close the table"
        rows={cashRounds}
        write={write}
        onDone={done}
        onSettle={settleCash ? settle : undefined}
        collectedHint
      />
      <RequestGroup
        title="Bill requests"
        hint="Answer the call — the bill is cut here and sent back to the floor"
        rows={billCalls}
        write={write}
        onDone={done}
        onAccept={bills && answersCalls ? { fn: answer, label: 'Cut the bill' } : undefined}
      />
      <RequestGroup
        title="Table clears"
        hint="The floor says the guests have gone — confirm nothing is owed and free the table"
        rows={clearCalls}
        write={write}
        onDone={done}
        onAccept={answersCalls ? { fn: answer, label: 'Confirm clear' } : undefined}
      />
      <RequestGroup title="Floor calls" hint="Ask a waiter to pick these up" rows={rest} write={write} onDone={done} />
      {!rows.length && (
        <Card>
          <EmptyState icon={<Inbox size={26} />} title="No open calls" body="Every guest has what they need right now." />
        </Card>
      )}
    </div>
  );
}

function RequestGroup({
  title,
  hint,
  rows,
  write,
  onDone,
  onAccept,
  onSettle,
  collectedHint,
}: {
  title: string;
  hint: string;
  rows: CustomerRequest[];
  write: boolean;
  onDone: (r: CustomerRequest) => Promise<void>;
  onAccept?: { fn: (r: CustomerRequest) => Promise<void>; label: string } | undefined;
  onSettle?: ((r: CustomerRequest) => Promise<void>) | undefined;
  collectedHint?: boolean;
}) {
  if (!rows.length) return null;
  return (
    <Card title={title} subtitle={hint}>
      <ul className="divide-y divide-ink-100">
        {rows.map((r) => (
          <li key={r._id} className="flex items-center gap-3 px-3.5 py-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-ink-100 text-[16px]">
              {REQUEST_LABEL[r.type]?.emoji ?? '✋'}
            </span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-[13.5px] font-semibold text-ink-900">
                Table {r.tableNumber || '—'} · {REQUEST_LABEL[r.type]?.label ?? r.type}
                {r.billGrandTotal ? ` · ${inr(r.billGrandTotal)}` : ''}
              </p>
              <p className="truncate text-[12px] text-ink-500">
                {collectedHint
                  ? r.collectedAt
                    ? `waiter took ${inr(r.tendered ?? 0)} · ${timeAgo(r.collectedAt)}`
                    : 'the waiter has not picked the cash up yet'
                  : r.note || timeAgo(r.createdAt)}
              </p>
            </div>
            <Pill className={r.status === 'ACKNOWLEDGED' ? 'bg-blue-50 text-blue-800 ring-blue-200' : 'bg-amber-50 text-amber-800 ring-amber-200'}>
              {r.status === 'ACKNOWLEDGED' ? (collectedHint ? 'At the till' : 'On it') : 'Waiting'}
            </Pill>
            {onAccept && (r.billPublicToken ? (
              <LinkButton to={`/bill/${r.billPublicToken}`} size="sm" variant="secondary" icon={<ReceiptText size={14} />}>
                Show bill
              </LinkButton>
            ) : (
              <Button size="sm" variant="primary" icon={<ReceiptText size={14} />} onClick={() => void onAccept.fn(r)}>
                {onAccept.label}
              </Button>
            ))}
            {onSettle && r.collectedAt && (
              <Button size="sm" variant="success" icon={<Banknote size={14} />} onClick={() => void onSettle(r)}>
                Payment done
              </Button>
            )}
            {write && !onSettle && (
              <Button size="sm" variant="secondary" icon={<CheckCheck size={14} />} onClick={() => void onDone(r)}>
                Done
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
