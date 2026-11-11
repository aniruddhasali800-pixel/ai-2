'use client';

import { useEffect, useState, useTransition, useActionState } from 'react';
import { claimPayment, type ClaimState } from '@/lib/actions/customer';

interface PayPanelProps {
  token: string;
  code: string;
  amountLabel: string;
  payeeName: string;
  payeeMasked: string;
  /** Public: it is printed inside every customer's QR. Staff screens show the mask instead. */
  payeeVpa: string;
  qrDataUrl: string;
  upiUri: string;
  note: string;
  status: string;
  headline: string;
  detail: string;
  canClaim: boolean;
  downloadable: boolean;
}

const POLL_MS = 5000;

const TONE: Record<string, string> = {
  PENDING: 'pill pill-pending',
  PAYMENT_VERIFICATION_PENDING: 'pill pill-claim',
  PAID: 'pill pill-paid',
  FAILED: 'pill pill-closed',
  CANCELLED: 'pill pill-closed',
};

const READABLE: Record<string, { headline: string; detail: string }> = {
  PENDING: {
    headline: 'Waiting for payment',
    detail: 'Scan the QR or open your UPI app, pay the exact amount, then tell us.',
  },
  PAYMENT_VERIFICATION_PENDING: {
    headline: 'Payment submitted. Payment verification pending.',
    detail: 'The counter has been told. This confirms your claim, not the money — they match it against their UPI statement.',
  },
  PAID: { headline: 'Payment received', detail: 'Thank you. The counter confirmed your transfer.' },
  FAILED: {
    headline: 'Payment could not be confirmed',
    detail: 'The counter checked and could not find this transfer. Please speak to them before paying again.',
  },
  CANCELLED: { headline: 'This bill is closed', detail: 'The payment request was cancelled. Nothing is owed through this QR.' },
};

export function PayPanel(props: PayPanelProps) {
  const [status, setStatus] = useState(props.status);
  const [copied, setCopied] = useState(false);
  const [state, claim, pending] = useActionState<ClaimState, FormData>(
    (prev: ClaimState, _data: FormData) => claimPayment(props.token, prev),
    { error: null, headline: null },
  );
  const [, startTransition] = useTransition();

  const copy = READABLE[status] ?? { headline: props.headline, detail: props.detail };
  const settled = status === 'PAID' || status === 'FAILED' || status === 'CANCELLED';

  // The guest should see the confirmation without refreshing, and this page has no socket.
  useEffect(() => {
    if (settled) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/pay/${props.token}/status`, { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as { paymentStatus?: string };
        if (body.paymentStatus && body.paymentStatus !== status) {
          startTransition(() => setStatus(body.paymentStatus as string));
        }
      } catch {
        // A dropped poll is harmless; the next one lands, and the counter can also tell them.
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [props.token, status, settled]);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <span className={TONE[status] ?? 'pill'}>{status.replace(/_/g, ' ').toLowerCase()}</span>
        <span className="label">Bill {props.code}</span>
      </div>

      <div>
        <p className="text-2xl font-semibold">{copy.headline}</p>
        <p className="mt-1 text-sm text-[var(--muted)]">{copy.detail}</p>
      </div>

      {settled ? null : (
        <div className="card flex flex-col items-center gap-3">
          <p className="text-3xl font-semibold">{props.amountLabel}</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- the QR is a server-built data URL; next/image cannot optimize one, and re-encoding it would risk a picture that disagrees with the deep link. */}
          <img src={props.qrDataUrl} alt={`UPI QR for ${props.amountLabel}`} className="h-56 w-56 rounded-lg border border-[var(--line)] bg-white p-2" />
          <p className="text-center text-sm">
            Pay to <strong>{props.payeeName}</strong> · {props.payeeMasked}
          </p>
          <p className="text-center text-xs text-[var(--muted)]">Reference shown to the payee: {props.note}</p>

          <div className="flex w-full flex-wrap justify-center gap-2 pt-1">
            <a className="btn btn-primary" href={props.upiUri}>
              Open UPI app
            </a>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                navigator.clipboard.writeText(props.payeeVpa).catch(() => undefined);
                setCopied(true);
              }}
            >
              {copied ? 'Copied' : 'Copy UPI ID'}
            </button>
            {props.downloadable ? (
              <a className="btn btn-ghost" href={props.qrDataUrl} download={`upi-${props.code}.png`}>
                Save QR
              </a>
            ) : null}
          </div>
        </div>
      )}

      {status === 'PENDING' && props.canClaim ? (
        <form action={claim} className="flex flex-col gap-2">
          <button type="submit" className="btn btn-primary" disabled={pending}>
            {pending ? 'Recording your claim…' : 'I have completed the payment'}
          </button>
          <p className="text-xs text-[var(--muted)]">
            This tells the counter to look for your transfer. It does not confirm that money moved.
          </p>
        </form>
      ) : null}

      {status === 'PAYMENT_VERIFICATION_PENDING' ? (
        <p className="notice">Waiting for the counter to confirm. This page updates on its own.</p>
      ) : null}

      {state.error ? <p className="notice" style={{ borderLeftColor: 'var(--warn)' }}>{state.error}</p> : null}
    </section>
  );
}
