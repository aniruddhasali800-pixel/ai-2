import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Sparkles,
  Store,
  User,
  UtensilsCrossed,
} from 'lucide-react';
import { Brand } from '../layouts/AppShell';
import { Button, Field, Input } from '../components/ui';
import { ImagePicker } from '../components/ImagePicker';
import { useAuth } from '../store/auth';
import { connectRealtime } from '../lib/socket';
import { errMsg, mediaUrl } from '../lib/api';

export function RegisterPage() {
  const { user, register } = useAuth();
  const navigate = useNavigate();

  // 2-Step Form State:
  // Step 1: Restaurant Name, Tagline, Cuisine, Address, Logo
  // Step 2: Owner Name, Owner Email ID, Password, Phone
  const [step, setStep] = useState<1 | 2>(1);

  const [form, setForm] = useState({
    // Step 1: Restaurant Details
    restaurantName: '',
    tagline: '',
    cuisine: '',
    logoUrl: '',
    address: {
      line1: '',
      city: '',
      state: '',
      pincode: '',
    },
    // Step 2: Owner Details
    name: '',
    email: '',
    phone: '',
    password: '',
  });

  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (user) return <Navigate to="/app" replace />;

  const setField = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  const setAddressField = (k: keyof typeof form.address) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, address: { ...f.address, [k]: e.target.value } }));
  };

  // Validation when moving from Step 1 to Step 2
  function goToStep2(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.restaurantName.trim()) {
      setError('Please provide your restaurant/store name.');
      return;
    }
    setStep(2);
  }

  // Final submission on Step 2
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const cleanRestaurant = form.restaurantName.trim();
    const cleanEmail = form.email.trim().toLowerCase();
    const cleanPassword = form.password;
    const cleanName = form.name.trim() || (cleanEmail ? cleanEmail.split('@')[0] : '') || `${cleanRestaurant} Owner`;
    const cleanPhone = form.phone.trim();

    if (!cleanRestaurant) {
      setError('Please provide your restaurant name.');
      setStep(1);
      setBusy(false);
      return;
    }

    if (!cleanEmail && !cleanPhone) {
      setError('Please enter your email ID to sign in with.');
      setBusy(false);
      return;
    }

    if (!cleanPassword || cleanPassword.length < 6) {
      setError('Password must be at least 6 characters.');
      setBusy(false);
      return;
    }

    try {
      await register({
        restaurantName: cleanRestaurant,
        name: cleanName,
        email: cleanEmail || undefined,
        phone: cleanPhone || undefined,
        password: cleanPassword,
        cuisine: form.cuisine.trim() || undefined,
        tagline: form.tagline.trim() || undefined,
        logoUrl: form.logoUrl || undefined,
        address: {
          line1: form.address.line1.trim() || undefined,
          city: form.address.city.trim() || undefined,
          state: form.address.state.trim() || undefined,
          pincode: form.address.pincode.trim() || undefined,
        },
      });

      connectRealtime(useAuth.getState().accessToken);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(errMsg(err, 'Could not create the restaurant. Please check your credentials.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink-100 px-4 py-10 sm:px-6">
      <div className="w-full max-w-xl">
        <div className="flex justify-center">
          <Brand />
        </div>

        {/* Stepper indicator: Step 1 vs Step 2 */}
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            onClick={() => {
              setError(null);
              setStep(1);
            }}
            className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
              step === 1
                ? 'bg-ember-500 text-white shadow-sm'
                : 'bg-white text-ink-600 ring-1 ring-ink-200 hover:bg-ink-50'
            }`}
          >
            <Store size={14} />
            <span>1. Restaurant &amp; Information</span>
          </button>
          <div className="h-0.5 w-6 bg-ink-200" />
          <button
            type="button"
            onClick={() => {
              if (form.restaurantName.trim()) {
                setError(null);
                setStep(2);
              }
            }}
            className={`flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
              step === 2
                ? 'bg-ember-500 text-white shadow-sm'
                : 'bg-white text-ink-600 ring-1 ring-ink-200'
            }`}
          >
            <User size={14} />
            <span>2. Owner Details &amp; Login</span>
          </button>
        </div>

        <div className="card mt-4 overflow-hidden border border-ink-200/80 bg-white p-6 shadow-sm sm:p-8">
          {step === 1 ? (
            /* ==================== FORM 1: RESTAURANT DETAILS ==================== */
            <div>
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="font-display text-2xl font-800 tracking-tight text-ink-900">
                    Step 1: Restaurant Information
                  </h1>
                  <p className="mt-1 text-[13.5px] text-ink-500">
                    Enter your restaurant name, branding, and location address.
                  </p>
                </div>
                <span className="hidden sm:inline-flex items-center gap-1 rounded-lg bg-ember-50 px-2.5 py-1 text-xs font-bold text-ember-700 ring-1 ring-ember-200">
                  <Sparkles size={13} /> Multi-tenant
                </span>
              </div>

              {/* Live Preview Card */}
              <div className="mt-4 rounded-xl border border-ink-200/70 bg-gradient-to-r from-ink-50 to-white p-3.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-ink-400">Live Brand Preview</span>
                <div className="mt-2 flex items-center gap-3">
                  <div className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-ink-200 bg-white shadow-xs">
                    {form.logoUrl ? (
                      <img src={mediaUrl(form.logoUrl)} alt="Logo" className="h-full w-full object-cover" />
                    ) : (
                      <UtensilsCrossed size={20} className="text-ember-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-display text-[15px] font-bold text-ink-900">
                      {form.restaurantName.trim() || 'Your Restaurant Name'}
                    </h3>
                    <p className="truncate text-xs text-ink-500">
                      {form.tagline.trim() || form.cuisine.trim() || 'Fine Dining & Quick Service'}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-400">
                      <MapPin size={11} />
                      {form.address.city.trim()
                        ? `${form.address.city}${form.address.state ? `, ${form.address.state}` : ''}`
                        : 'City, State'}
                    </p>
                  </div>
                </div>
              </div>

              <form onSubmit={goToStep2} className="mt-5 space-y-4">
                <Field label="Restaurant / Store Name" required hint="Appears on menus, receipts, and QR stickers.">
                  <Input
                    value={form.restaurantName}
                    onChange={setField('restaurantName')}
                    placeholder="e.g. Royal Palace Bistro"
                    required
                    autoFocus
                  />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Tagline (Optional)" hint="Short bio or motto.">
                    <Input
                      value={form.tagline}
                      onChange={setField('tagline')}
                      placeholder="e.g. Authentic Wood-fired Kitchen"
                    />
                  </Field>
                  <Field label="Cuisine Type (Optional)">
                    <Input
                      value={form.cuisine}
                      onChange={setField('cuisine')}
                      placeholder="e.g. North Indian, Continental"
                    />
                  </Field>
                </div>

                {/* Address Section */}
                <div className="space-y-3 pt-1">
                  <Field label="Restaurant Address Line (Optional)">
                    <Input
                      value={form.address.line1}
                      onChange={setAddressField('line1')}
                      placeholder="e.g. Shop 12, High Street Boulevard"
                    />
                  </Field>

                  <div className="grid grid-cols-3 gap-2.5">
                    <Field label="City">
                      <Input
                        value={form.address.city}
                        onChange={setAddressField('city')}
                        placeholder="Pune"
                      />
                    </Field>
                    <Field label="State">
                      <Input
                        value={form.address.state}
                        onChange={setAddressField('state')}
                        placeholder="MH"
                      />
                    </Field>
                    <Field label="Pincode">
                      <Input
                        value={form.address.pincode}
                        onChange={setAddressField('pincode')}
                        placeholder="411001"
                      />
                    </Field>
                  </div>
                </div>

                {/* Logo Upload */}
                <Field label="Restaurant Logo (Optional)" hint="JPEG, PNG or WebP up to 5MB.">
                  <ImagePicker label="Restaurant Logo" value={form.logoUrl} onChange={(logoUrl) => setForm((f) => ({ ...f, logoUrl }))} />
                </Field>

                {error && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700 ring-1 ring-red-200">
                    {error}
                  </p>
                )}

                <div className="flex gap-2.5 pt-3">
                  <Link to="/login" className="grow">
                    <Button variant="ghost" className="w-full" icon={<ArrowLeft size={15} />}>
                      Back to sign in
                    </Button>
                  </Link>
                  <Button type="submit" variant="primary" className="grow" icon={<ArrowRight size={15} />}>
                    Continue: Owner Details →
                  </Button>
                </div>
              </form>
            </div>
          ) : (
            /* ==================== FORM 2: OWNER DETAILS & LOGIN ==================== */
            <div>
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="font-display text-2xl font-800 tracking-tight text-ink-900">
                    Step 2: Owner Details &amp; Login
                  </h1>
                  <p className="mt-1 text-[13.5px] text-ink-500">
                    Set up your owner credentials for <span className="font-semibold text-ink-800">{form.restaurantName}</span>.
                  </p>
                </div>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-ink-900 text-white">
                  <ShieldCheck size={20} />
                </span>
              </div>

              {/* Owner security badge */}
              <div className="mt-4 rounded-xl border border-leaf-200 bg-leaf-50/70 p-3 text-leaf-900">
                <div className="flex items-center gap-2 font-semibold text-xs text-leaf-800">
                  <CheckCircle2 size={15} className="text-leaf-600 shrink-0" />
                  <span>Master Administrator Account</span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-leaf-700">
                  This email &amp; password will be used to log in to the <strong>Owner Dashboard (/app)</strong> where you can add employee IDs, manage passwords, and view sales.
                </p>
              </div>

              <form onSubmit={submit} className="mt-5 space-y-4">
                {/* Owner Name */}
                <Field label="Owner Name (Optional)" hint="Defaults to your email name or Store Owner.">
                  <Input
                    value={form.name}
                    onChange={setField('name')}
                    placeholder="e.g. Vikram Malhotra"
                    autoFocus
                  />
                </Field>

                {/* Email Address */}
                <Field label="Owner Email ID" required hint="Your login email ID for the restaurant dashboard.">
                  <Input
                    type="email"
                    value={form.email}
                    onChange={setField('email')}
                    placeholder="owner@myrestaurant.com"
                    autoComplete="email"
                    required
                  />
                </Field>

                {/* Password with Eye Toggle */}
                <Field label="Password" required hint="At least 6 characters. Use the eye button to verify your password.">
                  <div className="relative flex items-center">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={form.password}
                      onChange={setField('password')}
                      placeholder="Enter or paste your password"
                      autoComplete="new-password"
                      required
                      minLength={6}
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

                {/* Phone number */}
                <Field label="Owner Phone Number (Optional)" hint="For staff calls or order notifications.">
                  <Input
                    value={form.phone}
                    onChange={setField('phone')}
                    placeholder="+91 98200 11001"
                  />
                </Field>

                {error && (
                  <p className="rounded-lg bg-red-50 px-3.5 py-2.5 text-[13px] text-red-700 ring-1 ring-red-200">
                    {error}
                  </p>
                )}

                <div className="flex gap-2.5 pt-3">
                  <Button
                    type="button"
                    variant="secondary"
                    className="grow"
                    onClick={() => {
                      setError(null);
                      setStep(1);
                    }}
                    icon={<ArrowLeft size={15} />}
                  >
                    ← Edit Restaurant
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={busy}
                    className="grow"
                    icon={<Lock size={15} />}
                  >
                    Create Store &amp; Launch
                  </Button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
