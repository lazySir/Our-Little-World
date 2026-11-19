import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, unlink, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import sharp from 'sharp';
import AdmZip from 'adm-zip';
import { readSetupToken } from './setup-fixture';

let app: any, api: any, directory: string, token: string;
const auth = () => ({ Authorization: `Bearer ${token}` });
const binary = (res: any, cb: any) => {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'world-backup-recovery-'));
  process.env.DATABASE_URL = `file:${path.join(directory, 'test.db').replace(/\\/g, '/')}`;
  process.env.STORAGE_DIR = path.join(directory, 'storage');
  process.env.ASSET_SECRET = 'backup-recovery-isolated-test-secret-123456';
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
    username: 'recovery_owner',
    password: 'recovery-password-123',
    nickname: '小林',
    spaceName: '恢复审查空间',
    startDate: '2024-01-01',
  });
  assert.equal(setup.status, 201, JSON.stringify(setup.body));
  token = setup.body.token;
});

after(async () => {
  if (app) await app.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function upload(color: string) {
  const bytes = await sharp({ create: { width: 12, height: 12, channels: 3, background: color } })
    .png()
    .toBuffer();
  const response = await api.post('/api/assets').set(auth()).attach('file', bytes, {
    filename: 'recovery.png',
    contentType: 'image/png',
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body;
}

test('a successful restore removes unreferenced uploads without deleting another space assets', async (t) => {
  const retained = await upload('#e5bbaa');
  const backup = await api.get('/api/backup/download').set(auth()).buffer(true).parse(binary);
  assert.equal(backup.status, 200);
  const archived = new AdmZip(backup.body);
  const archivedAssets = JSON.parse(archived.readAsText('data.json')).assets;
  const retainedAsset = archivedAssets.find((asset: any) => asset.id === retained.id);
  assert.ok(retainedAsset);
  const uploadDirectory = path.join(directory, 'storage', 'uploads');
  const removed = await upload('#aae5bb');
  await writeFile(path.join(uploadDirectory, 'legacy-orphan.webp'), 'orphan');
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  const otherSpace = await db.space.create({
    data: { name: '另一个空间', startDate: '2024-01-01', theme: 'cream' },
  });
  const otherSpaceAsset = await db.asset.create({
    data: {
      spaceId: otherSpace.id,
      filename: 'other-space-photo.webp',
      originalName: 'other.webp',
      mime: 'image/webp',
      size: 6,
    },
  });
  t.after(async () => {
    await db.asset.deleteMany({ where: { id: otherSpaceAsset.id } });
    await db.space.deleteMany({ where: { id: otherSpace.id } });
    await db.$disconnect();
  });
  await writeFile(path.join(uploadDirectory, otherSpaceAsset.filename), 'shared');
  const current = await api.get('/api/backup/export').set(auth());
  const removedAsset = current.body.assets.find((asset: any) => asset.id === removed.id);
  assert.ok(removedAsset);

  const restore = await api
    .post('/api/backup/restore')
    .set(auth())
    .attach('file', backup.body, { filename: 'asset-cleanup.zip' });

  assert.equal(restore.status, 201, JSON.stringify(restore.body));
  assert.deepEqual(
    (await readdir(uploadDirectory)).sort(),
    [retainedAsset.filename, otherSpaceAsset.filename].sort(),
  );
  await assert.rejects(readFile(path.join(uploadDirectory, removedAsset.filename)), {
    code: 'ENOENT',
  });
  assert.equal(
    (await api.get(removed.url)).status,
    404,
    'A removed attachment must no longer be served after restore',
  );
  assert.deepEqual(
    await readFile(path.join(uploadDirectory, otherSpaceAsset.filename)),
    Buffer.from('shared'),
  );
});

test('a failed database restore keeps files from the pre-restore state', async () => {
  const retained = await upload('#d9bbaa');
  const record = await api.post('/api/wishes').set(auth()).send({ title: '触发数据库回滚' });
  assert.equal(record.status, 201);
  const backup = await api.get('/api/backup/download').set(auth()).buffer(true).parse(binary);
  assert.equal(backup.status, 200);
  const archive = new AdmZip(backup.body);
  const backupData = JSON.parse(archive.readAsText('data.json'));
  const restoredAsset = backupData.assets.find((asset: any) => asset.id === retained.id);
  assert.ok(restoredAsset);
  const uploadDirectory = path.join(directory, 'storage', 'uploads');
  const originalBytes = Buffer.from(archive.readFile(`uploads/${restoredAsset.filename}`)!);
  const beforeRestore = await api.get(retained.url).buffer(true).parse(binary);
  assert.equal(beforeRestore.status, 200);
  assert.deepEqual(beforeRestore.body, originalBytes);
  const altered = Buffer.from(archive.readFile(`uploads/${restoredAsset.filename}`)!);
  altered[0] ^= 0xff;
  archive.updateFile(`uploads/${restoredAsset.filename}`, altered);
  const failingBackup = archive.toBuffer();
  const current = await upload('#aabbdd');
  const { PrismaClient } = await import('@prisma/client');
  const db = new PrismaClient();
  const filesBefore = (await readdir(uploadDirectory)).sort();
  const exportBefore = await api.get('/api/backup/export').set(auth());

  try {
    await db.$executeRawUnsafe(`
      CREATE TRIGGER fail_restore_entry
      BEFORE INSERT ON "Entry"
      BEGIN SELECT RAISE(ABORT, 'forced restore failure'); END
    `);
    const originalConsoleError = console.error;
    let restore: any;
    try {
      console.error = () => {};
      restore = await api
        .post('/api/backup/restore')
        .set(auth())
        .attach('file', failingBackup, { filename: 'rollback.zip' });
    } finally {
      console.error = originalConsoleError;
    }

    assert.equal(restore.status, 500);
    assert.deepEqual((await readdir(uploadDirectory)).sort(), filesBefore);
    assert.equal((await api.get(current.url)).status, 200);
    const retainedAfter = await api.get(retained.url).buffer(true).parse(binary);
    assert.equal(retainedAfter.status, 200);
    assert.deepEqual(
      retainedAfter.body,
      originalBytes,
      'Rollback must restore overwritten attachment bytes',
    );
    assert.equal((await api.get('/api/auth/me').set(auth())).status, 200);
    const exportAfter = await api.get('/api/backup/export').set(auth());
    const { exportedAt: _beforeTime, ...before } = exportBefore.body;
    const { exportedAt: _afterTime, ...after } = exportAfter.body;
    assert.deepEqual(after, before, 'The failed transaction must preserve all database records');
  } finally {
    await db.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_restore_entry');
    await db.$disconnect();
  }
});

test('restore safety archives use unique names and retain only the latest seven', async () => {
  const backup = await api.get('/api/backup/download').set(auth()).buffer(true).parse(binary);
  assert.equal(backup.status, 200);
  const backupDirectory = path.join(directory, 'storage', 'backups');
  await mkdir(backupDirectory, { recursive: true });
  for (let index = 0; index < 8; index++) {
    await writeFile(
      path.join(backupDirectory, `before-restore-${1000000000000 + index}.zip`),
      'old',
    );
  }
  await writeFile(path.join(backupDirectory, 'auto-1000000000000.zip'), 'scheduled');

  const now = Date.now;
  const fixedNow = now();
  let firstName: string;
  let secondName: string;
  Date.now = () => fixedNow;
  try {
    const restore = () =>
      api
        .post('/api/backup/restore')
        .set(auth())
        .attach('file', backup.body, { filename: 'safety-retention.zip' });
    const first = await restore();
    const second = await restore();
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(second.status, 201, JSON.stringify(second.body));
    firstName = first.body.safetyBackup;
    secondName = second.body.safetyBackup;
  } finally {
    Date.now = now;
  }

  const files = await readdir(backupDirectory);
  const safetyFiles = files.filter((name) => name.startsWith('before-restore-'));
  assert.notEqual(firstName!, secondName!);
  assert.ok(
    Number(secondName!.match(/^before-restore-(\d+)/)?.[1]) >
      Number(firstName!.match(/^before-restore-(\d+)/)?.[1]),
    'A later restore must sort newer even when Date.now has not advanced',
  );
  assert.equal(safetyFiles.length, 7);
  assert.ok(safetyFiles.includes(firstName!));
  assert.ok(safetyFiles.includes(secondName!));
  assert.ok(
    files.includes('auto-1000000000000.zip'),
    'Restore retention must not remove auto backups',
  );
});

test('valid backup repairs a missing photo while the safety copy records the gap and keeps current data', async (t) => {
  const lostPhoto = await upload('#e5bbaa'),
    keptPhoto = await upload('#aae5bb');
  const memory = await api
    .post('/api/memories')
    .set(auth())
    .send({
      title: '需要恢复的照片',
      date: '2026-11-17',
      assetIds: [lostPhoto.id, keptPhoto.id],
    });
  assert.equal(memory.status, 201);
  const backup = await api.get('/api/backup/download').set(auth()).buffer(true).parse(binary);
  assert.equal(backup.status, 200);
  const original = new AdmZip(backup.body);
  const completeManifest = JSON.parse(original.readAsText('manifest.json'));
  assert.equal(completeManifest.complete, true);
  assert.deepEqual(completeManifest.missingAssets, []);
  const originalData = JSON.parse(original.readAsText('data.json'));
  const lost = originalData.assets.find((asset: any) => asset.id === lostPhoto.id);
  const kept = originalData.assets.find((asset: any) => asset.id === keptPhoto.id);
  t.after(() =>
    writeFile(
      path.join(directory, 'storage', 'uploads', lost.filename),
      original.readFile(`uploads/${lost.filename}`)!,
    ),
  );
  const newerPhoto = await upload('#bbaae5');
  const newer = await api
    .post('/api/work')
    .set(auth())
    .send({
      title: '备份后新写的手记',
      date: '2026-11-17',
      content: '这份当前记录也要留在保护副本里',
      assetIds: [newerPhoto.id],
    });
  assert.equal(newer.status, 201);
  await unlink(path.join(directory, 'storage', 'uploads', lost.filename));
  assert.equal((await api.get(lostPhoto.url)).status, 404);
  const restore = await api
    .post('/api/backup/restore')
    .set(auth())
    .attach('file', backup.body, { filename: 'valid-backup.zip' });
  assert.equal(restore.status, 201, JSON.stringify(restore.body));
  assert.equal(restore.body.safetyMissingAssets, 1);
  const restored = await api.get(lostPhoto.url).buffer(true).parse(binary);
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.body, original.readFile(`uploads/${lost.filename}`));
  assert.equal((await api.get('/api/auth/me').set(auth())).status, 200);
  assert.ok(
    !(await api.get('/api/work').set(auth())).body.some((row: any) => row.id === newer.body.id),
  );

  const safety = new AdmZip(
    await readFile(path.join(directory, 'storage', 'backups', restore.body.safetyBackup)),
  );
  const manifest = JSON.parse(safety.readAsText('manifest.json'));
  const currentData = JSON.parse(safety.readAsText('data.json'));
  assert.equal(manifest.complete, false);
  assert.deepEqual(manifest.missingAssets, [{ id: lostPhoto.id, filename: lost.filename }]);
  assert.ok(
    currentData.entries.some((row: any) => row.id === newer.body.id),
    'Safety data must retain records created after the chosen backup',
  );
  assert.ok(
    currentData.assets.some((asset: any) => asset.id === lostPhoto.id),
    'Missing file metadata must remain traceable',
  );
  assert.ok(safety.getEntry('database.sqlite'));
  assert.equal(safety.getEntry(`uploads/${lost.filename}`), null);
  assert.deepEqual(
    safety.readFile(`uploads/${kept.filename}`),
    original.readFile(`uploads/${kept.filename}`),
  );
  const newerAsset = currentData.assets.find((asset: any) => asset.id === newerPhoto.id);
  assert.ok(
    safety.readFile(`uploads/${newerAsset.filename}`),
    'Safety copy must keep other current photos',
  );
  const incompleteRestore = await api
    .post('/api/backup/restore')
    .set(auth())
    .attach('file', safety.toBuffer(), { filename: 'incomplete-safety.zip' });
  assert.equal(incompleteRestore.status, 400);
  assert.match(incompleteRestore.body.message, /保护副本的附件不完整/);
  assert.equal((await api.get(lostPhoto.url)).status, 200);
  assert.ok(
    !(await api.get('/api/work').set(auth())).body.some((row: any) => row.id === newer.body.id),
    'An incomplete protection archive must not change the restored records',
  );
});

test('ordinary complete backups reject missing photo files', async (t) => {
  const photo = await upload('#abcdef');
  const snapshot = await api.get('/api/backup/download').set(auth()).buffer(true).parse(binary);
  assert.equal(snapshot.status, 200);
  const original = new AdmZip(snapshot.body);
  const asset = JSON.parse(original.readAsText('data.json')).assets.find(
    (row: any) => row.id === photo.id,
  );
  t.after(() =>
    writeFile(
      path.join(directory, 'storage', 'uploads', asset.filename),
      original.readFile(`uploads/${asset.filename}`)!,
    ),
  );
  await unlink(path.join(directory, 'storage', 'uploads', asset.filename));
  const incomplete = await api.get('/api/backup/download').set(auth());
  assert.equal(incomplete.status, 409);
  assert.equal(
    incomplete.body.message,
    '有照片文件缺失，请先使用以前保存的完整备份恢复，再重新备份',
  );
});

test('an invalid zip changes neither the current records nor the available files', async () => {
  const created = await api
    .post('/api/wishes')
    .set(auth())
    .send({ title: '坏备份不能改变这条记录' });
  assert.equal(created.status, 201);
  const exportBefore = await api.get('/api/backup/export').set(auth());
  const fileNames = await readdir(path.join(directory, 'storage', 'uploads'));
  const filesBefore = await Promise.all(
    fileNames.map((filename) => readFile(path.join(directory, 'storage', 'uploads', filename))),
  );
  const invalid = await api
    .post('/api/backup/restore')
    .set(auth())
    .attach('file', Buffer.from('invalid zip'), { filename: 'bad.zip' });
  assert.equal(invalid.status, 400);
  const exportAfter = await api.get('/api/backup/export').set(auth());
  const { exportedAt: _beforeTime, ...before } = exportBefore.body;
  const { exportedAt: _afterTime, ...after } = exportAfter.body;
  assert.deepEqual(after, before);
  assert.deepEqual(await readdir(path.join(directory, 'storage', 'uploads')), fileNames);
  assert.deepEqual(
    await Promise.all(
      fileNames.map((filename) => readFile(path.join(directory, 'storage', 'uploads', filename))),
    ),
    filesBefore,
  );
});
