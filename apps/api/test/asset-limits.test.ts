import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import sharp from 'sharp';
import type { PrismaClient } from '../src/db/client';
import type { WorldApplication } from '../src/app';
import { readSetupToken } from './setup-fixture';

const imageLimit = 10 * 1024 * 1024;
let app: WorldApplication;
let api: ReturnType<typeof request>;
let db: PrismaClient;
let directory: string;
let token: string;
let photo: Buffer;
const auth = () => ({ Authorization: `Bearer ${token}` });
const files = () =>
  readdir(path.join(directory, 'storage', 'uploads')).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'world-asset-limits-'));
  process.env.DATABASE_URL = `file:${path.join(directory, 'test.db').replace(/\\/g, '/')}`;
  process.env.STORAGE_DIR = path.join(directory, 'storage');
  process.env.ASSET_SECRET = 'asset-limits-isolated-test-secret-123456';
  process.env.AUTO_BACKUP_HOURS = '0';
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--config', 'prisma.config.ts'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'pipe',
    env: { ...process.env, RUST_LOG: 'info' },
  });
  const { createApp } = await import('../src/app');
  app = await createApp({ logger: false });
  await app.init();
  api = request(app.getHttpServer());
  db = app.get('PRISMA');
  const setup = await api.post('/api/auth/setup').send({
    setupToken: readSetupToken(path.join(directory, 'storage')),
    username: 'asset_limits_owner',
    password: 'asset-limits-password-123',
    nickname: '小林',
    spaceName: '照片上传边界',
    startDate: '2024-01-01',
  });
  assert.equal(setup.status, 201, JSON.stringify(setup.body));
  token = setup.body.token;
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#e5bbaa' } })
    .png()
    .toBuffer();
  photo = Buffer.alloc(imageLimit);
  png.copy(photo);
  // Padding changes the upload size while keeping a small, decodable image.
  assert.ok((await sharp(photo).webp().toBuffer()).length > 0);
});

after(async () => {
  if (app) await app.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('image upload accepts exactly 10 MiB', async () => {
  assert.equal(photo.length, imageLimit);
  const response = await api
    .post('/api/assets')
    .set(auth())
    .attach('file', photo, { filename: 'exact-limit.png', contentType: 'image/png' });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const asset = await db.asset.findUniqueOrThrow({ where: { id: response.body.id } });
  assert.equal(asset.originalName, 'exact-limit.png');
  assert.equal(asset.mime, 'image/webp');
  assert.deepEqual(await files(), [asset.filename]);
});

test('image upload rejects one byte over 10 MiB without writing an asset or file', async () => {
  const assetsBefore = await db.asset.findMany();
  const filesBefore = await files();
  const oversized = Buffer.concat([photo, Buffer.alloc(1)]);
  assert.equal(oversized.length, imageLimit + 1);
  const response = await api
    .post('/api/assets')
    .set(auth())
    .attach('file', oversized, { filename: 'over-limit.png', contentType: 'image/png' });
  assert.equal(response.status, 413, JSON.stringify(response.body));
  assert.deepEqual(await db.asset.findMany(), assetsBefore);
  assert.deepEqual(await files(), filesBefore);
});
