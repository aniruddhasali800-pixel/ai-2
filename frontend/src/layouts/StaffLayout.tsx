import { Navigate, Outlet, useLocation } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  CalendarClock,
  ClipboardList,
  LayoutGrid,
  Link2,
  ScrollText,
  Settings,
  ShoppingBasket,
  ShieldCheck,
  Sparkles,
  UtensilsCrossed,
  Users,
  Wallet,
} from 'lucide-react';
import { AppShell, type NavItem } from './AppShell';
import { useAuth, can } from '../store/auth';
import { homeFor } from '../pages/Login';

const NAV: (NavItem & { permission: string })[] = [
  { to: '/app', label: 'Dashboard', icon: <LayoutGrid size={17} />, permission: 'reports:read', end: true },
  { to: '/app/orders', label: 'Orders', icon: <ClipboardList size={17} />, permission: 'orders:read' },
  { to: '/app/requests', label: 'Guest calls', icon: <Bell size={17} />, permission: 'requests:read' },
  { to: '/app/tables', label: 'Tables & QR', icon: <Sparkles size={17} />, permission: 'tables:read' },
  { to: '/app/menu', label: 'Menu', icon: <UtensilsCrossed size={17} />, permission: 'menu:read' },
  { to: '/app/bookings', label: 'Bookings', icon: <CalendarClock size={17} />, permission: 'bookings:read' },
  { to: '/app/inventory', label: 'Inventory', icon: <ShoppingBasket size={17} />, permission: 'inventory:read' },
  { to: '/app/staff', label: 'Staff', icon: <Users size={17} />, permission: 'staff:read' },
  { to: '/app/reports', label: 'Reports', icon: <BarChart3 size={17} />, permission: 'reports:read' },
  { to: '/app/payments', label: 'Payments', icon: <Wallet size={17} />, permission: 'payments:read' },
  { to: '/app/delivery', label: 'Delivery', icon: <Link2 size={17} />, permission: 'integrations:write' },
  { to: '/app/audit', label: 'Audit log', icon: <ScrollText size={17} />, permission: 'audit:read' },
  { to: '/app/settings', label: 'Settings', icon: <Settings size={17} />, permission: 'settings:read' },
];

export function StaffLayout() {
  const { user, restaurant, ready } = useAuth();
  const location = useLocation();

  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.role !== 'OWNER' && user.role !== 'MANAGER') {
    return <Navigate to={homeFor(user.role)} replace />;
  }

  const nav = NAV.filter((n) => can(user.role, n.permission));

  return (
    <AppShell nav={nav} title={restaurant?.name ?? 'Sizzle'} subtitle="Back office">
      <Outlet />
    </AppShell>
  );
}

export { ShieldCheck };
