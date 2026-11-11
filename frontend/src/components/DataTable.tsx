import type { ReactNode } from 'react';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  className?: string;
  align?: 'left' | 'right' | 'center';
  hideBelow?: 'sm' | 'md' | 'lg';
}

export function DataTable<T extends { _id: string }>({
  rows,
  columns,
  onRowClick,
  empty = 'Nothing to show yet.',
  dense,
}: {
  rows: T[];
  columns: Column<T>[];
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
  dense?: boolean;
}) {
  const hide = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' };
  if (!rows.length) return <div className="px-4 py-10 text-center text-[13px] text-ink-500">{empty}</div>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-ink-200 text-left">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`${c.hideBelow ? hide[c.hideBelow] : ''} whitespace-nowrap px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500 ${
                  c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''
                } ${c.className ?? ''}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-ink-100">
          {rows.map((row) => (
            <tr
              key={row._id}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`transition-colors ${onRowClick ? 'cursor-pointer hover:bg-ember-50/50' : 'hover:bg-ink-50'}`}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`${c.hideBelow ? hide[c.hideBelow] : ''} px-3 ${dense ? 'py-2' : 'py-2.5'} align-middle text-ink-700 ${
                    c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''
                  } ${c.className ?? ''}`}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-3 py-2.5">{children}</div>;
}
