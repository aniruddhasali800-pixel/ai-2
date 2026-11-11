import { create } from 'zustand';
import type { AppNotification } from '../lib/types';
import { http } from '../lib/api';

interface NotifState {
  items: AppNotification[];
  unread: number;
  loaded: boolean;
  load: () => Promise<void>;
  receive: (n: AppNotification) => void;
  markRead: (id: string) => void;
  markAll: () => void;
  remove: (id: string) => void;
}

export const useNotifications = create<NotifState>((set, get) => ({
  items: [],
  unread: 0,
  loaded: false,

  async load() {
    const { data } = await http.get<{ data: AppNotification[]; unreadCount: number }>('/notifications', {
      params: { limit: 40 },
    });
    set({ items: data.data, unread: data.unreadCount, loaded: true });
  },

  receive(n) {
    if (get().items.some((i) => i._id === n._id)) return;
    set((s) => ({ items: [n, ...s.items].slice(0, 60), unread: s.unread + 1 }));
  },

  markRead(id) {
    set((s) => {
      const target = s.items.find((i) => i._id === id);
      const wasUnread = target && !target.readAt;
      return {
        items: s.items.map((i) => (i._id === id ? { ...i, readAt: new Date().toISOString() } : i)),
        unread: Math.max(0, s.unread - (wasUnread ? 1 : 0)),
      };
    });
    void http.post(`/notifications/${id}/read`).catch(() => undefined);
  },

  markAll() {
    set((s) => ({ items: s.items.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })), unread: 0 }));
    void http.post('/notifications/read-all').catch(() => undefined);
  },

  remove(id) {
    set((s) => ({ items: s.items.filter((i) => i._id !== id) }));
    void http.delete(`/notifications/${id}`).catch(() => undefined);
  },
}));
