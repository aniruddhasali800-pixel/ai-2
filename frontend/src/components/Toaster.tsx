import { CheckCircle2, AlertTriangle, Info, Radio, X } from 'lucide-react';
import { useToasts } from '../store/toasts';
import type { ToastKind } from '../store/toasts';
import { Link } from 'react-router-dom';

const ICONS: Record<ToastKind, typeof Info> = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
  event: Radio,
};

const TONE: Record<ToastKind, string> = {
  success: 'border-l-leaf-500',
  error: 'border-l-red-500',
  info: 'border-l-ink-400',
  event: 'border-l-ember-500',
};

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const dismiss = useToasts((s) => s.dismiss);
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:items-end">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            className={`toast-in pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-l-4 border-ink-200 bg-white p-3 shadow-lg ${TONE[t.kind]}`}
          >
            <Icon size={18} className="mt-0.5 shrink-0 text-ink-700" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink-900">{t.title}</p>
              {t.body && <p className="mt-0.5 text-[13px] text-ink-500">{t.body}</p>}
              {t.href && (
                <Link to={t.href} className="mt-1 inline-block text-[13px] font-semibold text-ember-600 hover:underline">
                  Open
                </Link>
              )}
            </div>
            <button onClick={() => dismiss(t.id)} className="shrink-0 text-ink-400 hover:text-ink-700" aria-label="Dismiss">
              <X size={16} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
