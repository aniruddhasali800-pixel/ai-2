import { useState, type ReactNode } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Flame, LogOut, Menu, Wifi, WifiOff, X } from 'lucide-react';
import { useAuth } from '../store/auth';
import { NotificationBell } from '../components/NotificationBell';
import { useRealtimeConnected } from '../lib/socket';
import { initials } from '../lib/format';

export interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  end?: boolean;
}

export function Brand({ compact = false, light = false }: { compact?: boolean; light?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-ember-500 text-white shadow-sm shadow-ember-500/30">
        <Flame size={19} strokeWidth={2.4} />
      </span>
      {!compact && (
        <span className="leading-tight">
          <span className={`block font-display text-[17px] font-800 tracking-tight ${light ? 'text-white' : 'text-ink-900'}`}>
            Sizzle
          </span>
          <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-ember-500">Restaurant OS</span>
        </span>
      )}
    </div>
  );
}

function LiveChip() {
  const connected = useRealtimeConnected();
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold ${
        connected ? 'bg-leaf-100 text-leaf-600' : 'bg-ink-200 text-ink-500'
      }`}
      title={connected ? 'Realtime connected' : 'Reconnecting…'}
    >
      {connected ? <Wifi size={12} /> : <WifiOff size={12} className="pulse" />}
      {connected ? 'Live' : 'Offline'}
    </span>
  );
}

export function AppShell({
  nav,
  title,
  subtitle,
  actions,
  children,
  bare = false,
  headerExtra,
}: {
  nav: NavItem[];
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  bare?: boolean;
  headerExtra?: ReactNode;
}) {
  const { user, restaurant, logout } = useAuth();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-5 py-5">
        <Link to="/">
          <Brand light />
        </Link>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setDrawer(false)}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium transition-colors ${
                isActive ? 'bg-ember-500/15 text-white ring-1 ring-inset ring-ember-500/30' : 'text-ink-400 hover:bg-white/5 hover:text-ink-100'
              }`
            }
          >
            <span className="shrink-0">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink-700 text-[12px] font-bold text-white">
            {initials(user?.name ?? '?')}
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[13px] font-semibold text-white">{user?.name}</span>
            <span className="block truncate text-[11px] text-ink-400">{user?.role?.toLowerCase()}</span>
          </span>
          <button
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="text-ink-400 transition-colors hover:text-white"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-ink-100 lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 bg-ink-900 lg:block">{sidebar}</aside>

      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/50" onClick={() => setDrawer(false)} />
          <aside className="animate-in absolute left-0 top-0 h-full w-64 bg-ink-900">
            <button onClick={() => setDrawer(false)} className="absolute right-3 top-4 text-ink-400">
              <X size={18} />
            </button>
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-200 bg-ink-50/90 px-4 py-3 backdrop-blur lg:px-7">
          <button className="lg:hidden" onClick={() => setDrawer(true)} aria-label="Menu">
            <Menu size={20} className="text-ink-600" />
          </button>
          <div className="min-w-0 flex-1">
            {title && <h1 className="truncate font-display text-lg font-800 tracking-tight text-ink-900 lg:text-xl">{title}</h1>}
            {subtitle && <p className="truncate text-[12.5px] text-ink-500">{subtitle}</p>}
          </div>
          {headerExtra}
          <div className="flex items-center gap-2">
            <span className="hidden md:inline-flex">
              <LiveChip />
            </span>
            {actions}
            <NotificationBell />
          </div>
        </header>
        <main className={bare ? 'min-w-0 flex-1' : 'min-w-0 flex-1 px-4 py-5 lg:px-7 lg:py-6'}>
          <div className={bare ? '' : 'mx-auto max-w-[1180px]'}>{children}</div>
        </main>
      </div>
    </div>
  );
}

export { LiveChip };
