import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
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
