import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { env, allowedOrigins } from '../config/env';
import { OrderModel, TableSessionModel } from '../models';
import type { AccessPayload } from '../middleware/auth';

let io: Server | null = null;

export const roomNames = {
  restaurant: (restaurantId: string) => `restaurant:${restaurantId}`,
  kitchen: (restaurantId: string) => `kitchen:${restaurantId}`,
  cashier: (restaurantId: string) => `cashier:${restaurantId}`,
  waiter: (userId: string) => `waiter:${userId}`,
  user: (userId: string) => `user:${userId}`,
  session: (token: string) => `session:${token}`,
  order: (token: string) => `order:${token}`,
};

export function getIO(): Server {
  if (!io) throw new Error('Socket.IO has not been initialised');
  return io;
}

export function initSocket(server: HttpServer): Server {
  io = new Server(server, {
    cors: { origin: allowedOrigins, credentials: true },
    path: '/socket.io',
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      // Customer sockets connect anonymously; they may only join a table-session room.
      socket.data.guest = true;
      return next();
    }
    try {
      socket.data.auth = jwt.verify(token, env.ACCESS_TOKEN_SECRET) as AccessPayload;
      next();
    } catch {
      next(new Error('unauthorised'));
    }
  });

  io.on('connection', (socket) => {
    const auth = socket.data.auth as AccessPayload | undefined;
    if (auth) {
      socket.join(roomNames.restaurant(auth.rid));
      socket.join(roomNames.user(auth.sub));
      if (auth.role === 'KITCHEN') socket.join(roomNames.kitchen(auth.rid));
      if (auth.role === 'CASHIER') socket.join(roomNames.cashier(auth.rid));
      if (auth.role === 'WAITER') socket.join(roomNames.waiter(auth.sub));
      socket.emit('connection:ready', { userId: auth.sub, role: auth.role, at: new Date().toISOString() });
    } else {
      socket.emit('connection:ready', { guest: true, at: new Date().toISOString() });
    }

    // Guests join the room for the table session printed in their QR flow.
    socket.on('join:session', async (payload: { token?: string }, ack?: (res: { ok: boolean }) => void) => {
      const token = typeof payload?.token === 'string' ? payload.token : '';
      if (!token || token.length < 8) {
        ack?.({ ok: false });
        return;
      }
      const session = await TableSessionModel.findOne({ publicToken: token }).select('_id').lean();
      if (!session) {
        ack?.({ ok: false });
        return;
      }
      socket.join(roomNames.session(token));
      ack?.({ ok: true });
    });

    socket.on('leave:session', (payload: { token?: string }) => {
      if (typeof payload?.token === 'string') socket.leave(roomNames.session(payload.token));
    });

    // An app customer follows one order — the tracking token is the only proof they get.
    socket.on('join:order', async (payload: { token?: string }, ack?: (res: { ok: boolean }) => void) => {
      const token = typeof payload?.token === 'string' ? payload.token : '';
      if (!token || token.length < 8) {
        ack?.({ ok: false });
        return;
      }
      const order = await OrderModel.findOne({ trackingToken: token }).select('_id').lean();
      if (!order) {
        ack?.({ ok: false });
        return;
      }
      socket.join(roomNames.order(token));
      ack?.({ ok: true });
    });

    socket.on('leave:order', (payload: { token?: string }) => {
      if (typeof payload?.token === 'string') socket.leave(roomNames.order(payload.token));
    });
  });

  return io;
}

export async function closeSocket(): Promise<void> {
  if (io) {
    await io.close();
    io = null;
  }
}
