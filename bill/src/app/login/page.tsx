import { redirect } from 'next/navigation';
import { currentStaff } from '@/lib/auth/session';
import { LoginForm } from '@/components/LoginForm';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const existing = await currentStaff();
  if (existing) redirect('/admin');
  const { denied } = await searchParams;

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Staff sign in</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          The verification queue and the payee settings live behind this. Guests do not sign in — they use the
          code on their bill.
        </p>
      </header>
      {denied ? (
        <p className="notice">
          That screen needs a different role. Your account can read the queue, but only the owner and the counter
          act on it.
        </p>
      ) : null}
      <LoginForm />
    </section>
  );
}
