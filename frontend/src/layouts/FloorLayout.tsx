import { useEffect } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { CalendarCheck, ClipboardList, LogOut, PlusCircle, LayoutDashboard, Users } from 'lucide-react';
import { useAuth, can } from '../store/auth';
import { NotificationBell } from '../components/NotificationBell';
import { Brand } from './AppShell';
import { homeFor } from '../pages/Login';

export function FloorLayout() {
  const { user, ready, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    document.title = 'Sizzle — Floor';
  }, []);

  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== 'WAITER' && user.role !== 'MANAGER' && user.role !== 'OWNER') {
    return <Navigate to={homeFor(user.role)} replace />;
  }

  const tabs = [
    { to: '/floor', label: 'Floor', icon: Users, end: true },
    { to: '/floor/order', label: 'New order', icon: PlusCircle },
    { to: '/floor/map', label: 'Tables', icon: ClipboardList },
    { to: '/floor/bookings', label: 'Bookings', icon: CalendarCheck },
  ];

  const isActive = (to: string, end?: boolean) => (end ? location.pathname === to : location.pathname.startsWith(to));

  return (
    <div className="min-h-screen bg-ink-100 pb-20 lg:pb-0">
      <header className="sticky top-0 z-30 flex items-center gap-3 bg-ink-900 px-4 py-3 text-white">
        <Brand compact />
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate font-display text-[15px] font-700">{user.name}</p>
          <p className="text-[11px] text-ink-400">Waiter · mobile</p>
        </div>
        {(user.role === 'MANAGER' || user.role === 'OWNER') && (
          <button
            onClick={() => navigate('/app')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-[12px] font-semibold hover:bg-white/5"
          >
            <LayoutDashboard size={13} /> Office
          </button>
        )}
        <NotificationBell />
        <button
          onClick={() => { logout(); navigate('/login'); }}
          className="grid h-9 w-9 place-items-center rounded-lg text-ink-400 hover:bg-white/5 hover:text-white"
          title="Sign out"
        >
          <LogOut size={17} />
        </button>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-5">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-ink-200 bg-white/95 backdrop-blur lg:hidden">
        {tabs.map((t) => (
          <button
            key={t.to}
            onClick={() => navigate(t.to)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold transition-colors ${
              isActive(t.to, t.end) ? 'text-ember-600' : 'text-ink-400'
            }`}
          >
            <t.icon size={19} strokeWidth={isActive(t.to, t.end) ? 2.4 : 2} />
            {t.label}
          </button>
        ))}
      </nav>

      <nav className="fixed left-4 top-24 hidden flex-col gap-1 lg:flex">
        {tabs.map((t) => (
          <button
            key={t.to}
            onClick={() => navigate(t.to)}
            className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-[13px] font-semibold transition-colors ${
              isActive(t.to, t.end) ? 'bg-ink-900 text-white' : 'text-ink-500 hover:bg-ink-200'
            }`}
          >
            <t.icon size={15} /> {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
