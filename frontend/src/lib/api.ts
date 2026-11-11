import axios, { AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
import { useAuth } from '../store/auth';
import { onRealtimeAuthFailure } from './socket';

/**
 * Where the API lives. Empty means "this same server", which is how the app runs in
 * development (Vite proxies /api) and when the API hosts the built client itself.
 * A separately deployed client — Vercel in front of Render, say — has to be told at
 * build time, because the browser cannot discover it.
 */
export const API_ROOT = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') ?? '';

const baseURL = `${API_ROOT}/api`;

/** Turn a stored `/uploads/menu/x.png` into something loadable from another origin. */
export function mediaUrl(path: string | null | undefined): string {
  if (!path) return '';
  return /^(https?:|data:|blob:)/.test(path) ? path : `${API_ROOT}${path.startsWith('/') ? path : `/${path}`}`;
}

export const http: AxiosInstance = axios.create({
  baseURL,
  withCredentials: false,
});

/** Attach the local JWT access token to every request. */
http.interceptors.request.use((config) => {
  const localToken = useAuth.getState().accessToken;
  if (localToken && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${localToken}`;
  }
  return config;
});

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  const { refreshToken, setTokens, logout } = useAuth.getState();
  if (!refreshToken) {
    logout();
    throw new Error('no refresh token');
  }
  try {
    const { data } = await axios.post(`${baseURL}/auth/refresh`, { refreshToken });
    // The server rotates one device's session slot per call, so only the pair the store is still
    // holding may be replaced — an answer for a token somebody already swapped out would strand us.
    if (useAuth.getState().refreshToken === refreshToken) {
      setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    }
    return useAuth.getState().accessToken ?? (data.accessToken as string);
  } catch (err) {
    const now = useAuth.getState();
    // A second caller can win this race and its session is the live one, so adopt it rather than
    // throwing the owner back to the sign-in screen with a half-typed form behind them.
    if (now.refreshToken !== refreshToken && now.accessToken) return now.accessToken;
    now.logout();
    throw err;
  }
}

/**
 * One refresh in flight, whichever layer asked for it. The socket and a refused HTTP call both notice
 * the same expired token, and two posts carrying the same refresh token leave exactly one of the two
 * answers usable — the loser's screen ends up signed out.
 */
function refreshTokenOnce(): Promise<string> {
  if (!refreshPromise) refreshPromise = refreshAccessToken().finally(() => (refreshPromise = null));
  return refreshPromise;
}

/**
 * The socket carries the same access token as the HTTP calls and outlives it by design: a kitchen
 * screen left open all night makes no request of its own, so nothing would ever refresh the token it
 * handshakes with. Handing the refresher over lets the socket re-authenticate itself instead of
 * going quietly silent.
 */
onRealtimeAuthFailure(refreshTokenOnce);

/** Raised when the API answers with the single-page app instead of data. */
class ShellAnswerError extends Error {
  constructor(url: string) {
    super(`The server answered ${url} with a web page instead of data — the request never reached the API`);
    this.name = 'ShellAnswerError';
  }
}

http.interceptors.response.use(
  (res) => {
    // A hosted client proxies /api to another service, and the proxy's own catch-all answers an
    // unmatched path with index.html and a 200. Axios treats that as success, so a save that never
    // arrived would toast "saved" over an empty folder. HTML where JSON belongs is a failure.
    if (String(res.headers?.['content-type'] ?? '').includes('text/html')) {
      throw new ShellAnswerError(res.config?.url ?? 'that request');
    }
    return res;
  },
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    const status = error.response?.status;
    const isAuthRoute =
      original?.url?.includes('/auth/login') ||
      original?.url?.includes('/auth/refresh') ||
      original?.url?.includes('/auth/me');

    if (status === 401 && original && !original._retry && !isAuthRoute) {
      const state = useAuth.getState();
      if (state.refreshToken) {
        original._retry = true;
        try {
          const token = await refreshTokenOnce();
          original.headers.Authorization = `Bearer ${token}`;
          return http(original);
        } catch {
          return Promise.reject(error);
        }
      }
    }
    return Promise.reject(error);
  },
);

/** Extract a human-readable message from any failed axios call. */
export function errMsg(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string; error?: { message?: string } } | undefined;
    return data?.error?.message || data?.message || fallback;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}
