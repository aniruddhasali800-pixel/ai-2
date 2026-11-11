'use client';

import { useActionState } from 'react';
import { savePayeeSettings, type ActionState } from '@/lib/actions/staff';

interface Props {
  businessName: string;
  payeeName: string;
  payeeMasked: string;
  enabled: boolean;
  updatedByName: string | null;
  updatedAt: string | null;
}

const initial: ActionState = { error: null, done: null };

/**
 * The payee is the one field that redirects money, so it is never editable from a mask: the full
 * UPI ID has to be typed again, which makes an accidental change impossible.
 */
export function PayeeForm(props: Props) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(savePayeeSettings, initial);

  return (
    <form action={formAction} className="card flex flex-col gap-3">
      <p className="text-sm">
        Currently <strong>{props.payeeMasked}</strong>
        {props.updatedAt ? (
          <span className="text-[var(--muted)]">
            {' '}
            · last changed {props.updatedAt} by {props.updatedByName ?? 'unknown'}
          </span>
        ) : null}
      </p>

      <label className="flex flex-col gap-1">
        <span className="label">UPI ID — type it in full again</span>
        <input className="input" name="vpa" placeholder="restaurantname@bank" autoComplete="off" spellCheck={false} required />
      </label>

      <label className="flex flex-col gap-1">
        <span className="label">Payee name shown in the payer&apos;s app</span>
        <input className="input" name="payeeName" defaultValue={props.payeeName} maxLength={50} required />
      </label>

      <label className="flex flex-col gap-1">
        <span className="label">Business name</span>
        <input className="input" name="businessName" defaultValue={props.businessName} maxLength={60} />
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" value="on" defaultChecked={props.enabled} />
        Collect payments through this service
      </label>

      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? 'Saving…' : 'Save payee'}
      </button>

      {state.error ? <p className="text-sm text-[var(--accent)]">{state.error}</p> : null}
      {state.done ? <p className="text-sm text-[var(--good)]">{state.done}</p> : null}
    </form>
  );
}
