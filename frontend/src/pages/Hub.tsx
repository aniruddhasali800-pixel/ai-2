import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Ban,
  Boxes,
  CalendarCheck,
  ChefHat,
  ClipboardList,
  ConciergeBell,
  CreditCard,
  Download,
  ExternalLink,
  LayoutGrid,
  LogOut,
  Menu as MenuIcon,
  QrCode,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  Smartphone,
  Store,
  UserCog,
  Webhook,
} from 'lucide-react';
import { Brand } from '../layouts/AppShell';
import { Button, LinkButton, Pill } from '../components/ui';
import { useQuery } from '../lib/query';
import { can, useAuth } from '../store/auth';
import { useRealtimeConnected } from '../lib/socket';
import { homeFor } from './Login';
import { inr } from '../lib/format';
import type { Bill, Paginated, Role, Table } from '../lib/types';

interface Screen {
  path: string;
  title: string;
  role: Role;
  icon: typeof ChefHat;
  blurb: string;
  points: string[];
}

const STAFF_SCREENS: Screen[] = [
  {
    path: '/kds',
    title: 'Kitchen display',
    role: 'KITCHEN',
    icon: ChefHat,
    blurb: 'The pass. Tickets land here the second a guest or waiter sends them.',
    points: ['Four columns: New, Queued, On the fire, Ready to pass', 'Fire by station — grill, tandoor, fry, bar', 'Tickets turn red past 20 minutes'],
  },
  {
    path: '/floor',
    title: 'Waiter floor',
    role: 'WAITER',
    icon: ConciergeBell,
    blurb: 'Your tables, your calls, running totals — built for one hand and a phone.',
    points: ['Seat a party, take an order, serve, clear', 'Guest requests arrive with a toast and a buzz', 'Cash settle small bills without the counter'],
  },
  {
    path: '/pos',
    title: 'Counter and bills',
    role: 'CASHIER',
    icon: CreditCard,
    blurb: 'Where the money is collected: GST bills, cash drawer, card and UPI.',
    points: ['Cash tendered, change calculated on the server', 'Scan-to-pay UPI QR on every unpaid bill', 'Refunds and reprint, both audited'],
  },
  {
    path: '/app',
    title: 'Owner back office',
    role: 'OWNER',
    icon: ShieldCheck,
    blurb: 'The whole restaurant on one screen, then the drills underneath it.',
    points: ['Live dashboard, sales and payment reports', 'Menu, tables, staff, inventory, audit trail', 'Settings including the UPI handle on bills'],
  },
];

function canOpen(path: string, role?: Role | null): boolean {
  if (!role) return false;
  if (path === '/kds') return role === 'KITCHEN' || role === 'MANAGER' || role === 'OWNER';
  if (path === '/floor') return can(role, 'tables:read');
  if (path === '/pos') return can(role, 'billing:read');
  return can(role, 'orders:read');
}

export function Hub() {
  const navigate = useNavigate();
  const { user, restaurant, logout } = useAuth();

  const { data: tablesData } = useQuery<{ data: Table[] }>('hub:tables', '/tables', undefined, {
    enabled: can(user?.role, 'tables:read'),
  });
  const { data: billsData } = useQuery<Paginated<Bill>>('hub:bills', '/billing', { unpaidOnly: true, limit: 8 }, {
    enabled: can(user?.role, 'billing:read'),
  });

  const tables = tablesData?.data ?? [];
  const seated = tables.filter((t) => t.session);
  const menuTable = seated[0] ?? tables[0];
  const unpaid = billsData?.data ?? [];
  const slug = restaurant?.slug ?? 'saffron-and-smoke';

  /** A card opens its screen for whoever is already signed in. This page used to sign a named demo
   * person in with a password carried inside the bundle, which put that password on every machine
   * that loaded the hub; an account here starts with a password somebody typed. */
  function enter(screen: Screen) {
    navigate(user ? screen.path : '/login');
  }

  return (
    <div className="min-h-screen bg-ink-50">
      <header className="border-b border-ink-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-5 py-4">
          <Brand />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <LiveBadge />
            {user ? (
              <>
                <Pill className="bg-ink-100 text-ink-700 ring-ink-200">
                  {user.name} · {user.role.toLowerCase()}
                </Pill>
                <LinkButton to={homeFor(user.role)} size="sm" variant="primary" icon={<ArrowRight size={14} />}>
                  My dashboard
                </LinkButton>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<LogOut size={14} />}
                  onClick={() => {
                    logout();
                    navigate('/');
                  }}
                >
                  Sign out
                </Button>
              </>
            ) : (
              <LinkButton to="/login" size="sm" variant="secondary">
                Sign in
              </LinkButton>
            )}
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-5 pb-2 pt-9">
        <h1 className="font-display text-[30px] font-800 leading-tight tracking-tight text-ink-900 sm:text-[34px]">
          Everything in this build, in one place
        </h1>
        <p className="mt-2.5 max-w-2xl text-[14.5px] leading-relaxed text-ink-600">
          {restaurant?.name ?? 'Saffron & Smoke'} · {restaurant?.address?.city ?? 'Pune'} · one tenant, one Node backend, five
          roles. Press a card to walk into that screen — if you are not signed in as someone who works there, the card signs
          you in as that role first.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-6">
        <h2 className="label">Staff screens</h2>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          {STAFF_SCREENS.map((screen) => {
            const open = canOpen(screen.path, user?.role);
            const mine = user?.role === screen.role;
            return (
              <article
                key={screen.path}
                className="flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-ink-200 transition-shadow hover:shadow-[0_10px_30px_-18px_rgba(28,25,23,0.45)]"
              >
                <div className="flex items-start gap-3 px-4 pt-4">
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${mine ? 'bg-ember-500 text-white' : 'bg-ink-900 text-white'}`}>
                    <screen.icon size={19} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-display text-[16.5px] font-800 leading-tight text-ink-900">{screen.title}</h3>
                    <p className="mt-0.5 font-mono text-[11.5px] text-ink-400">{window.location.origin}{screen.path}</p>
                  </div>
                  {mine && <Pill className="bg-ember-50 text-ember-700 ring-ember-200">You are here</Pill>}
                </div>

                <p className="mt-2.5 px-4 text-[13.5px] leading-relaxed text-ink-600">{screen.blurb}</p>

                <ul className="mt-3 space-y-1 px-4">
                  {screen.points.map((point) => (
                    <li key={point} className="flex gap-2 text-[12.5px] leading-snug text-ink-500">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ember-500" />
                      {point}
                    </li>
                  ))}
                </ul>

                <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-ink-100 px-4 py-3">
                  {open || !user ? (
                    <Button
                      size="sm"
                      variant={mine ? 'primary' : 'dark'}
                      icon={<ArrowRight size={14} />}
                      onClick={() => enter(screen)}
                    >
                      {user ? `Open ${screen.title.toLowerCase()}` : 'Sign in to open'}
                    </Button>
                  ) : (
                    <span className="text-[12px] text-ink-400">
                      A {user.role.toLowerCase()} account does not open this screen — it belongs to the {screen.role.toLowerCase()}.
                    </span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-6">
        <h2 className="label">Guest screens — no login</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <GuestCard
            icon={Download}
            title="Ordering app to install"
            body={`Pickup, delivery or eat in at /eat/${slug} — Add to Home Screen and it runs full screen`}
            to={`/eat/${slug}`}
          />
          <GuestCard
            icon={QrCode}
            title="Table QR menu"
            body={menuTable ? `Table ${menuTable.number} · scans to the live menu` : 'Every table card carries its own token'}
            to={menuTable ? `/t/${menuTable.qrToken}` : null}
            locked="Sign in as manager or owner to pick up a live table link."
          />
          <GuestCard
            icon={Smartphone}
            title="Running order"
            body={seated[0]?.session ? `${seated[0].session.customerName || 'Party'} · ${seated[0].session.guestCount} pax` : 'What the guest sees after ordering'}
            to={seated[0]?.session ? `/s/${seated[0].session.publicToken}` : null}
            locked="No table is seated right now — open the floor map and seat one."
          />
          <GuestCard
            icon={Receipt}
            title="Digital bill"
            body={unpaid[0] ? `${unpaid[0].billNumber} · ${inr(unpaid[0].grandTotal)} with a UPI QR` : 'Itemised GST bill, shareable link'}
            to={unpaid[0]?.publicToken ? `/bill/${unpaid[0].publicToken}` : null}
            locked="Nothing is unpaid — issue a bill from the counter first."
          />
          <GuestCard
            icon={CalendarCheck}
            title="Public booking"
            body={`Reservations at /book/${slug}`}
            to={`/book/${slug}`}
          />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-6">
        <h2 className="label">Every route in the app</h2>
        <div className="mt-3 rounded-2xl bg-white p-1.5 ring-1 ring-ink-200">
          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { to: '/app', label: 'Live dashboard', icon: LayoutGrid, perm: 'orders:read' },
              { to: '/app/orders', label: 'All orders', icon: ClipboardList, perm: 'orders:read' },
              { to: '/app/tables', label: 'Tables and QR cards', icon: Store, perm: 'tables:read' },
              { to: '/app/menu', label: 'Menu and pricing', icon: MenuIcon, perm: 'menu:read' },
              { to: '/app/bookings', label: 'Reservations', icon: CalendarCheck, perm: 'bookings:read' },
              { to: '/app/inventory', label: 'Stock and recipes', icon: Boxes, perm: 'inventory:read' },
              { to: '/app/staff', label: 'Staff and roles', icon: UserCog, perm: 'staff:read' },
              { to: '/app/reports', label: 'Sales reports', icon: ScrollText, perm: 'reports:read' },
              { to: '/app/delivery', label: 'Swiggy / Zomato feed', icon: Webhook, perm: 'integrations:read' },
              { to: '/app/audit', label: 'Audit trail', icon: ShieldCheck, perm: 'audit:read' },
              { to: '/app/settings', label: 'Restaurant settings', icon: Settings, perm: 'settings:write' },
              { to: '/floor/map', label: 'Floor map (waiter)', icon: QrCode, perm: 'tables:read' },
              { to: '/floor/order', label: 'New ticket (waiter)', icon: ClipboardList, perm: 'orders:write' },
              { to: '/pos/requests', label: 'Guest request queue', icon: ConciergeBell, perm: 'requests:read' },
              { to: '/kds', label: 'Kitchen display', icon: ChefHat, perm: 'kitchen:operate' },
              { to: '/login', label: 'Sign in', icon: ArrowRight, perm: '' },
            ].map((item) => {
              const allowed = item.to === '/login' || can(user?.role, item.perm);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium transition-colors ${
                    allowed ? 'text-ink-700 hover:bg-ember-50 hover:text-ember-700' : 'text-ink-300 hover:bg-ink-50'
                  }`}
                >
                  <item.icon size={15} className={allowed ? 'text-ink-400' : 'text-ink-200'} />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  <span className="font-mono text-[10.5px] text-ink-300">{item.to}</span>
                  {!allowed && <Ban size={12} className="shrink-0 text-ink-200" />}
                </Link>
              );
            })}
          </div>
        </div>
        <p className="mt-2.5 text-[12px] leading-relaxed text-ink-500">
          Greyed links are routes your current role cannot open — the backend refuses them too, not just this page.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-10 pt-4">
        <div className="rounded-2xl bg-ink-900 px-5 py-5 text-white">
          <h3 className="font-display text-[16px] font-800">The loop, if you want to watch it move</h3>
          <ol className="mt-3 grid gap-2.5 text-[13px] leading-relaxed text-ink-300 sm:grid-cols-2 lg:grid-cols-4">
            {[
              'Open the table QR menu in a second tab and order butter chicken.',
              'Watch the ticket appear on the kitchen display without a refresh.',
              'Seat the party, then raise the bill from the counter — the UPI QR is already cut.',
              'Collect cash or mark the UPI paid; the guest link flips to PAID instantly.',
            ].map((step, i) => (
              <li key={step} className="flex gap-2.5">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-ember-500 text-[12px] font-bold text-white">
                  {i + 1}
                </span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      </section>

      <footer className="border-t border-ink-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-5 py-5 text-[12.5px] text-ink-500">
          <span>Sizzle · restaurant platform</span>
          <Link to="/register" className="font-semibold text-ember-600 hover:underline">
            Onboard a restaurant
          </Link>
          <Link to={`/book/${slug}`} className="font-semibold text-ember-600 hover:underline">
            Book a table
          </Link>
          <span className="ml-auto">No demo password ships in this build — every screen opens for an account its own person created.</span>
        </div>
      </footer>
    </div>
  );
}

function LiveBadge() {
  const connected = useRealtimeConnected();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold ring-1 ring-inset ${
        connected ? 'bg-leaf-100 text-leaf-700 ring-leaf-500/30' : 'bg-ink-100 text-ink-500 ring-ink-200'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-leaf-500 pulse' : 'bg-ink-400'}`} />
      {connected ? 'Live' : 'Offline'}
    </span>
  );
}

function GuestCard({
  icon: Icon,
  title,
  body,
  to,
  locked,
}: {
  icon: typeof ChefHat;
  title: string;
  body: string;
  to: string | null;
  locked?: string;
}) {
  return (
    <article className="flex flex-col overflow-hidden rounded-2xl bg-white ring-1 ring-ink-200">
      <div className="flex-1 px-4 pt-4">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-ember-50 text-ember-600">
          <Icon size={17} />
        </span>
        <h3 className="mt-3 font-display text-[15px] font-800 text-ink-900">{title}</h3>
        <p className="mt-1 text-[12.5px] leading-snug text-ink-500">{body}</p>
      </div>
      <div className="mt-3 px-4 pb-4">
        {to ? (
          <a
            href={to}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ember-600 hover:underline"
          >
            Open in a new tab <ExternalLink size={12} />
          </a>
        ) : (
          <p className="text-[12px] leading-snug text-ink-400">{locked ?? 'Not available yet.'}</p>
        )}
      </div>
    </article>
  );
}
