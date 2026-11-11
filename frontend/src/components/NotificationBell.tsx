import { useEffect, useRef, useState } from 'react';
import { Bell, Check, Trash2 } from 'lucide-react';
import { useAuth } from '../store/auth';
import { useNotifications } from '../store/notifications';
import { timeAgo } from '../lib/format';

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const accessToken = useAuth((s) => s.accessToken);
  const { items, unread, loaded, load, markRead, markAll, remove } = useNotifications();

  useEffect(() => {
    if (accessToken && !loaded) void load().catch(() => undefined);
  }, [accessToken, loaded, load]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-ink-500 transition-colors hover:bg-ink-800 hover:text-white"
        aria-label="Notifications"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-ember-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="animate-in absolute right-0 top-11 z-50 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-ink-200 bg-white shadow-xl">
          <header className="flex items-center justify-between border-b border-ink-100 px-4 py-2.5">
            <span className="font-display text-sm font-700 text-ink-900">Notifications</span>
            {unread > 0 && (
              <button onClick={markAll} className="text-[12px] font-semibold text-ember-600 hover:underline">
                Mark all read
              </button>
            )}
          </header>
          <ul className="max-h-[26rem] divide-y divide-ink-100 overflow-y-auto">
            {!items.length && <li className="px-4 py-8 text-center text-[13px] text-ink-400">You are all caught up.</li>}
            {items.map((n) => (
              <li key={n._id} className={`group flex gap-2.5 px-4 py-3 ${!n.readAt ? 'bg-ember-50/50' : ''}`}>
                <button
                  className="min-w-0 flex-1 text-left"
                  onClick={() => !n.readAt && markRead(n._id)}
                >
                  <p className="text-[13px] font-semibold text-ink-900">{n.title}</p>
                  {n.body && <p className="mt-0.5 text-[12px] leading-snug text-ink-600">{n.body}</p>}
                  <p className="mt-1 text-[11px] text-ink-400">{timeAgo(n.createdAt)}</p>
                </button>
                <div className="flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  {!n.readAt && (
                    <button onClick={() => markRead(n._id)} className="text-ink-400 hover:text-leaf-600" title="Mark read">
                      <Check size={15} />
                    </button>
                  )}
                  <button onClick={() => remove(n._id)} className="text-ink-400 hover:text-red-600" title="Delete">
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
