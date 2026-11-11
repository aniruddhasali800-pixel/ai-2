'use client';

import { useActionState } from 'react';
import { signIn, type AuthState } from '@/lib/actions/auth';

const initial: AuthState = { error: null };

export function LoginForm() {
  const [state, formAction, pending] = useActionState<AuthState, FormData>(signIn, initial);

  return (
    <form action={formAction} className="card flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="label">Email</span>
        <input className="input" name="email" type="email" autoComplete="username" required />
      </label>
      <label className="flex flex-col gap-1">
        <span className="label">Password</span>
        <input className="input" name="password" type="password" autoComplete="current-password" required />
      </label>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Checking…' : 'Sign in'}
      </button>
      {state.error ? <p className="text-sm text-[var(--accent)]">{state.error}</p> : null}
    </form>
  );
}
