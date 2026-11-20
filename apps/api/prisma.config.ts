import path from 'node:path';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

const root = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });
dotenv.config({ path: path.join(root, 'apps/api/.env'), quiet: true });
const defaultDatabaseUrl = `file:${path.join(root, 'data/world.db').replaceAll('\\', '/')}`;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL || defaultDatabaseUrl },
});
