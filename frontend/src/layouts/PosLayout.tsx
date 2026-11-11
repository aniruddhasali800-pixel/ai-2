import { useEffect } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Inbox, ReceiptText, LayoutDashboard, LogOut } from 'lucide-react';
import { useAuth, can } from '../store/auth';
import { NotificationBell } from '../components/NotificationBell';
import { Brand } from './AppShell';
import { useQuery } from '../lib/query';
import { homeFor } from '../pages/Login';
import type { Paginated, CustomerRequest } from '../lib/types';

export function PosLayout() {
  const { user, ready, restaurant, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: requests } = useQuery<Paginated<CustomerRequest>>('requests:list', '/waiters/requests');

  useEffect(() => {
    document.title = 'Sizzle — Cashier';
  }, []);

  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== 'CASHIER' && user.role !== 'MANAGER' && user.role !== 'OWNER') {
    return <Navigate to={homeFor(user.role)} replace />;
  }

  const openRequests = requests?.data.filter((r) => r.status !== 'DONE').length ?? 0;
  const tabs = [
    { to: '/pos', label: 'Bills', icon: ReceiptText, end: true },
    { to: '/pos/requests', label: 'Guest calls', icon: Inbox, badge: openRequests },
  ];
  const isActive = (to: string, end?: boolean) => (end ? location.pathname === to : location.pathname.startsWith(to));

  return (
    <div className="min-h-screen bg-ink-100">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-ink-200 bg-white px-4 py-3">
        <Brand compact />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-display text-[15px] font-700 text-ink-900">{restaurant?.name ?? 'Cashier'}</p>
          <p className="text-[11px] text-ink-500">{user.name} · counter</p>
        </div>
        <span className="hidden items-center gap-2 sm:flex">
          {tabs.map((t) => (
            <button
              key={t.to}
              onClick={() => navigate(t.to)}
              className={`relative inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                isActive(t.to, t.end) ? 'bg-ink-900 text-white' : 'text-ink-500 hover:bg-ink-100'
              }`}
            >
              <t.icon size={15} /> {t.label}
              {!!t.badge && (
                <span className="ml-1 grid h-4 min-w-4 place-items-center rounded-full bg-ember-500 px-1 text-[10px] font-bold text-white">
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </span>
        {(user.role === 'MANAGER' || user.role === 'OWNER') && (
          <button
            onClick={() => navigate('/app')}
            className="hidden items-center gap-1.5 rounded-lg border border-ink-200 px-2.5 py-1.5 text-[12px] font-semibold text-ink-600 hover:bg-ink-100 md:inline-flex"
          >
            <LayoutDashboard size={13} /> Office
          </button>
        )}
        <NotificationBell />
        <button
          onClick={() => { logout(); navigate('/login'); }}
          className="grid h-9 w-9 place-items-center rounded-lg text-ink-400 hover:bg-ink-100 hover:text-ink-900"
          title="Sign out"
        >
          <LogOut size={17} />
        </button>
      </header>

      {/* Mobile tab strip */}
      <div className="flex border-b border-ink-200 bg-white sm:hidden">
        {tabs.map((t) => (
          <button
            key={t.to}
            onClick={() => navigate(t.to)}
            className={`flex flex-1 items-center justify-center gap-1.5 py-2 text-[13px] font-semibold ${
              isActive(t.to, t.end) ? 'border-b-2 border-ember-500 text-ink-900' : 'text-ink-500'
            }`}
          >
            <t.icon size={15} /> {t.label}
            {!!t.badge && (
              <span className="grid h-4 min-w-4 place-items-center rounded-full bg-ember-500 px-1 text-[10px] font-bold text-white">
                {t.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      <main className="mx-auto max-w-[1180px] px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}
