/** Explicit acceptance check; the real configured database is never opened. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { projectRoot, resolveEnvironment } from './runtime.mts';

const prefix = path.join(os.tmpdir(), 'world-demo-check-');
const temporaryRoot = mkdtempSync(prefix);
const password = randomBytes(24).toString('hex');
const environment = resolveEnvironment(projectRoot, {
  ...process.env,
  DATABASE_URL: `file:${path.join(temporaryRoot, 'world.db').replace(/\\/g, '/')}`,
  STORAGE_DIR: path.join(temporaryRoot, 'storage'),
  ASSET_SECRET: randomBytes(48).toString('hex'), DEMO_PASSWORD: password, RUST_LOG: 'info',
});
const run = () => spawnSync(process.execPath, ['--experimental-strip-types', 'scripts/demo.mts'], {
  cwd: projectRoot, env: environment, encoding: 'utf8', windowsHide: true, timeout: 120000,
});

try {
  const seeded = run();
  assert.equal(seeded.status, 0, seeded.error?.message || `${seeded.stdout}\n${seeded.stderr}`);
  const require = createRequire(import.meta.url);
  const { PrismaClient } = require('@prisma/client') as typeof import('@prisma/client');
  const database = new PrismaClient({ datasources: { db: { url: environment.DATABASE_URL } } });
  try {
    assert.equal(await database.space.count(), 1);
    assert.equal(await database.user.count(), 2);
    assert.ok(await database.entry.count() >= 10);
    const snapshot = async () => JSON.stringify({
      spaces: await database.space.findMany({ orderBy: { id: 'asc' } }),
      users: await database.user.findMany({ orderBy: { id: 'asc' } }),
      entries: await database.entry.findMany({ orderBy: { id: 'asc' } }),
    });
    const before = await snapshot();
    const refused = run();
    assert.notEqual(refused.status, 0);
    assert.match(`${refused.stdout}\n${refused.stderr}`, /already has a space/);
    assert.equal(await snapshot(), before, 'Second demo attempt changed existing records');
    console.log(`Demo check passed: 1 space, 2 users, ${await database.entry.count()} records; a second run refused without changing any data.`);
  } finally { await database.$disconnect(); }
} catch (error) {
  console.error(`Demo check failed: ${(error as Error).message.replaceAll(password, '[private]')}`);
  process.exitCode = 1;
} finally {
  if (!path.resolve(temporaryRoot).startsWith(path.resolve(prefix))) throw new Error('Unexpected temporary storage location');
  rmSync(temporaryRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
