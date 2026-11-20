import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import type { WorldApplication } from '../src/app';
let app: WorldApplication, api: ReturnType<typeof request>, directory: string;
const setup = (setupToken?: string) =>
  api.post('/api/auth/setup').send({
    ...(setupToken ? { setupToken } : {}),
    username: 'private_owner',
    password: 'correct-horse-123',
    nickname: '小林',
    spaceName: '我们的小世界',
    startDate: '2024-02-29',
  });
before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'world-setup-token-'));
  process.env.DATABASE_URL = `file:${path.join(directory, 'test.db').replace(/\\/g, '/')}`;
  process.env.STORAGE_DIR = path.join(directory, 'storage');
  process.env.ASSET_SECRET = 'test-secret-that-is-long-enough-for-tests';
  process.env.SETUP_TOKEN = '';
  process.env.RUST_LOG ||= 'info';
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--config', 'prisma.config.ts'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'pipe',
    env: { ...process.env, RUST_LOG: 'info' },
  });
  const { createApp } = require('../src/app');
  app = await createApp({ logger: false });
  await app.init();
  api = request(app.getHttpServer());
});
after(async () => {
  if (app) await app.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
test('first owner setup requires the local one-time code and consumes it after creation', async () => {
  assert.equal((await setup()).status, 403);
  assert.equal((await setup('wrong-code')).status, 403);
  assert.equal((await api.get('/api/auth/status')).body.initialized, false);
  assert.equal(await app.get('PRISMA').user.count(), 0);

  const setupToken = (
    await readFile(path.join(directory, 'storage', '.setup-token'), 'utf8')
  ).trim();
  assert.equal(setupToken.length, 43);
  const created = await setup(setupToken);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal((await api.get('/api/auth/status')).body.initialized, true);
  await assert.rejects(readFile(path.join(directory, 'storage', '.setup-token'), 'utf8'));
  assert.equal((await setup(setupToken)).status, 409);
});
