import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import { Mutex } from 'async-mutex';
import { readSetupToken } from './setup-fixture';

let app: any, api: any, db: any, directory: string, token: string, smallBackup: Buffer;
const auth = () => ({ Authorization: `Bearer ${token}` });
const offlineGuidance = /停止服务.*data.*storage.*\.env.*离线/;
const binary = (res: any, cb: any) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'world-backup-limits-'));
  process.env.DATABASE_URL = `file:${path.join(directory, 'test.db').replace(/\\/g, '/')}`;
  process.env.STORAGE_DIR = path.join(directory, 'storage');
  process.env.ASSET_SECRET = 'backup-limits-isolated-test-secret-123456';
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
    username: 'limits_owner',
    password: 'limits-password-123',
    nickname: '小林',
    spaceName: '备份边界空间',
    startDate: '2024-01-01',
  });
  assert.equal(setup.status, 201, JSON.stringify(setup.body));
  token = setup.body.token;
  const baseline = await api.get('/api/backup/download').set(auth()).buffer(true).parse(binary);
  assert.equal(baseline.status, 200);
  smallBackup = baseline.body;
  const owner = await db.user.findFirst({ where: { role: 'owner' } });
  for (let offset = 0; offset < 10001; offset += 500) {
    await db.entry.createMany({
      data: Array.from({ length: Math.min(500, 10001 - offset) }, (_, index) => ({
        id: `limit-wish-${offset + index}`,
        kind: 'wishes',
        data: JSON.stringify({ title: `愿望 ${offset + index}` }),
        authorId: owner.id,
        spaceId: owner.spaceId,
      })),
    });
  }
});

after(async () => {
  if (app) await app.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('manual backup refuses a dataset beyond the restore record budget with offline guidance', async () => {
  const response = await api.get('/api/backup/download').set(auth());
  assert.equal(response.status, 413);
  assert.match(response.body.message, offlineGuidance);
  assert.equal(await db.entry.count(), 10001);
});

test('automatic backup refuses oversized current data and preserves all previous archives', async () => {
  const backups = path.join(directory, 'storage', 'backups');
  await mkdir(backups, { recursive: true });
  const names = Array.from({ length: 7 }, (_, index) => `auto-${1000000000000 + index}.zip`);
  for (const name of names) await writeFile(path.join(backups, name), `previous-${name}`);
  const { makeBackupController } = await import('../src/backup');
  const controller = makeBackupController({
    db,
    assets: { directory: path.join(directory, 'storage', 'uploads') },
    route: () => {},
    auth: {},
    mutex: new Mutex(),
  }) as any;
  await assert.rejects(controller.runAutomatic(), offlineGuidance);
  assert.deepEqual((await readdir(backups)).sort(), names);
  for (const name of names)
    assert.equal(await readFile(path.join(backups, name), 'utf8'), `previous-${name}`);
});

test('restore refuses before mutation when current data cannot fit a protection archive', async () => {
  const backups = path.join(directory, 'storage', 'backups');
  const namesBefore = (await readdir(backups)).sort();
  const spaceBefore = await db.space.findFirst();
  const response = await api
    .post('/api/backup/restore')
    .set(auth())
    .attach('file', smallBackup, { filename: 'valid-small-backup.zip' });
  assert.equal(response.status, 413);
  assert.match(response.body.message, offlineGuidance);
  assert.equal(await db.entry.count(), 10001);
  assert.ok(await db.entry.findUnique({ where: { id: 'limit-wish-10000' } }));
  assert.deepEqual(await db.space.findFirst(), spaceBefore);
  assert.deepEqual((await readdir(backups)).sort(), namesBefore);
});
