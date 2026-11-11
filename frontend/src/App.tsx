import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage, homeFor } from './pages/Login';
import { useAuth } from './store/auth';
import { StaffLayout } from './layouts/StaffLayout';
import { KdsLayout } from './layouts/KdsLayout';
import { FloorLayout } from './layouts/FloorLayout';
import { PosLayout } from './layouts/PosLayout';
import { Spinner } from './components/ui';
import { Toaster } from './components/Toaster';
import { FirstRun } from './components/FirstRun';
import { useRealtimeShell } from './hooks/useRealtimeShell';

const Hub = lazy(() => import('./pages/Hub').then((m) => ({ default: m.Hub })));
const RegisterPage = lazy(() => import('./pages/Register').then((m) => ({ default: m.RegisterPage })));
const NotFound = lazy(() => import('./pages/NotFound').then((m) => ({ default: m.NotFound })));
const StaffInstall = lazy(() => import('./pages/StaffInstall').then((m) => ({ default: m.StaffInstall })));

const DashboardPage = lazy(() => import('./pages/owner/DashboardPage').then((m) => ({ default: m.DashboardPage })));
const OrdersPage = lazy(() => import('./pages/owner/OrdersPage').then((m) => ({ default: m.OrdersPage })));
const OrderDetailPage = lazy(() => import('./pages/owner/OrderDetailPage').then((m) => ({ default: m.OrderDetailPage })));
const TablesPage = lazy(() => import('./pages/owner/TablesPage').then((m) => ({ default: m.TablesPage })));
const MenuPage = lazy(() => import('./pages/owner/MenuPage').then((m) => ({ default: m.MenuPage })));
const BookingsPage = lazy(() => import('./pages/owner/BookingsPage').then((m) => ({ default: m.BookingsPage })));
const InventoryPage = lazy(() => import('./pages/owner/InventoryPage').then((m) => ({ default: m.InventoryPage })));
const StaffPage = lazy(() => import('./pages/owner/StaffPage').then((m) => ({ default: m.StaffPage })));
const ReportsPage = lazy(() => import('./pages/owner/ReportsPage').then((m) => ({ default: m.ReportsPage })));
const PaymentsPage = lazy(() => import('./pages/owner/PaymentsPage').then((m) => ({ default: m.PaymentsPage })));
const DeliveryPage = lazy(() => import('./pages/owner/DeliveryPage').then((m) => ({ default: m.DeliveryPage })));
const AuditPage = lazy(() => import('./pages/owner/AuditPage').then((m) => ({ default: m.AuditPage })));
const SettingsPage = lazy(() => import('./pages/owner/SettingsPage').then((m) => ({ default: m.SettingsPage })));

const KdsBoard = lazy(() => import('./pages/kitchen/KdsBoard').then((m) => ({ default: m.KdsBoard })));
const FloorMap = lazy(() => import('./pages/waiter/FloorMap').then((m) => ({ default: m.FloorMap })));
const NewOrder = lazy(() => import('./pages/waiter/NewOrder').then((m) => ({ default: m.NewOrder })));
const WaiterFloor = lazy(() => import('./pages/waiter/WaiterFloor').then((m) => ({ default: m.WaiterFloor })));
const BillsPage = lazy(() => import('./pages/pos/BillsPage').then((m) => ({ default: m.BillsPage })));
const PosRequests = lazy(() => import('./pages/pos/PosRequests').then((m) => ({ default: m.PosRequests })));

const GuestMenu = lazy(() => import('./pages/guest/GuestMenu').then((m) => ({ default: m.GuestMenu })));
const GuestSession = lazy(() => import('./pages/guest/GuestSession').then((m) => ({ default: m.GuestSession })));
const GuestBill = lazy(() => import('./pages/guest/GuestBill').then((m) => ({ default: m.GuestBill })));
const PublicBooking = lazy(() => import('./pages/guest/PublicBooking').then((m) => ({ default: m.PublicBooking })));
const ApplyJob = lazy(() => import('./pages/ApplyJob').then((m) => ({ default: m.ApplyJob })));

const AppLanding = lazy(() => import('./pages/app/AppLanding').then((m) => ({ default: m.AppLanding })));
const CustomerApp = lazy(() => import('./pages/app/CustomerApp').then((m) => ({ default: m.CustomerApp })));
const AppTrack = lazy(() => import('./pages/app/AppTrack').then((m) => ({ default: m.AppTrack })));
const MockCheckout = lazy(() => import('./pages/app/MockCheckout').then((m) => ({ default: m.MockCheckout })));

function RootRoute() {
  const { user, ready } = useAuth();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homeFor(user.role)} replace />;
}

export function App() {
  // One listener set for the whole app, mounted here rather than in the staff layouts: a report, a
  // delivery queue or a guest menu opened directly has to repaint on the server's word too, and a
  // screen that only listens while a particular layout is on screen is a screen that needs a refresh.
  useRealtimeShell();
  return (
    <Suspense fallback={<div className="grid min-h-screen place-items-center bg-ink-50"><Spinner label="Loading…" /></div>}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* One installable app for the whole team; the account decides the screen */}
        <Route path="/staff.html" element={<StaffInstall />} />

        {/* ── Protected staff routes — must be signed in ── */}

        {/* Back office — owner & manager */}
        <Route path="/app" element={<StaffLayout />}>
          <Route index element={<DashboardPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="orders/:id" element={<OrderDetailPage />} />
          <Route path="requests" element={<PosRequests />} />
          <Route path="tables" element={<TablesPage />} />
          <Route path="menu" element={<MenuPage />} />
          <Route path="bookings" element={<BookingsPage />} />
          <Route path="inventory" element={<InventoryPage />} />
          <Route path="staff" element={<StaffPage />} />
          <Route path="reports" element={<ReportsPage />} />
          <Route path="payments" element={<PaymentsPage />} />
          <Route path="delivery" element={<DeliveryPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>

        {/* Role-specific workspaces */}
        <Route path="/kds" element={<KdsLayout />}>
          <Route index element={<KdsBoard />} />
        </Route>

        <Route path="/floor" element={<FloorLayout />}>
          <Route index element={<WaiterFloor />} />
          <Route path="map" element={<FloorMap />} />
          <Route path="order" element={<NewOrder />} />
          <Route path="bookings" element={<BookingsPage />} />
        </Route>

        <Route path="/pos" element={<PosLayout />}>
          <Route index element={<BillsPage />} />
          <Route path="requests" element={<PosRequests />} />
        </Route>

        {/* Guest flows — no auth required */}
        <Route path="/eat" element={<AppLanding />} />
        <Route path="/eat/:slug" element={<CustomerApp />} />
        <Route path="/track/:token" element={<AppTrack />} />
        <Route path="/pay/mock" element={<MockCheckout />} />
        <Route path="/t/:tableToken" element={<GuestMenu />} />
        <Route path="/s/:publicToken" element={<GuestSession />} />
        <Route path="/bill/:billToken" element={<GuestBill />} />
        <Route path="/book/:slug" element={<PublicBooking />} />
        <Route path="/apply/:slug" element={<ApplyJob />} />

        <Route path="/" element={<RootRoute />} />
        <Route path="/hub" element={<Hub />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      {/* Every screen raises its notices here — the layouts are too busy to carry them. */}
      <Toaster />
      {/* A machine that has never held a restaurant gets asked to open one before anything else. */}
      <FirstRun />
    </Suspense>
  );
}
