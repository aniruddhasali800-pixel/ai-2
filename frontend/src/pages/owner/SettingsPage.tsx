import { useEffect, useRef, useState } from 'react';
import { Clock, Download, ExternalLink, Link2, Printer, Save, ShieldAlert, ShieldCheck, Sparkles, UserCheck } from 'lucide-react';
import { http, errMsg } from '../../lib/api';
import { useQuery } from '../../lib/query';
import { useAuth, can } from '../../store/auth';
import type { Restaurant, Role } from '../../lib/types';
import { FLOOR_JOBS, JOB_META } from '../../lib/jobs';
import { Button, Card, Field, Input, Modal, Select, Spinner, Textarea, Toggle } from '../../components/ui';
import { downloadQr } from '../../lib/downloadQr';
import { ImagePicker } from '../../components/ImagePicker';
import { toast } from '../../store/toasts';
import { OperationsAppModal, OPERATIONS_SYSTEMS } from '../../components/OperationsAppModal';

export function SettingsPage() {
  const { user, restaurant, setRestaurant } = useAuth();
  const [data, setData] = useState<Restaurant | null>(restaurant ?? null);
  const [loading, setLoading] = useState(!restaurant);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const patchRef = useRef<Record<string, unknown>>({});

  useEffect(() => {
    if (restaurant) return;
    http.get<Restaurant>('/restaurants').then((r) => setData(r.data)).catch(() => undefined).finally(() => setLoading(false));
  }, [restaurant]);

  if (loading && !data) return <Spinner label="Loading settings…" />;
  if (!data) return <EmptySettings />;

  const s = data.settings ?? {
    acceptingOrders: true, autoAcceptOrders: false, billFooterNote: '', bookingEnabled: true,
    bookingSlotMinutes: 30, bookingDurationMinutes: 90, bookingReminderMinutes: 60, allowWaiterCash: false, deliveryEnabled: true,
  };
  // Nothing saved yet means every floor job is open, which is what the API answers too.
  const openRoles: Role[] = s.openRoles?.length ? s.openRoles : FLOOR_JOBS;

  function set<K extends keyof Restaurant>(key: K, value: Restaurant[K]) {
    setData((d) => (d ? { ...d, [key]: value } : d));
    patchRef.current[key as string] = value;
    setDirty(true);
  }
  function setSetting<K extends keyof NonNullable<Restaurant['settings']>>(key: K, value: NonNullable<Restaurant['settings']>[K]) {
    setData((d) => (d ? { ...d, settings: { ...(d.settings ?? s), [key]: value } } : d));
    patchRef.current.settings = { ...(patchRef.current.settings as object), [key]: value };
    setDirty(true);
  }
  function setAddress(key: 'line1' | 'city' | 'state' | 'pincode', value: string) {
    setData((d) => (d ? { ...d, address: { ...d.address, [key]: value } } : d));
    patchRef.current.address = { ...(patchRef.current.address as object), [key]: value };
    setDirty(true);
  }
  function setBranding(key: 'logoUrl' | 'coverUrl' | 'tagline', value: string) {
    setData((d) => (d ? { ...d, branding: { ...d.branding, [key]: value } } : d));
    patchRef.current.branding = { ...(patchRef.current.branding as object), [key]: value };
    setDirty(true);
  }
  function setHours(key: 'open' | 'close', value: string) {
    setData((d) => (d ? { ...d, hours: { ...d.hours, [key]: value } } : d));
    patchRef.current.hours = { ...(patchRef.current.hours as object), [key]: value };
    setDirty(true);
  }
  function setPayment(key: 'upiId' | 'upiName', value: string) {
    setData((d) => (d ? { ...d, payment: { ...d.payment, [key]: value } } : d));
    patchRef.current.payment = { ...(patchRef.current.payment as object), [key]: value };
    setDirty(true);
  }

  async function save() {
    setBusy(true);
    try {
      const { data: fresh } = await http.patch<Restaurant>('/restaurants', patchRef.current);
      setData(fresh);
      setRestaurant(fresh);
      patchRef.current = {};
      setDirty(false);
      toast('Settings saved', 'success');
    } catch (e) {
      toast(errMsg(e, 'Could not save those settings'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const isOwner = can(user?.role, 'settings:write');

  return (
    <div className="space-y-4">
      {!isOwner && (
        <div className="flex items-center justify-between rounded-xl border border-blue-200 bg-blue-50/90 px-4 py-3 text-[13px] text-blue-900 shadow-sm">
          <div className="flex items-center gap-2.5">
            <UserCheck size={18} className="text-blue-600" />
            <span>
              <strong>Operations Manager View:</strong> You have full access to the Operations App QR code, 4 system dashboards, and shift launchers below.
            </span>
          </div>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <StaffQrCard slug={data.slug} isOwner={isOwner} />

        <Card title="Restaurant" subtitle="Shown on guest menus and bills">
          <div className="grid gap-3.5 p-4 sm:grid-cols-2">
            <Field label="Name" className="sm:col-span-2"><Input value={data.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Phone"><Input value={data.phone ?? ''} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="Email"><Input value={data.email ?? ''} onChange={(e) => set('email', e.target.value)} /></Field>
            <Field label="Tagline" className="sm:col-span-2">
              <Input value={data.branding?.tagline ?? ''} onChange={(e) => setBranding('tagline', e.target.value)} placeholder="Fire-cooked, family-run" />
            </Field>
            <Field label="Address" className="sm:col-span-2"><Input value={data.address?.line1 ?? ''} onChange={(e) => setAddress('line1', e.target.value)} /></Field>
            <Field label="City"><Input value={data.address?.city ?? ''} onChange={(e) => setAddress('city', e.target.value)} /></Field>
            <Field label="State"><Input value={data.address?.state ?? ''} onChange={(e) => setAddress('state', e.target.value)} /></Field>
            <Field label="Pincode"><Input value={data.address?.pincode ?? ''} onChange={(e) => setAddress('pincode', e.target.value)} /></Field>
            <Field label="URL slug" hint="Set when you registered"><Input value={data.slug} disabled /></Field>
          </div>
        </Card>

        <Card title="Scan-to-pay UPI" subtitle="Every bill prints its own QR with the amount already in it">
          <div className="grid gap-3.5 p-4 sm:grid-cols-2">
            <Field label="UPI ID" hint="Looks like restaurant-name@bank">
              <Input value={data.payment?.upiId ?? ''} onChange={(e) => setPayment('upiId', e.target.value)} placeholder="saffronandsmoke@icici" />
            </Field>
            <Field label="Name shown to the guest" hint="Blank falls back to your restaurant name">
              <Input value={data.payment?.upiName ?? ''} onChange={(e) => setPayment('upiName', e.target.value)} placeholder={data.name} />
            </Field>
            <p className="sm:col-span-2 rounded-xl bg-ink-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-500">
              Leave the UPI ID blank to hide QRs on bills. Money still lands in your account directly — we never touch it, and
              the counter still marks a payment approved once the confirmation arrives.
            </p>
          </div>
        </Card>

        <Card title="Service charge and taxes" subtitle="Applied to every dine-in bill">
          <div className="grid gap-3.5 p-4 sm:grid-cols-2">
            <Field label="GST (%)" hint="Per-item rates override this">
              <Input type="number" step="0.5" value={data.taxPercent} onChange={(e) => set('taxPercent', Number(e.target.value))} />
            </Field>
            <Field label="Service charge (%)"><Input type="number" step="0.5" value={data.serviceChargePercent} onChange={(e) => set('serviceChargePercent', Number(e.target.value))} /></Field>
            <Field label="Footer note on bills" className="sm:col-span-2">
              <Textarea value={s.billFooterNote} onChange={(e) => setSetting('billFooterNote', e.target.value)} placeholder="Thank you — do come again" />
            </Field>
            <div className="sm:col-span-2">
              <p className="label"><Clock size={11} className="mr-1 inline" /> Opening hours</p>
              <div className="mt-1.5 flex items-center gap-2">
                <Input type="time" value={data.hours?.open ?? ''} onChange={(e) => setHours('open', e.target.value)} className="w-32" />
                <span className="text-ink-400">to</span>
                <Input type="time" value={data.hours?.close ?? ''} onChange={(e) => setHours('close', e.target.value)} className="w-32" />
              </div>
            </div>
          </div>
        </Card>

        <Card title="Kitchen and orders" subtitle="How live tickets behave">
          <div className="space-y-3.5 p-4">
            <SettingRow
              title="Accepting orders"
              body="Turn this off to freeze every channel — guests see a quiet menu."
              control={<Toggle checked={s.acceptingOrders} onChange={(v) => setSetting('acceptingOrders', v)} />}
            />
            <SettingRow
              title="Auto-accept incoming orders"
              body="Skips the manual accept step for staff-placed tickets. Aggregator orders still wait for the partner."
              control={<Toggle checked={s.autoAcceptOrders} onChange={(v) => setSetting('autoAcceptOrders', v)} />}
            />
            <SettingRow
              title="Let waiters collect cash"
              body="Allows the floor app to settle small bills without the counter."
              control={<Toggle checked={s.allowWaiterCash} onChange={(v) => setSetting('allowWaiterCash', v)} />}
            />
            <SettingRow
              title="Home delivery in the guest app"
              body={`Turns the delivery card on at /eat/${data.slug}. With it off, the guest app offers seating only.`}
              control={<Toggle checked={!!s.deliveryEnabled} onChange={(v) => setSetting('deliveryEnabled', v)} />}
            />
          </div>
        </Card>

        <Card title="Reservations" subtitle="Public booking page and reminders">
          <div className="space-y-3.5 p-4">
            <SettingRow
              title="Take online bookings"
              body={`Guests can reserve at /book/${data.slug}`}
              control={<Toggle checked={s.bookingEnabled} onChange={(v) => setSetting('bookingEnabled', v)} />}
            />
            <div className="grid gap-3.5 sm:grid-cols-3">
              <Field label="Slot step (min)"><Input type="number" value={s.bookingSlotMinutes} onChange={(e) => setSetting('bookingSlotMinutes', Number(e.target.value))} /></Field>
              <Field label="Sitting (min)"><Input type="number" value={s.bookingDurationMinutes} onChange={(e) => setSetting('bookingDurationMinutes', Number(e.target.value))} /></Field>
              <Field label="Remind (min before)"><Input type="number" value={s.bookingReminderMinutes} onChange={(e) => setSetting('bookingReminderMinutes', Number(e.target.value))} /></Field>
            </div>
          </div>
        </Card>

        <Card title="Branding" subtitle="Logo and cover image for guest screens" className="lg:col-span-2">
          <div className="grid gap-3.5 p-4 sm:grid-cols-2">
            <ImagePicker label="Logo" value={data.branding?.logoUrl ?? ''} onChange={(v) => setBranding('logoUrl', v)} />
            <ImagePicker label="Cover" value={data.branding?.coverUrl ?? ''} onChange={(v) => setBranding('coverUrl', v)} />
          </div>
        </Card>

        {can(user?.role, 'settings:write') && (
          <Card title="Hiring" subtitle="Which jobs the staff code offers to a walk-in" className="lg:col-span-2">
            <div className="space-y-3.5 p-4">
              {FLOOR_JOBS.map((job) => {
                const open = openRoles.includes(job);
                return (
                  <SettingRow
                    key={job}
                    title={JOB_META[job].label}
                    body={JOB_META[job].blurb}
                    control={<Toggle checked={open} onChange={(v) => setSetting('openRoles', v ? [...openRoles, job] : openRoles.filter((r) => r !== job))} />}
                  />
                );
              })}
              <p className="rounded-xl bg-ink-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-500">
                A closed job disappears from the application form, so nobody asks for work you are not offering. An
                applicant signs nothing and chooses nothing beyond the job — their account only exists once the manager
                accepts the application, and a manager account is yours alone to hand out.
              </p>
            </div>
          </Card>
        )}
      </div>

      <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-2xl bg-ink-900 px-4 py-3 text-white shadow-xl">
        <ShieldCheck size={16} className="text-leaf-400" />
        <p className="min-w-0 flex-1 text-[12.5px] text-ink-300">
          {!isOwner
            ? 'Manager view: Operations QR code and dashboard launchers active.'
            : dirty
            ? 'You have unsaved changes.'
            : 'Everything on this screen is written to your restaurant only.'}
        </p>
        {isOwner && (
          <Button size="sm" variant="ghost" className="text-ink-300 hover:bg-white/10" onClick={() => { patchRef.current = {}; setDirty(false); setData(restaurant ?? null); }}>
            Reset
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={() => setPasswordOpen(true)}>Change password</Button>
        {isOwner && (
          <Button size="sm" variant="primary" icon={<Save size={14} />} loading={busy} disabled={!dirty} onClick={save}>Save settings</Button>
        )}
      </div>

      <ChangePasswordModal open={passwordOpen} onClose={() => setPasswordOpen(false)} />
    </div>
  );
}

function StaffQrCard({ slug, isOwner }: { slug: string; isOwner: boolean }) {
  const { data, loading } = useQuery<{ url: string; dataUrl: string }>('restaurants:staff-qr', '/restaurants/staff-qr');
  const [modalOpen, setModalOpen] = useState(false);

  function openPopup() {
    if (!data?.url) return;
    window.open(data.url, 'SizzleOperationsOS', 'width=580,height=840,menubar=no,toolbar=no,location=no');
  }

  return (
    <>
      <Card
        title="Operations App & 4 Dashboards (Staff Only)"
        subtitle="Scan QR code or open the window to download and launch all 4 operational systems on mobile and computer"
        className="lg:col-span-2 border-ember-300/80 shadow-sm"
      >
        <div className="flex flex-col gap-6 p-4 sm:flex-row sm:items-center">
          {/* QR Code Container */}
          <div className="flex shrink-0 flex-col items-center">
            <span className="grid h-44 w-44 place-items-center overflow-hidden rounded-2xl bg-white p-2 shadow-sm ring-1 ring-ink-200">
              {data ? (
                <img src={data.dataUrl} alt={`Staff install code for ${slug}`} className="h-full w-full object-contain" />
              ) : (
                <span className={`text-[12px] text-ink-400 ${loading ? 'animate-pulse' : ''}`}>
                  {loading ? 'Generating QR…' : 'Unavailable'}
                </span>
              )}
            </span>
            <span className="mt-1.5 text-[11px] font-semibold text-ink-500">Scan to install on phone</span>
          </div>

          {/* Details & Actions */}
          <div className="min-w-0 flex-1 space-y-3.5">
            {/* Security Warning Notice */}
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/90 p-3 text-[12px] text-amber-950">
              <ShieldAlert size={17} className="mt-0.5 shrink-0 text-amber-600" />
              <div>
                <span className="font-bold">Strictly Restricted to Operations:</span> This QR code and window give access to the 4 operational systems:
                Kitchen Display, Waiter Floor, Cashier POS, and Owner/Manager Back Office. Customer food ordering is prohibited here.
              </div>
            </div>

            {/* The 4 Systems Preview Pills */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {OPERATIONS_SYSTEMS.map((sys) => (
                <div
                  key={sys.id}
                  onClick={() => window.open(sys.url, '_blank')}
                  className="group flex cursor-pointer items-center gap-2 rounded-xl border border-ink-200 bg-white p-2 shadow-xs transition-all hover:border-ink-400 hover:shadow-sm"
                >
                  <img src={sys.iconSrc} alt={sys.name} className="h-7 w-7 shrink-0 rounded-lg shadow-2xs" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11.5px] font-bold text-ink-900 group-hover:text-ember-600">{sys.name}</p>
                    <p className="text-[10px] font-mono text-ink-400">{sys.url}</p>
                  </div>
                </div>
              ))}
            </div>

            {data && (
              <p className="break-all rounded-lg bg-ink-50 px-3 py-1.5 font-mono text-[11.5px] text-ink-500 ring-1 ring-ink-200">
                {data.url}
              </p>
            )}

            {/* Interactive Action Buttons */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button
                size="sm"
                variant="primary"
                icon={<Sparkles size={14} />}
                onClick={() => setModalOpen(true)}
              >
                Open Operations App Window
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<ExternalLink size={13} />}
                disabled={!data}
                onClick={openPopup}
              >
                Launch Standalone Window
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<Download size={13} />}
                disabled={!data}
                onClick={() => downloadQr(`${slug}-staff-app`, data?.dataUrl)}
              >
                Download PNG
              </Button>
              <Button
                size="sm"
                variant="secondary"
                icon={<Printer size={13} />}
                disabled={!data}
                onClick={() => printInstallSticker(slug, data?.dataUrl)}
              >
                Print Sticker
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Link2 size={13} />}
                disabled={!data}
                onClick={() => {
                  void navigator.clipboard?.writeText(data?.url ?? '');
                  toast('Staff operations link copied', 'success');
                }}
              >
                Copy link
              </Button>
            </div>
          </div>
        </div>
      </Card>

      <OperationsAppModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        slug={slug}
        qrDataUrl={data?.dataUrl}
      />
    </>
  );
}

function printInstallSticker(slug: string, dataUrl?: string) {
  if (!dataUrl) return;
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.write(
    `<div style="text-align:center;font-family:system-ui,sans-serif;padding:32px">` +
      `<p style="margin:0;font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:#78716c">Sizzle · staff app</p>` +
      `<h2 style="margin:4px 0 18px;font-size:26px">Team &amp; jobs</h2>` +
      `<img src="${dataUrl}" style="width:260px" onload="window.print()" />` +
      `<p style="margin:16px 0 0;font-size:15px;font-weight:600">Scan to install</p>` +
      `<p style="margin:4px 0 0;font-size:12.5px;color:#78716c">Back office, floor, kitchen and counter — sign in with your own account.</p>` +
      `<p style="margin:4px 0 0;font-size:12.5px;color:#78716c">No account yet? The same code takes you to the job form.</p>` +
    `</div>`,
  );
  w.document.close();
}

function EmptySettings() {
  return (
    <Card>
      <p className="px-4 py-10 text-center text-[13px] text-ink-500">Only the owner can edit restaurant settings.</p>
    </Card>
  );
}

function SettingRow({ title, body, control }: { title: string; body: string; control: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl bg-ink-50 px-3.5 py-3">
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-ink-900">{title}</p>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-500">{body}</p>
      </div>
      {control}
    </div>
  );
}

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [busy, setBusy] = useState(false);

  async function go() {
    if (form.newPassword.length < 8) { toast('New password needs 8 characters', 'error'); return; }
    setBusy(true);
    try {
      await http.post('/auth/change-password', form);
      toast('Password changed', 'success');
      setForm({ currentPassword: '', newPassword: '' });
      onClose();
    } catch (e) { toast(errMsg(e, 'Could not change the password'), 'error'); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Change your password" width="max-w-sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={go}>Update</Button></>}>
      <div className="space-y-3.5">
        <Field label="Current password" required><Input type="password" value={form.currentPassword} onChange={(e) => setForm((f) => ({ ...f, currentPassword: e.target.value }))} /></Field>
        <Field label="New password" required hint="Other devices stay signed in until their token expires.">
          <Input type="password" value={form.newPassword} onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))} />
        </Field>
      </div>
    </Modal>
  );
}
