import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, X } from 'lucide-react';
import { initials } from '../lib/format';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'dark';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-ember-500 text-white hover:bg-ember-600 active:bg-ember-700 shadow-sm shadow-ember-500/20 border border-ember-600/40',
  secondary: 'bg-white text-ink-800 hover:bg-ink-50 active:bg-ink-100 border border-ink-300',
  ghost: 'bg-transparent text-ink-600 hover:bg-ink-200/60 active:bg-ink-200 border border-transparent',
  danger: 'bg-white text-red-700 hover:bg-red-50 active:bg-red-100 border border-red-200',
  success: 'bg-leaf-600 text-white hover:bg-green-700 active:bg-green-800 border border-green-700/40',
  dark: 'bg-ink-900 text-white hover:bg-ink-800 active:bg-ink-950 border border-ink-950/40',
};

const SIZES: Record<Size, string> = {
  sm: 'h-8 px-2.5 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-[10px]',
  lg: 'h-12 px-5 text-[15px] gap-2 rounded-xl',
};

function buttonClass(variant: Variant, size: Size, className = '') {
  return `inline-flex select-none items-center justify-center font-semibold transition-[background,transform,box-shadow] duration-100 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember-400 ${VARIANTS[variant]} ${SIZES[size]} ${className}`;
}

/** Router link dressed as a button — nesting a <button> inside an <a> is invalid HTML. */
export function LinkButton({
  to,
  variant = 'secondary',
  size = 'md',
  className = '',
  icon,
  children,
}: {
  to: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Link to={to} className={buttonClass(variant, size, className)}>
      {icon}
      {children}
    </Link>
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className = '',
  children,
  disabled,
  ...rest
}: {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={buttonClass(variant, size, className)}
    >
      {loading ? <Loader2 className="animate-spin" size={size === 'sm' ? 13 : 15} /> : icon}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  children,
  className = '',
  ...rest
}: { label: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-ink-200 bg-white text-ink-500 transition-colors hover:bg-ink-50 hover:text-ink-800 active:scale-95 disabled:opacity-50 ${className}`}
    >
      {children}
    </button>
  );
}

export function Card({
  children,
  className = '',
  title,
  action,
  subtitle,
}: {
  children?: ReactNode;
  className?: string;
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 border-b border-ink-100 px-4 py-3">
          <div>
            {title && <h3 className="font-display text-[15px] font-700 leading-tight text-ink-900">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Pill({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] ring-1 ring-inset ${className}`}
    >
      {children}
    </span>
  );
}

export function StatusDot({ className = '' }: { className?: string }) {
  return <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${className}`} />;
}

export function Field({
  label,
  hint,
  children,
  required,
  className = '',
}: {
  label?: string;
  hint?: string;
  children: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      {label && (
        <span className="label">
          {label}
          {required && <span className="text-ember-500"> *</span>}
        </span>
      )}
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-500">{hint}</span>}
    </label>
  );
}

export function Input({ className = '', ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={`field ${className}`} />;
}

export function Textarea({ className = '', ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={`field min-h-[76px] resize-y ${className}`} />;
}

export function Select({
  className = '',
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={`field appearance-none bg-[right_0.6rem_center] bg-no-repeat pr-8 ${className}`}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2378716c' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")",
      }}
    >
      {children}
    </select>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2.5 disabled:opacity-60"
    >
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200 ${
          checked ? 'bg-ember-500' : 'bg-ink-300'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all duration-200 ${
            checked ? 'left-[1.15rem]' : 'left-0.5'
          }`}
        />
      </span>
      {label && <span className="text-sm font-medium text-ink-700">{label}</span>}
    </button>
  );
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className={`inline-flex flex-wrap items-center gap-1 rounded-xl bg-ink-200/70 p-1 ${size === 'sm' ? 'text-[13px]' : 'text-sm'}`}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-lg font-semibold transition-all duration-150 ${
            size === 'sm' ? 'px-2.5 py-1' : 'px-3 py-1.5'
          } ${value === o.value ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-600 hover:text-ink-900'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-6">
      <div className="absolute inset-0" onClick={onClose} aria-hidden />
      <div className={`animate-in relative w-full ${width} max-h-[92vh] overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl`}>
        <header className="flex items-start justify-between gap-4 border-b border-ink-100 px-5 py-4">
          <div>
            {title && <h2 className="font-display text-lg font-700 leading-tight text-ink-900">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-ink-500">{subtitle}</p>}
          </div>
          <IconButton label="Close" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </header>
        <div className="max-h-[calc(92vh-8.5rem)] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex items-center justify-end gap-2 border-t border-ink-100 bg-ink-50 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-950/40" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="animate-in flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
        style={{ animationName: 'sizzle-slide' }}
      >
        <header className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <h2 className="font-display text-lg font-700 text-ink-900">{title}</h2>
          <IconButton label="Close" onClick={onClose}>
            <X size={15} />
          </IconButton>
        </header>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="border-t border-ink-100 bg-ink-50 px-5 py-3">{footer}</footer>}
      </aside>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && <div className="mb-1 text-ink-300">{icon}</div>}
      <p className="font-display text-[15px] font-700 text-ink-800">{title}</p>
      {body && <p className="max-w-xs text-[13px] leading-relaxed text-ink-500">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = 'h-4 w-full' }: { className?: string }) {
  return <div className={`pulse rounded-md bg-ink-200 ${className}`} />;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-500">
      <Loader2 className="animate-spin" size={16} />
      {label ?? 'Loading'}
    </div>
  );
}

/** Count-up animation for money tiles — small thing, feels alive. */
export function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current;
    if (from === value) return;
    const start = performance.now();
    const dur = 520;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - (1 - t) ** 3;
      setShown(from + (value - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{format(shown)}</>;
}

export function StatTile({
  label,
  value,
  delta,
  hint,
  tone = 'default',
  icon,
}: {
  label: string;
  value: ReactNode;
  delta?: number;
  hint?: ReactNode;
  tone?: 'default' | 'ember' | 'leaf' | 'ink';
  icon?: ReactNode;
}) {
  const ring =
    tone === 'ember'
      ? 'ring-ember-200'
      : tone === 'leaf'
        ? 'ring-leaf-500/25'
        : tone === 'ink'
          ? 'ring-ink-900/10'
          : 'ring-ink-200';
  return (
    <div className={`card p-4 ring-1 ${ring}`}>
      <div className="flex items-start justify-between gap-2">
        <span className="label mb-0">{label}</span>
        {icon && <span className="text-ink-300">{icon}</span>}
      </div>
      <div className="mt-2 font-display text-[26px] font-800 leading-none tracking-tight text-ink-900">{value}</div>
      <div className="mt-1.5 flex items-center gap-2 text-xs text-ink-500">
        {delta !== undefined && (
          <span className={`font-semibold ${delta >= 0 ? 'text-leaf-600' : 'text-red-600'}`}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        {hint}
      </div>
    </div>
  );
}

export function Money({ amount, className = '' }: { amount: number; className?: string }) {
  return (
    <span className={`font-display tabular-nums ${className}`}>
      ₹{amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
    </span>
  );
}

/** The house mark beside the Sizzle wordmark on a bill — a real logo when uploaded, the initials otherwise. */
export function MerchantMark({ name, logoSrc }: { name: string; logoSrc?: string }) {
  if (logoSrc) {
    return <img src={logoSrc} alt="" className="h-9 w-9 rounded-lg object-cover ring-1 ring-ink-200" />;
  }
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ink-900 font-display text-[12px] font-800 uppercase tracking-tight text-ember-400 ring-1 ring-ink-700">
      {initials(name)}
    </span>
  );
}

export function VegDot({ isVeg }: { isVeg: boolean }) {
  return (
    <span
      title={isVeg ? 'Veg' : 'Non-veg'}
      className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${
        isVeg ? 'border-leaf-600' : 'border-red-700'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${isVeg ? 'bg-leaf-600' : 'bg-red-700'}`} />
    </span>
  );
}

/**
 * A dish with a photo shows it. A dish without one still has to look like part of a
 * menu, so the tile carries the veg colour and the first letter.
 */
export function DishThumb({
  name,
  src,
  isVeg,
  size = 74,
}: {
  name: string;
  src?: string;
  isVeg: boolean;
  size?: number;
}) {
  const box = { width: size, height: size };
  if (src) {
    return <img src={src} alt="" style={box} className="shrink-0 rounded-xl object-cover ring-1 ring-ink-200" />;
  }
  return (
    <span
      style={box}
      className={`grid shrink-0 place-items-center rounded-xl font-display font-800 uppercase ${
        isVeg ? 'bg-leaf-100 text-leaf-700' : 'bg-red-50 text-red-700'
      }`}
    >
      <span style={{ fontSize: Math.round(size * 0.29) }}>{name.slice(0, 1)}</span>
    </span>
  );
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
}: {
  tabs: { value: T; label: ReactNode; badge?: number }[];
  active: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-ink-200">
      {tabs.map((t) => (
        <button
          key={t.value}
          onClick={() => onChange(t.value)}
          className={`relative shrink-0 px-3 py-2.5 text-sm font-semibold transition-colors ${
            active === t.value ? 'text-ink-900' : 'text-ink-500 hover:text-ink-800'
          }`}
        >
          {t.label}
          {!!t.badge && (
            <span className="ml-1.5 rounded-full bg-ember-100 px-1.5 py-0.5 text-[10px] font-bold text-ember-700">
              {t.badge}
            </span>
          )}
          {active === t.value && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-ember-500" />}
        </button>
      ))}
    </div>
  );
}
