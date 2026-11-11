import { useState } from 'react';
import { ExternalLink, RefreshCw, Send, Store, Webhook } from 'lucide-react';
import { invalidate, useQuery } from '../../lib/query';
import { http, errMsg } from '../../lib/api';
import type { DeliveryAdapter, Order, Paginated } from '../../lib/types';
import { ORDER_STATUS_META, SOURCE_META } from '../../lib/statusMaps';
import { inr, timeAgo } from '../../lib/format';
import { Button, Card, EmptyState, Pill, SegmentedControl, Spinner, StatTile } from '../../components/ui';
import { can, useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';

export function DeliveryPage() {
  const { user } = useAuth();
  const writable = can(user?.role, 'integrations:write');
  const [source, setSource] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [simulating, setSimulating] = useState<string | null>(null);

  const { data: config } = useQuery<{ adapters: DeliveryAdapter[] }>('integrations:adapters', '/integrations');
  const params: Record<string, unknown> = { limit: 50 };
  if (source) params.source = source;
  const { data: orders, loading } = useQuery<Paginated<Order>>('integrations:orders', '/integrations/orders', params);

  const rows = orders?.data ?? [];
  const adapters = config?.adapters ?? [];
  const live = rows.filter((o) => ['PLACED', 'ACCEPTED', 'PREPARING'].includes(o.status)).length;

  async function push(o: Order) {
    setBusyId(o._id);
    try {
      await http.post(`/integrations/push/${o._id}`);
      toast(`${o.orderNumber} status sent to ${SOURCE_META[o.source]?.label ?? o.source}`, 'success');
    } catch (e) { toast(errMsg(e, 'Partner API rejected the push'), 'error'); } finally { setBusyId(null); }
  }

  async function simulate(provider: string) {
    setSimulating(provider);
    try {
      await http.post(`/integrations/simulate/${provider}`, {});
      invalidate('integrations');
      invalidate('orders');
      toast('Test order received from the partner', 'success');
    } catch (e) { toast(errMsg(e, 'Simulation failed'), 'error'); } finally { setSimulating(null); }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatTile label="Aggregator tickets" value={String(orders?.total ?? 0)} hint="Swiggy, Zomato and web" />
        <StatTile label="In flight" value={String(live)} tone="ember" hint="still being cooked" />
        <StatTile label="Partners wired" value={String(adapters.filter((a) => a.configured).length)} tone="leaf" hint={`of ${adapters.length} available`} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        {adapters.map((a) => (
          <Card key={a.provider} title={<span className="inline-flex items-center gap-2"><Store size={14} className="text-ember-500" /> {a.label}</span>}
            subtitle={a.configured ? 'Credentials present — webhooks verified by HMAC' : 'Not configured on this server'}>
            <div className="space-y-2.5 p-4">
              <div>
                <p className="label">Webhook endpoint</p>
                <p className="mt-1 break-all rounded-lg bg-ink-50 px-2.5 py-2 font-mono text-[11.5px] leading-snug text-ink-600">{a.webhookUrl}</p>
              </div>
              <p className="text-[12px] text-ink-500">
                Signature header <code className="rounded bg-ink-100 px-1 py-0.5 text-[11.5px]">{a.signatureHeader}</code>
              </p>
              <p className="text-[12px] leading-relaxed text-ink-500">{a.docsHint}</p>
              {writable && (
                <Button size="sm" variant="secondary" className="w-full" loading={simulating === a.provider} onClick={() => void simulate(a.provider)}>
                  Receive a test order
                </Button>
              )}
              <a href="#integrations" className="block text-center text-[11.5px] font-medium text-ink-400 hover:text-ink-600">
                <ExternalLink size={11} className="mr-1 inline" /> Register this URL in the partner dashboard
              </a>
            </div>
          </Card>
        ))}
        {!adapters.length && <Card><Spinner /></Card>}
      </div>

      <Card
        title="Delivery tickets"
        subtitle="Every order that arrived from an outside platform"
        action={
          <div className="flex items-center gap-2">
            <SegmentedControl
              size="sm"
              value={source}
              onChange={setSource}
              options={[
                { value: '', label: 'All' },
                { value: 'SWIGGY', label: 'Swiggy' },
                { value: 'ZOMATO', label: 'Zomato' },
                { value: 'WEBSITE', label: 'Website' },
              ]}
            />
            <Button size="sm" variant="ghost" icon={<RefreshCw size={14} />} onClick={() => invalidate('integrations')}>Refresh</Button>
          </div>
        }
      >
        {loading && !orders ? <Spinner /> : !rows.length ? (
          <EmptyState icon={<Webhook size={26} />} title="No aggregator orders yet" body="Push a test order above to see how the pipeline behaves." />
        ) : (
          <ul className="divide-y divide-ink-100">
            {rows.map((o) => (
              <li key={o._id} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                <Pill className="bg-ink-100 text-ink-700 ring-ink-200">{SOURCE_META[o.source]?.label ?? o.source}</Pill>
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-[13.5px] font-semibold text-ink-900">
                    {o.orderNumber} <span className="font-normal text-ink-400">· {o.externalOrderId}</span>
                  </p>
                  <p className="truncate text-[12px] text-ink-500">
                    {o.customerName || 'Guest'} · {o.items.reduce((n, i) => n + i.qty, 0)} items · {timeAgo(o.createdAt)}
                  </p>
                  {!!dropoff(o) && <p className="truncate text-[12px] text-ink-400">{dropoff(o)}</p>}
                </div>
                <span className="font-display text-[15px] font-800 tabular-nums text-ink-900">{inr(o.grandTotal)}</span>
                <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold uppercase ring-1 ring-inset ${ORDER_STATUS_META[o.status].cls}`}>
                  {ORDER_STATUS_META[o.status].label}
                </span>
                {writable && <Button size="sm" variant="secondary" loading={busyId === o._id} icon={<Send size={13} />} onClick={() => void push(o)}>Push status</Button>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="px-1 text-[12px] leading-relaxed text-ink-500">
        We only ever talk to official partner APIs with server-held credentials. Nothing here scrapes a consumer website, and
        inbound webhooks are validated against the shared secret before an order is created.
      </p>
    </div>
  );
}

function dropoff(o: Order): string {
  return [o.customerAddress, o.customerCity].filter(Boolean).join(', ');
}
