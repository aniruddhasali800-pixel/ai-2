import { useState } from 'react';
import { KeyRound, Mail, Phone, ShieldCheck, UserPlus, Users, UserRoundPlus } from 'lucide-react';
import { invalidate, useQuery } from '../../lib/query';
import { http, errMsg } from '../../lib/api';
import type { Role, StaffApplication, User } from '../../lib/types';
import { jobLabel } from '../../lib/jobs';
import { dateTime, initials, timeAgo } from '../../lib/format';
import { Button, Card, EmptyState, Field, Input, Modal, Pill, Select, Spinner } from '../../components/ui';
import { can, useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';

const ROLES: { value: Role; label: string; blurb: string }[] = [
  { value: 'MANAGER', label: 'Manager', blurb: 'Runs the floor, menu and reports' },
  { value: 'CASHIER', label: 'Cashier', blurb: 'Bills, payments and refunds' },
  { value: 'WAITER', label: 'Waiter', blurb: 'Tables, orders and guest calls' },
  { value: 'KITCHEN', label: 'Kitchen', blurb: 'See tickets and set cooking status' },
];

const ROLE_TONE: Record<string, string> = {
  OWNER: 'bg-ink-900 text-white ring-ink-900',
  MANAGER: 'bg-ember-50 text-ember-700 ring-ember-200',
  CASHIER: 'bg-leaf-100 text-leaf-600 ring-leaf-500/30',
  WAITER: 'bg-blue-50 text-blue-800 ring-blue-200',
  KITCHEN: 'bg-amber-50 text-amber-800 ring-amber-200',
};

export function StaffPage() {
  const { user } = useAuth();
  const writable = can(user?.role, 'staff:write');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const { data, loading } = useQuery<{ data: User[] }>('staff', '/staff');
  const rows = data?.data ?? [];

  const byRole = ROLES.reduce<Record<string, number>>((acc, r) => {
    acc[r.value] = rows.filter((u) => u.role === r.value).length;
    return acc;
  }, { OWNER: rows.filter((u) => u.role === 'OWNER').length });

  async function setStatus(u: User, status: 'ACTIVE' | 'SUSPENDED') {
    try {
      await http.patch(`/staff/${u._id}`, { status });
      invalidate('staff');
      toast(`${u.name} ${status === 'ACTIVE' ? 'reactivated' : 'suspended'}`, status === 'ACTIVE' ? 'success' : 'info');
    } catch (e) { toast(errMsg(e, 'Could not change that'), 'error'); }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        {['OWNER', ...ROLES.map((r) => r.value)].map((r) => (
          <div key={r} className="card p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">{r === 'OWNER' ? 'Owner' : ROLES.find((x) => x.value === r)!.label}</p>
            <p className="mt-1 font-display text-[22px] font-800 leading-none tabular-nums text-ink-900">{byRole[r] ?? 0}</p>
          </div>
        ))}
      </div>

      <ApplicationsQueue />

      <Card
        title="Team"
        subtitle="Roles decide what each device can touch"
        action={writable && <Button size="sm" variant="primary" icon={<UserPlus size={14} />} onClick={() => setAdding(true)}>Add staff</Button>}
      >
        {loading && !data ? <Spinner /> : !rows.length ? (
          <EmptyState icon={<Users size={26} />} title="No team yet" body="Add waiters, cooks and a cashier so the floor can run itself." />
        ) : (
          <ul className="divide-y divide-ink-100">
            {rows.map((u) => (
              <li key={u._id} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-900 font-display text-[13px] font-800 text-white">
                  {initials(u.name)}
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-[13.5px] font-semibold text-ink-900">
                    {u.name}
                    {u._id === user?._id && <span className="ml-1.5 text-[11px] font-medium text-ink-400">(you)</span>}
                  </p>
                  <p className="flex flex-wrap items-center gap-2 truncate text-[12px] text-ink-500">
                    {u.email && <span className="inline-flex items-center gap-1"><Mail size={11} /> {u.email}</span>}
                    {u.phone && <span className="inline-flex items-center gap-1"><Phone size={11} /> {u.phone}</span>}
                  </p>
                </div>
                <span className="hidden text-[11.5px] text-ink-400 md:block">
                  {u.lastLoginAt ? `active ${timeAgo(u.lastLoginAt)}` : `added ${dateTime(u.createdAt).split(',')[0]}`}
                </span>
                <Pill className={ROLE_TONE[u.role] ?? 'bg-ink-100 text-ink-600 ring-ink-200'}>{u.role}</Pill>
                {u.status !== 'ACTIVE' && <Pill className="bg-red-50 text-red-700 ring-red-200">Suspended</Pill>}
                {writable && u.role !== 'OWNER' && (
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>Edit</Button>
                    <Button size="sm" variant="ghost" icon={<KeyRound size={13} />} onClick={() => setResetting(u)}>Password</Button>
                    <Button size="sm" variant={u.status === 'ACTIVE' ? 'danger' : 'success'} onClick={() => void setStatus(u, u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')}>
                      {u.status === 'ACTIVE' ? 'Suspend' : 'Restore'}
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="flex items-center gap-1.5 px-1 text-[12px] text-ink-500">
        <ShieldCheck size={13} className="text-leaf-600" /> Role changes, refunds and price edits are written to the audit trail.
      </p>

      {adding && <StaffModal onClose={() => setAdding(false)} />}
      {editing && <StaffModal user={editing} onClose={() => setEditing(null)} />}
      {resetting && <PasswordModal user={resetting} onClose={() => setResetting(null)} />}
    </div>
  );
}

function StaffModal({ user, onClose }: { user?: User; onClose: () => void }) {
  const { user: me } = useAuth();
  const isOwner = me?.role === 'OWNER';
  // A manager runs the floor, so the jobs they can hand out are floor jobs. Manager is the
  // owner's to grant — the same rule the API enforces, kept off the screen so nobody taps a 403.
  const jobOptions = isOwner ? ROLES : ROLES.filter((r) => r.value !== 'MANAGER');
  const [form, setForm] = useState({
    name: user?.name ?? '',
    role: user?.role ?? ('WAITER' as Role),
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    password: '',
  });
  const [busy, setBusy] = useState(false);
  const isEdit = Boolean(user);

  async function save() {
    if (form.name.trim().length < 2) { toast('Add a full name', 'error'); return; }
    if (!form.email.trim()) { toast('Add an Email ID for this employee', 'error'); return; }
    if (!isEdit && (!form.password || form.password.length < 6)) { toast('Password must be at least 6 characters', 'error'); return; }
    setBusy(true);
    try {
      if (isEdit) {
        await http.patch(`/staff/${user!._id}`, {
          name: form.name.trim(),
          role: form.role,
          email: form.email.trim().toLowerCase(),
          phone: form.phone.trim() || null,
        });
        toast('Team member updated', 'success');
      } else {
        await http.post('/staff', {
          name: form.name.trim(),
          role: form.role,
          email: form.email.trim().toLowerCase(),
          phone: form.phone.trim() || undefined,
          password: form.password,
        });
        toast(`${form.name} (${form.role}) created successfully`, 'success');
      }
      invalidate('staff');
      onClose();
    } catch (e) { toast(errMsg(e, 'Could not save staff member'), 'error'); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit ${user!.name}` : 'Add a team member'} width="max-w-md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={save}>Save</Button></>}>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="Full name" required className="sm:col-span-2">
          <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Sneha Patil" />
        </Field>
        <Field label="Role" required className="sm:col-span-2">
          <Select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}>
            {jobOptions.map((r) => <option key={r.value} value={r.value}>{r.label} — {r.blurb}</option>)}
          </Select>
        </Field>
        <Field label="Employee Email ID" required className="sm:col-span-2">
          <Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} placeholder="employee@restaurant.com" type="email" />
        </Field>
        {!isEdit && (
          <Field label="Login Password" required className="sm:col-span-2" hint="Employee will use this email ID and password to sign in to their dashboard.">
            <Input type="text" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="At least 6 characters" minLength={6} />
          </Field>
        )}
        <Field label="Phone (Optional)" className="sm:col-span-2">
          <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+91 98200 11005" inputMode="tel" />
        </Field>
      </div>
    </Modal>
  );
}

function PasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function go() {
    if (password.length < 6) { toast('6 characters minimum', 'error'); return; }
    setBusy(true);
    try {
      await http.post(`/staff/${user._id}/reset-password`, { password });
      invalidate('staff');
      toast(`${user.name}'s password reset`, 'success');
      onClose();
    } catch (e) { toast(errMsg(e, 'Reset failed'), 'error'); } finally { setBusy(false); }
  }

  return (
    <Modal open onClose={onClose} title="Reset password" subtitle={user.name} width="max-w-sm"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={go}>Set password</Button></>}>
      <Field label="New password" required hint="This replaces their old password immediately.">
        <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}

/**
 * Who has asked to work here. A walk-in's application arrives from the staff sticker with no
 * account behind it, and accepting is the only thing that opens one — the phone they typed
 * becomes the way they sign in, so there is no password to hand over at the door.
 */
function ApplicationsQueue() {
  const { user } = useAuth();
  const writable = can(user?.role, 'staff:write');
  const [busyId, setBusyId] = useState<string | null>(null);
  const { data, loading } = useQuery<{ data: StaffApplication[] }>('staff:applications', '/staff/applications');
  const rows = data?.data ?? [];
  const pending = rows.filter((r) => r.status === 'PENDING');
  const handled = rows.filter((r) => r.status !== 'PENDING').slice(0, 4);

  async function decide(app: StaffApplication, action: 'approve' | 'reject') {
    setBusyId(app._id);
    try {
      if (action === 'approve') {
        await http.post(`/staff/applications/${app._id}/approve`, {});
        toast(`${app.name} can sign in with ${app.phone} and a code`, 'success');
      } else {
        await http.post(`/staff/applications/${app._id}/reject`, {});
        toast(`Declined ${app.name}`, 'info');
      }
      invalidate('staff');
    } catch (e) {
      toast(errMsg(e, 'Could not do that'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  if (!rows.length && !loading) return null;
  return (
    <Card
      title="Applications"
      subtitle={pending.length ? `${pending.length} waiting on you` : 'From the staff sticker — accepting opens their account'}
      action={pending.length ? <Pill className="bg-ember-50 text-ember-700 ring-ember-200">{pending.length} new</Pill> : undefined}
    >
      {loading && !data ? <Spinner /> : !pending.length && !handled.length ? (
        <EmptyState
          icon={<UserRoundPlus size={26} />}
          title="Nobody has asked yet"
          body="Print the staff code from Settings and stick it by the door. Anyone without an account can apply for a floor job from their own phone."
        />
      ) : (
        <ul className="divide-y divide-ink-100">
          {pending.map((app) => (
            <li key={app._id} className="flex flex-wrap items-start gap-3 px-3.5 py-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ember-50 font-display text-[13px] font-800 text-ember-700 ring-1 ring-ember-200">
                {initials(app.name)}
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-[13.5px] font-semibold text-ink-900">
                  {app.name}
                  <span className="ml-2 text-[11.5px] font-medium text-ink-500">wants {jobLabel(app.role).toLowerCase()}</span>
                </p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-500">
                  <a href={`tel:${app.phone}`} className="inline-flex items-center gap-1 font-medium text-ember-600 hover:underline">
                    <Phone size={11} /> {app.phone}
                  </a>
                  <span className="text-ink-300">·</span>
                  <span>{timeAgo(app.createdAt)}</span>
                </p>
                {app.note && <p className="mt-1 rounded-lg bg-ink-50 px-2.5 py-1.5 text-[12px] leading-snug text-ink-600">{app.note}</p>}
              </div>
              {writable && (
                <div className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" disabled={busyId === app._id} onClick={() => void decide(app, 'reject')}>Decline</Button>
                  <Button size="sm" variant="primary" loading={busyId === app._id} onClick={() => void decide(app, 'approve')}>
                    Hire
                  </Button>
                </div>
              )}
            </li>
          ))}
          {!pending.length &&
            handled.map((app) => (
              <li key={app._id} className="flex items-center gap-3 px-3.5 py-2.5 text-[12.5px] text-ink-500">
                <span className="min-w-0 flex-1 truncate">
                  {app.name} · {jobLabel(app.role).toLowerCase()} · {app.status === 'APPROVED' ? 'hired' : 'declined'}
                  {app.decidedByName ? ` by ${app.decidedByName}` : ''}
                </span>
                <span className="shrink-0 text-[11.5px] text-ink-400">{app.decidedAt ? timeAgo(app.decidedAt) : ''}</span>
              </li>
            ))}
        </ul>
      )}
    </Card>
  );
}
