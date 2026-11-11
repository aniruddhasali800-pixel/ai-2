'use server';

import { revalidatePath } from 'next/cache';
import { findIntentAny, rejectByStaff, settleByStaff, cancelIntent, TransitionError } from '@/lib/intents';
import { savePayee } from '@/lib/settings';
import { StatusError } from '@/lib/payments/status';
import { requireAction } from '@/lib/auth/session';

export interface ActionState {
  error: string | null;
  done: string | null;
}

const quiet = (message: string): ActionState => ({ error: message, done: null });

/** Every staff surface funnels through these three, and each one re-checks the role in the database. */
export async function markPaid(ref: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const staff = await requireAction('verify');
  const utr = String(formData.get('utr') ?? '').trim();
  if (!utr) return quiet('Type the UTR (bank reference) from your UPI statement first.');

  try {
    const intent = await findIntentAny(ref);
    if (!intent) return quiet('That payment request is gone.');
    const result = await settleByStaff(intent.id, utr.slice(0, 40), { id: staff.id, name: staff.name });
    revalidatePath('/admin');
    revalidatePath(`/pay/${intent.token}`);
    return {
      error: null,
      done: `Marked paid · ${result.view.code}. Sizzle was told: ${callbackWord(result.callback)}.`,
    };
  } catch (error) {
    if (error instanceof StatusError || error instanceof TransitionError) return quiet(error.message);
    throw error;
  }
}

export async function markNotFound(ref: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const staff = await requireAction('verify');
  const reason = String(formData.get('reason') ?? '').trim() || 'Not found in the statement';
  try {
    const intent = await findIntentAny(ref);
    if (!intent) return quiet('That payment request is gone.');
    await rejectByStaff(intent.id, reason.slice(0, 120), { id: staff.id, name: staff.name });
    revalidatePath('/admin');
    revalidatePath(`/pay/${intent.token}`);
    return { error: null, done: 'Marked as not received. The guest sees that it still needs checking.' };
  } catch (error) {
    if (error instanceof StatusError || error instanceof TransitionError) return quiet(error.message);
    throw error;
  }
}

export async function closeRequest(ref: string): Promise<ActionState> {
  const staff = await requireAction('verify');
  try {
    const intent = await findIntentAny(ref);
    if (!intent) return quiet('That payment request is gone.');
    await cancelIntent(intent.id, 'STAFF', { staff: { id: staff.id, name: staff.name }, reason: 'Closed by staff' });
    revalidatePath('/admin');
    revalidatePath(`/pay/${intent.token}`);
    return { error: null, done: 'This QR is closed. Scanning it now says nothing is owed.' };
  } catch (error) {
    if (error instanceof StatusError || error instanceof TransitionError) return quiet(error.message);
    throw error;
  }
}

export async function savePayeeSettings(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const owner = await requireAction('settings');
  const vpa = String(formData.get('vpa') ?? '').trim();
  const payeeName = String(formData.get('payeeName') ?? '').trim();
  const businessName = String(formData.get('businessName') ?? '').trim();
  if (!vpa || !payeeName) return quiet('Both the UPI ID and the payee name are needed.');

  try {
    const view = await savePayee({
      vpa,
      payeeName,
      businessName: businessName || undefined,
      enabled: formData.get('enabled') !== 'off',
      actorId: owner.id,
    });
    revalidatePath('/admin/settings');
    revalidatePath('/admin');
    return { error: null, done: `Payee saved as ${view.payeeMasked}. Every bill issued from now on points there.` };
  } catch (error) {
    return quiet(error instanceof Error ? error.message : 'That could not be saved.');
  }
}

function callbackWord(callback: { ok: boolean; message: string } | 'not_applicable'): string {
  if (callback === 'not_applicable') return 'no message needed';
  return callback.ok ? 'the bill is now paid there' : `it is not updated yet (${callback.message})`;
}
