import type { Role } from './types';

/** One place to say what a job is called, so the job form, the queue and the team list agree. */
export const JOB_META: Record<Role, { label: string; blurb: string }> = {
  OWNER: { label: 'Owner', blurb: 'Everything, reports and settings' },
  MANAGER: { label: 'Manager', blurb: 'Runs the floor, the menu and the reports' },
  WAITER: { label: 'Waiter', blurb: 'Seat guests, carry orders, call the bill from the table' },
  KITCHEN: { label: 'Kitchen', blurb: 'Tickets fire by course at the pass' },
  CASHIER: { label: 'Cashier', blurb: 'Bills, UPI, cards and the change drawer' },
};

/** The jobs a stranger can ask for. Manager and owner are never self-requested. */
export const FLOOR_JOBS: Role[] = ['WAITER', 'KITCHEN', 'CASHIER'];

export function jobLabel(role?: string | null): string {
  return (role && JOB_META[role as Role]?.label) || (role ?? '').replace(/_/g, ' ');
}
