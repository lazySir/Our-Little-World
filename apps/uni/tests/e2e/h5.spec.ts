import { test, expect, type Page, type Locator } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { removeTestPhoto } from '../../../../e2e/backup-fixture.mts';

const api = 'http://127.0.0.1:3002/api';
const stamp = Date.now();
const names = {
  wish: `一起看日出 ${stamp}`,
  menu: `番茄面 ${stamp}`,
  memory: `慢慢吃早餐 ${stamp}`,
  work: `小进展 ${stamp}`,
  anniversary: `特别的一天 ${stamp}`,
  letter: `未来的信 ${stamp}`,
};
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yQwAAAABJRU5ErkJggg==',
  'base64',
);
const sheet = (page: Page) => page.locator('.sheet:visible');
const field = (box: Locator, label: string) =>
  box
    .locator('.form-field')
    .filter({ has: box.page().locator('.form-label').filter({ hasText: label }) })
    .first();
const fill = async (box: Locator, label: string, value: string) =>
  field(box, label).locator('input,textarea').first().fill(value);
async function click(box: Page | Locator, text: string) {
  const button = box.locator('uni-button').filter({ hasText: text });
  await (
    (await button.count()) ? button.last() : box.getByText(text, { exact: true }).last()
  ).click();
}
async function save(page: Page, resource: string) {
  const waiting = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/${resource}`) && response.request().method() === 'POST',
  );
  await click(sheet(page), '保存这一刻');
  const response = await waiting;
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect(sheet(page)).toHaveCount(0);
}
async function visit(page: Page, feature: string, title: string) {
  await page.goto(`/#/pages/${feature}/index`);
  await expect(page.locator('.title')).toHaveText(title);
  await expect(page.locator('.loading')).toHaveCount(0);
}

test('uni H5 keeps a working server address when a new connection check fails', async ({
  page,
}) => {
  await page.goto('/#/pages/auth/index');
  await expect(page.locator('.title')).toContainText('欢迎来到我们的小世界');
  const server = field(page.locator('.auth-page'), '小世界服务地址');
  if (!(await server.isVisible()))
    await page.locator('.auth-bottom').filter({ hasText: '连接设置' }).click();
  await fill(page.locator('.auth-page'), '小世界服务地址', api);
  const working = page.waitForResponse(`${api}/auth/status`);
  await click(page, '保存地址并检查连接');
  expect((await working).ok()).toBeTruthy();
  await expect(page.locator('.error-box')).toHaveCount(0);
  await fill(page.locator('.auth-page'), '小世界服务地址', `${api}/not-a-service`);
  await click(page, '保存地址并检查连接');
  await expect(page.locator('.error-box')).toBeVisible();
  await page.reload();
  await expect(page.locator('.title')).toContainText('欢迎来到我们的小世界');
  await expect(page.locator('.error-box')).toHaveCount(0);
  await expect(page.locator('.auth-bottom').filter({ hasText: '连接设置' })).toContainText(api);
});

test('uni H5 rejects an unrelated JSON service and keeps the working address during its probe', async ({
  page,
}) => {
  await page.goto('/#/pages/auth/index');
  await expect(page.locator('.title')).toContainText('欢迎来到我们的小世界');
  const server = field(page.locator('.auth-page'), '小世界服务地址');
  if (!(await server.isVisible()))
    await page.locator('.auth-bottom').filter({ hasText: '连接设置' }).click();
  const unrelated = `${api}/unrelated-json/api`;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(`${unrelated}/auth/status`, async (route) => {
    await gate;
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await fill(page.locator('.auth-page'), '小世界服务地址', unrelated);
  const requested = page.waitForRequest(`${unrelated}/auth/status`);
  await click(page, '保存地址并检查连接');
  await requested;
  try {
    expect(
      (await page.evaluate(() => localStorage.getItem('little-world-api'))) || '',
    ).not.toContain('unrelated-json');
    await expect(page.locator('uni-button').filter({ hasText: '保存地址并检查连接' })).toHaveClass(
      /is-loading/,
    );
  } finally {
    release();
  }
  await expect(page.locator('.error-box')).toContainText('服务地址没有返回小世界数据');
  await page.reload();
  await expect(page.locator('.auth-bottom').filter({ hasText: '连接设置' })).toContainText(api);
  await expect(page.locator('.error-box')).toHaveCount(0);
});

test('uni H5 connects to a chosen server and persists real daily workflows including two photos', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/#/pages/auth/index');
  await expect(page.locator('.title')).toContainText('欢迎来到我们的小世界');
  const serverField = field(page.locator('.auth-page'), '小世界服务地址');
  if (!(await serverField.isVisible()))
    await page.locator('.auth-bottom').filter({ hasText: '连接设置' }).click();
  await fill(page.locator('.auth-page'), '小世界服务地址', api);
  await click(page, '保存地址并检查连接');
  await fill(page.locator('.auth-form'), '登录账号', 'uni_h5_owner');
  await fill(page.locator('.auth-form'), '密码', 'uni-private-test-123');
  if (await page.getByText('创建我们的小世界', { exact: true }).isVisible()) {
    await fill(page.locator('.auth-form'), '怎么称呼你', '小熊');
    await fill(page.locator('.auth-form'), '我们的小世界叫做', '小熊与兔子的小屋');
    await click(page, '创建我们的小世界');
  } else await click(page, '回家啦');
  await expect(page.locator('.title')).toHaveText('今天，也在好好生活');
  await expect(page.locator('.loading')).toHaveCount(0);
  await click(page, '☀ 闪闪发光');
  await page.locator('.page textarea').first().fill('今天也在认真记录我们的生活');
  await click(page, '保存今天的心情');
  await expect(page.locator('.loading')).toHaveCount(0);
  await expect(page.getByText('我们的待办愿望', { exact: true })).toBeVisible();
  await click(page, '写下第一个愿望');
  await expect(page.locator('.title')).toHaveText('一起做');

  await visit(page, 'wishes', '一起做');
  await click(page, '＋ 添加');
  await fill(sheet(page), '想做什么', names.wish);
  await fill(sheet(page), '说得更具体一点', '带上热咖啡，一起等太阳升起。');
  await save(page, 'wishes');
  await expect(page.locator('.card-title').filter({ hasText: names.wish })).toBeVisible();
  await page.reload();
  await expect(page.locator('.card-title').filter({ hasText: names.wish })).toBeVisible();
  await visit(page, 'home', '今天，也在好好生活');
  const homeWish = page.locator('.home-wishes').getByText(names.wish, { exact: true });
  await expect(homeWish).toBeVisible();
  const wishLayout = await page
    .locator('.home-wishes .wd-cell__wrapper')
    .first()
    .evaluate((row) => ({
      rowWidth: row.getBoundingClientRect().width,
      titleWidth: row.querySelector('.wd-cell__left')!.getBoundingClientRect().width,
    }));
  expect(wishLayout.titleWidth).toBeGreaterThan(wishLayout.rowWidth * 0.7);
  await page.screenshot({ path: 'test-results/home-wishes-h5.png', fullPage: true });
  await homeWish.click();
  await expect(page.locator('.title')).toHaveText('一起做');
  await expect(page.locator('.loading')).toHaveCount(0);
  const wish = page.locator('.card').filter({ hasText: names.wish });
  await wish.locator('.check').click();
  await expect(wish).toHaveClass(/done/);
  await visit(page, 'home', '今天，也在好好生活');
  await expect(page.locator('.error-box')).toHaveCount(0);
  await expect(page.getByText('写下第一个愿望', { exact: true })).toBeVisible();
  await expect(page.locator('.home-wishes').getByText(names.wish, { exact: true })).toHaveCount(0);
  await visit(page, 'wishes', '一起做');
  await click(wish, '写成一段回忆 →');
  await expect(page.locator('.title')).toHaveText('回忆相册');

  await visit(page, 'menu', '今天吃什么');
  await click(page, '＋ 添加');
  await fill(sheet(page), '名字', names.menu);
  await fill(sheet(page), '价格（元）', '18.50');
  await save(page, 'menu');
  const food = page.locator('.card').filter({ hasText: names.menu }).first();
  await food.locator('.quantity-btn').last().click();
  await fill(page.locator('.sticky-cart'), '给这一单留个备注', '保存期间保留的点单备注');
  let releaseOrder!: () => void;
  const orderGate = new Promise<void>((resolve) => (releaseOrder = resolve));
  const orderTasks: Promise<void>[] = [];
  const holdOrder = (route: import('@playwright/test').Route) => {
    const task = (async () => {
      if (route.request().method() === 'POST') await orderGate;
      await route.continue();
    })();
    orderTasks.push(task);
    return task;
  };
  await page.route('**/api/orders', holdOrder);
  try {
    const started = page.waitForRequest(
      (req) => req.url().endsWith('/api/orders') && req.method() === 'POST',
    );
    await click(page, '提交点单');
    await started;
    await expect(
      field(page.locator('.sticky-cart'), '给这一单留个备注').locator('input'),
    ).toBeDisabled();
    await food.locator('.quantity-btn').last().click();
    await expect(page.locator('.sticky-cart .card-title')).toContainText('1 份');
    const order = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/orders') && response.request().method() === 'POST',
    );
    releaseOrder();
    expect((await order).ok()).toBeTruthy();
  } finally {
    releaseOrder();
    await Promise.allSettled(orderTasks);
    await page.unroute('**/api/orders', holdOrder);
  }
  await expect(page.getByText('等着开饭', { exact: true }).first()).toBeVisible();
  await expect(page.locator('.card').filter({ hasText: '保存期间保留的点单备注' })).toContainText(
    '× 1',
  );

  await visit(page, 'ledger', '共同账本');
  await click(page, '＋ 记一笔');
  await fill(sheet(page), '金额（元）', '18.50');
  await fill(sheet(page), '备注', `两个人的晚餐 ${stamp}`);
  let releaseLedger!: () => void;
  const ledgerGate = new Promise<void>((resolve) => (releaseLedger = resolve));
  const ledgerTasks: Promise<void>[] = [];
  const holdLedger = (route: import('@playwright/test').Route) => {
    const task = (async () => {
      if (route.request().method() === 'POST') await ledgerGate;
      await route.continue();
    })();
    ledgerTasks.push(task);
    return task;
  };
  await page.route('**/api/ledger', holdLedger);
  try {
    const started = page.waitForRequest(
      (req) => req.url().endsWith('/api/ledger') && req.method() === 'POST',
    );
    const saving = save(page, 'ledger');
    await started;
    await expect(field(sheet(page), '金额（元）').locator('input')).toBeDisabled();
    await expect(field(sheet(page), '备注').locator('textarea')).toBeDisabled();
    await expect(sheet(page).locator('uni-button').filter({ hasText: '先放一放' })).toHaveClass(
      /is-disabled/,
    );
    releaseLedger();
    await saving;
  } finally {
    releaseLedger();
    await Promise.allSettled(ledgerTasks);
    await page.unroute('**/api/ledger', holdLedger);
  }
  await expect(page.locator('.card').filter({ hasText: `两个人的晚餐 ${stamp}` })).toContainText(
    '18.50',
  );

  await visit(page, 'memories', '回忆相册');
  await click(page, '＋ 写一篇');
  await fill(sheet(page), '给这段回忆起个名字', names.memory);
  await fill(sheet(page), '写点什么', '阳光落在桌上，早餐也变得可爱。');
  let releaseUploads = () => {};
  const uploadGate = new Promise<void>((resolve) => {
    releaseUploads = resolve;
  });
  await page.route('**/api/assets', async (route) => {
    if (route.request().method() === 'POST') await uploadGate;
    await route.continue();
  });
  const uploading = page.waitForRequest(
    (request) => request.url().endsWith('/api/assets') && request.method() === 'POST',
  );
  const chooser = page.waitForEvent('filechooser');
  await sheet(page).locator('.upload-tile').click();
  try {
    await (
      await chooser
    ).setFiles([
      { name: 'morning.png', mimeType: 'image/png', buffer: pixel },
      { name: 'sunshine.png', mimeType: 'image/png', buffer: pixel },
    ]);
    await uploading;
    await expect(sheet(page).locator('uni-button').filter({ hasText: '保存这一刻' })).toHaveClass(
      /is-disabled/,
    );
    await click(sheet(page), '先放一放');
    await expect(sheet(page)).toHaveCount(1);
  } finally {
    releaseUploads();
  }
  await expect(sheet(page).locator('.photo')).toHaveCount(2);
  await save(page, 'memories');
  await page.reload();
  const memory = page.locator('.card').filter({ hasText: names.memory });
  await expect(memory.locator('.photo')).toHaveCount(2);
  await memory.locator('.photo').first().click();
  await expect(page.locator('#u-a-p uni-swiper')).toBeVisible();
  await page.reload();
  await page.goto('/#/pages/home/index');
  await expect(page.locator('.title')).toHaveText('今天，也在好好生活');
  await page.screenshot({
    path: path.resolve('apps/uni/test-results/uni-home-mobile.png'),
    fullPage: true,
  });

  await visit(page, 'anniversaries', '纪念日');
  await click(page, '＋ 添加');
  await fill(sheet(page), '这是什么日子', names.anniversary);
  await fill(sheet(page), '关于这一天', '每年都要好好记得。');
  await save(page, 'anniversaries');
  await page.reload();
  await expect(page.locator('.card-title').filter({ hasText: names.anniversary })).toBeVisible();

  await visit(page, 'baby', '宝宝成长');
  await click(page, '建立宝宝档案');
  await fill(sheet(page), '宝宝的名字', '小糯米');
  const profile = page.waitForResponse(
    (response) => response.url().endsWith('/api/baby') && response.request().method() === 'PUT',
  );
  await click(sheet(page), '保存这一刻');
  expect((await profile).ok()).toBeTruthy();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator('.hero')).toContainText('小糯米');
  await click(page, '＋ 记录');
  await fill(sheet(page), '这一刻叫什么', `第一次翻身 ${stamp}`);
  await fill(sheet(page), '记录内容', '认真记住成长的每一步。');
  await save(page, 'growth');
  await page.reload();
  await expect(page.locator('.hero')).toContainText('小糯米');
  await expect(
    page.locator('.card-title').filter({ hasText: `第一次翻身 ${stamp}` }),
  ).toBeVisible();

  await visit(page, 'work', '工作手记');
  await click(page, '＋ 写一篇');
  await fill(sheet(page), '标题', names.work);
  await fill(sheet(page), '手记内容', '完成了今天的小目标。');
  await save(page, 'work');
  await expect(page.locator('.card-title').filter({ hasText: names.work })).toBeVisible();
  await visit(page, 'letters', '时光信箱');
  await click(page, '＋ 写封信');
  await fill(sheet(page), '信件标题', names.letter);
  await fill(sheet(page), '想留到未来的话', '这段正文只能在未来打开。');
  await save(page, 'letters');
  await expect(page.locator('.letter').filter({ hasText: names.letter })).not.toContainText(
    '这段正文只能在未来打开。',
  );
  await visit(page, 'settings', '我们的设置');
  await click(page, '玫瑰日记');
  const space = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/space') &&
      response.request().method() === 'POST' &&
      response.request().headers()['x-http-method-override'] === 'PATCH',
  );
  await click(page, '保存小世界');
  expect((await space).ok()).toBeTruthy();
  await expect(page.locator('.page')).toHaveClass(/theme-rose/);
  await page.reload();
  await expect(page.locator('.page')).toHaveClass(/theme-rose/);
  const exported = page.waitForEvent('download');
  await click(page, '导出数据 JSON');
  expect((await exported).suggestedFilename()).toMatch(/\.json$/);
  await page.screenshot({
    path: path.resolve('apps/uni/test-results/uni-settings-mobile.png'),
    fullPage: true,
  });

  const backupDownload = page.waitForEvent('download');
  await click(page, '下载完整 ZIP');
  const backup = await backupDownload;
  expect(backup.suggestedFilename()).toMatch(/\.zip$/);
  const backupPath = await backup.path();
  expect(backupPath).toBeTruthy();
  const invalidChooser = page.waitForEvent('filechooser');
  await click(page, '选择 ZIP 并恢复');
  await (
    await invalidChooser
  ).setFiles({
    name: 'invalid.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from('not a ZIP'),
  });
  await expect(page.getByText('恢复完整备份', { exact: true })).toBeVisible();
  const invalidRestore = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/backup/restore') && response.request().method() === 'POST',
  );
  await page.getByText('确定', { exact: true }).last().click();
  const invalidResponse = await invalidRestore;
  expect(invalidResponse.ok()).toBeFalsy();
  const invalidDetails = await invalidResponse.json();
  await expect(page.locator('.error-box')).toHaveText(invalidDetails.message);
  const afterBackupWish = `备份后新增 ${stamp}`;
  await visit(page, 'wishes', '一起做');
  await click(page, '＋ 添加');
  await fill(sheet(page), '想做什么', afterBackupWish);
  await save(page, 'wishes');
  await visit(page, 'settings', '我们的设置');
  const archiveChooser = page.waitForEvent('filechooser');
  await click(page, '选择 ZIP 并恢复');
  await (await archiveChooser).setFiles(backupPath!);
  await expect(page.getByText('恢复完整备份', { exact: true })).toBeVisible();
  const restored = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/backup/restore') && response.request().method() === 'POST',
  );
  await page.getByText('确定', { exact: true }).last().click();
  expect((await restored).ok()).toBeTruthy();
  await expect(page.locator('.title')).toHaveText('今天，也在好好生活');
  await visit(page, 'wishes', '一起做');
  await expect(page.locator('.card-title').filter({ hasText: afterBackupWish })).toHaveCount(0);
  await expect(page.locator('.card-title').filter({ hasText: names.wish })).toBeVisible();
  await visit(page, 'settings', '我们的设置');
  const missingPhoto = await removeTestPhoto(backupPath!, 'uni', 'damaged');
  const rejectedBackup = page.waitForResponse((response) =>
    response.url().endsWith('/api/backup/download'),
  );
  await click(page, '下载完整 ZIP');
  const rejectedResponse = await rejectedBackup;
  expect(rejectedResponse.status()).toBe(409);
  const rejectedDetails = await rejectedResponse.json();
  await expect(page.locator('.error-box')).toHaveText(rejectedDetails.message);
  const warningChooser = page.waitForEvent('filechooser');
  await click(page, '选择 ZIP 并恢复');
  await (await warningChooser).setFiles(backupPath!);
  await expect(page.getByText('恢复完整备份', { exact: true })).toBeVisible();
  await page.getByText('确定', { exact: true }).last().click();
  await expect(page.getByText('记录已经恢复', { exact: true })).toBeVisible();
  await expect(page.getByText(/恢复前已有 1 张照片文件缺失/)).toBeVisible();
  await page.getByText('知道了', { exact: true }).click();
  await expect(page.locator('.title')).toHaveText('今天，也在好好生活');
  expect(await readFile(missingPhoto.target)).toEqual(missingPhoto.bytes);

  await visit(page, 'settings', '我们的设置');
  const alternate = `${api}/alternate-service/api`;
  const sentTokens: string[] = [];
  await page.route(`${alternate}/auth/status`, async (route) => {
    sentTokens.push(route.request().headers().authorization || '');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ initialized: false }),
    });
  });
  await fill(page.locator('.page'), '接口地址', alternate);
  await click(page, '检查并保存地址');
  await expect(page.locator('.title')).toContainText('欢迎来到我们的小世界');
  await expect(page.getByText('创建我们的小世界', { exact: true })).toBeVisible();
  expect(sentTokens.length).toBeGreaterThan(0);
  expect(sentTokens.every((token) => token === '')).toBeTruthy();
  expect(await page.evaluate(() => localStorage.getItem('little-world-token'))).toBeNull();
  expect(errors).toEqual([]);
});

test('uni H5 locks a pending mood, keeps its failed draft and persists a real retry', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const status = await request.get(`${api}/auth/status`);
  expect(status.ok()).toBeTruthy();
  if (!(await status.json()).initialized) {
    const setup = await request.post(`${api}/auth/setup`, {
      data: {
        username: 'uni_h5_owner',
        password: 'uni-private-test-123',
        nickname: '小熊',
        spaceName: '小熊与兔子的小屋',
        startDate: '2026-01-01',
      },
    });
    expect(setup.ok(), await setup.text()).toBeTruthy();
  }
  await page.goto('/#/pages/auth/index');
  await expect(page.locator('.title')).toContainText('欢迎来到我们的小世界');
  const serverField = field(page.locator('.auth-page'), '小世界服务地址');
  if (!(await serverField.isVisible()))
    await page.locator('.auth-bottom').filter({ hasText: '连接设置' }).click();
  await fill(page.locator('.auth-page'), '小世界服务地址', api);
  const connected = page.waitForResponse(`${api}/auth/status`);
  await click(page, '保存地址并检查连接');
  expect((await connected).ok()).toBeTruthy();
  await fill(page.locator('.auth-form'), '登录账号', 'uni_h5_owner');
  await fill(page.locator('.auth-form'), '密码', 'uni-private-test-123');
  const loggedIn = page.waitForResponse(`${api}/auth/login`);
  await click(page, '回家啦');
  const login = await loggedIn;
  expect(login.ok(), await login.text()).toBeTruthy();
  const account = await login.json();
  await expect(page.locator('.title')).toHaveText('今天，也在好好生活');
  await expect(page.locator('.loading')).toHaveCount(0);

  const selected = page.locator('.chips .chip').filter({ hasText: '还不错' });
  const other = page.locator('.chips .chip').filter({ hasText: '有点低落' });
  const note = page.locator('.page textarea').first();
  const draft = `保存失败也不丢失的心情 ${stamp}`;
  await selected.click();
  await note.fill(draft);
  await expect(selected).toHaveClass(/active/);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const intercepted: unknown[] = [];
  const tasks: Promise<void>[] = [];
  const failure = '保存暂时失败，请再试一次';
  const holdMood = (route: import('@playwright/test').Route) => {
    const task = (async () => {
      if (route.request().method() !== 'POST') {
        await route.continue();
        return;
      }
      intercepted.push(route.request().postDataJSON());
      await gate;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ message: failure }),
      });
    })();
    tasks.push(task);
    return task;
  };
  await page.route('**/api/moods', holdMood);
  try {
    const started = page.waitForRequest(
      (req) => req.url().endsWith('/api/moods') && req.method() === 'POST',
    );
    await click(page, '保存今天的心情');
    await started;
    await expect(note).toBeDisabled();
    await other.click();
    await expect(selected).toHaveClass(/active/);
    await expect(other).not.toHaveClass(/active/);
    await expect(note).toHaveValue(draft);
    expect(intercepted).toEqual([{ mood: 'good', note: draft }]);
    const failed = page.waitForResponse(
      (response) => response.url().endsWith('/api/moods') && response.request().method() === 'POST',
    );
    release();
    expect((await failed).status()).toBe(503);
    await expect(page.getByText(failure, { exact: true })).toBeVisible();
    await expect(note).toBeEnabled();
    await expect(note).toHaveValue(draft);
    await expect(selected).toHaveClass(/active/);
  } finally {
    release();
    await Promise.allSettled(tasks);
    await page.unroute('**/api/moods', holdMood);
  }

  const savedNote = `${draft}，现在继续记录`;
  await note.fill(savedNote);
  const saved = page.waitForResponse(
    (response) => response.url().endsWith('/api/moods') && response.request().method() === 'POST',
  );
  await click(page, '保存今天的心情');
  const response = await saved;
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect(page.locator('.loading')).toHaveCount(0);
  await expect(note).toBeEnabled();
  await page.reload();
  await expect(page.locator('.title')).toHaveText('今天，也在好好生活');
  await expect(page.locator('.loading')).toHaveCount(0);
  await expect(note).toHaveValue(savedNote);
  await expect(selected).toHaveClass(/active/);
  const dashboard = await request.get(`${api}/dashboard`, {
    headers: { Authorization: `Bearer ${account.token}` },
  });
  expect(dashboard.ok(), await dashboard.text()).toBeTruthy();
  const mine = (await dashboard.json()).moods.find(
    (entry: { authorId: string }) => entry.authorId === account.user.id,
  );
  expect(mine).toMatchObject({ mood: 'good', note: savedNote });
  expect(errors).toEqual([]);
});
