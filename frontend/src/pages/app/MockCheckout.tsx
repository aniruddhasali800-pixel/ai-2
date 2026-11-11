import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CreditCard, Lock, ShieldCheck } from 'lucide-react';
import { useQuery } from '../../lib/query';
import { http, errMsg } from '../../lib/api';
import type { AppTicket } from '../../lib/types';
import { inr } from '../../lib/format';
import { Spinner } from '../../components/ui';
import { toast } from '../../store/toasts';
import { useTitle } from '../../hooks/useTitle';

/**
 * The sandbox gateway's own page — what `checkoutUrl` points at when no real provider
 * keys are configured. A card number is never typed here and never was: this screen can
 * only ask the backend to capture the pending payment, and the backend routes that ask
 * through the same signature-verified webhook a live bank callback would use.
 */
export function MockCheckout() {
  const [params] = useSearchParams();
  const token = params.get('t') ?? '';
  const { data: ticket, loading, error } = useQuery<AppTicket>(
    `app:ticket:${token}`,
    token.length >= 8 ? `/public/apps/orders/${token}` : null,
  );
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useTitle('Checkout');

  async function pay() {
    setBusy(true);
    try {
      await http.post(`/public/apps/orders/${token}/checkout/confirm`);
      setDone(true);
    } catch (e) {
      toast(errMsg(e, 'The bank declined that payment'), 'error');
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 text-center text-[13px] text-ink-500">
        This checkout link is missing its order. Go back to the ticket and tap pay again.
      </div>
    );
  }
  if (loading && !ticket) return <Spinner label="Opening the checkout…" />;
  if (error || !ticket) {
    return (
      <div className="mx-auto max-w-md px-5 py-16 text-center text-[13px] text-ink-500">
        {error ?? 'This checkout link has expired.'}
      </div>
    );
  }

  const amount = ticket.bill?.grandTotal ?? ticket.grandTotal;

  if (done || ticket.paymentStatus === 'PAID') {
    return (
      <div className="mx-auto max-w-md px-5 py-16 text-center">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-leaf-100 text-leaf-700">
          <ShieldCheck size={26} />
        </span>
        <h1 className="mt-4 font-display text-xl font-800 text-ink-900">Payment captured</h1>
        <p className="mt-1.5 text-[13px] text-ink-500">
          {inr(amount)} for {ticket.orderNumber}. The kitchen can see it already.
        </p>
        <Link
          to={`/track/${token}`}
          className="mt-5 inline-flex h-11 items-center rounded-xl border border-ember-600/40 bg-ember-500 px-5 text-[14px] font-bold text-white transition-colors hover:bg-ember-600"
        >
          Back to your order
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-md bg-ink-100 px-4 py-8">
      <div className="overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-ink-200">
        <header className="flex items-center gap-2.5 border-b border-ink-100 px-5 py-4">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-ink-900 text-ember-400">
            <CreditCard size={16} />
          </span>
          <div className="leading-tight">
            <p className="text-[13.5px] font-bold text-ink-900">Sandbox gateway</p>
            <p className="text-[11px] text-ink-500">No card details, no real money</p>
          </div>
        </header>

        <div className="px-5 py-5">
          <p className="text-[12px] text-ink-500">Paying for</p>
          <p className="font-display text-[26px] font-800 tabular-nums text-ink-900">{inr(amount)}</p>
          <p className="mt-1 text-[12.5px] text-ink-500">
            {ticket.orderNumber} · {ticket.items.length} item{ticket.items.length > 1 ? 's' : ''}
          </p>

          <dl className="mt-5 space-y-2 border-t border-dashed border-ink-200 pt-4 text-[12.5px]">
            <div className="flex justify-between">
              <dt className="text-ink-500">Merchant</dt>
              <dd className="font-semibold text-ink-800">{ticket.restaurant?.name ?? 'Sizzle'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-500">Reference</dt>
              <dd className="font-mono text-ink-700">{ticket.bill?.billNumber ?? ticket.orderNumber}</dd>
            </div>
          </dl>

          <button
            onClick={() => void pay()}
            disabled={busy}
            className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-ink-950/40 bg-ink-900 text-[15px] font-bold text-white transition-[background,transform] hover:bg-ink-800 active:scale-[0.99] disabled:opacity-60"
          >
            <Lock size={15} /> {busy ? 'Contacting the bank…' : `Pay ${inr(amount)}`}
          </button>
          <Link to={`/track/${token}`} className="mt-3 block text-center text-[12.5px] font-semibold text-ink-500 hover:text-ink-900">
            Cancel and go back
          </Link>
        </div>
      </div>

      <p className="mt-4 px-2 text-center text-[11.5px] leading-relaxed text-ink-500">
        Add real Razorpay keys on the server and this screen disappears: the order's checkout link then points at the
        provider's hosted page instead, and only its signed callback can settle a bill.
      </p>
    </div>
  );
}
