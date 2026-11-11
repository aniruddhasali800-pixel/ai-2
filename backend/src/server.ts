import http from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { connectDb, disconnectDb } from './config/db';
import { RestaurantModel, UserModel } from './models';
import { phoneDigits } from './utils/phone';
import { seedDemoData } from './seed';
import { initSocket, closeSocket } from './realtime/socket';
import { startScheduler, stopScheduler } from './services/scheduler.service';

/**
 * Accounts that predate the phoneDigits column would never match a code request, because the
 * number was typed with spaces or a country code when the account was made. One pass at boot
 * fixes any database that has been sitting there since before the field existed.
 */
async function backfillPhoneDigits() {
  const missing = await UserModel.find({ $or: [{ phoneDigits: null }, { phoneDigits: { $exists: false } }] }, { phone: 1 }).lean();
  const ops = missing
    .filter((user) => !!user.phone)
    .map((user) => ({
      updateOne: { filter: { _id: user._id }, update: { $set: { phoneDigits: phoneDigits(user.phone) } } },
    }));
  if (ops.length) await UserModel.bulkWrite(ops);
}

async function main() {
  await connectDb();

  if (env.AUTO_SEED && (await RestaurantModel.estimatedDocumentCount()) === 0) {
    console.log('[server] empty database — loading the Saffron & Smoke demo tenant');
    await seedDemoData();
  }
  await backfillPhoneDigits();
  const app = createApp();
  const server = http.createServer(app);
  initSocket(server);
  startScheduler();

  await new Promise<void>((resolve) => server.listen(env.PORT, resolve));
  console.log(`[server] Sizzle API ready on http://localhost:${env.PORT} (${env.NODE_ENV})`);

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${signal} received — shutting down`);
    stopScheduler();
    await closeSocket();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await disconnectDb();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[server] failed to start', err);
  process.exit(1);
});
