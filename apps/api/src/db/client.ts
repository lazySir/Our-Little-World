import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient as GeneratedPrismaClient } from '../generated/prisma/client';

export { PrismaClient, Prisma } from '../generated/prisma/client';
export type { Asset, Entry, Session, Space, User, Invite } from '../generated/prisma/client';

export function createPrismaClient(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) throw new Error('DATABASE_URL is required to create the SQLite client');
  const adapter = new PrismaBetterSqlite3(
    { url: databaseUrl },
    { timestampFormat: 'unixepoch-ms' },
  );
  return new GeneratedPrismaClient({ adapter });
}
