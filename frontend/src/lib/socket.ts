import { io, type Socket } from 'socket.io-client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

// Read straight from the environment rather than importing API_ROOT from ./api: this module has to
// be importable *by* the HTTP layer, which re-authenticates the socket after a token refresh.
const API_ROOT = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') ?? '';

let socket: Socket | null = null;
let authToken: string | null = null;

/**
 * Bumped whenever the socket object is replaced. The access token lives fifteen minutes and the
 * HTTP layer quietly mints a new one underneath this socket, so a connection is not a one-way,
 * page-load-only thing — every subscriber has to rebind to the new socket or live updates stop
 * with no error anywhere. Hooks read this generation instead of capturing `socket` once.
 */
let generation = 0;
const generationListeners = new Set<() => void>();

let recovering = false;
let authResolver: (() => Promise<string>) | null = null;

/** The HTTP layer hands over a way to mint a fresh access token when the socket's has aged out. */
export function onRealtimeAuthFailure(resolver: () => Promise<string>) {
  authResolver = resolver;
}

/** Guest rooms this page cares about, replayed at the server on every (re)connect. */
const joinedSessions = new Set<string>();
const joinedOrders = new Set<string>();

function announce() {
  generation += 1;
  for (const listener of [...generationListeners]) listener();
}

function subscribeGeneration(listener: () => void) {
  generationListeners.add(listener);
  return () => {
    generationListeners.delete(listener);
  };
}

function attachRoomReplays(target: Socket) {
  target.on('connect', () => {
    recovering = false;
    for (const token of joinedSessions) target.emit('join:session', { token });
    for (const token of joinedOrders) target.emit('join:order', { token });
  });
  target.on('connect_error', (err: Error) => {
    // Counting failures and blaming the token was wrong twice over: a proxy that cannot carry the
    // transport and a server that refused the credential look identical from here, and mistaking the
    // one for the other minted a fresh token, re-opened the socket, failed the same way and minted
    // another. Only the server's own refusal of the credential asks for a new one, and it asks once.
    if (!/unauthor/i.test(String(err?.message ?? '')) || recovering || !authToken || !authResolver) return;
    recovering = true;
    void authResolver().catch(() => {
      recovering = false;
    });
  });
}

export function connectRealtime(token: string | null) {
  // Same token, live socket: nothing to do. Hub and login both call this on mount, and tearing
  // the socket down there would drop every listener for no reason.
  if (socket && token === authToken) return socket;
  authToken = token;
  recovering = false;
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  socket = io(API_ROOT || undefined, {
    path: '/socket.io',
    auth: token ? { token } : {},
    // Polling first, then upgrade. Asking for a WebSocket before anything has proven that the path
    // between the browser and the API can carry one — a proxy in front of a separate API host usually
    // cannot — leaves the screen with no transport at all, retrying the same failed upgrade forever.
    // Plain HTTP polling goes through wherever the API calls themselves already go through.
    transports: ['polling', 'websocket'],
    upgrade: true,
  });
  attachRoomReplays(socket);
  announce();
  return socket;
}

export function disconnectRealtime() {
  authToken = null;
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }
  joinedSessions.clear();
  joinedOrders.clear();
  announce();
}

export function getSocket(): Socket | null {
  return socket;
}

export function joinSession(token: string) {
  joinedSessions.add(token);
  socketOrGuest().emit('join:session', { token });
}

export function leaveSession(token: string) {
  joinedSessions.delete(token);
  socket?.emit('leave:session', { token });
}

/** An app guest follows one ticket, not a table. */
export function joinOrder(token: string) {
  joinedOrders.add(token);
  socketOrGuest().emit('join:order', { token });
}

export function leaveOrder(token: string) {
  joinedOrders.delete(token);
  socket?.emit('leave:order', { token });
}

/**
 * The guest screens — a table's session, its bill, a delivery tracker — are reached without
 * signing in, so nothing has opened a socket by the time they ask to follow a room. A guest room
 * needs no account: the token in the QR is the whole authorisation, and the server lets an
 * anonymous socket join nothing else. Without this the screens would sit there promising to
 * update on their own while never listening for the event that would do it.
 */
function socketOrGuest(): Socket {
  return socket ?? connectRealtime(null);
}

export function useRealtimeConnected(): boolean {
  const current = useSyncExternalStore(subscribeGeneration, () => generation);
  const [connected, setConnected] = useState(() => socket?.connected ?? false);
  useEffect(() => {
    const target = socket;
    // Stay wrong-side-up when there is no socket yet: a later connectRealtime bumps the
    // generation and this effect runs again.
    if (!target) {
      setConnected(false);
      return;
    }
    setConnected(target.connected);
    const on = () => setConnected(true);
    const off = () => setConnected(false);
    target.on('connect', on);
    target.on('disconnect', off);
    return () => {
      target.off('connect', on);
      target.off('disconnect', off);
    };
  }, [current]);
  return connected;
}

/** Subscribe to a socket event for the lifetime of a component. */
export function useRealtimeEvent<T = unknown>(event: string, handler: (payload: T) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  const current = useSyncExternalStore(subscribeGeneration, () => generation);
  useEffect(() => {
    const target = socket;
    if (!target) return;
    const listener = (payload: T) => ref.current(payload);
    target.on(event, listener);
    return () => {
      target.off(event, listener);
    };
  }, [event, current]);
}

/**
 * Catch-all subscription for a set of event-name prefixes — used by the guest
 * screens, which only care that "something on this table changed".
 */
export function useRealtimePrefix(prefixes: string[], handler: (event: string) => void) {
  const ref = useRef(handler);
  ref.current = handler;
  const fingerprint = prefixes.join('|');
  const current = useSyncExternalStore(subscribeGeneration, () => generation);
  useEffect(() => {
    const target = socket;
    if (!target) return;
    const list = fingerprint.split('|');
    const listener = (event: string) => {
      if (list.some((p) => event.startsWith(p))) ref.current(event);
    };
    target.onAny(listener);
    return () => {
      target.offAny(listener);
    };
  }, [fingerprint, current]);
}

export { authToken };
