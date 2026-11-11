import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AuthResult, Restaurant, User } from '../lib/types';
import { http } from '../lib/api';
import { connectRealtime, disconnectRealtime } from '../lib/socket';

interface AuthState {
  user: User | null;
  restaurant: Restaurant | null;
  accessToken: string | null;
  refreshToken: string | null;
  ready: boolean;
  login: (identifier: string, password: string) => Promise<void>;
  /** The floor signs in with the phone they gave on the job form plus a code worth minutes. */
  loginWithCode: (phone: string, code: string) => Promise<void>;
  register: (input: Record<string, unknown>) => Promise<void>;
  setTokens: (tokens: { accessToken: string; refreshToken: string }) => void;
  setRestaurant: (restaurant: Restaurant) => void;
  logout: () => void;
  bootstrap: () => Promise<void>;
}

/** Any sign-in — password, code or a fresh restaurant — hands back the same shape. */
function sessionOf(data: AuthResult) {
  return {
    user: data.user,
    restaurant: data.restaurant ?? null,
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    ready: true,
  };
}

/**
 * A session is only live while the socket carries its token, so the socket opens wherever a token
 * appears rather than on the sign-in screen alone. A page reloaded straight into the menu, the reports
 * or the kitchen keeps the session in local storage, and a screen that stops listening until someone
 * signs in again is a screen that has to be refreshed — which is what this app must never ask for.
 */
function live(accessToken: string | null) {
  if (accessToken) connectRealtime(accessToken);
  else disconnectRealtime();
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      restaurant: null,
      accessToken: null,
      refreshToken: null,
      ready: false,

      async login(identifier, password) {
        const { data } = await http.post<AuthResult>('/auth/login', { identifier, password });
        set(sessionOf(data));
        live(get().accessToken);
      },

      async loginWithCode(phone, code) {
        const { data } = await http.post<AuthResult>('/auth/otp/verify', { phone, code });
        set(sessionOf(data));
        live(get().accessToken);
      },

      async register(input) {
        const { data } = await http.post<AuthResult>('/auth/register', input);
        set(sessionOf(data));
        live(get().accessToken);
      },

      setTokens(tokens) {
        set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
        live(tokens.accessToken);
      },

      setRestaurant(restaurant) {
        set({ restaurant });
      },

      logout() {
        const { accessToken, refreshToken } = get();
        // The refresh token goes along so the server ends this device only; the counter tablet
        // signed in with the same job account must keep its session.
        if (accessToken) void http.post('/auth/logout', { refreshToken }).catch(() => undefined);
        // The socket is a member of rooms keyed to this identity; leaving them stops the next
        // person on this device being told about the previous one's tables.
        disconnectRealtime();
        set({ user: null, restaurant: null, accessToken: null, refreshToken: null, ready: true });
      },

      /** Re-validates the stored token on boot and refreshes the restaurant record. */
      async bootstrap() {
        const { accessToken } = get();
        if (!accessToken) return void set({ ready: true });
        try {
          const { data } = await http.get<{ user: User; restaurant: Restaurant }>('/auth/me');
          set({ user: data.user, restaurant: data.restaurant, ready: true });
          live(get().accessToken);
        } catch {
          set({ user: null, restaurant: null, accessToken: null, refreshToken: null, ready: true });
        }
      },
    }),
    {
      name: 'sizzle.auth',
      partialize: (s) => ({ user: s.user, restaurant: s.restaurant, accessToken: s.accessToken, refreshToken: s.refreshToken }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.ready = true;
          // A reload restores the session from storage without visiting the sign-in screen, and this
          // is the only moment that knows it. Without opening the socket here, a reloaded kitchen or
          // report sits at "Offline" until somebody signs in again — which reads as a page that has to
          // be refreshed to stay current.
          live(state.accessToken);
        }
      },
    },
  ),
);

export const PERMISSIONS: Record<string, string[]> = {
  OWNER: ['*'],
  MANAGER: [
    'menu:read', 'menu:write', 'orders:read', 'orders:write', 'orders:status', 'kitchen:operate',
    'billing:read', 'billing:write', 'payments:read', 'payments:write', 'payments:refund',
    'bookings:read', 'bookings:write', 'tables:read', 'tables:write', 'requests:read', 'requests:write',
    'staff:read', 'staff:write', 'inventory:read', 'inventory:write', 'reports:read', 'audit:read',
    'settings:read',
  ],
  CASHIER: [
    'menu:read', 'orders:read', 'orders:status', 'billing:read', 'billing:write',
    'payments:read', 'payments:write', 'tables:read', 'bookings:read', 'requests:read', 'requests:write',
  ],
  KITCHEN: ['menu:read', 'orders:read', 'kitchen:operate'],
  WAITER: [
    'menu:read', 'orders:read', 'orders:write', 'orders:status', 'tables:read', 'tables:write',
    'bookings:read', 'bookings:write', 'requests:read', 'requests:write',
    // Matches the server: a waiter carries cash but the counter owns marking it paid.
    'billing:read', 'billing:write', 'payments:read',
  ],
};

export function can(role: string | undefined | null, permission: string): boolean {
  if (!role) return false;
  const list = PERMISSIONS[role];
  return !!list && (list.includes('*') || list.includes(permission));
}
