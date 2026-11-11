'use client';

import { useActionState, useState, useTransition } from 'react';
import { closeRequest, markNotFound, markPaid, type ActionState } from '@/lib/actions/staff';

interface Props {
  intentId: string;
  code: string;
  amountLabel: string;
  payeeMasked: string;
}

const initial: ActionState = { error: null, done: null };

/**
 * The human-with-a-bank-statement controls. Both buttons need a reason or a reference, because a
 * settlement with no evidence is exactly the thing this service exists to prevent.
 */
export function VerifyControls({ intentId, code, amountLabel, payeeMasked }: Props) {
  const [paidState, paidAction, paidPending] = useActionState<ActionState, FormData>(
    (prev, data) => markPaid(intentId, prev, data),
    initial,
  );
  const [failState, failAction, failPending] = useActionState<ActionState, FormData>(
    (prev, data) => markNotFound(intentId, prev, data),
    initial,
  );
  const [closeMessage, setCloseMessage] = useState<string | null>(null);
  const [closing, startClosing] = useTransition();

  const state = paidState.done || failState.done || closeMessage;

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-[var(--line)] pt-3">
      {state ? <p className="text-sm text-[var(--good)]">{state}</p> : null}
      {!state && (paidState.error || failState.error) ? (
        <p className="text-sm text-[var(--accent)]">{paidState.error ?? failState.error}</p>
      ) : null}

      <form action={paidAction} className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-40 flex-1 flex-col gap-1">
          <span className="label">UTR / bank reference for {amountLabel}</span>
          <input className="input" name="utr" placeholder="12-digit UTR from your statement" required maxLength={40} />
        </label>
        <button type="submit" className="btn btn-primary" disabled={paidPending}>
          {paidPending ? 'Saving…' : 'Mark paid'}
        </button>
      </form>

      <details className="text-sm">
        <summary className="cursor-pointer text-[var(--muted)]">It is not in the statement</summary>
        <form action={failAction} className="mt-2 flex flex-wrap items-end gap-2">
          <label className="flex min-w-40 flex-1 flex-col gap-1">
            <span className="label">What you checked</span>
            <input className="input" name="reason" maxLength={120} placeholder={`Nothing for ${code} · paid to ${payeeMasked}`} />
          </label>
          <button type="submit" className="btn btn-ghost" disabled={failPending}>
            {failPending ? 'Saving…' : 'Mark not received'}
          </button>
        </form>
      </details>

      <p className="text-xs text-[var(--muted)]">
        <button
          type="button"
          className="underline"
          disabled={closing}
          onClick={() =>
            startClosing(async () => {
              const result = await closeRequest(intentId);
              setCloseMessage(result.done ?? result.error);
            })
          }
        >
          {closing ? 'Closing…' : 'Close this QR instead (settled another way)'}
        </button>
      </p>
    </div>
  );
}
