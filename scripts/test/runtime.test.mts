import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { resolveEnvironment, stopChild } from '../runtime.mts';

test('resolves default database, upload, and Web paths from project root', () => {
  const root = path.resolve('test-world');
  const env = resolveEnvironment(root, {});
  assert.equal(env.DATABASE_URL, `file:${path.join(root, 'data/world.db').replace(/\\/g, '/')}`);
  assert.equal(env.STORAGE_DIR, path.join(root, 'storage'));
  assert.equal(env.WEB_DIST_DIR, path.join(root, 'apps/web/dist'));
  assert.equal(env.HOST, '0.0.0.0');
  assert.equal(env.PORT, '3000');
  assert.equal(env.AUTO_BACKUP_HOURS, '24');
  assert.equal(env.API_PROXY_TARGET, 'http://127.0.0.1:3000');
});

test('preserves custom absolute paths and environment variables', () => {
  const root = path.resolve('test-world');
  const db = path.resolve('different place', 'family.db');
  const storage = path.resolve('photos');
  const input = { DATABASE_URL: `file:${db}?connection_limit=1`, STORAGE_DIR: storage, PORT: '4080', ASSET_SECRET: 'private' };
  const env = resolveEnvironment(root, input);
  assert.equal(env.DATABASE_URL, `file:${db.replace(/\\/g, '/')}?connection_limit=1`);
  assert.equal(env.STORAGE_DIR, storage);
  assert.equal(env.PORT, '4080');
  assert.equal(env.API_PROXY_TARGET, 'http://127.0.0.1:4080');
  assert.equal(env.ASSET_SECRET, 'private');
  assert.equal(input.STORAGE_DIR, storage);
});

test('rejects nonpersistent databases and invalid ports before launching a process', () => {
  for (const DATABASE_URL of ['postgresql://example', 'file:', 'file::memory:']) {
    assert.throws(() => resolveEnvironment(process.cwd(), { DATABASE_URL }));
  }
  for (const PORT of ['abc', '-1', '0', '65536', '3.5']) {
    assert.throws(() => resolveEnvironment(process.cwd(), { PORT }));
  }
  for (const AUTO_BACKUP_HOURS of ['bad', '-1', 'Infinity', '0.00001', '597']) {
    assert.throws(() => resolveEnvironment(process.cwd(), { AUTO_BACKUP_HOURS }));
  }
  assert.equal(resolveEnvironment(process.cwd(), { AUTO_BACKUP_HOURS: '0' }).AUTO_BACKUP_HOURS, '0');
});

test('config-only initialization fills a blank secret and preserves it on a second run', (context) => {
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const root = mkdtempSync(path.join(os.tmpdir(), 'world-launcher-test-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts'));
  for (const name of ['runtime.mts', 'init.mts']) copyFileSync(path.join(sourceRoot, 'scripts', name), path.join(root, 'scripts', name));
  copyFileSync(path.join(sourceRoot, '.env.example'), path.join(root, '.env.example'));
  const envPath = path.join(root, '.env');
  const result = spawnSync(process.execPath, ['--experimental-strip-types', path.join(root, 'scripts/init.mts'), '--config-only'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr);
  const first = readFileSync(envPath, 'utf8');
  assert.match(first, /^ASSET_SECRET=[a-f0-9]{96}$/m);
  const again = spawnSync(process.execPath, ['--experimental-strip-types', path.join(root, 'scripts/init.mts'), '--config-only'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(readFileSync(envPath, 'utf8'), first);
});

test('stops a child even when Windows process-tree cleanup is unavailable', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    const stopped = new Promise<void>(resolve => child.once('exit', () => resolve()));
    stopChild(child);
    await Promise.race([
      stopped,
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Child did not stop')), 3000); }),
    ]);
  } finally {
    clearTimeout(timeout);
    child.kill();
  }
});
