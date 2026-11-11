import { useEffect } from 'react';
import { useRealtimeConnected, useRealtimeEvent } from '../lib/socket';
import { invalidate, invalidateMany, revalidateAll } from '../lib/query';
import { useNotifications } from '../store/notifications';
import { useToasts } from '../store/toasts';
import { useAuth } from '../store/auth';
import { inr } from '../lib/format';
import type { AppNotification, Order } from '../lib/types';

/**
 * One place that turns backend socket events into cache invalidations and toast
 * pings, so every open screen repaints the moment anything changes anywhere.
 */
export function useRealtimeShell() {
  const receive = useNotifications((s) => s.receive);
  const push = useToasts((s) => s.push);
  const role = useAuth((s) => s.user?.role);
  const userId = useAuth((s) => s.user?._id);

  useRealtimeEvent<AppNotification>('notification:new', (n) => {
    if (!n || !('_id' in n)) return;
    receive(n);
    const tone = n.type === 'PAYMENT_FAILED' || n.type === 'LOW_STOCK' ? 'error' : 'event';
    push({ kind: tone, title: n.title, body: n.body });
    // A closed day arrives as a notice, and the report panel is the notice's subject: whoever is
    // looking at the reports has to see the finished day, not the snapshot they opened an hour ago.
    if (n.type === 'DAY_CLOSE') invalidateMany(['dayclose', 'reports', 'dashboard']);
  });

  const onOrder = (o: Order) => {
    // 'waiter' is the shift summary and 'hub' the public landing tiles: both are derived from the
    // same tickets, and a screen nobody revisits must not keep showing yesterday's counts.
    invalidateMany(['orders', 'kds', 'floor', 'reports', 'dashboard', 'waiter', 'hub']);
    if (!o?.orderNumber) return;
    // Only ping the roles that actually act on the ticket.
    if (role === 'KITCHEN' && o.status === 'PLACED') push({ kind: 'event', title: `New ticket ${o.orderNumber}`, body: `${o.items.length} item(s)` });
  };
  useRealtimeEvent('order.created', onOrder);
  useRealtimeEvent('order.accepted', onOrder);
  useRealtimeEvent('order.preparing', onOrder);
  useRealtimeEvent('order.ready', onOrder);
  useRealtimeEvent('order.served', onOrder);
  useRealtimeEvent('order.completed', onOrder);
  useRealtimeEvent('order.cancelled', onOrder);
  useRealtimeEvent('order.updated', onOrder);

  useRealtimeEvent('delivery.order', () => invalidateMany(['orders', 'kds', 'reports', 'dashboard', 'integrations']));

  const onTable = () => invalidateMany(['floor', 'tables', 'dashboard', 'waiter', 'hub']);
  useRealtimeEvent('table.updated', onTable);
  useRealtimeEvent('table.cleaned', onTable);
  useRealtimeEvent('table.available', onTable);

  const onBill = () => invalidateMany(['bills', 'reports', 'dashboard', 'payments', 'floor', 'hub']);
  useRealtimeEvent('bill.created', onBill);
  useRealtimeEvent('bill.updated', onBill);
  useRealtimeEvent('bill.paid', onBill);
  useRealtimeEvent('bill.requested', () => invalidateMany(['floor', 'waiter']));

  const onPayment = (payload: { amount?: number; method?: string }) => {
    invalidateMany(['payments', 'bills', 'reports', 'dashboard']);
    if ((role === 'OWNER' || role === 'MANAGER' || role === 'CASHIER') && payload?.amount) {
      push({ kind: 'event', title: `${payload.method ?? 'Payment'} received`, body: inr(payload.amount) });
    }
  };
  useRealtimeEvent('payment.succeeded', onPayment);
  // A claim is a guest's word, not money — repaint the queue quietly, the role notification makes the noise.
  useRealtimeEvent('payment.claimed', () => invalidateMany(['payments', 'bills', 'reports', 'dashboard']));
  useRealtimeEvent('payment.refunded', () => invalidateMany(['payments', 'bills', 'reports']));
  useRealtimeEvent('payment.failed', () => invalidate('payments'));

  const onBooking = () => invalidateMany(['bookings', 'dashboard']);
  useRealtimeEvent('booking.created', onBooking);
  useRealtimeEvent('booking.updated', onBooking);
  useRealtimeEvent('booking.reminder', onBooking);

  const onRequest = (r?: { tableNumber?: string; type?: string }) => {
    invalidateMany(['requests', 'floor', 'waiter', 'hub']);
    if (role === 'WAITER' && r?.type) {
      push({ kind: 'event', title: `Table ${r.tableNumber ?? ''}`, body: r.type.replace(/_/g, ' ').toLowerCase() });
    }
  };
  useRealtimeEvent('customer.requested', onRequest);
  // An update is usually the counter answering a call the floor already knows about — repaint, do
  // not ping the waiter with the news they just caused.
  useRealtimeEvent('request.updated', () => invalidateMany(['requests', 'floor', 'waiter', 'hub']));

  // The same menu is read under three different keys by three different clients, and a price or a
  // disabled dish has to leave the guest's phone as soon as it leaves the kitchen's screen.
  useRealtimeEvent('menu.updated', () => invalidateMany(['menu', 'app:menu', 'guest:menu', 'reports']));
  // Settings move the branding, the hours, the payee and the QR targets, so everything that shows one
  // of those repaints: the owner's forms, the guest's app, the counter's bill pages.
  useRealtimeEvent('settings.updated', () =>
    invalidateMany(['restaurants', 'app', 'guest', 'menu', 'payments', 'bills', 'dashboard']),
  );
  useRealtimeEvent('dayclose.closed', () => invalidateMany(['dayclose', 'reports', 'dashboard']));
  useRealtimeEvent('staff.updated', () => invalidateMany(['staff', 'restaurants', 'dashboard']));
  const onInventory = () => invalidateMany(['inventory', 'dashboard']);
  useRealtimeEvent('inventory.updated', onInventory);
  useRealtimeEvent('inventory.low_stock', (payload: { name?: string }) => {
    onInventory();
    if (role === 'OWNER' || role === 'MANAGER') {
      push({ kind: 'error', title: 'Low stock', body: payload?.name ? `${payload.name} is running out` : 'An item is running out' });
    }
  });

  useEffect(() => {
    // Re-arm notifications when the acting user changes (login / role switch).
    void userId;
  }, [userId]);

  // The socket is the fast path, not a guarantee: a hosted instance sleeps between customers, and a
  // handshake refused by a cold service can stay refused. While nothing is listening, every mounted
  // screen asks again on a minute and whenever the tab is looked at, so a figure nobody refreshed is
  // at worst a minute old rather than closed for the evening.
  const connected = useRealtimeConnected();
  useEffect(() => {
    if (connected) return;
    const ask = () => revalidateAll();
    const timer = setInterval(ask, 60_000);
    const onShow = () => document.visibilityState === 'visible' && ask();
    document.addEventListener('visibilitychange', onShow);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [connected]);
}

/** Call after a local mutation to refresh the affected slices immediately. */
export function refresh(...prefixes: string[]) {
  for (const p of prefixes) invalidate(p);
}
