import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../generated/prisma/client';

const globalForPrisma = globalThis as { prisma?: PrismaClient };

function createClient() {
  const url = process.env.DATABASE_URL ?? 'file:./dev.db';
  return new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
