import { useState } from 'react';
import { inr } from '../lib/format';

/**
 * Hand-drawn SVG charts — no chart library, so the look stays ours and the
 * bundle stays light. Each chart takes plain arrays.
 */

const PALETTE = ['#ea580c', '#f59e0b', '#16a34a', '#4f46e5', '#0891b2', '#be123c', '#a16207', '#57534e'];

export interface Slice {
  label: string;
  value: number;
  color?: string;
}

export function Donut({
  data,
  size = 168,
  thickness = 22,
  center,
}: {
  data: Slice[];
  size?: number;
  thickness?: number;
  center?: { top: React.ReactNode; bottom: React.ReactNode };
}) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const [hover, setHover] = useState<number | null>(null);
  let offset = 0;

  return (
    <div className="flex items-center gap-5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f5f5f4" strokeWidth={thickness} />
          {total > 0 &&
            data.map((d, i) => {
              const len = (d.value / total) * c;
              const el = (
                <circle
                  key={d.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={d.color ?? PALETTE[i % PALETTE.length]}
                  strokeWidth={hover === i ? thickness + 4 : thickness}
                  strokeDasharray={`${len} ${c - len}`}
                  strokeDashoffset={-offset}
                  strokeLinecap="butt"
                  onMouseEnter={() => setHover(i)}
                  onMouseLeave={() => setHover(null)}
                  style={{ transition: 'stroke-width .15s' }}
                />
              );
              offset += len;
              return el;
            })}
        </svg>
        {center && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-display text-xl font-800 text-ink-900">{center.top}</span>
            <span className="text-[11px] uppercase tracking-wider text-ink-500">{center.bottom}</span>
          </div>
        )}
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5">
        {data.map((d, i) => (
          <li
            key={d.label}
            className={`flex items-center justify-between gap-3 rounded-lg px-2 py-1 text-[13px] transition-colors ${
              hover === i ? 'bg-ink-100' : ''
            }`}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: d.color ?? PALETTE[i % PALETTE.length] }} />
              <span className="truncate text-ink-700">{d.label}</span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums text-ink-900">
              {total ? `${Math.round((d.value / total) * 100)}%` : '0%'}
            </span>
          </li>
        ))}
        {!data.length && <li className="text-[13px] text-ink-500">Nothing to chart yet.</li>}
      </ul>
    </div>
  );
}

export function AreaChart({
  points,
  height = 190,
  format = inr,
  color = '#ea580c',
}: {
  points: { label: string; value: number }[];
  height?: number;
  format?: (n: number) => string;
  color?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 640;
  const h = height;
  const padY = 18;
  const max = Math.max(1, ...points.map((p) => p.value));
  const stepX = points.length > 1 ? (w - 24) / (points.length - 1) : 0;
  const xy = points.map((p, i) => {
    const x = 12 + i * stepX;
    const y = h - padY - (p.value / max) * (h - padY * 2);
    return { x, y, ...p };
  });
  const line = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = xy.length ? `${line} L${xy[xy.length - 1].x},${h - padY} L${xy[0].x},${h - padY} Z` : '';
  const gid = `grad-${color.replace('#', '')}`;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="none" style={{ height }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} x1={12} x2={w - 12} y1={padY + t * (h - padY * 2)} y2={padY + t * (h - padY * 2)} stroke="#f5f5f4" strokeWidth={1} />
        ))}
        {area && <path d={area} fill={`url(#${gid})`} />}
        {line && <path d={line} fill="none" stroke={color} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />}
        {xy.map((p, i) => (
          <g key={p.label + i}>
            {hover === i && <line x1={p.x} x2={p.x} y1={padY - 8} y2={h - padY} stroke="#d6d3d1" strokeDasharray="3 3" />}
            <circle
              cx={p.x}
              cy={p.y}
              r={hover === i ? 5 : 2.6}
              fill="#fff"
              stroke={color}
              strokeWidth={2}
              style={{ transition: 'r .12s' }}
            />
            <rect
              x={p.x - stepX / 2 || 0}
              y={0}
              width={stepX || w}
              height={h}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          </g>
        ))}
      </svg>
      {hover !== null && points[hover] && (
        <div className="animate-in pointer-events-none absolute left-1/2 top-1 -translate-x-1/2 rounded-lg bg-ink-900 px-2.5 py-1.5 text-[12px] text-white shadow-lg">
          <span className="text-ink-300">{points[hover].label}</span> ·{' '}
          <span className="font-semibold">{format(points[hover].value)}</span>
        </div>
      )}
      <div className="mt-1 flex justify-between px-1 text-[10px] uppercase tracking-wider text-ink-400">
        <span>{points[0]?.label ?? ''}</span>
        <span>{points[points.length - 1]?.label ?? ''}</span>
      </div>
    </div>
  );
}

export function BarRows({
  rows,
  format = inr,
  emptyText = 'No data in this range',
}: {
  rows: { label: string; value: number; sub?: string }[];
  format?: (n: number) => string;
  emptyText?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (!rows.length) return <p className="py-6 text-center text-[13px] text-ink-500">{emptyText}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={r.label} className="group">
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="truncate font-medium text-ink-800">{r.label}</span>
            <span className="shrink-0 tabular-nums text-ink-600">
              {format(r.value)}
              {r.sub && <span className="ml-1.5 text-ink-400">{r.sub}</span>}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-100">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(3, (r.value / max) * 100)}%`,
                background: PALETTE[i % PALETTE.length],
                opacity: 0.85,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function DayBars({
  bars,
  format = inr,
  height = 150,
}: {
  bars: { label: string; value: number }[];
  format?: (n: number) => string;
  height?: number;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {bars.map((b, i) => (
        <div
          key={b.label + i}
          className="group relative flex h-full flex-1 flex-col justify-end"
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
        >
          {hover === i && (
            <div className="absolute -top-1 left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-ink-900 px-2 py-1 text-[11px] text-white shadow">
              {format(b.value)}
            </div>
          )}
          <div
            className="w-full rounded-t-[5px] transition-all duration-200"
            style={{
              height: `${Math.max(2, (b.value / max) * 100)}%`,
              background: hover === i ? '#c2410c' : i === bars.length - 1 ? '#ea580c' : '#fdba74',
            }}
          />
          <span className="mt-1.5 truncate text-center text-[10px] text-ink-400">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

export function Sparkline({ values, color = '#ea580c', width = 84, height = 26 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / span) * (height - 4) - 2;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} className="overflow-visible">
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
