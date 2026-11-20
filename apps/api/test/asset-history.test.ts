import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import request from 'supertest';
import sharp from 'sharp';
import { readSetupToken } from './setup-fixture';

let app: any, api: any, directory: string, token: string, photo: Buffer;
const auth = () => ({ Authorization: `Bearer ${token}` });
const oldestId = 'asset-history-0000';

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'world-asset-history-'));
  process.env.DATABASE_URL = `file:${path.join(directory, 'test.db').replace(/\\/g, '/')}`;
  process.env.STORAGE_DIR = path.join(directory, 'storage');
  process.env.ASSET_SECRET = 'asset-history-isolated-secret-1234567890';
  process.env.AUTO_BACKUP_HOURS = '0';
  execFileSync(
    process.execPath,
    [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--config', 'prisma.config.ts'],
    {
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe',
      env: { ...process.env, RUST_LOG: 'info' },
    },
  );
  const { createApp } = await import('../src/app');
  app = await createApp({ logger: false });
  await app.init();
  api = request(app.getHttpServer());
  const setup = await api.post('/api/auth/setup').send({
    setupToken: readSetupToken(path.join(directory, 'storage')),
    username: 'asset_history_owner',
    password: 'asset-history-password-123',
    nickname: '小林',
    spaceName: '完整照片历史',
    startDate: '2024-01-01',
  });
  assert.equal(setup.status, 201, JSON.stringify(setup.body));
  token = setup.body.token;
  const db = app.get('PRISMA');
  const owner = await db.user.findUniqueOrThrow({ where: { username: 'asset_history_owner' } });
  photo = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#e5bbaa' } })
    .webp()
    .toBuffer();
  for (let offset = 0; offset < 1001; offset += 500) {
    await db.asset.createMany({
      data: Array.from({ length: Math.min(500, 1001 - offset) }, (_, index) => {
        const number = offset + index;
        return {
          id: `asset-history-${String(number).padStart(4, '0')}`,
          spaceId: owner.spaceId,
          filename: `asset-history-${number}.webp`,
          originalName: `照片-${number}.webp`,
          mime: 'image/webp',
          size: photo.length,
          createdAt: new Date(Date.UTC(2020, 0, 1) + number * 1000),
        };
      }),
    });
  }
  const otherSpace = await db.space.create({
    data: { name: '另一个空间', startDate: '2024-01-01' },
  });
  await db.asset.create({
    data: {
      id: 'outside-asset',
      spaceId: otherSpace.id,
      filename: 'outside-asset.webp',
      originalName: '其他空间的照片.webp',
      mime: 'image/webp',
      size: photo.length,
    },
  });
  await mkdir(path.join(directory, 'storage', 'uploads'), { recursive: true });
  await writeFile(path.join(directory, 'storage', 'uploads', 'asset-history-0.webp'), photo);
});

after(async () => {
  if (app) await app.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('all 1001 asset records remain available including the oldest signed photo', async () => {
  const listed = await api.get('/api/assets').set(auth());
  assert.equal(listed.status, 200);
  assert.equal(listed.body.length, 1001);
  assert.equal(listed.body[0].id, 'asset-history-1000');
  assert.equal(listed.body.at(-1).id, oldestId);
  assert.ok(!listed.body.some((asset: any) => asset.id === 'outside-asset'));
  const oldest = listed.body.find((asset: any) => asset.id === oldestId);
  assert.ok(oldest?.url);
  const served = await api
    .get(oldest.url)
    .buffer(true)
    .parse((res: any, cb: any) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  assert.equal(served.status, 200);
  assert.deepEqual(served.body, photo);
  assert.equal((await api.get('/api/assets')).status, 401);
});

test('signed photo URLs are short lived, tamper resistant, and not cacheable', async () => {
  const listed = await api.get('/api/assets').set(auth());
  assert.equal(listed.status, 200);
  const oldest = listed.body.find((asset: any) => asset.id === oldestId);
  assert.ok(oldest?.url);
  const parsed = new URL(`http://localhost${oldest.url}`);
  const expires = Number(parsed.searchParams.get('expires'));
  assert.ok(expires > Date.now());
  assert.ok(expires - Date.now() <= 30 * 60 * 1000 + 1_000);

  const expired = Date.now() - 1;
  const expiredSignature = crypto
    .createHmac('sha256', process.env.ASSET_SECRET!)
    .update(`${oldestId}:${expired}`)
    .digest('hex');
  assert.equal(
    (await api.get(`/api/assets/${oldestId}/file?expires=${expired}&signature=${expiredSignature}`))
      .status,
    403,
  );

  const originalSignature = parsed.searchParams.get('signature')!;
  const tampered = (originalSignature[0] === '0' ? '1' : '0') + originalSignature.slice(1);
  assert.equal(
    (await api.get(`/api/assets/${oldestId}/file?expires=${expires}&signature=${tampered}`)).status,
    403,
  );

  const tooFar = Date.now() + 30 * 60 * 1000 + 1_000;
  const tooFarSignature = crypto
    .createHmac('sha256', process.env.ASSET_SECRET!)
    .update(`${oldestId}:${tooFar}`)
    .digest('hex');
  assert.equal(
    (await api.get(`/api/assets/${oldestId}/file?expires=${tooFar}&signature=${tooFarSignature}`))
      .status,
    403,
  );

  const served = await api.get(oldest.url).buffer(true);
  assert.equal(served.status, 200);
  assert.equal(served.headers['cache-control'], 'private, no-store, max-age=0');
  assert.equal(served.headers.pragma, 'no-cache');
});

test('authorized users can renew only their own asset URLs', async () => {
  const renewed = await api.get('/api/assets/' + oldestId + '/url').set(auth());
  assert.equal(renewed.status, 200, JSON.stringify(renewed.body));
  assert.equal(renewed.body.id, oldestId);
  assert.match(renewed.body.url, new RegExp('/api/assets/' + oldestId + '/file\\\\?'));

  assert.equal((await api.get('/api/assets/' + oldestId + '/url')).status, 401);
  assert.equal((await api.get('/api/assets/outside-asset/url').set(auth())).status, 404);
});
