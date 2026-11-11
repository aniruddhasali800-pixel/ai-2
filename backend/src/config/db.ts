import { resolve } from 'node:path';
import mongoose from 'mongoose';
import { env } from './env';
import { startStore } from '../store';

/**
 * Connects to MongoDB when MONGODB_URI is provided, and initializes the record store.
 */
export async function connectDb(): Promise<void> {
  if (env.MONGODB_URI && env.NODE_ENV !== 'test') {
    try {
      console.log(`[mongo] Connecting to MongoDB: ${env.MONGODB_URI.replace(/:([^:@]+)@/, ':****@')}`);
      await mongoose.connect(env.MONGODB_URI, {
        serverSelectionTimeoutMS: 8000,
      });
      console.log(`[mongo] Connected successfully to MongoDB: ${mongoose.connection.host}/${mongoose.connection.name}`);
    } catch (err: any) {
      console.error(`[mongo] MongoDB connection failed (${err.message}). Running with local store.`);
    }
  }

  const dir = resolve(process.cwd(), env.ARCHIVE_DIR);
  const { files, documents } = await startStore(dir);
  if (documents) console.log(`[store] ${documents} records across ${files} files in ${dir}`);
  else console.log(`[store] the archive is empty — ${dir}`);
}

export async function disconnectDb(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
    console.log('[mongo] Disconnected from MongoDB');
  }
}
