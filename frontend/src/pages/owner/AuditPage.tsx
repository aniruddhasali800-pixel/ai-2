import { useState } from 'react';
import { ScrollText, Search } from 'lucide-react';
import { useQuery } from '../../lib/query';
import type { AuditEntry } from '../../lib/types';
import { dateTime } from '../../lib/format';
import { Button, Card, EmptyState, Input, Pill, Select, Spinner } from '../../components/ui';
import { Toolbar } from '../../components/DataTable';

const ENTITY = ['', 'Order', 'Bill', 'Payment', 'Product', 'Table', 'User', 'Booking', 'InventoryItem', 'Restaurant'];

export function AuditPage() {
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const params: Record<string, unknown> = { limit: 50, page };
  if (action) params.action = action;
  if (entityType) params.entityType = entityType;

  const { data, loading } = useQuery<{ data: AuditEntry[]; total: number; actions: string[]; page: number; limit: number }>('audit', '/audit', params);
  const rows = data?.data ?? [];
  const actions = data?.actions ?? [];

  return (
    <Card
      title="Audit trail"
      subtitle={`${(data?.total ?? 0).toLocaleString('en-IN')} recorded actions · newest first`}
      action={
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter on this page" className="h-8 w-44 pl-7 text-[13px]" />
        </div>
      }
    >
      <Toolbar>
        <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="h-8 w-auto text-[13px]">
          <option value="">Every action</option>
          {actions.map((a) => <option key={a} value={a}>{a}</option>)}
        </Select>
        <Select value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }} className="h-8 w-auto text-[13px]">
          {ENTITY.map((t) => <option key={t || 'all'} value={t}>{t ? t : 'Any entity'}</option>)}
        </Select>
        <span className="ml-auto text-[12px] text-ink-500">Page {data?.page ?? 1} of {Math.max(1, Math.ceil((data?.total ?? 0) / (data?.limit ?? 50)))}</span>
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Newer</Button>
        <Button size="sm" variant="ghost" disabled={rows.length < (data?.limit ?? 50)} onClick={() => setPage((p) => p + 1)}>Older</Button>
      </Toolbar>

      {loading && !data ? <Spinner /> : !rows.length ? (
        <EmptyState icon={<ScrollText size={26} />} title="Nothing recorded" body="Sensitive actions — refunds, price edits, role changes — land here." />
      ) : (
        <ul className="divide-y divide-ink-100">
          {rows
            .filter((r) => !search || `${r.actorName} ${r.action} ${r.entityType}`.toLowerCase().includes(search.toLowerCase()))
            .map((r) => (
              <li key={r._id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3.5 py-3">
                <span className="w-36 shrink-0 text-[12px] tabular-nums text-ink-500">{dateTime(r.createdAt)}</span>
                <span className="min-w-[7rem] shrink-0 text-[13px] font-semibold text-ink-900">{r.actorName || 'System'}</span>
                <Pill className="shrink-0 bg-ink-100 text-ink-700 ring-ink-200">{r.action}</Pill>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-500">
                  {r.entityType}{r.entityId ? ` · ${r.entityId.slice(-6)}` : ''}
                  {r.metadata ? ` · ${summarise(r.metadata)}` : ''}
                </span>
              </li>
            ))}
        </ul>
      )}
    </Card>
  );
}

function summarise(meta: Record<string, unknown>): string {
  return Object.entries(meta)
    .filter(([, v]) => v !== null && v !== '' && typeof v !== 'object')
    .slice(0, 4)
    .map(([k, v]) => `${k} ${typeof v === 'number' ? v.toLocaleString('en-IN') : v}`)
    .join(' · ');
}
