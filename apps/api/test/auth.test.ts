import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import type { WorldApplication } from '../src/app';
import { readSetupToken } from './setup-fixture';
let app: WorldApplication, api: ReturnType<typeof request>, directory: string, token: string;
before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'world-auth-'));
  process.env.DATABASE_URL = `file:${path.join(directory, 'test.db').replace(/\\/g, '/')}`;
  process.env.STORAGE_DIR = path.join(directory, 'storage');
  process.env.ASSET_SECRET = 'test-secret-that-is-long-enough-for-tests';
  process.env.RUST_LOG ||= 'info';
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
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
test('fresh install creates one owner and protects space', async () => {
  assert.equal((await api.get('/api/auth/status')).body.initialized, false);
  assert.equal((await api.get('/api/auth/me')).status, 401);
  const setup = await api.post('/api/auth/setup').send({
    setupToken: readSetupToken(path.join(directory, 'storage')),
    username: 'owner',
    password: 'correct-horse-123',
    nickname: '小林',
    spaceName: '我们',
    startDate: '2024-02-29',
  });
  assert.equal(setup.status, 201, JSON.stringify(setup.body));
  token = setup.body.token;
  assert.ok(token);
  assert.equal(setup.body.user.passwordHash, undefined);
  assert.equal((await api.post('/api/auth/setup').send({})).status, 409);
  const me = await api.get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  assert.equal(me.body.space.name, '我们');
  assert.equal(me.body.partner, null);
});
test('one-use invitation admits one partner and rejects a third', async () => {
  const invitation = await api.post('/api/auth/invite').set('Authorization', `Bearer ${token}`);
  assert.equal(invitation.status, 201);
  const joined = await api.post('/api/auth/join').send({
    code: invitation.body.code,
    username: 'partner',
    password: 'partner-password-123',
    nickname: '小禾',
  });
  assert.equal(joined.status, 201, JSON.stringify(joined.body));
  assert.equal(
    (
      await api.post('/api/auth/join').send({
        code: invitation.body.code,
        username: 'third',
        password: 'third-password-123',
        nickname: '第三人',
      })
    ).status,
    400,
  );
  assert.equal(
    (await api.post('/api/auth/invite').set('Authorization', `Bearer ${token}`)).status,
    409,
  );
});
test('password checks, login and logout revoke sessions', async () => {
  assert.equal(
    (await api.post('/api/auth/login').send({ username: 'owner', password: 'bad' })).status,
    401,
  );
  const login = await api
    .post('/api/auth/login')
    .send({ username: 'owner', password: 'correct-horse-123' });
  assert.equal(login.status, 201);
  await api.post('/api/auth/logout').set('Authorization', `Bearer ${login.body.token}`);
  assert.equal(
    (await api.get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`)).status,
    401,
  );
});
test('changing a password keeps its current session and revokes other sessions', async () => {
  const secondSession = await api
    .post('/api/auth/login')
    .send({ username: 'owner', password: 'correct-horse-123' });
  assert.equal(secondSession.status, 201, JSON.stringify(secondSession.body));
  const changed = await api
    .patch('/api/auth/password')
    .set('Authorization', `Bearer ${token}`)
    .send({ currentPassword: 'correct-horse-123', newPassword: 'new-correct-horse-456' });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  assert.equal((await api.get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status, 200);
  assert.equal(
    (await api.get('/api/auth/me').set('Authorization', `Bearer ${secondSession.body.token}`))
      .status,
    401,
  );
  assert.equal(
    (await api.post('/api/auth/login').send({ username: 'owner', password: 'correct-horse-123' }))
      .status,
    401,
  );
  const newLogin = await api
    .post('/api/auth/login')
    .send({ username: 'owner', password: 'new-correct-horse-456' });
  assert.equal(newLogin.status, 201, JSON.stringify(newLogin.body));
});
