import { useCallback, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  ChefHat,
  ConciergeBell,
  CreditCard,
  Eye,
  EyeOff,
  Lock,
  LogOut,
  Mail,
  ShieldCheck,
  Store,
  UserCheck,
} from 'lucide-react';
import { Brand } from '../layouts/AppShell';
import { Button, Field, Input } from '../components/ui';
import { useAuth } from '../store/auth';
import { connectRealtime } from '../lib/socket';
import { errMsg } from '../lib/api';
import type { Role } from '../lib/types';

/** Maps a staff role to their dedicated station — used by post-login redirect & route guards. */
export function homeFor(role: Role): string {
  switch (role) {
    case 'KITCHEN':
      return '/kds';
    case 'WAITER':
      return '/floor';
    case 'CASHIER':
      return '/pos';
    case 'MANAGER':
    case 'OWNER':
    default:
      return '/app';
  }
}

export function LoginPage() {
  const { user, login, logout } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** After a successful login, open the authorized station screen. */
  const finish = useCallback(
    async (role?: Role) => {
      const u = role ? { role } : useAuth.getState().user;
      connectRealtime(useAuth.getState().accessToken);
      navigate(u ? homeFor(u.role) : '/app', { replace: true });
    },
    [navigate],
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(identifier.trim(), password);
      await finish();
    } catch (err) {
      setError(errMsg(err, 'Invalid email or password. Please check your credentials.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Decorative / branding panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink-950 p-12 text-white lg:flex">
        <div className="relative z-10">
          <Brand light />
        </div>
        <div className="relative z-10 max-w-md space-y-4">
          <h2 className="font-display text-3xl font-800 tracking-tight text-white sm:text-4xl">
            Strict Role-Based Operations Portal.
          </h2>
          <p className="text-[15px] leading-relaxed text-ink-300">
            Sign in with your Email ID and Password. The system strictly authorizes your account to open only your assigned workspace:
          </p>

          <div className="grid gap-2.5 pt-2 text-xs">
            <div className="flex items-center gap-2.5 rounded-lg bg-white/5 px-3 py-2 text-ink-200 border border-white/10">
              <ShieldCheck size={16} className="text-amber-400 shrink-0" />
              <span><strong>Owner / Manager:</strong> Full Back-Office Dashboard (/app)</span>
            </div>
            <div className="flex items-center gap-2.5 rounded-lg bg-white/5 px-3 py-2 text-ink-200 border border-white/10">
              <ConciergeBell size={16} className="text-blue-400 shrink-0" />
              <span><strong>Waiter:</strong> Floor Tables &amp; Orders (/floor)</span>
            </div>
            <div className="flex items-center gap-2.5 rounded-lg bg-white/5 px-3 py-2 text-ink-200 border border-white/10">
              <ChefHat size={16} className="text-emerald-400 shrink-0" />
              <span><strong>Kitchen:</strong> Kitchen Display System (/kds)</span>
            </div>
            <div className="flex items-center gap-2.5 rounded-lg bg-white/5 px-3 py-2 text-ink-200 border border-white/10">
              <CreditCard size={16} className="text-purple-400 shrink-0" />
              <span><strong>Cashier:</strong> Counter POS &amp; Billing (/pos)</span>
            </div>
          </div>
        </div>
        <p className="relative text-[12px] text-ink-500">Sizzle · Secured Multi-Tenant Restaurant OS</p>
      </div>

      {/* Login Form Container */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-14">
        <div className="mx-auto w-full max-w-sm">
          <div className="lg:hidden">
            <Brand />
          </div>

          <h1 className="mt-8 font-display text-2xl font-800 tracking-tight text-ink-900 lg:mt-0">
            Sign in to your restaurant
          </h1>
          <p className="mt-1 text-sm leading-relaxed text-ink-500">
            Enter your assigned Email ID and password to access your role dashboard.
          </p>

          {/* Currently logged-in indicator if a session already exists */}
          {user && (
            <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50/70 p-3.5 text-amber-950">
              <div className="flex items-center gap-2 font-semibold text-xs text-amber-900">
                <UserCheck size={16} className="text-amber-700 shrink-0" />
                <span>Currently active: <strong>{user.name}</strong> ({user.role})</span>
              </div>
              <p className="mt-1 text-[11.5px] text-amber-800">
                Opening in this browser will use this account.
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => finish(user.role)}
                  icon={<ArrowRight size={13} />}
                >
                  Continue to {user.role} Dashboard
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    logout();
                    setError(null);
                  }}
                  icon={<LogOut size={13} />}
                >
                  Sign out
                </Button>
              </div>
            </div>
          )}

          <form onSubmit={submit} className="mt-5 space-y-4">
            <Field label="Email ID or Phone">
              <div className="relative">
                <Input
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="owner@restaurant.in or employee@restaurant.com"
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>
            </Field>

            <Field label="Password">
              <div className="relative flex items-center">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  autoComplete="current-password"
                  required
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 text-ink-400 hover:text-ink-700 focus:outline-none"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </Field>

            {error && (
              <p className="rounded-lg bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700 ring-1 ring-red-200">
                {error}
              </p>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              className="w-full"
              loading={busy}
              icon={<ArrowRight size={16} />}
            >
              Sign in with Email
            </Button>
          </form>

          <div className="my-7 flex items-center gap-3">
            <span className="h-px flex-1 bg-ink-200" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-400">or</span>
            <span className="h-px flex-1 bg-ink-200" />
          </div>

          <button
            type="button"
            onClick={() => navigate('/register')}
            className="flex w-full items-center gap-3 rounded-xl border border-ink-200 bg-white px-4 py-3.5 text-left transition-all hover:border-ember-300 hover:bg-ember-50/40"
          >
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-ember-500 text-white">
              <Store size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14.5px] font-semibold text-ink-900">Create a restaurant</span>
              <span className="block text-[12.5px] leading-relaxed text-ink-500">
                Register a new store with an owner email &amp; password.
              </span>
            </span>
            <ArrowRight size={16} className="shrink-0 text-ink-400" />
          </button>

          <p className="mt-6 flex items-start gap-2 text-[11.5px] leading-relaxed text-ink-400">
            <ShieldCheck size={13} className="mt-0.5 shrink-0" />
            <span>
              All roles (Owner, Manager, Cashier, Kitchen, Waiter) are strictly authenticated with Email ID &amp; Password.
            </span>
          </p>
        </div>
      </div>
    </div>
  );
}
