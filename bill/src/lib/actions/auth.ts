'use server';

import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/crypto';
import { startSession, endSession, type StaffRole } from '@/lib/auth/session';

export interface AuthState {
  error: string | null;
}

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.' };

  const user = await db.user.findUnique({ where: { email } });
  if (!user || !verifyPassword(password, user.passwordHash)) {
    // Same answer either way: whether this address has an account is not information to give out.
    return { error: 'Those details do not match an account here.' };
  }

  await startSession({ id: user.id, email: user.email, name: user.name, role: user.role as StaffRole });
  redirect('/admin');
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect('/login');
}
