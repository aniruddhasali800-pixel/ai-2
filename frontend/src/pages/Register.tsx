import { useEffect, useState, type FormEvent } from 'react';
import { useUser } from '@clerk/clerk-react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Lock,
  MapPin,
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
import { errMsg, mediaUrl } from '../lib/api';

export function RegisterPage() {
  const { user, registerRestaurant } = useAuth();
  const { isLoaded: isClerkLoaded, user: clerkUser } = useUser();
  const navigate = useNavigate();

  const [step, setStep] = useState<1 | 2>(1);

  const [searchParams] = useSearchParams();
  const initialEmail = searchParams.get('email') || '';
  const initialName = searchParams.get('name') || '';

  const [form, setForm] = useState({
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
    name: initialName,
    email: initialEmail,
    phone: '',
  });

  // Prefill from Clerk user if signed in
  useEffect(() => {
    if (isClerkLoaded && clerkUser) {
      const clerkEmail =
        clerkUser.primaryEmailAddress?.emailAddress ||
        clerkUser.emailAddresses?.[0]?.emailAddress ||
        '';
      const clerkName =
        clerkUser.fullName ||
        [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') ||
        '';
      const clerkPhone =
        clerkUser.primaryPhoneNumber?.phoneNumber ||
        clerkUser.phoneNumbers?.[0]?.phoneNumber ||
        '';

      setForm((f) => ({
        ...f,
        name: f.name || clerkName,
        email: f.email || clerkEmail,
        phone: f.phone || clerkPhone,
      }));
    }
  }, [isClerkLoaded, clerkUser]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already authenticated with a restaurant, go directly to owner dashboard
  if (user) return <Navigate to="/app" replace />;

  // If Clerk finished loading and no Clerk session exists, go to login to authenticate first
  if (isClerkLoaded && !clerkUser) {
    return <Navigate to="/login" replace />;
  }

  const setField = (k: keyof typeof form) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
  };

  const setAddressField = (k: keyof typeof form.address) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, address: { ...f.address, [k]: e.target.value } }));
  };

  function goToStep2(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.restaurantName.trim()) {
      setError('Please provide your restaurant name.');
      return;
    }
    setStep(2);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    const clerkId = clerkUser?.id;
    if (!clerkId) {
      setError('Clerk session expired. Please sign in again.');
      setBusy(false);
      navigate('/login');
      return;
    }

    try {
      await registerRestaurant({
        restaurantName: form.restaurantName.trim(),
        clerkUserId: clerkId,
        name: form.name.trim() || clerkUser.fullName || 'Owner',
        email: form.email.trim() || clerkUser.primaryEmailAddress?.emailAddress || undefined,
        phone: form.phone.trim() || undefined,
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

      // Immediately launch the owner dashboard without asking to log in again
      navigate('/app', { replace: true });
    } catch (err) {
      setError(errMsg(err, 'Could not create the restaurant'));
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

        {/* Stepper indicator */}
        <div className="mt-6 flex items-center justify-center gap-3">
          <div
            className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold transition-all ${
              step === 1 ? 'bg-ember-500 text-white shadow-xs' : 'bg-white text-ink-600 ring-1 ring-ink-200'
            }`}
          >
            <Store size={14} />
            <span>1. Restaurant &amp; Brand</span>
          </div>
          <div className="h-0.5 w-6 bg-ink-200" />
          <div
            className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold transition-all ${
              step === 2 ? 'bg-ember-500 text-white shadow-xs' : 'bg-white text-ink-600 ring-1 ring-ink-200'
            }`}
          >
            <User size={14} />
            <span>2. Owner Confirmation</span>
          </div>
        </div>

        <div className="card mt-4 overflow-hidden border border-ink-200/80 bg-white p-6 shadow-xs sm:p-8">
          {step === 1 ? (
            <div>
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="font-display text-2xl font-800 tracking-tight text-ink-900">
                    Register your restaurant
                  </h1>
                  <p className="mt-1 text-[13.5px] text-ink-500">
                    Set up your store name, logo branding, and location to launch your digital operations.
                  </p>
                </div>
                <span className="hidden sm:inline-flex items-center gap-1 rounded-lg bg-ember-50 px-2.5 py-1 text-xs font-bold text-ember-700 ring-1 ring-ember-200">
                  <Sparkles size={13} /> Multi-tenant
                </span>
              </div>

              {/* Live Preview Card */}
              <div className="mt-5 rounded-xl border border-ink-200/70 bg-gradient-to-r from-ink-50 to-white p-4">
                <span className="text-[11px] font-bold uppercase tracking-wider text-ink-400">Live Brand Preview</span>
                <div className="mt-2.5 flex items-center gap-3.5">
                  <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-xl border border-ink-200 bg-white shadow-2xs">
                    {form.logoUrl ? (
                      <img src={mediaUrl(form.logoUrl)} alt="Logo" className="h-full w-full object-cover" />
                    ) : (
                      <UtensilsCrossed size={22} className="text-ember-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-display text-[16px] font-bold text-ink-900">
                      {form.restaurantName.trim() || 'Your Restaurant Name'}
                    </h3>
                    <p className="truncate text-xs text-ink-500">
                      {form.tagline.trim() || form.cuisine.trim() || 'Fine Dining & Quick Service'}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1 text-[11px] text-ink-400">
                      <MapPin size={11} />
                      {form.address.city.trim()
                        ? `${form.address.city}${form.address.state ? `, ${form.address.state}` : ''}`
                        : 'City, Country'}
                    </p>
                  </div>
                </div>
              </div>

              <form onSubmit={goToStep2} className="mt-6 space-y-4">
                <Field label="Restaurant name" required hint="Appears on menus, bills, and QR stickers.">
                  <Input
                    value={form.restaurantName}
                    onChange={setField('restaurantName')}
                    placeholder="e.g. Royal Palace Bistro"
                    required
                    autoFocus
                  />
                </Field>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Tagline" hint="Optional short bio.">
                    <Input
                      value={form.tagline}
                      onChange={setField('tagline')}
                      placeholder="e.g. Authentic Wood-fired Kitchen"
                    />
                  </Field>
                  <Field label="Cuisine type" hint="Shapes starter categories.">
                    <Input
                      value={form.cuisine}
                      onChange={setField('cuisine')}
                      placeholder="e.g. Italian, Indian, Cafe"
                    />
                  </Field>
                </div>

                {/* Logo Uploader */}
                <div className="rounded-xl border border-ink-200/80 bg-ink-50/50 p-3.5">
                  <ImagePicker
                    label="Restaurant logo"
                    value={form.logoUrl}
                    onChange={(url) => setForm((f) => ({ ...f, logoUrl: url }))}
                    uploadUrl="/uploads/public"
                  />
                </div>

                {/* Address Section */}
                <div className="space-y-3 pt-1">
                  <div className="flex items-center gap-2 text-xs font-semibold text-ink-700">
                    <MapPin size={14} className="text-ember-600" /> Store Address (Optional)
                  </div>
                  <Field label="Street / Area">
                    <Input
                      value={form.address.line1}
                      onChange={setAddressField('line1')}
                      placeholder="Shop 12, High Street"
                    />
                  </Field>
                  <div className="grid grid-cols-3 gap-2.5">
                    <Field label="City">
                      <Input
                        value={form.address.city}
                        onChange={setAddressField('city')}
                        placeholder="Mumbai"
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
                        placeholder="400001"
                      />
                    </Field>
                  </div>
                </div>

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
                    Continue: Owner Confirmation
                  </Button>
                </div>
              </form>
            </div>
          ) : (
            <div>
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="font-display text-2xl font-800 tracking-tight text-ink-900">
                    Confirm owner account
                  </h1>
                  <p className="mt-1 text-[13.5px] text-ink-500">
                    Administrator details for <span className="font-semibold text-ink-800">{form.restaurantName}</span>.
                  </p>
                </div>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-ink-900 text-white">
                  <ShieldCheck size={20} />
                </span>
              </div>

              {/* Clerk Verified Identity Badge */}
              <div className="mt-4 rounded-xl border border-leaf-200 bg-leaf-50/70 p-3 text-leaf-900">
                <div className="flex items-center gap-2 font-semibold text-xs text-leaf-800">
                  <CheckCircle2 size={15} className="text-leaf-600 shrink-0" />
                  <span>Authenticated via Clerk (Single Sign-On)</span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-leaf-700">
                  Your identity is secured by Clerk. You do not need to create or remember a separate password. You can sign in anytime using your Google, Apple, or email credentials.
                </p>
              </div>

              <form onSubmit={submit} className="mt-5 space-y-4">
                <Field label="Owner full name" required>
                  <Input
                    value={form.name}
                    onChange={setField('name')}
                    placeholder="e.g. Vikram Malhotra"
                    required
                    autoFocus
                  />
                </Field>

                <div className="grid gap-3.5 sm:grid-cols-2">
                  <Field label="Email address (Clerk Verified)" hint="Used for receipts & notifications.">
                    <Input
                      type="email"
                      value={form.email}
                      onChange={setField('email')}
                      placeholder="owner@restaurant.in"
                    />
                  </Field>
                  <Field label="Phone number" hint="Optional contact number.">
                    <Input
                      value={form.phone}
                      onChange={setField('phone')}
                      placeholder="+91 98200 11001"
                    />
                  </Field>
                </div>

                {error && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700 ring-1 ring-red-200">
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
                    Edit Restaurant
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    loading={busy}
                    className="grow"
                    icon={<Lock size={15} />}
                  >
                    Launch My Dashboard
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
