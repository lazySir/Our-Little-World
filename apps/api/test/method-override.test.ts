import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import request from 'supertest';

let app: any, api: any, directory: string, token: string, wishId: string;
const auth = () => ({ Authorization: `Bearer ${token}` });
const override = { 'X-HTTP-Method-Override': 'PATCH' };

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'world-method-override-'));
  process.env.DATABASE_URL = `file:${path.join(directory, 'test.db').replace(/\\/g, '/')}`;
  process.env.STORAGE_DIR = path.join(directory, 'storage');
  process.env.ASSET_SECRET = 'method-override-test-secret-123456789';
  process.env.AUTO_BACKUP_HOURS = '0';
  process.env.CORS_ORIGINS = 'http://localhost:5175';
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'pipe',
    env: { ...process.env, RUST_LOG: 'info' },
  });
  const { createApp } = await import('../src/app');
  app = await createApp({ logger: false });
  await app.init();
  api = request(app.getHttpServer());
  const setup = await api.post('/api/auth/setup').send({
    username: 'transport_owner',
    password: 'transport-password-123',
    nickname: '原昵称',
    spaceName: '微信兼容测试',
    startDate: '2024-01-01',
  });
  assert.equal(setup.status, 201, JSON.stringify(setup.body));
  token = setup.body.token;
  const wish = await api.post('/api/wishes').set(auth()).send({ title: '原愿望' });
  assert.equal(wish.status, 201);
  wishId = wish.body.id;
});

after(async () => {
  if (app) await app.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('POST PATCH override edits a persisted resource while direct PATCH remains available', async () => {
  const edited = await api
    .post(`/api/wishes/${wishId}`)
    .set({ ...auth(), ...override })
    .send({ title: '微信编辑后的愿望' });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.id, wishId);
  assert.equal(edited.body.title, '微信编辑后的愿望');
  const listed = await api.get('/api/wishes').set(auth());
  assert.equal(listed.body.find((row: any) => row.id === wishId).title, '微信编辑后的愿望');
  const direct = await api.patch(`/api/wishes/${wishId}`).set(auth()).send({ status: 'done' });
  assert.equal(direct.status, 200, JSON.stringify(direct.body));
  assert.equal(direct.body.status, 'done');
});

test('POST PATCH override edits the authenticated nickname', async () => {
  const edited = await api
    .post('/api/auth/profile')
    .set({ ...auth(), ...override })
    .send({ nickname: '微信新昵称' });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.nickname, '微信新昵称');
  assert.equal((await api.get('/api/auth/me').set(auth())).body.user.nickname, '微信新昵称');
});

test('overridden PATCH requests still require a valid session', async () => {
  const response = await api
    .post(`/api/wishes/${wishId}`)
    .set(override)
    .send({ title: '匿名修改' });
  assert.equal(response.status, 401, JSON.stringify(response.body));
  const profile = await api.post('/api/auth/profile').set(override).send({ nickname: '匿名昵称' });
  assert.equal(profile.status, 401, JSON.stringify(profile.body));
});

test('GET and non-PATCH method overrides cannot change a resource', async () => {
  const before = (await api.get('/api/wishes').set(auth())).body;
  const get = await api
    .get('/api/wishes')
    .set({ ...auth(), ...override })
    .send({ title: 'GET 不应修改' });
  assert.equal(get.status, 200, JSON.stringify(get.body));
  assert.deepEqual(get.body, before);
  for (const method of ['DELETE', 'PUT', 'GET']) {
    const response = await api
      .post(`/api/wishes/${wishId}`)
      .set({ ...auth(), 'X-HTTP-Method-Override': method })
      .send({ title: `${method} 不应修改` });
    assert.equal(response.status, 404, `${method}: ${JSON.stringify(response.body)}`);
  }
  assert.deepEqual((await api.get('/api/wishes').set(auth())).body, before);
});

test('configured H5 origins may send the method override header', async () => {
  const response = await api
    .options(`/api/wishes/${wishId}`)
    .set('Origin', 'http://localhost:5175')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'authorization,content-type,x-http-method-override');
  assert.equal(response.status, 204);
  assert.match(response.headers['access-control-allow-headers'], /x-http-method-override/i);
});
