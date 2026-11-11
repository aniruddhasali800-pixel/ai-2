'use server';

import { revalidatePath } from 'next/cache';
import { claimByToken } from '@/lib/intents';
import { StatusError, CUSTOMER_COPY } from '@/lib/payments/status';

export interface ClaimState {
  error: string | null;
  headline: string | null;
}

/**
 * The guest's button. It raises a claim and nothing more — the copy says "verification pending",
 * because nobody has seen the money yet.
 */
export async function claimPayment(token: string, _prev: ClaimState): Promise<ClaimState> {
  try {
    const result = await claimByToken(token);
    revalidatePath(`/pay/${token}`);
    return {
      error: null,
      headline: CUSTOMER_COPY[result.view.paymentStatus].headline,
    };
  } catch (error) {
    if (error instanceof StatusError) return { error: error.message, headline: null };
    return { error: 'We could not record that. Tell the counter and try once more.', headline: null };
  }
}
