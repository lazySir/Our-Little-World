import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { PrismaClient } from '../src/db/client';
import request from 'supertest';
import { readSetupToken } from './setup-fixture';

let app: any, api: any, db: PrismaClient, directory: string;
let token: string, partnerToken: string, ownerId: string, partnerId: string, spaceId: string;
let currentDate: string, historicalDate: string;
const count = 1001;
const recordId = (index: number) => `ledger-history-${String(index).padStart(4, '0')}`;
const expectedIds = Array.from({ length: count }, (_, index) => recordId(count - index - 1));
const auth = (value = token) => ({ Authorization: `Bearer ${value}` });
const payload = (date: string, amountCents = 100) => ({
  type: 'expense',
  amountCents,
  category: '日常',
  date,
  note: '',
  payer: '小林',
});

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'world-history-'));
  process.env.DATABASE_URL = `file:${path.join(directory, 'test.db').replace(/\\/g, '/')}`;
  process.env.STORAGE_DIR = path.join(directory, 'storage');
  process.env.ASSET_SECRET = 'history-isolated-test-secret-1234567890';
  process.env.AUTO_BACKUP_HOURS = '0';
  process.env.TZ = 'Asia/Shanghai';
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--config', 'prisma.config.ts'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'pipe',
    env: { ...process.env, RUST_LOG: 'info' },
  });
  const { createApp } = await import('../src/app');
  const { createPrismaClient } = await import('../src/db/client');
  const { today } = await import('../src/resources');
  currentDate = today();
  historicalDate = `${Number(currentDate.slice(0, 4)) - 1}-01-01`;
  app = await createApp({ logger: false });
  await app.init();
  api = request(app.getHttpServer());
  db = createPrismaClient();
  const setup = await api.post('/api/auth/setup').send({
    setupToken: readSetupToken(path.join(directory, 'storage')),
    username: 'history_owner',
    password: 'history-password-123',
    nickname: '小林',
    spaceName: '完整历史空间',
    startDate: '2024-01-01',
  });
  assert.equal(setup.status, 201, JSON.stringify(setup.body));
  token = setup.body.token;
  const owner = await db.user.findUniqueOrThrow({ where: { username: 'history_owner' } });
  ownerId = owner.id;
  spaceId = owner.spaceId;
  const invite = await api.post('/api/auth/invite').set(auth());
  assert.equal(invite.status, 201);
  const joined = await api.post('/api/auth/join').send({
    code: invite.body.code,
    username: 'history_partner',
    password: 'partner-password-123',
    nickname: '小禾',
  });
  assert.equal(joined.status, 201, JSON.stringify(joined.body));
  partnerToken = joined.body.token;
  partnerId = (await db.user.findUniqueOrThrow({ where: { username: 'history_partner' } })).id;
  const otherSpace = await db.space.create({
    data: { name: '另一个空间', startDate: '2024-01-01' },
  });
  const outsider = await db.user.create({
    data: {
      username: 'history_outsider',
      nickname: '其他人',
      passwordHash: owner.passwordHash,
      role: 'owner',
      spaceId: otherSpace.id,
    },
  });
  await db.entry.create({
    data: {
      id: 'outside-ledger',
      kind: 'ledger',
      spaceId: otherSpace.id,
      authorId: outsider.id,
      data: JSON.stringify(payload(currentDate, 999999)),
    },
  });
});

beforeEach(async () => {
  await db.entry.deleteMany({ where: { spaceId } });
  await db.entry.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      id: recordId(index),
      kind: 'ledger',
      spaceId,
      authorId: index % 2 === 0 ? ownerId : partnerId,
      data: JSON.stringify(payload(index === 0 ? currentDate : historicalDate)),
      createdAt: new Date(Date.UTC(2020, 0, 1) + index * 1000),
    })),
  });
});

after(async () => {
  if (db) await db.$disconnect();
  if (app) await app.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('lists all 1001 records including the oldest in descending creation order', async () => {
  const response = await api.get('/api/ledger').set(auth());
  assert.equal(response.status, 200);
  assert.equal(response.body.length, count);
  assert.deepEqual(
    response.body.map((row: any) => row.id),
    expectedIds,
  );
  assert.equal(response.body.at(-1).id, recordId(0));
});

test('the partner sees the full shared history while other spaces stay excluded', async () => {
  const response = await api.get('/api/ledger').set(auth(partnerToken));
  assert.equal(response.status, 200);
  assert.equal(response.body.length, count);
  assert.deepEqual(
    response.body.map((row: any) => row.id),
    expectedIds,
  );
  assert.deepEqual(
    new Set(response.body.map((row: any) => row.authorId)),
    new Set([ownerId, partnerId]),
  );
  assert.ok(!response.body.some((row: any) => row.id === 'outside-ledger'));
  const unrelated = await api
    .patch('/api/ledger/outside-ledger')
    .set(auth(partnerToken))
    .send({ note: '不能跨空间修改' });
  assert.equal(unrelated.status, 404);
});

test('monthly totals include an oldest current-month record after 1000 backdated additions', async () => {
  for (const value of [token, partnerToken]) {
    const response = await api.get('/api/dashboard').set(auth(value));
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.monthly, {
      incomeCents: 0,
      expenseCents: 100,
      balanceCents: -100,
    });
  }
});

test('monthly totals include every current-month record beyond the first 1000', async () => {
  await db.entry.updateMany({
    where: { kind: 'ledger', spaceId },
    data: { data: JSON.stringify(payload(currentDate)) },
  });
  const response = await api.get('/api/dashboard').set(auth());
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.monthly, {
    incomeCents: 0,
    expenseCents: 100100,
    balanceCents: -100100,
  });
});
