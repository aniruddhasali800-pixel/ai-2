import { Copy, Download, QrCode } from 'lucide-react';
import type { UpiCharge } from '../lib/types';
import { inr } from '../lib/format';
import { IconButton } from './ui';
import { downloadQr } from '../lib/downloadQr';
import { toast } from '../store/toasts';

export function UpiQr({ charge }: { charge: UpiCharge }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white p-3.5">
      <div className="flex items-start gap-4">
        <img
          src={charge.qrDataUrl}
          alt={`UPI QR code for ${inr(charge.amount)}`}
          width={132}
          height={132}
          className="shrink-0 rounded-lg ring-1 ring-ink-200"
        />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-500">
            <QrCode size={12} className="text-ember-600" /> Scan to pay
          </p>
          <p className="mt-1 font-display text-[24px] font-800 leading-none tabular-nums text-ink-900">{inr(charge.amount)}</p>
          <p className="mt-2 truncate text-[13px] font-semibold text-ink-800">{charge.payeeName}</p>
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(charge.upiId);
              toast('UPI ID copied', 'success');
            }}
            title="Copy UPI ID"
            className="mt-0.5 flex max-w-full items-center gap-1.5 text-[12.5px] text-ink-500 transition-colors hover:text-ember-600"
          >
            <span className="truncate">{charge.upiId}</span>
            <Copy size={11} className="shrink-0" />
          </button>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-dashed border-ink-200 pt-2.5">
        <p className="text-[11.5px] leading-snug text-ink-400">
          Cut for {charge.note || 'this bill'}. Works in any UPI app — the amount is already filled in.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <IconButton
            label="Download this pay code as a PNG"
            onClick={() => downloadQr(`payment-${charge.note || 'bill'}-${Math.round(charge.amount)}`, charge.qrDataUrl)}
          >
            <Download size={14} />
          </IconButton>
          <a
            href={charge.link}
            className="shrink-0 rounded-lg bg-ink-900 px-2.5 py-1.5 text-[12px] font-semibold text-white transition-transform hover:bg-ink-800 active:scale-[0.97]"
          >
            Open UPI app
          </a>
        </div>
      </div>
    </div>
  );
}
