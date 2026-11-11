// Where each collection lives on the local drive.
//
// The tree is meant to be opened in Explorer and understood without this repository: one folder per
// restaurant, then a named folder per kind of record, and the records that pile up day by day are
// split one file per date so a month of bills is a month of files rather than one growing one.
import type { Doc } from './types';

export type Scope = 'restaurant' | 'global';

export interface Layout {
  /** Model name, as registered with mongoose. */
  model: string;
  scope: Scope;
  /** Path inside the restaurant folder, or inside the root for global collections. */
  folder: string[];
  /** File name without extension; a day-partitioned collection writes one per date. */
  file: string;
  /** Day-partitioned: the append-heavy records a restaurant reads by date. */
  partitioned?: boolean;
  /** The date a partition is named for. Defaults to createdAt. */
  partitionField?: string;
}

export const LAYOUT: Layout[] = [
  { model: 'Restaurant', scope: 'global', folder: ['_index'], file: 'restaurants' },
  { model: 'Counter', scope: 'global', folder: ['_index'], file: 'counters' },
  { model: 'StaffApplication', scope: 'global', folder: ['_index'], file: 'staff-applications' },
  { model: 'LoginCode', scope: 'global', folder: ['_index'], file: 'login-codes' },

  { model: 'User', scope: 'restaurant', folder: [], file: 'login-ids' },
  { model: 'Category', scope: 'restaurant', folder: ['menu'], file: 'categories' },
  { model: 'Product', scope: 'restaurant', folder: ['menu'], file: 'products' },
  { model: 'Addon', scope: 'restaurant', folder: ['menu'], file: 'addons' },
  { model: 'Table', scope: 'restaurant', folder: ['tables'], file: 'tables' },
  { model: 'TableSession', scope: 'restaurant', folder: ['tables'], file: 'sessions', partitioned: true },
  { model: 'Order', scope: 'restaurant', folder: ['orders'], file: 'orders', partitioned: true, partitionField: 'placedAt' },
  { model: 'Bill', scope: 'restaurant', folder: ['bills'], file: 'bills', partitioned: true },
  { model: 'Payment', scope: 'restaurant', folder: ['payments'], file: 'payments', partitioned: true },
  { model: 'Booking', scope: 'restaurant', folder: ['bookings'], file: 'bookings', partitioned: true },
  { model: 'CustomerRequest', scope: 'restaurant', folder: ['requests'], file: 'requests', partitioned: true },
  { model: 'InventoryItem', scope: 'restaurant', folder: ['stock'], file: 'items' },
  { model: 'InventoryTransaction', scope: 'restaurant', folder: ['stock', 'movements'], file: 'movements', partitioned: true },
  { model: 'Notification', scope: 'restaurant', folder: ['notifications'], file: 'notifications', partitioned: true },
  { model: 'AuditLog', scope: 'restaurant', folder: ['audit'], file: 'audit', partitioned: true },
];

/** A folder name a person can read in Explorer, and that Windows will accept. */
export function slugFor(name: string): string {
  const cleaned = String(name ?? '')
    .normalize('NFKD')
    .replace(/[^\w\s.&-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Windows refuses a name ending in a dot or a space, and reserves these device names.
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
  const safe = cleaned.replace(/[. ]+$/, '');
  return !safe || reserved.test(safe) ? 'restaurant' : safe.slice(0, 60);
}

/** The date folder a record belongs to, in the restaurant's own timezone. */
export function partitionOf(doc: Doc, field = 'createdAt'): string[] {
  const at = doc[field] instanceof Date ? (doc[field] as Date) : doc.createdAt instanceof Date ? (doc.createdAt as Date) : new Date();
  // Asia/Kolkata is the house timezone everywhere in this product; a bill at 23:30 IST must not
  // land in the previous day's file because the server clock runs on UTC. The shift puts the instant
  // onto Indian wall-clock time, and the UTC getters then read that wall clock on any machine.
  const ist = new Date(at.getTime() + 330 * 60_000);
  const yyyy = ist.getUTCFullYear();
  const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  return [String(yyyy), mm, `${yyyy}-${mm}-${dd}`];
}

export function fileFor(layout: Layout, restaurantFolder: string | null, doc: Doc): string {
  const parts = layout.scope === 'global' ? [layout.folder[0]] : [restaurantFolder ?? '_unassigned', ...layout.folder];
  if (layout.partitioned) parts.push(...partitionOf(doc, layout.partitionField));
  return [...parts, `${layout.file}.jsonl`].join('/');
}
