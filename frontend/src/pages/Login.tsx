import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { SignIn, useUser, useSignIn } from '@clerk/clerk-react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  Flame,
  Fingerprint,
  KeyRound,
  Mail,
  MessageSquareText,
  ShieldCheck,
  Smartphone,
  Sparkles,
} from 'lucide-react';
import { Brand } from '../layouts/AppShell';
import { Button, Field, Input, Spinner } from '../components/ui';
import { useAuth } from '../store/auth';
import { connectRealtime } from '../lib/socket';
import { errMsg, http } from '../lib/api';
import type { Role } from '../lib/types';

/** Maps a staff role to their home route — used by every post-login redirect. */
export function homeFor(role: Role): string {
  switch (role) {
    case 'KITCHEN':
    case 'COOK':
      return '/kds';
    case 'WAITER':
      return '/floor';
    case 'CASHIER':
      return '/pos';
    default:
      return '/app';
  }
}

export function LoginPage() {
  const { user, syncClerk } = useAuth();
  const { isLoaded: isUserLoaded, isSignedIn: isClerkSignedIn, user: clerkUser } = useUser();
  const { isLoaded: isSignInLoaded, signIn, setActive } = useSignIn();
  const navigate = useNavigate();

  const [staffDoor, setStaffDoor] = useState(false);
  const [doorTab, setDoorTab] = useState<'email' | 'phone' | 'passkey'>('email');
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  async function handlePasskeySignIn() {
    if (!isSignInLoaded || !signIn) return;
    setPasskeyLoading(true);
    setPasskeyError(null);
    try {
      if (typeof (signIn as any).authenticateWithPasskey === 'function') {
        const response = await (signIn as any).authenticateWithPasskey();
        if (response?.status === 'complete' && response.createdSessionId) {
          if (setActive) {
            await setActive({ session: response.createdSessionId });
          }
        }
      } else {
        setPasskeyError('Passkeys are not configured in your Clerk dashboard yet.');
      }
    } catch (err: any) {
      if (err?.name !== 'NotAllowedError') {
        setPasskeyError(err?.errors?.[0]?.message || err?.message || 'Passkey authentication could not be completed.');
      }
    } finally {
      setPasskeyLoading(false);
    }
  }

  /** After a successful local or code login, open the right station screen. */
  const finish = useCallback(
    async (role?: Role) => {
      const u = role ? { role } : useAuth.getState().user;
      connectRealtime(useAuth.getState().accessToken);
      navigate(u ? homeFor(u.role) : '/app', { replace: true });
    },
    [navigate],
  );

  // When Clerk authenticates the user, sync with restaurant database:
  // If user has a restaurant -> straight to owner dashboard (/app)
  // If user is new -> straight to create restaurant form (/register)
  useEffect(() => {
    if (!isUserLoaded || !isClerkSignedIn || !clerkUser) return;
    let cancelled = false;

    async function sync() {
      setSyncing(true);
      setSyncError(null);
      try {
        const primaryEmail =
          clerkUser?.primaryEmailAddress?.emailAddress ||
          clerkUser?.emailAddresses?.[0]?.emailAddress ||
          '';
        const fullName =
          clerkUser?.fullName ||
          [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(' ') ||
          '';
        const primaryPhone =
          clerkUser?.primaryPhoneNumber?.phoneNumber ||
          clerkUser?.phoneNumbers?.[0]?.phoneNumber ||
          '';

        const result = await syncClerk({
          clerkUserId: clerkUser?.id ?? '',
          email: primaryEmail || undefined,
          name: fullName || undefined,
          phone: primaryPhone || undefined,
        });

        if (cancelled) return;

        if (!result.isNewUser && result.user) {
          // Existing owner or staff with restaurant -> send directly to their dashboard
          connectRealtime(useAuth.getState().accessToken);
          navigate(homeFor(result.user.role), { replace: true });
        } else {
          // New owner without a restaurant -> send to Create Restaurant form
          navigate('/register', { replace: true });
        }
      } catch (err: any) {
        if (cancelled) return;
        setSyncError(errMsg(err, 'Could not verify your restaurant account'));
      } finally {
        if (!cancelled) setSyncing(false);
      }
    }

    void sync();

    return () => {
      cancelled = true;
    };
  }, [isUserLoaded, isClerkSignedIn, clerkUser, syncClerk, navigate]);

  // If already authenticated in our system, navigate straight to their home dashboard
  if (user) return <Navigate to={homeFor(user.role)} replace />;

  const clerkSessionActive = isUserLoaded && isClerkSignedIn && !!clerkUser;

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* ── Left branding panel: Centered logo badge with borders, gap, and centered tagline ── */}
      <div className="relative hidden flex-col items-center justify-center overflow-hidden bg-ink-950 p-12 text-white lg:flex">
        {/* Subtle radial glow */}
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_var(--tw-gradient-stops))] from-ember-500/10 via-transparent to-transparent opacity-40" />

        {/* Logo Card — Centered on top with border on all sides */}
        <div className="relative z-10 flex flex-col items-center rounded-2xl border border-ink-700/80 bg-ink-900/60 px-12 py-7 shadow-xl shadow-black/40 backdrop-blur-sm">
          {/* Flame icon — centered at the top */}
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-ember-500 text-white shadow-lg shadow-ember-500/30">
            <Flame size={24} strokeWidth={2.4} />
          </span>
          {/* Logo title and subtitle — centered */}
          <div className="mt-3 text-center">
            <span className="block font-display text-[22px] font-800 tracking-tight text-white">
              Sizzle
            </span>
            <span className="block text-[10.5px] font-bold uppercase tracking-[0.2em] text-ember-500">
              Restaurant OS
            </span>
          </div>
        </div>

        {/* Gap between logo and text */}
        <div className="h-10" />

        {/* Tagline — Centered in the middle */}
        <div className="relative z-10 max-w-md space-y-4 text-center">
          <h2 className="font-display text-3xl font-800 tracking-tight text-white sm:text-4xl">
            Live orders, active tables and clear bills.
          </h2>
          <p className="text-[15px] leading-relaxed text-ink-300">
            One system for floor, counter and kitchen. Sign in and the account decides which station opens — owner,
            manager, waiter, kitchen or cashier.
          </p>
        </div>

        {/* Footer tagline */}
        <p className="absolute bottom-6 text-[12px] text-ink-500">
          Sizzle · floor, counter and kitchen in one system
        </p>
      </div>

      {/* ── Right Panel: Clerk Authentication & Station Access ── */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-14 bg-ink-50/50">
        <div className="mx-auto w-full max-w-sm">
          <div className="lg:hidden mb-6 flex justify-center">
            <Brand />
          </div>

          {/* ── Top Portal Selector: Owner vs Staff Station ── */}
          {!syncing && !clerkSessionActive && (
            <div className="mb-4 flex rounded-xl border border-ink-200/80 bg-ink-100/90 p-1 shadow-2xs">
              <button
                type="button"
                onClick={() => setStaffDoor(false)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-all ${
                  !staffDoor
                    ? 'bg-white text-ink-950 shadow-xs'
                    : 'text-ink-600 hover:text-ink-900'
                }`}
              >
                <span>👑 Owner / Management</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setDoorTab('email');
                  setStaffDoor(true);
                }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-bold transition-all ${
                  staffDoor
                    ? 'bg-white text-ember-600 shadow-xs ring-1 ring-ember-200'
                    : 'text-ink-600 hover:text-ink-900'
                }`}
              >
                <Mail size={13} className="text-ember-500" />
                <span>👤 Staff Door (Email OTP)</span>
              </button>
            </div>
          )}

          {syncing || clerkSessionActive ? (
            <div className="rounded-2xl border border-ink-200/80 bg-white p-8 text-center shadow-xs">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-ember-500/10 text-ember-600">
                <Spinner label="Verifying account" />
              </div>
              <h3 className="mt-4 font-display text-lg font-bold text-ink-900">
                Opening your restaurant workspace…
              </h3>
              <p className="mt-1 text-xs text-ink-500">
                Checking your restaurant association and permissions.
              </p>
              {syncError && (
                <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  {syncError}
                  <button
                    type="button"
                    onClick={() => {
                      const auth = useAuth.getState();
                      auth.logout();
                      setSyncError(null);
                    }}
                    className="mt-2 block w-full rounded-lg bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-200 transition-colors"
                  >
                    Sign out and try again
                  </button>
                </div>
              )}
            </div>
          ) : staffDoor ? (
            /* Staff Sign-in Door: Email Code or Phone Code (Passwordless) */
            <div className="rounded-2xl border border-ink-200/80 bg-white p-6 shadow-xs">
              <div className="flex items-center justify-between pb-4 border-b border-ink-100">
                <div>
                  <h3 className="font-display text-base font-bold text-ink-900">
                    Staff Station Sign In
                  </h3>
                  <p className="text-xs text-ink-500">Fast one-time code — no password needed</p>
                </div>
                <button
                  type="button"
                  onClick={() => setStaffDoor(false)}
                  className="text-xs font-semibold text-ember-600 hover:text-ember-700"
                >
                  Owner / Clerk &rarr;
                </button>
              </div>

              {/* Tabs for Email vs Passkey vs Phone Code */}
              <div className="mt-4 flex rounded-xl bg-ink-100 p-1">
                <button
                  type="button"
                  onClick={() => setDoorTab('email')}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all ${
                    doorTab === 'email' ? 'bg-white text-ink-900 shadow-2xs' : 'text-ink-600 hover:text-ink-900'
                  }`}
                >
                  <Mail size={13} />
                  <span>Email</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDoorTab('passkey')}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all ${
                    doorTab === 'passkey' ? 'bg-white text-ink-900 shadow-2xs' : 'text-ink-600 hover:text-ink-900'
                  }`}
                >
                  <Fingerprint size={13} className="text-ember-600" />
                  <span>Passkey</span>
                </button>
                <button
                  type="button"
                  onClick={() => setDoorTab('phone')}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold transition-all ${
                    doorTab === 'phone' ? 'bg-white text-ink-900 shadow-2xs' : 'text-ink-600 hover:text-ink-900'
                  }`}
                >
                  <Smartphone size={13} />
                  <span>Phone</span>
                </button>
              </div>

              <div className="mt-4">
                {doorTab === 'email' ? (
                  <EmailCodeForm onComplete={finish} />
                ) : doorTab === 'passkey' ? (
                  <PasskeyForm
                    onPasskey={handlePasskeySignIn}
                    loading={passkeyLoading}
                    error={passkeyError}
                  />
                ) : (
                  <CodeForm onComplete={finish} />
                )}
              </div>
            </div>
          ) : (
            /* Primary Clerk Sign-in Component */
            <div className="space-y-4">
              {syncError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                  {syncError}
                </div>
              )}

              {/* Passkey / Biometric Quick Sign-In */}
              <button
                type="button"
                onClick={handlePasskeySignIn}
                disabled={passkeyLoading}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-ink-200 bg-white py-2.5 px-4 text-xs font-semibold text-ink-800 shadow-2xs hover:bg-ink-50 transition-colors"
              >
                <Fingerprint size={16} className="text-ember-600" />
                <span>{passkeyLoading ? 'Verifying biometric passkey…' : 'Sign in with Passkey (Touch ID / Face ID)'}</span>
              </button>

              {passkeyError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
                  {passkeyError}
                </div>
              )}

              <div className="flex justify-center">
                <SignIn
                  routing="hash"
                  appearance={{
                    elements: {
                      rootBox: 'w-full',
                      card: 'shadow-xs border border-ink-200/80 rounded-2xl w-full p-6 bg-white',
                      headerTitle: 'font-display text-xl font-800 text-ink-950',
                      headerSubtitle: 'text-xs text-ink-500',
                      socialButtonsBlockButton:
                        'border border-ink-200 hover:bg-ink-50 rounded-xl text-ink-800 font-semibold text-xs py-2.5 transition-colors',
                      dividerLine: 'bg-ink-200',
                      dividerText: 'text-ink-400 text-[11px] font-semibold uppercase',
                      formButtonPrimary:
                        'bg-ember-500 hover:bg-ember-600 text-white font-semibold text-xs py-2.5 rounded-xl transition-all shadow-xs',
                      formFieldInput:
                        'rounded-xl border-ink-200 focus:border-ember-500 focus:ring-1 focus:ring-ember-500 text-xs py-2',
                      footerActionLink: 'text-ember-600 hover:text-ember-700 font-semibold text-xs',
                    },
                  }}
                />
              </div>

              {/* Bottom Card for floor staff & team sign in without password */}
              <div className="rounded-xl border border-ink-200/70 bg-white p-3.5 shadow-2xs">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 text-ink-600">
                    <Mail size={15} className="text-ember-500" />
                    <span>Staff member with email or phone code?</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDoorTab('email');
                      setStaffDoor(true);
                    }}
                    className="font-semibold text-ember-600 hover:text-ember-700"
                  >
                    Staff Sign In &rarr;
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-center gap-1.5 text-[11.5px] text-ink-400">
                <ShieldCheck size={13} className="text-leaf-600" />
                <span>Single Sign-On powered by Clerk</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Staff members can sign in with their registered email address:
 * They receive a short-lived 6-digit OTP code in their email, without needing any password.
 */
function EmailCodeForm({ onComplete }: { onComplete: (role?: Role) => void }) {
  const { loginWithEmailCode } = useAuth();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter your registered staff email address');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await http.post<{ ok: boolean; sent: boolean; demoCode?: string; name?: string; role?: string }>(
        '/auth/email-otp/request',
        { email: email.trim() },
      );
      setSent(true);
      if (data.demoCode) {
        setHint(`Demo code: ${data.demoCode}`);
        setCode(data.demoCode);
      }
    } catch (err) {
      setError(errMsg(err, 'No active staff account found with that email'));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await loginWithEmailCode(email.trim(), code.trim());
      onComplete();
    } catch (err) {
      setError(errMsg(err, 'That code is incorrect or has expired'));
    } finally {
      setBusy(false);
    }
  }

  if (!sent) {
    return (
      <form onSubmit={sendCode} className="space-y-3.5">
        <Field label="Staff Email Address" hint="The email your manager or owner invited you with.">
          <Input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="waiter@restaurant.in"
            inputMode="email"
            autoFocus
          />
        </Field>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <Button
          type="submit"
          variant="primary"
          className="w-full"
          loading={busy}
          icon={<Mail size={14} />}
        >
          Send Sign-in Code
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-3.5">
      <Field label={`Code sent to ${email}`} hint={hint ?? 'Enter the 6-digit code from your email.'}>
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
          inputMode="numeric"
          autoFocus
        />
      </Field>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <Button
        type="submit"
        variant="primary"
        className="w-full"
        loading={busy}
        icon={<KeyRound size={14} />}
      >
        Sign In with Code
      </Button>
      <button
        type="button"
        onClick={() => setSent(false)}
        className="w-full text-center text-xs text-ink-500 hover:text-ink-800"
      >
        Use a different email address
      </button>
    </form>
  );
}

/**
 * Floor workers (waiters, runners, cashiers) can sign in by phone number alone: they receive a
 * short-lived OTP code on SMS/WhatsApp without having to remember passwords.
 */
function CodeForm({ onComplete }: { onComplete: (role?: Role) => void }) {
  const { loginWithCode } = useAuth();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    if (phone.trim().length < 8) {
      setError('Enter your phone number');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await http.post<{ ok: boolean; sent: boolean; demoCode?: string }>(
        '/auth/otp/request',
        { phone: phone.trim() },
      );
      setSent(true);
      if (data.demoCode) {
        setHint(`Demo code: ${data.demoCode}`);
        setCode(data.demoCode);
      }
    } catch (err) {
      setError(errMsg(err, 'Could not send a code right now'));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await loginWithCode(phone.trim(), code.trim());
      onComplete();
    } catch (err) {
      setError(errMsg(err, 'That code is incorrect or has expired'));
    } finally {
      setBusy(false);
    }
  }

  if (!sent) {
    return (
      <form onSubmit={sendCode} className="space-y-3.5">
        <Field label="Phone number" hint="The phone you gave when your account was created.">
          <Input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91 98200 11001"
            inputMode="tel"
            autoFocus
          />
        </Field>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <Button
          type="submit"
          variant="primary"
          className="w-full"
          loading={busy}
          icon={<MessageSquareText size={14} />}
        >
          Send Login Code
        </Button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-3.5">
      <Field label={`Code sent to ${phone}`} hint={hint ?? 'Enter the digits from the text.'}>
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="123456"
          inputMode="numeric"
          autoFocus
        />
      </Field>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <Button
        type="submit"
        variant="primary"
        className="w-full"
        loading={busy}
        icon={<KeyRound size={14} />}
      >
        Sign In with Code
      </Button>
      <button
        type="button"
        onClick={() => setSent(false)}
        className="w-full text-center text-xs text-ink-500 hover:text-ink-800"
      >
        Try another phone number
      </button>
    </form>
  );
}

/**
 * Biometric Passkey sign-in for staff and managers (Touch ID / Face ID / Windows Hello).
 */
function PasskeyForm({
  onPasskey,
  loading,
  error,
}: {
  onPasskey: () => void;
  loading: boolean;
  error: string | null;
}) {
  return (
    <div className="space-y-4 py-3 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-ember-50 text-ember-600 ring-1 ring-ember-200">
        <Fingerprint size={30} />
      </div>
      <div>
        <h4 className="font-display text-sm font-bold text-ink-900">Sign in with Passkey</h4>
        <p className="mt-1 text-xs text-ink-500 leading-relaxed">
          Use Touch ID, Face ID, or Windows Hello to open your station instantly without typing a password.
        </p>
      </div>
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">
          {error}
        </div>
      )}
      <Button
        type="button"
        variant="primary"
        className="w-full"
        loading={loading}
        onClick={onPasskey}
        icon={<Fingerprint size={15} />}
      >
        Authenticate with Biometrics
      </Button>
    </div>
  );
}
