import { useState } from 'react';
import { KeyRound, Mail, Phone, Search, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { invalidate, useQuery } from '../../lib/query';
import { http, errMsg } from '../../lib/api';
import type { Role, StaffApplication, User } from '../../lib/types';
import { dateTime, initials, timeAgo } from '../../lib/format';
import { Button, Card, EmptyState, Field, Input, Modal, Pill, Select, Spinner } from '../../components/ui';
import { can, useAuth } from '../../store/auth';
import { toast } from '../../store/toasts';

const ROLES: { value: Role; label: string; blurb: string }[] = [
  { value: 'MANAGER', label: 'Manager', blurb: 'Runs the floor, menu and reports' },
  { value: 'CASHIER', label: 'Cashier', blurb: 'Bills, payments and refunds' },
  { value: 'WAITER', label: 'Waiter', blurb: 'Tables, orders and guest calls' },
  { value: 'KITCHEN', label: 'Kitchen', blurb: 'See tickets and set cooking status' },
  { value: 'COOK', label: 'Cook', blurb: 'Prepares station orders and fires tickets' },
];

const ROLE_TONE: Record<string, string> = {
  OWNER: 'bg-ink-900 text-white ring-ink-900',
  MANAGER: 'bg-ember-50 text-ember-700 ring-ember-200',
  CASHIER: 'bg-leaf-100 text-leaf-600 ring-leaf-500/30',
  WAITER: 'bg-blue-50 text-blue-800 ring-blue-200',
  KITCHEN: 'bg-amber-50 text-amber-800 ring-amber-200',
  COOK: 'bg-orange-50 text-orange-800 ring-orange-200',
};

const STATUS_TONE: Record<string, string> = {
  ACTIVE: 'bg-leaf-50 text-leaf-700 ring-leaf-200',
  PENDING: 'bg-amber-50 text-amber-700 ring-amber-200',
  INACTIVE: 'bg-ink-100 text-ink-600 ring-ink-200',
  SUSPENDED: 'bg-red-50 text-red-700 ring-red-200',
};

export function StaffPage() {
  const { user } = useAuth();
  const writable = can(user?.role, 'staff:write');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('ALL');

  const { data, loading } = useQuery<{ data: User[] }>('staff', '/staff');
  const allRows = data?.data ?? [];

  const byRole = ROLES.reduce<Record<string, number>>(
    (acc, r) => {
      acc[r.value] = allRows.filter((u) => u.role === r.value).length;
      return acc;
    },
    { OWNER: allRows.filter((u) => u.role === 'OWNER').length },
  );

  const filteredRows = allRows.filter((u) => {
    if (roleFilter !== 'ALL' && u.role !== roleFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      u.name.toLowerCase().includes(q) ||
      (u.email && u.email.toLowerCase().includes(q)) ||
      (u.phone && u.phone.includes(q)) ||
      (u.workArea && u.workArea.toLowerCase().includes(q))
    );
  });

  async function setStatus(u: User, status: 'ACTIVE' | 'SUSPENDED') {
    try {
      await http.patch(`/staff/${u._id}`, { status });
      invalidate('staff');
      toast(
        `${u.name} ${status === 'ACTIVE' ? 'reactivated' : 'suspended'}`,
        status === 'ACTIVE' ? 'success' : 'info',
      );
    } catch (e) {
      toast(errMsg(e, 'Could not change status'), 'error');
    }
  }

  async function resendInvite(u: User) {
    try {
      const { data } = await http.post<{ ok: boolean; message: string }>(`/staff/${u._id}/resend-invite`);
      toast(data.message || `Invitation resent to ${u.email}`, 'info');
      invalidate('staff');
    } catch (e) {
      toast(errMsg(e, 'Could not resend invitation'), 'error');
    }
  }

  return (
    <div className="space-y-4">
      {/* Role Summary Counters */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-6">
        {['OWNER', ...ROLES.map((r) => r.value)].map((r) => (
          <div
            key={r}
            onClick={() => setRoleFilter(roleFilter === r ? 'ALL' : r)}
            className={`card cursor-pointer p-3 transition-all ${
              roleFilter === r ? 'ring-2 ring-ember-500 bg-ember-50/20' : 'hover:border-ink-300'
            }`}
          >
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">
              {r === 'OWNER' ? 'Owner' : ROLES.find((x) => x.value === r)!.label}
            </p>
            <p className="mt-1 font-display text-[22px] font-800 leading-none tabular-nums text-ink-900">
              {byRole[r] ?? 0}
            </p>
          </div>
        ))}
      </div>

      <ApplicationsQueue />

      <Card
        title="Team & Permissions"
        subtitle="Staff roles and stations across floor, counter, and kitchen"
        action={
          writable && (
            <Button
              size="sm"
              variant="primary"
              icon={<UserPlus size={14} />}
              onClick={() => setAdding(true)}
            >
              Add staff
            </Button>
          )
        }
      >
        {/* Search & Filter Bar */}
        <div className="flex flex-wrap items-center gap-2.5 border-b border-ink-100 p-3 sm:flex-nowrap">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name, email, phone or station..."
              className="w-full rounded-xl border border-ink-200 bg-ink-50/50 py-1.5 pl-8 pr-3 text-xs text-ink-900 placeholder:text-ink-400 focus:border-ember-500 focus:bg-white focus:outline-hidden"
            />
          </div>
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="rounded-xl border border-ink-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-ink-700 focus:border-ember-500 focus:outline-hidden"
          >
            <option value="ALL">All Roles ({allRows.length})</option>
            <option value="OWNER">Owner ({byRole.OWNER ?? 0})</option>
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label} ({byRole[r.value] ?? 0})
              </option>
            ))}
          </select>
        </div>

        {loading && !data ? (
          <Spinner />
        ) : !filteredRows.length ? (
          <EmptyState
            icon={<Users size={26} />}
            title="No staff members found"
            body={search || roleFilter !== 'ALL' ? 'Try adjusting your search filters.' : 'Add waiters, cooks, and cashiers so the floor can run smoothly.'}
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {filteredRows.map((u) => (
              <li key={u._id} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink-900 font-display text-[13px] font-800 text-white">
                  {initials(u.name)}
                </span>
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-[13.5px] font-semibold text-ink-900">
                    {u.name}
                    {u._id === user?._id && <span className="ml-1.5 text-[11px] font-medium text-ink-400">(you)</span>}
                  </p>
                  <p className="flex flex-wrap items-center gap-2 truncate text-[12px] text-ink-500 mt-0.5">
                    {u.employeeId && (
                      <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-ink-800">
                        {u.employeeId}
                      </span>
                    )}
                    {u.email && (
                      <span className="inline-flex items-center gap-1">
                        <Mail size={11} /> {u.email}
                      </span>
                    )}
                    {u.phone && (
                      <span className="inline-flex items-center gap-1">
                        <Phone size={11} /> {u.phone}
                      </span>
                    )}
                    {u.department && (
                      <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-[10.5px] font-medium text-ink-700">
                        Dept: {u.department}
                      </span>
                    )}
                    {u.shift && (
                      <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-[10.5px] font-medium text-ink-700">
                        Shift: {u.shift}
                      </span>
                    )}
                    {u.workArea && (
                      <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-[10.5px] font-medium text-ink-700">
                        Area: {u.workArea}
                      </span>
                    )}
                    {u.assignedTables && u.assignedTables.length > 0 && (
                      <span className="rounded-md bg-ink-100 px-1.5 py-0.5 text-[10.5px] font-medium text-ink-700">
                        Tables: {u.assignedTables.join(', ')}
                      </span>
                    )}
                  </p>
                </div>
                <span className="hidden text-[11.5px] text-ink-400 md:block">
                  {u.lastLoginAt ? `active ${timeAgo(u.lastLoginAt)}` : `added ${dateTime(u.createdAt).split(',')[0]}`}
                </span>
                <Pill className={ROLE_TONE[u.role] ?? 'bg-ink-100 text-ink-600 ring-ink-200'}>
                  {u.role}
                </Pill>
                {u.invitationStatus === 'PENDING' ? (
                  <span className="inline-flex items-center gap-1">
                    <Pill className="bg-amber-50 text-amber-800 ring-amber-200">
                      Invite Pending
                    </Pill>
                    {writable && (
                      <button
                        type="button"
                        onClick={() => void resendInvite(u)}
                        className="text-[11px] font-semibold text-ember-600 hover:text-ember-700 underline ml-1"
                      >
                        Resend
                      </button>
                    )}
                  </span>
                ) : u.status !== 'ACTIVE' ? (
                  <Pill className={STATUS_TONE[u.status] ?? 'bg-red-50 text-red-700 ring-red-200'}>
                    {u.status}
                  </Pill>
                ) : null}
                {writable && u.role !== 'OWNER' && (
                  <div className="flex shrink-0 gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<KeyRound size={13} />}
                      onClick={() => setResetting(u)}
                    >
                      Password
                    </Button>
                    <Button
                      size="sm"
                      variant={u.status === 'ACTIVE' ? 'danger' : 'success'}
                      onClick={() =>
                        void setStatus(u, u.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')
                      }
                    >
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
        <ShieldCheck size={13} className="text-leaf-600" /> Multi-tenant role permissions and staff station assignments are enforced.
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
  const jobOptions = isOwner ? ROLES : ROLES.filter((r) => r.value !== 'MANAGER');
  const isEdit = Boolean(user);

  const [form, setForm] = useState({
    name: user?.name ?? '',
    role: user?.role ?? ('WAITER' as Role),
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    password: '',
    status: user?.status ?? ('ACTIVE' as const),
    employeeId: user?.employeeId ?? '',
    department: user?.department ?? '',
    dateOfJoining: user?.dateOfJoining ? user.dateOfJoining.slice(0, 10) : '',
    workingDays: user?.workingDays?.join(', ') ?? '',
    workingHours: user?.workingHours ?? '',
    shift: user?.shift ?? '',
    workArea: user?.workArea ?? '',
    assignedTables: user?.assignedTables ? user.assignedTables.join(', ') : '',
  });

  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [otpCode, setOtpCode] = useState('');
  const [otpHint, setOtpHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestEmailOtp() {
    if (form.name.trim().length < 2) {
      toast('Add a full name', 'error');
      return;
    }
    if (!form.email.trim()) {
      toast('Add an email address to send verification OTP', 'error');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast('Enter a valid email address with domain (e.g. staff@gmail.com)', 'error');
      return;
    }

    setBusy(true);
    try {
      const { data } = await http.post<{ ok: boolean; sent: boolean; demoCode?: string }>(
        '/staff/send-verification',
        { email: form.email.trim() },
      );
      setVerifyingOtp(true);
      if (data.demoCode) {
        setOtpHint(`Demo OTP: ${data.demoCode}`);
        setOtpCode(data.demoCode);
      }
      toast(`Verification code sent to ${form.email.trim()}`, 'info');
    } catch (e) {
      toast(errMsg(e, 'Could not send verification OTP'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (form.name.trim().length < 2) {
      toast('Add a full name', 'error');
      return;
    }
    if (!form.email.trim() && !form.phone.trim()) {
      toast('Add an email or phone number for authentication', 'error');
      return;
    }
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      toast('Enter a valid email address with domain (e.g. staff@gmail.com)', 'error');
      return;
    }

    // If adding a new staff member with an email and hasn't verified OTP yet, initiate verification
    if (!isEdit && form.email.trim() && !verifyingOtp) {
      await requestEmailOtp();
      return;
    }

    // If verifying OTP, require the code
    if (!isEdit && verifyingOtp && otpCode.trim().length < 4) {
      toast('Enter the 6-digit verification code sent to their email', 'error');
      return;
    }

    if (!isEdit && form.password.length > 0 && form.password.length < 8) {
      toast('Password must be at least 8 characters', 'error');
      return;
    }

    const assignedTables = form.assignedTables
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const workingDays = form.workingDays
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean);

    // If owner entered their own phone number, clear it so it doesn't conflict
    const sanitizedPhone =
      form.phone.trim() && me?.phone?.trim() && form.phone.trim() === me.phone.trim()
        ? undefined
        : form.phone.trim() || undefined;

    setBusy(true);
    try {
      if (isEdit) {
        await http.patch(`/staff/${user!._id}`, {
          name: form.name.trim(),
          role: form.role,
          email: form.email.trim() || null,
          phone: sanitizedPhone ?? null,
          status: form.status,
          employeeId: form.employeeId.trim() || null,
          department: form.department.trim() || null,
          dateOfJoining: form.dateOfJoining || null,
          workingDays,
          workingHours: form.workingHours.trim() || null,
          shift: form.shift.trim() || null,
          workArea: form.workArea.trim() || null,
          assignedTables,
        });
        toast('Staff member updated', 'success');
      } else {
        await http.post('/staff', {
          name: form.name.trim(),
          role: form.role,
          email: form.email.trim() || undefined,
          phone: sanitizedPhone,
          verificationCode: verifyingOtp ? otpCode.trim() : undefined,
          password: form.password || undefined,
          status: form.status,
          employeeId: form.employeeId.trim() || undefined,
          department: form.department.trim() || undefined,
          dateOfJoining: form.dateOfJoining || undefined,
          workingDays,
          workingHours: form.workingHours.trim() || undefined,
          shift: form.shift.trim() || undefined,
          workArea: form.workArea.trim() || undefined,
          assignedTables,
        });
        toast(
          `Staff member ${form.name} verified & added! An invite has been sent to ${form.email || form.phone}.`,
          'success',
        );
      }
      invalidate('staff');
      onClose();
    } catch (e) {
      toast(errMsg(e, 'Could not save staff member'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!user) return;
    if (!confirm(`Are you sure you want to deactivate ${user.name}? Historical orders and bills will be preserved.`)) {
      return;
    }
    setBusy(true);
    try {
      await http.delete(`/staff/${user._id}`);
      toast(`${user.name} deactivated`, 'info');
      invalidate('staff');
      onClose();
    } catch (e) {
      toast(errMsg(e, 'Could not deactivate staff member'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isEdit ? `Edit ${user!.name}` : verifyingOtp ? 'Verify Staff Email' : 'Add a team member'}
      subtitle={
        verifyingOtp
          ? `Enter the 6-digit OTP code sent to ${form.email}`
          : undefined
      }
      width="max-w-md"
      footer={
        <div className="flex w-full items-center justify-between">
          {isEdit ? (
            <Button
              variant="danger"
              size="sm"
              icon={<Trash2 size={13} />}
              loading={busy}
              onClick={handleDelete}
            >
              Deactivate
            </Button>
          ) : verifyingOtp ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setVerifyingOtp(false)}
            >
              &larr; Back to details
            </Button>
          ) : <span />}
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={save}>
              {verifyingOtp ? 'Verify & Add Staff' : !isEdit && form.email.trim() ? 'Verify & Save' : 'Save'}
            </Button>
          </div>
        </div>
      }
    >
      {verifyingOtp ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-ember-200 bg-ember-50/60 p-3.5 text-xs text-ink-700">
            <p className="font-semibold text-ink-900">
              Authentication OTP sent to: <span className="text-ember-600 font-mono">{form.email}</span>
            </p>
            <p className="mt-1 text-[11.5px] text-ink-500">
              Enter the 6-digit code below to confirm this email. Once verified, this staff member can log in anytime without a password.
            </p>
          </div>

          <Field
            label="6-Digit Verification Code"
            hint={otpHint ?? 'Check their inbox for the code.'}
          >
            <Input
              value={otpCode}
              onChange={(e) => setOtpCode(e.target.value)}
              placeholder="123456"
              inputMode="numeric"
              maxLength={6}
              autoFocus
            />
          </Field>

          <button
            type="button"
            onClick={requestEmailOtp}
            className="text-xs font-semibold text-ember-600 hover:text-ember-700"
          >
            Resend OTP code
          </button>
        </div>
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2">
          <Field label="Full name" required className="sm:col-span-2">
            <Input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Sneha Patil"
            />
          </Field>
          <Field label="Role" className="sm:col-span-2">
            <Select
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as Role }))}
            >
              {jobOptions.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label} — {r.blurb}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Staff Email" hint="Staff receives verification OTP and signs in passwordlessly.">
            <Input
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              inputMode="email"
              placeholder="staff@restaurant.in"
            />
          </Field>
          <Field label="Phone (Optional)" hint="For quick phone code sign-in.">
            <Input
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              inputMode="tel"
              placeholder="+91 98200 11001"
            />
          </Field>
          <Field label="Employee ID (Optional)" hint="e.g. EMP-042">
            <Input
              value={form.employeeId}
              onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}
              placeholder="EMP-001"
            />
          </Field>
          <Field label="Department (Optional)" hint="e.g. Floor, Kitchen, Counter">
            <Input
              value={form.department}
              onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
              placeholder="Floor Service"
            />
          </Field>
          <Field label="Shift Timing" hint="e.g. Morning 09:00 - 17:00">
            <Input
              value={form.shift}
              onChange={(e) => setForm((f) => ({ ...f, shift: e.target.value }))}
              placeholder="Morning (09:00 - 17:00)"
            />
          </Field>
          <Field label="Date of Joining">
            <Input
              type="date"
              value={form.dateOfJoining}
              onChange={(e) => setForm((f) => ({ ...f, dateOfJoining: e.target.value }))}
            />
          </Field>
          <Field label="Working Days" hint="e.g. Mon, Tue, Wed, Thu, Fri">
            <Input
              value={form.workingDays}
              onChange={(e) => setForm((f) => ({ ...f, workingDays: e.target.value }))}
              placeholder="Mon, Tue, Wed, Thu, Fri, Sat"
            />
          </Field>
          <Field label="Working Hours" hint="e.g. 8 hrs/day">
            <Input
              value={form.workingHours}
              onChange={(e) => setForm((f) => ({ ...f, workingHours: e.target.value }))}
              placeholder="8 hrs/day"
            />
          </Field>
          <Field label="Work Area" hint="e.g. Main Kitchen, Bar, Terrace">
            <Input
              value={form.workArea}
              onChange={(e) => setForm((f) => ({ ...f, workArea: e.target.value }))}
              placeholder="Main Kitchen"
            />
          </Field>
          <Field label="Assigned Tables" hint="e.g. 1, 2, 3, 4">
            <Input
              value={form.assignedTables}
              onChange={(e) => setForm((f) => ({ ...f, assignedTables: e.target.value }))}
              placeholder="1, 2, 3"
            />
          </Field>
          <Field label="Status" className="sm:col-span-2">
            <Select
              value={form.status}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  status: e.target.value as 'ACTIVE' | 'PENDING' | 'INACTIVE' | 'SUSPENDED',
                }))
              }
            >
              <option value="ACTIVE">Active (can sign in)</option>
              <option value="PENDING">Pending onboarding</option>
              <option value="INACTIVE">Inactive (deactivated)</option>
              <option value="SUSPENDED">Suspended (blocked)</option>
            </Select>
          </Field>
          {!isEdit && (
            <Field
              label="Backup Password (Optional)"
              className="sm:col-span-2"
              hint="Leave blank if they sign in via email code or phone OTP."
            >
              <Input
                type="text"
                value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                placeholder="optional — at least 8 characters"
              />
            </Field>
          )}
        </div>
      )}
    </Modal>
  );
}

function PasswordModal({ user, onClose }: { user: User; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function go() {
    if (password.length < 8) {
      toast('8 characters minimum', 'error');
      return;
    }
    setBusy(true);
    try {
      await http.post(`/staff/${user._id}/reset-password`, { password });
      invalidate('staff');
      toast(`${user.name}'s password reset`, 'success');
      onClose();
    } catch (e) {
      toast(errMsg(e, 'Reset failed'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Reset password"
      subtitle={user.name}
      width="max-w-sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={busy} onClick={go}>
            Set password
          </Button>
        </>
      }
    >
      <Field label="New password" required hint="This replaces their old password immediately.">
        <Input
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
        />
      </Field>
    </Modal>
  );
}

function ApplicationsQueue() {
  const { user } = useAuth();
  const writable = can(user?.role, 'staff:write');
  const [busyId, setBusyId] = useState<string | null>(null);
  const { data, loading } = useQuery<{ data: StaffApplication[] }>(
    'staff:applications',
    '/staff/applications',
  );
  const apps = data?.data ?? [];
  const pending = apps.filter((a) => a.status === 'PENDING');

  if (!pending.length) return null;

  async function act(id: string, action: 'approve' | 'reject') {
    setBusyId(id);
    try {
      await http.post(`/staff/applications/${id}/${action}`);
      invalidate('staff:applications');
      invalidate('staff');
      toast(action === 'approve' ? 'Application approved' : 'Application rejected', 'info');
    } catch (e) {
      toast(errMsg(e, 'Could not complete that action'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card
      title={`Hiring applications (${pending.length})`}
      subtitle="People who scanned the staff recruitment QR and asked for a shift"
    >
      {loading ? (
        <Spinner />
      ) : (
        <ul className="divide-y divide-ink-100">
          {pending.map((a) => (
            <li key={a._id} className="flex flex-wrap items-center gap-3 px-3.5 py-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ember-500 font-display text-[13px] font-800 text-white">
                {initials(a.name)}
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-[13.5px] font-semibold text-ink-900">{a.name}</p>
                <p className="flex items-center gap-2 truncate text-[12px] text-ink-500">
                  <span>{a.phone}</span>
                  {a.email && (
                    <>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1 text-ink-700 font-medium">
                        <Mail size={12} className="text-ember-500" />
                        {a.email}
                        {a.emailVerified && (
                          <span className="ml-1 rounded-sm bg-leaf-100 px-1 text-[10px] font-bold text-leaf-700">
                            ✓ Verified
                          </span>
                        )}
                      </span>
                    </>
                  )}
                  <span>·</span>
                  <span>Applied for {a.role}</span>
                </p>
                {a.note && <p className="mt-1 text-[12px] italic text-ink-600">"{a.note}"</p>}
              </div>
              <span className="text-[11.5px] text-ink-400">{timeAgo(a.createdAt)}</span>
              {writable && (
                <div className="flex shrink-0 gap-1.5">
                  <Button
                    size="sm"
                    variant="primary"
                    loading={busyId === a._id}
                    onClick={() => act(a._id, 'approve')}
                  >
                    Hire
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busyId === a._id}
                    onClick={() => act(a._id, 'reject')}
                  >
                    Decline
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
