import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { http, errMsg } from './api';

/**
 * A very small read-through cache. Screens register the keys they render, the
 * socket layer invalidates them, and optimistic writes patch them in place so a
 * click repaints the floor before the request even lands.
 */
const values = new Map<string, unknown>();
const stamp = new Map<string, number>();
const gens = new Map<string, number>();
// Which params produced each payload. A new range or filter under the same key is a
// different question, so the cached answer has to stop counting as fresh.
const asked = new Map<string, string>();
const listeners = new Set<() => void>();

function bump() {
  listeners.forEach((fn) => fn());
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

let version = 0;
function snapshot() {
  return version;
}

function bumpVersion() {
  version += 1;
  bump();
}

/** Bumped only when a key is dropped, so mounted screens know to refetch. */
function genOf(key: string) {
  return gens.get(key) ?? 0;
}

function touchGen(key: string) {
  gens.set(key, genOf(key) + 1);
}

export function peek<T>(key: string): T | undefined {
  return values.get(key) as T | undefined;
}

export function write<T>(key: string, value: T, params?: Record<string, unknown>) {
  values.set(key, value);
  stamp.set(key, Date.now());
  if (params !== undefined) asked.set(key, JSON.stringify(params));
  bumpVersion();
}

/** Replace part of a cached resource without a round-trip. */
export function patch<T>(key: string, updater: (current: T | undefined) => T | undefined) {
  const next = updater(values.get(key) as T | undefined);
  if (next !== undefined) write(key, next);
}

/** Drop cached entries so mounted screens refetch (prefix matches `key:*`). */
export function invalidate(prefix?: string) {
  if (!prefix) {
    for (const key of [...values.keys()]) touchGen(key);
    values.clear();
    stamp.clear();
    asked.clear();
  } else {
    for (const key of [...values.keys()]) {
      if (key.startsWith(prefix)) {
        values.delete(key);
        stamp.delete(key);
        asked.delete(key);
        touchGen(key);
      }
    }
  }
  bumpVersion();
}

export function invalidateMany(prefixes: string[]) {
  for (const p of prefixes) invalidate(p);
}

/**
 * Mounted readers, keyed by the entry they render. Used only by the fallback below: a screen can ask
 * again without its cached answer being deleted first, so refreshing costs no spinner.
 */
const reask = new Map<string, Set<() => void>>();

/**
 * Ask every mounted query again, keeping what is on screen until the answer lands. This is what a
 * screen does when realtime has gone quiet — a hosted instance sleeps between customers, and a socket
 * refused by a cold service does not always come back — so a stale figure is a slow one, not a
 * permanent one.
 */
export function revalidateAll() {
  for (const listeners of reask.values()) for (const fn of listeners) fn();
}

function watchReask(key: string, fn: () => void) {
  const set = reask.get(key) ?? new Set<() => void>();
  set.add(fn);
  reask.set(key, set);
  return () => {
    set.delete(fn);
    if (!set.size) reask.delete(key);
  };
}

export interface QueryResult<T> {
  data: T | undefined;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  /** Write a fresh payload into this key's slot (used after mutations). */
  setData: (value: T) => void;
}

export function useQuery<T>(
  key: string,
  url: string | null,
  params?: Record<string, unknown>,
  options?: { enabled?: boolean; refetchOnMount?: boolean },
): QueryResult<T> {
  useSyncExternalStore(subscribe, snapshot, snapshot);
  const enabled = options?.enabled !== false && Boolean(url);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Re-read on every store bump; a rising generation means our slot was dropped.
  const gen = genOf(key);

  const fingerprint = JSON.stringify(params ?? {});

  const run = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    setError(null);
    try {
      const { data } = await http.get(url, { params: params ? JSON.parse(fingerprint) : undefined });
      write(key, data, params);
    } catch (err) {
      setError(errMsg(err, 'Could not load this view'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, key, fingerprint]);

  useEffect(() => {
    if (!enabled) return;
    const stopWatching = watchReask(key, () => void run());
    // The cached payload only answers the current question when it was fetched with these params.
    const fresh =
      asked.get(key) === fingerprint &&
      values.has(key) &&
      (options?.refetchOnMount ? false : Date.now() - (stamp.get(key) ?? 0) < 20_000);
    if (!fresh) void run();
    return stopWatching;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, run, gen, fingerprint]);

  return {
    data: values.get(key) as T | undefined,
    loading: loading || (enabled && !values.has(key) && !error),
    error,
    refetch: () => void run(),
    setData: (value: T) => write(key, value, params),
  };
}

/** Fires `fn` when the socket says something changed, with a small debounce. */
export function scheduleRefetch(...prefixes: string[]) {
  for (const p of prefixes) invalidate(p);
}
