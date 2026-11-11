export function inr(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '₹0';
  return n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
}

export function inr2(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '₹0.00';
  return n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function num(n: number, digits = 0): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: digits });
}

/** A count that agrees with its own noun. */
export function count(n: number, one: string, many = `${one}s`): string {
  return `${num(n)} ${n === 1 ? one : many}`;
}

export function timeAgo(input: string | Date | null | undefined): string {
  if (!input) return '';
  const then = typeof input === 'string' ? new Date(input).getTime() : input.getTime();
  const secs = Math.round((Date.now() - then) / 1000);
  if (secs < 45) return 'just now';
  if (secs < 90) return 'a minute ago';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function clockTime(input: string | Date | null | undefined): string {
  if (!input) return '';
  const d = typeof input === 'string' ? new Date(input) : input;
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

export function dayMonth(input: string | Date | null | undefined): string {
  if (!input) return '';
  const d = typeof input === 'string' ? new Date(input) : input;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function dateTime(input: string | Date | null | undefined): string {
  if (!input) return '';
  const d = typeof input === 'string' ? new Date(input) : input;
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

export function minutesSince(input: string | Date | null | undefined): number {
  if (!input) return 0;
  const then = typeof input === 'string' ? new Date(input).getTime() : input.getTime();
  return Math.max(0, Math.round((Date.now() - then) / 60000));
}

export function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/[\s_]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}
