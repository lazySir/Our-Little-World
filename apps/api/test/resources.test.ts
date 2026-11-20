import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import request from 'supertest';
import sharp from 'sharp';
import AdmZip from 'adm-zip';
import { Mutex } from 'async-mutex';
import { readSetupToken } from './setup-fixture';
let app: any, api: any, directory: string, token: string, partnerToken: string;
const auth = () => ({ Authorization: `Bearer ${token}` });
before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'world-resources-'));
  process.env.DATABASE_URL = `file:${path.join(directory, 'test.db').replace(/\\/g, '/')}`;
  process.env.STORAGE_DIR = path.join(directory, 'storage');
  process.env.ASSET_SECRET = 'resource-tests-long-secret-1234567890';
  process.env.CORS_ORIGINS = 'http://localhost:5175';
  process.env.RUST_LOG ||= 'info';
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--config', 'prisma.config.ts'], {
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
    username: 'owner',
    password: 'resource-password-123',
    nickname: '小林',
    spaceName: '我们',
    startDate: '2024-01-01',
  });
  assert.equal(setup.status, 201, JSON.stringify(setup.body));
  token = setup.body.token;
  const invite = await api.post('/api/auth/invite').set(auth());
  const partner = await api.post('/api/auth/join').send({
    code: invite.body.code,
    username: 'partner',
    password: 'partner-password-123',
    nickname: '小禾',
  });
  partnerToken = partner.body.token;
});
after(async () => {
  if (app) await app.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});
test('all domain modules persist, update, list and delete records', async () => {
  const examples: any = {
    wishes: { title: '一起看海', category: 'travel' },
    menu: { name: '番茄炒蛋', category: 'dish', priceCents: 2400 },
    ledger: {
      type: 'expense',
      amountCents: 1234,
      category: '餐饮',
      date: '2026-11-17',
      payer: '小林',
    },
    anniversaries: { title: '在一起', date: '2024-02-29' },
    memories: { title: '第一张合照', date: '2026-11-17' },
    growth: { title: '长高啦', date: '2026-11-17', type: 'growth', heightCm: 70, weightKg: 8 },
    work: { title: '完成项目', date: '2026-11-17', content: '今天完成第一版' },
    moods: { mood: 'good', date: '2026-11-17' },
  };
  for (const [kind, data] of Object.entries(examples)) {
    assert.equal((await api.post(`/api/${kind}`).send(data)).status, 401);
    const created = await api.post(`/api/${kind}`).set(auth()).send(data);
    assert.equal(created.status, 201, `${kind}: ${JSON.stringify(created.body)}`);
    assert.ok(created.body.id);
    const listed = await api.get(`/api/${kind}`).set(auth());
    assert.ok(listed.body.some((e: any) => e.id === created.body.id));
    const patch =
      kind === 'menu'
        ? { name: '修改菜名' }
        : kind === 'moods'
          ? { note: '记录心情' }
          : kind === 'ledger'
            ? { note: '晚饭' }
            : { title: '修改标题' };
    const updated = await api.patch(`/api/${kind}/${created.body.id}`).set(auth()).send(patch);
    assert.equal(updated.status, 200, JSON.stringify(updated.body));
    assert.equal((await api.delete(`/api/${kind}/${created.body.id}`).set(auth())).status, 200);
    assert.equal(
      (await api.patch(`/api/${kind}/${created.body.id}`).set(auth()).send(patch)).status,
      404,
    );
  }
});
test('validation rejects bad calendar dates, fractions of cents and missing assets', async () => {
  assert.equal(
    (
      await api.post('/api/ledger').set(auth()).send({
        type: 'expense',
        amountCents: 1.2,
        category: '餐饮',
        date: '2026-02-30',
        payer: '我',
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api
        .post('/api/memories')
        .set(auth())
        .send({ title: '测试', date: '2026-11-17', assetIds: ['not-mine'] })
    ).status,
    400,
  );
  assert.equal(
    (
      await api
        .post('/api/letters')
        .set(auth())
        .send({ title: '过去', content: '不可', unlockDate: '2020-01-01' })
    ).status,
    400,
  );
});

test('business date is server-authoritative and matches future-letter validation', async (t) => {
  const previousTZ = process.env.TZ;
  process.env.TZ = 'Asia/Shanghai';
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 20, 16, 30) });
  try {
    const businessDate = await api.get('/api/business-date');
    assert.equal(businessDate.status, 200, JSON.stringify(businessDate.body));
    assert.deepEqual(businessDate.body, { date: '2026-11-21', month: '2026-11' });

    const letter = await api
      .post('/api/letters')
      .set(auth())
      .send({ title: '跨时区的明天', content: '日期由服务端决定', unlockDate: '2026-11-22' });
    assert.equal(letter.status, 201, JSON.stringify(letter.body));
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});
test('orders use server prices and immutable snapshots', async () => {
  const menu = await api.post('/api/menu').set(auth()).send({ name: '面条', priceCents: 1800 });
  const order = await api
    .post('/api/orders')
    .set(auth())
    .send({ items: [{ menuItemId: menu.body.id, name: '伪造价格', quantity: 2 }], totalCents: 1 });
  assert.equal(order.status, 201, JSON.stringify(order.body));
  assert.equal(order.body.totalCents, 3600);
  assert.equal(order.body.items[0].name, '面条');
  await api.delete(`/api/menu/${menu.body.id}`).set(auth());
  const done = await api.patch(`/api/orders/${order.body.id}`).set(auth()).send({ status: 'done' });
  assert.equal(done.status, 200);
  assert.equal(done.body.totalCents, 3600);
});
for (const scenario of [
  {
    name: 'status only',
    status: 'pending',
    patch: { status: 'done' },
    expectedStatus: 'done',
    expectedNote: '少放辣椒',
  },
  {
    name: 'note only',
    status: 'done',
    patch: { note: '多放青菜' },
    expectedStatus: 'done',
    expectedNote: '多放青菜',
  },
  {
    name: 'empty patch',
    status: 'done',
    patch: {},
    expectedStatus: 'done',
    expectedNote: '少放辣椒',
  },
  {
    name: 'explicitly empty note',
    status: 'done',
    patch: { note: '' },
    expectedStatus: 'done',
    expectedNote: '',
  },
]) {
  test(`order ${scenario.name} preserves other fields and the deleted menu snapshot`, async () => {
    const menu = await api.post('/api/menu').set(auth()).send({ name: '青菜面', priceCents: 1800 });
    assert.equal(menu.status, 201);
    const order = await api
      .post('/api/orders')
      .set(auth())
      .send({
        items: [{ menuItemId: menu.body.id, quantity: 2 }],
        status: scenario.status,
        note: '少放辣椒',
      });
    assert.equal(order.status, 201);
    assert.equal((await api.delete(`/api/menu/${menu.body.id}`).set(auth())).status, 200);
    const edited = await api.patch(`/api/orders/${order.body.id}`).set(auth()).send(scenario.patch);
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.status, scenario.expectedStatus);
    assert.equal(edited.body.note, scenario.expectedNote);
    assert.equal(edited.body.totalCents, order.body.totalCents);
    assert.deepEqual(edited.body.items, order.body.items);
    const persisted = (await api.get('/api/orders').set(auth())).body.find(
      (row: any) => row.id === order.body.id,
    );
    assert.equal(persisted.status, scenario.expectedStatus);
    assert.equal(persisted.note, scenario.expectedNote);
  });
}

test('future letters hide content for both members and enforce authorship', async () => {
  const letter = await api
    .post('/api/letters')
    .set(auth())
    .send({ title: '未来的信', content: '秘密内容', unlockDate: '2099-01-01' });
  assert.equal(letter.body.content, undefined);
  assert.equal(letter.body.isLocked, true);
  const listed = await api.get('/api/letters').set({ Authorization: `Bearer ${partnerToken}` });
  assert.equal(listed.body[0].content, undefined);
  assert.equal(
    (
      await api
        .patch(`/api/letters/${letter.body.id}`)
        .set({ Authorization: `Bearer ${partnerToken}` })
        .send({ title: '篡改' })
    ).status,
    403,
  );
  assert.equal(
    (
      await api
        .delete(`/api/letters/${letter.body.id}`)
        .set({ Authorization: `Bearer ${partnerToken}` })
    ).status,
    403,
  );
  for (const t of [token, partnerToken]) {
    const exported = await api.get('/api/backup/export').set({ Authorization: `Bearer ${t}` });
    assert.ok(
      !JSON.stringify(exported.body).includes('秘密内容'),
      'ordinary exports must keep letters sealed',
    );
  }
});
test('baby profile is optional and updates a singleton', async () => {
  assert.equal((await api.get('/api/baby').set(auth())).body, null);
  const a = await api.put('/api/baby').set(auth()).send({ name: '小豆芽', birthday: null });
  assert.equal(a.status, 200);
  const b = await api.put('/api/baby').set(auth()).send({ name: '小芽', birthday: '2026-01-01' });
  assert.equal(a.body.id, b.body.id);
});

test('calendar aggregates dated records and expands recurring birthdays', async () => {
  const recurring = await api
    .post('/api/anniversaries')
    .set(auth())
    .send({ title: '相识日', date: '2024-02-29', recurring: true });
  const oneTime = await api
    .post('/api/anniversaries')
    .set(auth())
    .send({ title: '搬家日', date: '2099-11-07', recurring: false });
  const wish = await api
    .post('/api/wishes')
    .set(auth())
    .send({ title: '一起看海', targetDate: '2099-11-04' });
  const letter = await api
    .post('/api/letters')
    .set(auth())
    .send({ title: '未来的信', content: '只给未来看的内容', unlockDate: '2099-11-05' });
  const memory = await api
    .post('/api/memories')
    .set(auth())
    .send({ title: '那天的照片', date: '2099-11-06' });
  const growth = await api
    .post('/api/growth')
    .set(auth())
    .send({ title: '第一次长高', date: '2099-11-08', type: 'growth', heightCm: 80 });
  const baby = await api
    .put('/api/baby')
    .set(auth())
    .send({ name: '小芽', birthday: '2020-11-13' });
  assert.equal(recurring.status, 201);
  assert.equal(oneTime.status, 201);
  assert.equal(wish.status, 201);
  assert.equal(letter.status, 201);
  assert.equal(memory.status, 201);
  assert.equal(growth.status, 201);
  assert.equal(baby.status, 200);

  const november = await api.get('/api/calendar?month=2099-11').set(auth());
  assert.equal(november.status, 200, JSON.stringify(november.body));
  assert.equal(november.body.month, '2099-11');
  assert.match(november.body.date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(
    november.body.events.map((event: any) => [event.kind, event.date, event.title]),
    [
      ['wish', '2099-11-04', '一起看海'],
      ['letter', '2099-11-05', '未来的信'],
      ['memory', '2099-11-06', '那天的照片'],
      ['anniversary', '2099-11-07', '搬家日'],
      ['growth', '2099-11-08', '第一次长高'],
      ['baby', '2099-11-13', '小芽的生日'],
    ],
  );
  const letterEvent = november.body.events.find((event: any) => event.kind === 'letter');
  assert.equal(letterEvent.sourceId, letter.body.id);
  assert.equal(letterEvent.locked, true);
  assert.equal(letterEvent.description, undefined);
  assert.equal(
    november.body.events.some((event: any) => event.sourceId === recurring.body.id),
    false,
  );

  const february = await api.get('/api/calendar?month=2099-02').set(auth());
  assert.equal(february.status, 200);
  assert.deepEqual(february.body.events, [
    {
      id: `${recurring.body.id}:2099-02-28`,
      sourceId: recurring.body.id,
      kind: 'anniversary',
      date: '2099-02-28',
      title: '相识日',
      description: '',
      recurring: true,
      icon: 'heart',
    },
  ]);

  const empty = await api.get('/api/calendar?month=2099-12').set(auth());
  assert.equal(empty.status, 200);
  assert.deepEqual(empty.body.events, []);
  assert.equal((await api.get('/api/calendar?month=2099-13').set(auth())).status, 400);
});
test('uploads decode image data and require valid signed access', async () => {
  const image = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#e8a38b' } })
    .png()
    .toBuffer();
  const uploaded = await api
    .post('/api/assets')
    .set(auth())
    .attach('file', image, { filename: 'photo.png', contentType: 'image/png' });
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
  assert.equal(uploaded.body.mime, 'image/webp');
  assert.equal((await api.get(uploaded.body.url)).status, 200);
  assert.equal((await api.get(`/api/assets/${uploaded.body.id}/file`)).status, 403);
  assert.equal(
    (
      await api
        .post('/api/assets')
        .set(auth())
        .attach('file', Buffer.from('<script>bad</script>'), {
          filename: 'bad.png',
          contentType: 'image/png',
        })
    ).status,
    400,
  );
  const memory = await api
    .post('/api/memories')
    .set(auth())
    .send({ title: '图片记录', date: '2026-11-17', assetIds: [uploaded.body.id] });
  assert.equal(memory.body.assets.length, 1);
  assert.equal((await api.delete(`/api/assets/${uploaded.body.id}`).set(auth())).status, 409);
});
test('backup restores a real roundtrip, preserves login and rejects malformed zip', async () => {
  const backup = await api
    .get('/api/backup/download')
    .set(auth())
    .buffer(true)
    .parse((res: any, cb: any) => {
      const chunks: Buffer[] = [];
      res.on('data', (b: Buffer) => chunks.push(b));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  assert.equal(backup.status, 200, JSON.stringify(backup.body));
  const zip = new AdmZip(backup.body);
  assert.ok(zip.getEntry('database.sqlite'));
  assert.ok(zip.getEntry('data.json'));
  const invalid = new AdmZip(backup.body),
    invalidData = JSON.parse(invalid.readAsText('data.json'));
  invalidData.space.startDate = 'not-a-date';
  invalid.updateFile('data.json', Buffer.from(JSON.stringify(invalidData)));
  assert.equal(
    (
      await api
        .post('/api/backup/restore')
        .set(auth())
        .attach('file', invalid.toBuffer(), { filename: 'bad-date.zip' })
    ).status,
    400,
  );
  assert.equal((await api.get('/api/dashboard').set(auth())).status, 200);
  const created = await api.post('/api/wishes').set(auth()).send({ title: '备份之后' });
  const restore = await api
    .post('/api/backup/restore')
    .set(auth())
    .attach('file', backup.body, { filename: 'backup.zip' });
  assert.equal(restore.status, 201, JSON.stringify(restore.body));
  assert.equal(restore.body.ok, true);
  assert.ok(
    !(await api.get('/api/wishes').set(auth())).body.some((e: any) => e.id === created.body.id),
  );
  assert.equal((await api.get('/api/auth/me').set(auth())).status, 200);
  assert.equal(
    (
      await api
        .post('/api/backup/restore')
        .set(auth())
        .attach('file', Buffer.from('not zip'), { filename: 'bad.zip' })
    ).status,
    400,
  );
  assert.equal(
    (await api.get('/api/backup/download').set({ Authorization: `Bearer ${partnerToken}` })).status,
    403,
  );
});

test('automatic archives contain data and retain only seven scheduled copies', async () => {
  const { createPrismaClient } = await import('../src/db/client');
  const { makeBackupController } = await import('../src/backup');
  const db = createPrismaClient();
  try {
    const backups = path.join(directory, 'storage', 'backups');
    await mkdir(backups, { recursive: true });
    for (let i = 0; i < 8; i++)
      await writeFile(path.join(backups, `auto-${1000000000000 + i}.zip`), 'old');
    const controller = makeBackupController({
      db,
      assets: { directory: path.join(directory, 'storage', 'uploads') },
      route: () => {},
      auth: {},
      mutex: new Mutex(),
    });
    await (controller as any).runAutomatic();
    const files = (await readdir(backups)).filter((f) => f.startsWith('auto-')).sort();
    assert.equal(files.length, 7);
    const zip = new AdmZip(await readFile(path.join(backups, files.at(-1)!)));
    assert.ok(zip.getEntry('database.sqlite'));
    assert.ok(zip.getEntry('data.json'));
    assert.ok(
      (await readdir(backups)).some((f) => f.startsWith('before-restore-')),
      'restore safety copy is retained',
    );
  } finally {
    await db.$disconnect();
  }
});

test('configured browser origins can call the API', async () => {
  for (const origin of ['http://localhost:5175']) {
    const response = await api.get('/api/health').set('Origin', origin);
    assert.equal(response.headers['access-control-allow-origin'], origin);
  }
  const blocked = await api.get('/api/health').set('Origin', 'https://unrelated.example');
  assert.equal(blocked.headers['access-control-allow-origin'], undefined);
});
