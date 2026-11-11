import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Briefcase, CheckCircle2, ChefHat, CreditCard, ConciergeBell, PhoneCall } from 'lucide-react';
import { Brand } from '../layouts/AppShell';
import { Button, Field, Input, Spinner, Textarea } from '../components/ui';
import { errMsg, http } from '../lib/api';
import { JOB_META } from '../lib/jobs';
import { useTitle } from '../hooks/useTitle';
import type { Role } from '../lib/types';

const ICONS: Record<string, typeof ChefHat> = { WAITER: ConciergeBell, KITCHEN: ChefHat, CASHIER: CreditCard };

interface Hiring {
  name: string;
  slug: string;
  tagline?: string;
  city?: string;
  openRoles: Role[];
}

/**
 * The job form behind the staff sticker. Nobody here has an account yet, so this is the only
 * screen a walk-in ever sees, and it asks for four things. Accepting it is what creates the
 * account — and the phone number typed here becomes the way they sign in from that day on.
 */
export function ApplyJob() {
  const { slug = '' } = useParams();
  const [hiring, setHiring] = useState<Hiring | null>(null);
  const [failed, setFailed] = useState(false);
  const [role, setRole] = useState<Role | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ role: Role; already?: boolean } | null>(null);

  useTitle(hiring ? `Work at ${hiring.name}` : 'Ask for a shift');

  useEffect(() => {
    let live = true;
    http
      .get<Hiring>(`/public/hiring/${slug}`)
      .then((r) => {
        if (!live) return;
        setHiring(r.data);
        setRole(r.data.openRoles[0] ?? null);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [slug]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!role) {
      setError('Pick the job you want');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await http.post<{ alreadyStaff?: boolean; alreadyApplied?: boolean }>(`/public/applications/${slug}`, {
        name: form.name.trim(),
        phone: form.phone.trim(),
        role,
        note: form.note.trim() || undefined,
      });
      setSent({ role, already: Boolean(data.alreadyStaff || data.alreadyApplied) });
    } catch (err) {
      setError(errMsg(err, 'That did not send — try again'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-ink-50 pb-14">
      <header className="bg-ink-900 px-4 pb-14 pt-5 text-white">
        <div className="mx-auto flex max-w-md items-center justify-between gap-3">
          <Brand light />
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11.5px] font-semibold text-ink-200 ring-1 ring-white/15">
            Join the team
          </span>
        </div>
        <div className="mx-auto mt-7 max-w-md">
          <h1 className="font-display text-[29px] font-800 leading-[1.12] tracking-tight">
            {hiring ? `Work at ${hiring.name}.` : 'Ask for a shift'}
          </h1>
          <p className="mt-2.5 text-[13.5px] leading-relaxed text-ink-300">
            Leave your name, your number and the job you want. The manager sees it on their phone the second you send
            it — and if they say yes, this is the number you sign in with.
          </p>
        </div>
      </header>

      <main className="mx-auto -mt-9 max-w-md space-y-3 px-4">
        {failed && (
          <div className="card p-4 text-[13px] text-ink-600">
            We could not find that restaurant.{' '}
            <Link to="/staff.html" className="font-semibold text-ember-600 hover:underline">
              Back to the staff app
            </Link>
          </div>
        )}

        {!hiring && !failed && (
          <div className="card grid place-items-center p-10">
            <Spinner label="Loading the job list…" />
          </div>
        )}

        {hiring &&
          (sent ? (
            <div className="card space-y-3 p-5 text-center">
              <CheckCircle2 size={30} className="mx-auto text-leaf-600" />
              <h2 className="font-display text-[19px] font-800 text-ink-900">
                {sent.already ? 'We already have you' : 'Sent to the manager'}
              </h2>
              <p className="text-[13px] leading-relaxed text-ink-600">
                {sent.already
                  ? 'That number is already on this restaurant\'s list. Sign in with it and ask for a one-time code.'
                  : `Your name, your number and the ${JOB_META[sent.role].label.toLowerCase()} job are with ${hiring.name}. If they accept, your account opens on that phone number.`}
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ember-600 hover:underline"
              >
                Sign in with a code <ArrowRight size={14} />
              </Link>
            </div>
          ) : (
            <form onSubmit={submit} className="card space-y-4 p-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-500">Which job?</p>
                <div className="mt-2 grid gap-2">
                  {hiring.openRoles.map((r) => {
                    const Icon = ICONS[r] ?? Briefcase;
                    const on = role === r;
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setRole(r)}
                        aria-pressed={on}
                        className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all ${
                          on ? 'border-ember-300 bg-ember-50/60 shadow-sm' : 'border-ink-200 bg-white hover:border-ink-300'
                        }`}
                      >
                        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${on ? 'bg-ember-500 text-white' : 'bg-ink-100 text-ink-500'}`}>
                          <Icon size={16} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] font-bold text-ink-900">{JOB_META[r].label}</span>
                          <span className="block text-[12px] leading-snug text-ink-500">{JOB_META[r].blurb}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <Field label="Your name" required>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Ravi Kumar" autoComplete="name" required />
              </Field>
              <Field label="Phone number" required hint="Codes to sign in go here, so keep it reachable.">
                <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} inputMode="tel" autoComplete="tel" placeholder="98765 43210" required />
              </Field>
              <Field label="Anything they should know?" hint="Optional — when you can start, what you have done before.">
                <Textarea rows={3} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="Two years at a tandoor in Baner, free from Monday" />
              </Field>

              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700 ring-1 ring-red-200">{error}</p>}

              <Button type="submit" variant="primary" size="lg" className="w-full" loading={busy} icon={<PhoneCall size={16} />}>
                Send my application
              </Button>

              <Link to="/staff.html" className="flex items-center justify-center gap-1.5 pt-1 text-[12.5px] font-semibold text-ink-500 hover:text-ink-800">
                <ArrowLeft size={13} /> Back to the staff app
              </Link>
            </form>
          ))}
      </main>
    </div>
  );
}
