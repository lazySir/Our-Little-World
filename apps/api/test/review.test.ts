import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import sharp from 'sharp';
import AdmZip from 'adm-zip';
let app: any, api: any, directory: string, ownerToken: string, partnerToken: string;
const owner = () => ({ Authorization: `Bearer ${ownerToken}` });
before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'world-review-'));
  process.env.DATABASE_URL = `file:${path.join(directory, 'test.db').replace(/\\/g, '/')}`;
  process.env.STORAGE_DIR = path.join(directory, 'storage');
  process.env.ASSET_SECRET = 'independent-review-asset-secret-123456';
  process.env.TZ = 'America/Los_Angeles';
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
    username: 'review_owner',
    password: 'review-password-123',
    nickname: '小林',
    spaceName: '审查空间',
    startDate: '2024-02-29',
  });
  assert.equal(setup.status, 201, JSON.stringify(setup.body));
  ownerToken = setup.body.token;
  const invite = await api.post('/api/auth/invite').set(owner());
  const partner = await api.post('/api/auth/join').send({
    code: invite.body.code,
    username: 'review_partner',
    password: 'review-partner-123',
    nickname: '小禾',
  });
  assert.equal(partner.status, 201);
  partnerToken = partner.body.token;
});
after(async () => {
  if (app) await app.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('ordinary exports keep letters sealed across configured time zones', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 16, 20, 0, 0) });
  const letter = await api.post('/api/letters').set(owner()).send({
    title: '明天再打开',
    content: '时区不同也不能提前打开的秘密',
    unlockDate: '2026-11-17',
  });
  assert.equal(letter.status, 201, JSON.stringify(letter.body));
  assert.equal(letter.body.isLocked, true);
  const listed = await api.get('/api/letters').set({ Authorization: `Bearer ${partnerToken}` });
  assert.equal(listed.body.find((row: any) => row.id === letter.body.id).content, undefined);
  const exported = await api
    .get('/api/backup/export')
    .set({ Authorization: `Bearer ${partnerToken}` });
  assert.equal(exported.status, 200);
  assert.ok(
    !JSON.stringify(exported.body).includes('时区不同也不能提前打开的秘密'),
    'export must use the same calendar date as the locked-letter API',
  );
});

test('restore repairs a damaged image even when its filename already exists', async () => {
  const image = await sharp({
    create: { width: 12, height: 12, channels: 3, background: '#e5bbaa' },
  })
    .png()
    .toBuffer();
  const asset = await api
    .post('/api/assets')
    .set(owner())
    .attach('file', image, { filename: 'review.png', contentType: 'image/png' });
  assert.equal(asset.status, 201);
  const backup = await api
    .get('/api/backup/download')
    .set(owner())
    .buffer(true)
    .parse((res: any, cb: any) => {
      const chunks: Buffer[] = [];
      res.on('data', (b: Buffer) => chunks.push(b));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  assert.equal(backup.status, 200);
  const zip = new AdmZip(backup.body);
  const data = JSON.parse(zip.readAsText('data.json'));
  const stored = data.assets.find((row: any) => row.id === asset.body.id);
  const original = zip.readFile(`uploads/${stored.filename}`);
  assert.ok(original);
  await writeFile(
    path.join(directory, 'storage', 'uploads', stored.filename),
    Buffer.from('damaged existing file'),
  );
  const ordinary = await api.get('/api/backup/download').set(owner());
  assert.equal(ordinary.status, 409, 'A complete download must refuse inconsistent photo bytes');
  const restore = await api
    .post('/api/backup/restore')
    .set(owner())
    .attach('file', backup.body, { filename: 'review-backup.zip' });
  assert.equal(restore.status, 201, JSON.stringify(restore.body));
  assert.equal(restore.body.safetyDamagedAssets, 1);
  const safety = new AdmZip(
    await readFile(path.join(directory, 'storage', 'backups', restore.body.safetyBackup)),
  );
  const manifest = JSON.parse(safety.readAsText('manifest.json'));
  assert.equal(manifest.complete, false);
  assert.deepEqual(manifest.damagedAssets, [
    {
      id: stored.id,
      filename: stored.filename,
      expectedSize: stored.size,
      actualSize: Buffer.byteLength('damaged existing file'),
    },
  ]);
  assert.deepEqual(
    safety.readFile(`uploads/${stored.filename}`),
    Buffer.from('damaged existing file'),
  );
  const served = await api
    .get(asset.body.url)
    .buffer(true)
    .parse((res: any, cb: any) => {
      const chunks: Buffer[] = [];
      res.on('data', (b: Buffer) => chunks.push(b));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  assert.equal(served.status, 200);
  assert.deepEqual(
    served.body,
    original,
    'restore must restore the image bytes, not keep the damaged existing file',
  );
});

test('passwords longer than bcrypt byte capacity are rejected', async () => {
  const changed = await api
    .patch('/api/auth/password')
    .set(owner())
    .send({ currentPassword: 'review-password-123', newPassword: 'a'.repeat(73) });
  assert.equal(
    changed.status,
    400,
    'a password must not silently ignore bytes after the 72-byte bcrypt limit',
  );
});

test('upcoming dashboard anniversaries exclude past one-time dates before limiting', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 17, 12, 0, 0) });
  for (let index = 1; index <= 5; index++) {
    const past = await api
      .post('/api/anniversaries')
      .set(owner())
      .send({ title: `过去的一次性日期 ${index}`, date: `2000-01-0${index}`, recurring: false });
    assert.equal(past.status, 201, JSON.stringify(past.body));
  }
  const future = await api
    .post('/api/anniversaries')
    .set(owner())
    .send({ title: '下一份期待', date: '2099-01-01', recurring: false });
  assert.equal(future.status, 201, JSON.stringify(future.body));
  const dashboard = await api.get('/api/dashboard').set(owner());
  assert.equal(dashboard.status, 200);
  assert.ok(
    dashboard.body.upcomingAnniversaries.every((row: any) => row.daysUntil >= 0),
    'past one-time dates must not appear as upcoming',
  );
  assert.ok(
    dashboard.body.upcomingAnniversaries.some((row: any) => row.id === future.body.id),
    'past entries must not push the next future anniversary out of the dashboard limit',
  );
});
