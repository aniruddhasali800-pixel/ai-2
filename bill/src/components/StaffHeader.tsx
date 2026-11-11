import { currentStaff } from '@/lib/auth/session';
import { roleCan } from '@/lib/auth/session';
import { signOut } from '@/lib/actions/auth';

const LINKS = [
  { href: '/admin', label: 'Verification', action: 'view' as const },
  { href: '/admin/income', label: 'Income', action: 'view' as const },
  { href: '/admin/settings', label: 'Payment settings', action: 'settings' as const },
];

export async function StaffHeader() {
  const staff = await currentStaff();
  if (!staff) return null;

  return (
    <header className="no-print flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Sizzle Pay</span>
        {LINKS.filter((link) => roleCan(staff.role, link.action)).map((link) => (
          <a key={link.href} href={link.href} className="text-sm underline">
            {link.label}
          </a>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm text-[var(--muted)]">
          {staff.name} · {staff.role}
        </span>
        <form action={signOut}>
          <button type="submit" className="btn btn-ghost text-sm">
            Sign out
          </button>
        </form>
      </div>
    </header>
  );
}
