import { test, expect, type Page, type Locator } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { removeTestPhoto } from './backup-fixture.mts';
const stamp = Date.now();
const names = {
  wish: `一起看海 ${stamp}`,
  menu: `番茄牛腩 ${stamp}`,
  memory: `阳光下的周末 ${stamp}`,
  ann: `第一次旅行 ${stamp}`,
  work: `完成一个小目标 ${stamp}`,
  growth: `第一次翻身 ${stamp}`,
  letter: `写给未来的我们 ${stamp}`,
};
const day = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const nextDay = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yQwAAAABJRU5ErkJggg==',
  'base64',
);
const dialog = (page: Page) => page.locator('.el-dialog:visible');
function field(box: Locator, label: string) {
  return box
    .locator('.el-form-item')
    .filter({ has: box.page().locator('.el-form-item__label').filter({ hasText: label }) })
    .first();
}
async function fill(box: Locator, label: string, value: string) {
  await field(box, label).locator('input,textarea').first().fill(value);
}
async function date(box: Locator, label: string, value: string) {
  const input = field(box, label).locator('input').first();
  await input.fill(value);
  await input.press('Tab');
}
async function save(page: Page, resource: string, button = '保存到小世界') {
  const response = page.waitForResponse(
    (r) => r.url().endsWith(`/api/${resource}`) && r.request().method() === 'POST',
  );
  await dialog(page).getByRole('button', { name: button, exact: true }).click();
  const result = await response;
  expect(result.ok(), await result.text()).toBeTruthy();
  await expect(dialog(page)).toHaveCount(0);
}
async function visit(page: Page, url: string, title: string) {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.locator('.el-skeleton')).toHaveCount(0);
}

test('the Web login page keeps its working endpoint after a failed connection change', async ({
  page,
}) => {
  await page.goto('/auth');
  await expect(page.locator('.auth-card .el-skeleton')).toHaveCount(0);
  await page.getByRole('button', { name: '连接我的私人服务' }).click();
  await dialog(page).locator('input').fill('/api/not-a-service');
  const failed = page.waitForResponse((response) =>
    response.url().endsWith('/api/not-a-service/auth/status'),
  );
  await dialog(page).getByRole('button', { name: '保存并连接' }).click();
  expect((await failed).ok()).toBeFalsy();
  await expect(page.locator('.el-alert')).toBeVisible();
  await page.reload();
  await expect(page.locator('.auth-card .el-skeleton')).toHaveCount(0);
  await expect(page.locator('.el-alert')).toHaveCount(0);
});

test('a stale endpoint status cannot replace the newly connected login mode', async ({ page }) => {
  let releaseOld!: () => void;
  let sawOld!: () => void;
  const pendingOld = new Promise<void>((resolve) => (releaseOld = resolve));
  const oldStarted = new Promise<void>((resolve) => (sawOld = resolve));
  await page.route('**/api/auth/status', async (route) => {
    sawOld();
    await pendingOld;
    await route.fulfill({ json: { initialized: false } });
  });
  await page.route('**/new-api/auth/status', (route) =>
    route.fulfill({ json: { initialized: true } }),
  );
  try {
    await page.goto('/auth');
    await oldStarted;
    await page.getByRole('button', { name: '连接我的私人服务' }).click();
    await dialog(page).locator('input').fill('/new-api');
    await dialog(page).getByRole('button', { name: '保存并连接' }).click();
    await expect(page.getByRole('heading', { name: '好久不见，欢迎回家' })).toBeVisible();
    const oldResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/auth/status',
    );
    releaseOld();
    await oldResponse;
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { name: '好久不见，欢迎回家' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('little-world-api'))).toBe('/new-api');
  } finally {
    releaseOld();
  }
});

test('a stale endpoint 401 cannot clear a session accepted by the new service', async ({
  page,
  request,
}) => {
  await request.post('http://127.0.0.1:3001/api/auth/setup', {
    data: {
      username: 'web_owner',
      password: 'little-world-e2e-123',
      nickname: '小林',
      spaceName: '小林与小禾的小世界',
      startDate: '2024-02-29',
    },
  });
  const login = await request.post('http://127.0.0.1:3001/api/auth/login', {
    data: { username: 'web_owner', password: 'little-world-e2e-123' },
  });
  expect(login.ok()).toBeTruthy();
  const { token } = await login.json();
  await page.goto('/auth');
  await page.evaluate((value) => localStorage.setItem('little-world-token', value), token);
  await visit(page, '/settings', '我们的小设置');
  let releaseOld!: () => void;
  let sawOld!: () => void;
  const pendingOld = new Promise<void>((resolve) => (releaseOld = resolve));
  const oldStarted = new Promise<void>((resolve) => (sawOld = resolve));
  await page.route('**/api/stale-resource', async (route) => {
    sawOld();
    await pendingOld;
    await route.fulfill({ status: 401, json: { message: '旧服务登录已过期' } });
  });
  try {
    await page.evaluate(async () => {
      const modulePath = '/src/api.ts';
      const api = await import(/* @vite-ignore */ modulePath);
      (window as any).oldEndpointRequest = api.request('/stale-resource').catch(() => undefined);
    });
    await oldStarted;
    await page.locator('.endpoint-row input').fill('http://127.0.0.1:3001/api');
    await page.locator('.endpoint-row').getByRole('button', { name: '保存并连接' }).click();
    await expect(page).toHaveURL(/\/auth$/);
    await fill(page.locator('.auth-card'), '账号', 'web_owner');
    await fill(page.locator('.auth-card'), '密码', 'little-world-e2e-123');
    await page.getByRole('button', { name: '回到小世界', exact: true }).click();
    await expect(page.getByRole('heading', { name: '平凡日子，也闪闪发光' })).toBeVisible();
    const newToken = await page.evaluate(() => localStorage.getItem('little-world-token'));
    expect(newToken).toBeTruthy();
    expect(newToken).not.toBe(token);
    releaseOld();
    await page.evaluate(() => (window as any).oldEndpointRequest);
    await expect(page.getByRole('heading', { name: '平凡日子，也闪闪发光' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('little-world-token'))).toBe(newToken);
  } finally {
    releaseOld();
  }
});

test('two people can create, share and persist their complete little world', async ({
  page,
  browser,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/auth');
  await expect(page.locator('.auth-card .el-skeleton')).toHaveCount(0);
  if (await page.getByRole('heading', { name: '给我们安一个家' }).isVisible()) {
    await fill(page.locator('.auth-card'), '你的昵称', '小林');
    await fill(page.locator('.auth-card'), '账号', 'web_owner');
    await fill(page.locator('.auth-card'), '密码', 'little-world-e2e-123');
    await fill(page.locator('.auth-card'), '小世界的名字', '小林与小禾的小世界');
    await date(page.locator('.auth-card'), '我们在一起的日子', '2024-02-29');
    await page.getByRole('button', { name: '开启我们的小世界', exact: true }).click();
  } else {
    await fill(page.locator('.auth-card'), '账号', 'web_owner');
    await fill(page.locator('.auth-card'), '密码', 'little-world-e2e-123');
    await page.getByRole('button', { name: '回到小世界', exact: true }).click();
  }
  await expect(page.getByRole('heading', { name: '平凡日子，也闪闪发光' })).toBeVisible();
  await expect(page.locator('.home-hero')).toContainText('小林与小禾的小世界');
  await page.getByRole('button', { name: '超开心', exact: true }).click();
  await page.getByPlaceholder('留一句今天的小心情…').fill('今天也认真过日子');
  await page.getByRole('button', { name: /记下心情|更新心情/ }).click();
  await expect(page.locator('.partner-moods')).toContainText('超开心');
  await visit(page, '/wishes', '一起做');
  await page.locator('.header-actions').getByRole('button', { name: '写下愿望' }).click();
  await fill(dialog(page), '标题', names.wish);
  await fill(dialog(page), '为什么想做', '想和你一起去看日落');
  await save(page, 'wishes');
  await expect(page.getByRole('heading', { name: names.wish })).toBeVisible();
  await page
    .locator('article')
    .filter({ hasText: names.wish })
    .getByRole('button', { name: '标记完成' })
    .click();
  await expect(page.locator('article').filter({ hasText: names.wish })).toContainText('已完成');
  await page.reload();
  await expect(page.getByRole('heading', { name: names.wish })).toBeVisible();
  await visit(page, '/meals', '今天吃什么');
  await page.locator('.header-actions').getByRole('button', { name: '添加收藏' }).click();
  await fill(dialog(page), '名称', names.menu);
  await field(dialog(page), '价格（元）').locator('input').fill('18.50');
  await fill(dialog(page), '小备注', '两个人都喜欢的家常菜');
  await save(page, 'menu', '保存');
  await page
    .locator('article')
    .filter({ hasText: names.menu })
    .getByRole('button', { name: '加入购物篮' })
    .click();
  await page
    .locator('.header-actions')
    .getByRole('button', { name: /购物篮/ })
    .click();
  await page.getByPlaceholder('给今晚留一句备注，例如：记得加辣').fill('少一点辣，多一点爱');
  const orderResponse = page.waitForResponse(
    (r) => r.url().endsWith('/api/orders') && r.request().method() === 'POST',
  );
  await dialog(page).getByRole('button', { name: '一起下单' }).click();
  expect((await orderResponse).ok()).toBeTruthy();
  await expect(page.locator('.orders-list')).toContainText(names.menu);
  await page
    .locator('.order-row')
    .filter({ hasText: names.menu })
    .getByRole('button', { name: '完成', exact: true })
    .click();
  await expect(page.locator('.order-row').filter({ hasText: names.menu })).toContainText('已完成');
  await visit(page, '/ledger', '共同账本');
  await page.locator('.header-actions').getByRole('button', { name: '记一笔' }).click();
  await fill(dialog(page), '金额（元）', '18.50');
  await fill(dialog(page), '备注', '今晚的番茄牛腩');
  await save(page, 'ledger', '记进账本');
  await expect(page.locator('.ledger-list')).toContainText('18.50');
  await expect(page.locator('.chart-canvas canvas').first()).toBeVisible();
  await visit(page, '/memories', '回忆相册');
  await page.locator('.header-actions').getByRole('button', { name: '收藏一个瞬间' }).click();
  await fill(dialog(page), '标题', names.memory);
  await fill(dialog(page), '内容', '阳光落在窗台，我们一起慢慢吃早餐。');
  await fill(dialog(page), '标签', '周末，阳光');
  await dialog(page)
    .locator('input[type=file]')
    .setInputFiles([
      { name: 'morning.png', mimeType: 'image/png', buffer: pixel },
      { name: 'sunshine.png', mimeType: 'image/png', buffer: pixel },
    ]);
  await expect(dialog(page).locator('.upload-photo')).toHaveCount(2);
  await save(page, 'memories');
  await page.reload();
  const memory = page.locator('article').filter({ hasText: names.memory });
  await expect(memory).toContainText('# 周末');
  await expect(memory.locator('img')).toBeVisible();
  await memory.locator('img').click();
  await expect(page.locator('.el-image-viewer__wrapper')).toBeVisible();
  await page.keyboard.press('Escape');
  await visit(page, '/anniversaries', '纪念日');
  await page.locator('.header-actions').getByRole('button', { name: '添加纪念日' }).click();
  await fill(dialog(page), '标题', names.ann);
  await date(dialog(page), '日期', '2024-02-29');
  await save(page, 'anniversaries');
  await expect(
    page.locator('article').filter({ hasText: names.ann }).locator('.anniversary-count'),
  ).toBeVisible();
  await visit(page, '/work', '工作手记');
  await page.locator('.header-actions').getByRole('button', { name: '写一篇手记' }).click();
  await fill(dialog(page), '标题', names.work);
  await fill(dialog(page), '内容', '把今天的进步分享给你。');
  await save(page, 'work');
  await expect(page.getByRole('heading', { name: names.work })).toBeVisible();
  await visit(page, '/baby', '宝宝成长');
  if (await page.locator('.baby-onboarding').isVisible()) {
    await page.locator('.header-actions').getByRole('button', { name: '创建宝宝档案' }).click();
    await fill(dialog(page), '宝宝的名字', '小小禾');
    const response = page.waitForResponse(
      (r) => r.url().endsWith('/api/baby') && r.request().method() === 'PUT',
    );
    await dialog(page).getByRole('button', { name: '保存小档案' }).click();
    expect((await response).ok()).toBeTruthy();
    await expect(dialog(page)).toHaveCount(0);
  }
  await page.locator('.header-actions').getByRole('button', { name: '记下成长' }).click();
  await fill(dialog(page), '标题', names.growth);
  await field(dialog(page), '身高（cm）').locator('input').fill('60.5');
  await field(dialog(page), '体重（kg）').locator('input').fill('5.25');
  await save(page, 'growth', '收藏这份成长');
  await expect(page.locator('.growth-timeline')).toContainText('60.5');
  await visit(page, '/letters', '时光信箱');
  await page.locator('.header-actions').getByRole('button', { name: '写一封信' }).click();
  await expect(field(dialog(page), '解锁日期').locator('input')).toHaveValue(nextDay());
  await fill(dialog(page), '标题', names.letter);
  await fill(dialog(page), '信的内容', '这段秘密必须留在未来');
  await date(dialog(page), '解锁日期', day());
  await dialog(page).getByRole('button', { name: '保存到小世界', exact: true }).click();
  await expect(page.getByText('请选择明天或更晚的解锁日期', { exact: true })).toBeVisible();
  await expect(dialog(page)).toBeVisible();
  await date(dialog(page), '解锁日期', nextDay());
  await save(page, 'letters');
  const letter = page.locator('article').filter({ hasText: names.letter });
  await expect(letter).toContainText('未到解锁日');
  await expect(letter).not.toContainText('这段秘密必须留在未来');
  const token = await page.evaluate(() => localStorage.getItem('little-world-token'));
  const locked = await request.get('http://127.0.0.1:3001/api/letters', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect((await locked.json()).find((i) => i.title === names.letter).content).toBeUndefined();
  await visit(page, '/settings', '我们的小设置');
  await fill(page.locator('.settings-panel').first(), '我的昵称', '小林');
  await page.getByRole('button', { name: '保存昵称', exact: true }).click();
  await page.getByRole('button', { name: '温柔玫瑰' }).click();
  await page.getByRole('button', { name: '保存家的模样' }).click();
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'rose');
  await page.reload();
  await expect(page.locator('.app')).toHaveAttribute('data-theme', 'rose');
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出数据', exact: true }).click();
  expect((await exported).suggestedFilename()).toMatch(/\.json$/);
  const backup = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载备份', exact: true }).click();
  const downloadedBackup = await backup;
  expect(downloadedBackup.suggestedFilename()).toMatch(/\.zip$/);
  const backupPath = await downloadedBackup.path();
  expect(backupPath).toBeTruthy();
  const newerWish = await request.post('http://127.0.0.1:3001/api/wishes', {
    headers: { Authorization: `Bearer ${token}` },
    data: { title: `恢复后应移除 ${stamp}` },
  });
  expect(newerWish.ok()).toBeTruthy();
  const newerWishId = (await newerWish.json()).id;
  const missingPhoto = await removeTestPhoto(backupPath!, 'web');
  await page.locator('input[type="file"]').setInputFiles(backupPath!);
  const restored = page.waitForResponse((response) =>
    response.url().endsWith('/api/backup/restore'),
  );
  await page.locator('.el-message-box:visible').getByRole('button', { name: '确认恢复' }).click();
  const restoreResponse = await restored;
  expect(restoreResponse.ok(), await restoreResponse.text()).toBeTruthy();
  await expect(page.getByText(/恢复前已有 1 张照片文件缺失/)).toBeVisible();
  await expect(page.getByText('备份已恢复，记录已回到小世界', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('little-world-token'))).toBe(token);
  const restoredWishes = await request.get('http://127.0.0.1:3001/api/wishes', {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect((await restoredWishes.json()).some((row) => row.id === newerWishId)).toBeFalsy();
  expect(await readFile(missingPhoto.target)).toEqual(missingPhoto.bytes);
  let partnerToken: string | undefined;
  if (await page.getByRole('button', { name: '生成邀请码', exact: true }).isVisible()) {
    await page.getByRole('button', { name: '生成邀请码', exact: true }).click();
    const code = await page.locator('.invite-code>strong').textContent();
    const partner = await browser.newPage();
    await partner.goto(`/auth?code=${code}`);
    await expect(partner.getByRole('heading', { name: '来，一起回家' })).toBeVisible();
    await fill(partner.locator('.auth-card'), '你的昵称', '小禾');
    await fill(partner.locator('.auth-card'), '账号', 'web_partner');
    await fill(partner.locator('.auth-card'), '密码', 'little-world-partner-123');
    await partner.getByRole('button', { name: '加入我们的家', exact: true }).click();
    await expect(partner.getByRole('heading', { name: '平凡日子，也闪闪发光' })).toBeVisible();
    partnerToken = await partner.evaluate(() => localStorage.getItem('little-world-token'));
    await visit(partner, '/wishes', '一起做');
    await expect(partner.getByRole('heading', { name: names.wish })).toBeVisible();
    await visit(partner, '/settings', '我们的小设置');
    await expect(partner.getByRole('button', { name: '下载备份', exact: true })).toBeDisabled();
    await partner.close();
  }
  await visit(page, '/', '平凡日子，也闪闪发光');
  await page.screenshot({ path: 'test-results/web-dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'test-results/web-dashboard-mobile.png', fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await expect(page.locator('.mobile-nav')).toBeVisible();
  await page.locator('.mobile-nav').getByRole('button', { name: '更多' }).click();
  await page.getByRole('link', { name: '时光信箱', exact: true }).last().click();
  await expect(page.getByRole('heading', { name: '时光信箱', exact: true })).toBeVisible();
  await expect(page.locator('article').filter({ hasText: names.letter })).not.toContainText(
    '这段秘密必须留在未来',
  );
  expect(errors).toEqual([]);
});

test('Web settings preserve the current endpoint and session when the new service fails', async ({
  page,
  request,
}) => {
  await request.post('http://127.0.0.1:3001/api/auth/setup', {
    data: {
      username: 'web_owner',
      password: 'little-world-e2e-123',
      nickname: '小林',
      spaceName: '连接回归',
      startDate: '2024-02-29',
    },
  });
  const login = await request.post('http://127.0.0.1:3001/api/auth/login', {
    data: { username: 'web_owner', password: 'little-world-e2e-123' },
  });
  expect(login.ok()).toBeTruthy();
  const { token } = await login.json();
  await page.goto('/auth');
  await page.evaluate((value) => localStorage.setItem('little-world-token', value), token);
  await visit(page, '/settings', '我们的小设置');
  await page.locator('.endpoint-row input').fill('/api/not-a-service');
  await page.locator('.endpoint-row').getByRole('button', { name: '保存并连接' }).click();
  await expect(page.locator('.el-message--error')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '我们的小设置' })).toBeVisible();
  await expect(page.locator('.endpoint-row input')).toHaveValue('/api');
  await page.locator('.endpoint-row input').fill('http://127.0.0.1:3001/api');
  const probe = page.waitForRequest('http://127.0.0.1:3001/api/auth/status');
  await page.locator('.endpoint-row').getByRole('button', { name: '保存并连接' }).click();
  expect((await probe).headers().authorization).toBeUndefined();
  await expect(page).toHaveURL(/\/auth$/);
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('little-world-token')))
    .toBeNull();
  await page.reload();
  await expect(page.getByRole('heading', { name: '好久不见，欢迎回家' })).toBeVisible();
});

test('all pages fit a small phone and the server address stays reachable', async ({
  page,
  request,
}) => {
  const response = await request.post('http://127.0.0.1:3001/api/auth/login', {
    data: { username: 'web_owner', password: 'little-world-e2e-123' },
  });
  expect(response.ok()).toBeTruthy();
  const auth = await response.json();
  await page.addInitScript(
    (token) => localStorage.setItem('little-world-token', token),
    auth.token,
  );
  await page.setViewportSize({ width: 375, height: 812 });
  for (const [url, title] of [
    ['/', '平凡日子，也闪闪发光'],
    ['/wishes', '一起做'],
    ['/meals', '今天吃什么'],
    ['/ledger', '共同账本'],
    ['/memories', '回忆相册'],
    ['/anniversaries', '纪念日'],
    ['/work', '工作手记'],
    ['/baby', '宝宝成长'],
    ['/letters', '时光信箱'],
    ['/settings', '我们的小设置'],
  ]) {
    await visit(page, url, title);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      url,
    ).toBeTruthy();
    const header = page.locator('.page-header');
    const left = await header.locator('>div').first().boundingBox();
    const right = await header.locator('.header-actions').first().boundingBox();
    if (left && right && right.width)
      expect(
        left.x + left.width <= right.x + 1 || left.y + left.height <= right.y + 1,
        url,
      ).toBeTruthy();
  }
  await page.screenshot({ path: 'test-results/web-settings-mobile.png', fullPage: true });
  await page.evaluate(() => {
    localStorage.removeItem('little-world-token');
    localStorage.setItem('little-world-api', 'http://127.0.0.1:9/api');
  });
  await page.goto('/auth');
  await expect(page.locator('.el-alert')).toBeVisible();
  await page.getByRole('button', { name: '连接我的私人服务' }).click();
  await expect(dialog(page).getByRole('heading', { name: '连接我的私人服务' })).toBeVisible();
  await expect(dialog(page).locator('input')).toHaveValue('http://127.0.0.1:9/api');
});

test('older meal orders remain reachable and manageable beyond the recent six', async ({
  page,
  request,
}) => {
  const apiBase = 'http://127.0.0.1:3001/api';
  const status = await (await request.get(`${apiBase}/auth/status`)).json();
  const signedIn = await request.post(`${apiBase}/auth/${status.initialized ? 'login' : 'setup'}`, {
    data: {
      username: 'web_owner',
      password: 'little-world-e2e-123',
      nickname: '小林',
      spaceName: '点单历史测试',
      startDate: '2024-02-29',
    },
  });
  expect(signedIn.ok(), await signedIn.text()).toBeTruthy();
  const { token } = await signedIn.json();
  const headers = { Authorization: `Bearer ${token}` };
  const menu = await request.post(`${apiBase}/menu`, {
    headers,
    data: { name: `点单历史菜品 ${stamp}`, priceCents: 1800 },
  });
  expect(menu.ok(), await menu.text()).toBeTruthy();
  const menuItem = await menu.json();
  const created: { id: string; note: string }[] = [];
  for (let index = 0; index < 8; index++) {
    const response = await request.post(`${apiBase}/orders`, {
      headers,
      data: {
        items: [{ menuItemId: menuItem.id, quantity: 1 }],
        note: `历史点单 ${index + 1} · ${stamp}`,
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    created.push(await response.json());
  }
  const allOrders = await (await request.get(`${apiBase}/orders`, { headers })).json();
  await page.addInitScript((value) => localStorage.setItem('little-world-token', value), token);
  await visit(page, '/meals', '今天吃什么');
  const section = page.locator('.orders-section');
  const rows = section.locator('.order-row');
  const oldest = section.locator(`.order-row[data-order-id="${created[0].id}"]`);
  await expect(rows).toHaveCount(6);
  await expect(oldest).toHaveCount(0);
  const historyButton = section.getByRole('button', { name: /查看全部点单/ });
  await expect(historyButton).toBeVisible();
  await historyButton.click();
  await expect(rows).toHaveCount(allOrders.length);
  await expect(oldest).toBeVisible();

  const completed = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/orders/${created[0].id}`) &&
      response.request().method() === 'PATCH',
  );
  await oldest.getByRole('button', { name: '完成', exact: true }).click();
  expect((await completed).ok()).toBeTruthy();
  await expect(oldest.locator('.tag')).toHaveText('已完成');
  await expect(oldest).toContainText(created[0].note);
  await page.screenshot({ path: 'test-results/web-order-history-desktop.png', fullPage: true });

  await page.setViewportSize({ width: 375, height: 812 });
  await section.getByRole('button', { name: '收起点单', exact: true }).click();
  await expect(rows).toHaveCount(6);
  await section.getByRole('button', { name: /查看全部点单/ }).click();
  await expect(oldest).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: 'test-results/web-order-history-mobile.png', fullPage: true });

  const deleted = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/orders/${created[0].id}`) &&
      response.request().method() === 'DELETE',
  );
  await oldest.getByRole('button', { name: '删除点单', exact: true }).click();
  await page
    .locator('.el-message-box:visible')
    .getByRole('button', { name: '删除', exact: true })
    .click();
  expect((await deleted).ok()).toBeTruthy();
  await expect(oldest).toHaveCount(0);
  await expect(rows).toHaveCount(allOrders.length - 1);
  const persisted = await (await request.get(`${apiBase}/orders`, { headers })).json();
  expect(persisted.some((order: { id: string }) => order.id === created[0].id)).toBeFalsy();

  for (const order of persisted.slice(6)) {
    await request.delete(`${apiBase}/orders/${order.id}`, { headers });
  }
  await page.reload();
  await expect(rows).toHaveCount(6);
  await expect(section.getByRole('button', { name: /查看全部点单|收起点单/ })).toHaveCount(0);
});

test('ledger saves keep the active draft locked and recover after a failed request', async ({
  page,
  request,
}) => {
  const apiBase = 'http://127.0.0.1:3001/api';
  const status = await (await request.get(`${apiBase}/auth/status`)).json();
  const signedIn = await request.post(`${apiBase}/auth/${status.initialized ? 'login' : 'setup'}`, {
    data: {
      username: 'web_owner',
      password: 'little-world-e2e-123',
      nickname: '小林',
      spaceName: '小林与小禾的小世界',
      startDate: '2024-02-29',
    },
  });
  expect(signedIn.ok(), await signedIn.text()).toBeTruthy();
  const { token } = await signedIn.json();
  await page.addInitScript((value) => localStorage.setItem('little-world-token', value), token);
  await visit(page, '/ledger', '共同账本');
  await page.getByRole('button', { name: '记一笔', exact: true }).click();
  const note = `保存锁回归 ${stamp}`;
  await fill(dialog(page), '金额（元）', '23.45');
  await fill(dialog(page), '备注', note);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let started!: () => void;
  const pending = new Promise<void>((resolve) => (started = resolve));
  const tasks: Promise<void>[] = [];
  const routeHandler = (route: import('@playwright/test').Route) => {
    const task = (async () => {
      if (route.request().method() === 'POST') {
        started();
        await gate;
        await route.fulfill({ status: 503, json: { message: '记账服务暂时中断，请重试' } });
      } else await route.continue();
    })();
    tasks.push(task);
    return task;
  };
  await page.route('**/api/ledger', routeHandler);
  try {
    await dialog(page).getByRole('button', { name: '记进账本', exact: true }).click();
    await pending;
    await expect(dialog(page).getByRole('button', { name: '取消', exact: true })).toBeDisabled();
    await expect(field(dialog(page), '金额（元）').locator('input')).toBeDisabled();
    await expect(field(dialog(page), '备注').locator('textarea')).toBeDisabled();
    await expect(dialog(page).locator('.el-dialog__headerbtn')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeVisible();
    await page.locator('.el-overlay:visible').click({ position: { x: 2, y: 2 }, force: true });
    await expect(dialog(page)).toBeVisible();
    release();
    await expect(page.locator('.el-message')).toContainText('记账服务暂时中断，请重试');
    await expect(field(dialog(page), '金额（元）').locator('input')).toBeEnabled();
    await expect(field(dialog(page), '备注').locator('textarea')).toHaveValue(note);
    await expect(dialog(page).getByRole('button', { name: '取消', exact: true })).toBeEnabled();
  } finally {
    release();
    await Promise.allSettled(tasks);
    await page.unroute('**/api/ledger', routeHandler);
  }
  await save(page, 'ledger', '记进账本');
  await expect(page.locator('.ledger-list')).toContainText(note);
  await page.reload();
  await expect(page.locator('.ledger-list')).toContainText(note);
});

test('ordering locks the submitted basket and preserves it after a failed request', async ({
  page,
  request,
}) => {
  const apiBase = 'http://127.0.0.1:3001/api';
  const status = await (await request.get(`${apiBase}/auth/status`)).json();
  const signedIn = await request.post(`${apiBase}/auth/${status.initialized ? 'login' : 'setup'}`, {
    data: {
      username: 'web_owner',
      password: 'little-world-e2e-123',
      nickname: '小林',
      spaceName: '小林与小禾的小世界',
      startDate: '2024-02-29',
    },
  });
  expect(signedIn.ok(), await signedIn.text()).toBeTruthy();
  const { token } = await signedIn.json();
  const name = `慢网络点单 ${stamp}`;
  const menu = await request.post(`${apiBase}/menu`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name, category: 'dish', priceCents: 800 },
  });
  expect(menu.ok(), await menu.text()).toBeTruthy();
  await page.addInitScript((value) => localStorage.setItem('little-world-token', value), token);
  await visit(page, '/meals', '今天吃什么');
  const dish = page.locator('article').filter({ hasText: name });
  await dish.getByRole('button', { name: '加入购物篮' }).click();
  await page
    .locator('.header-actions')
    .getByRole('button', { name: /购物篮/ })
    .click();
  const note = `保留点单备注 ${stamp}`;
  await page.getByPlaceholder('给今晚留一句备注，例如：记得加辣').fill(note);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let started!: () => void;
  const pending = new Promise<void>((resolve) => (started = resolve));
  const tasks: Promise<void>[] = [];
  const handler = (route: import('@playwright/test').Route) => {
    const task = (async () => {
      if (route.request().method() === 'POST') {
        started();
        await gate;
        await route.fulfill({ status: 503, json: { message: '点单暂时中断，请重试' } });
      } else await route.continue();
    })();
    tasks.push(task);
    return task;
  };
  await page.route('**/api/orders', handler);
  try {
    await dialog(page).getByRole('button', { name: '一起下单', exact: true }).click();
    await pending;
    await expect(dialog(page).getByRole('button', { name: '再选选', exact: true })).toBeDisabled();
    await expect(dialog(page).locator('textarea')).toBeDisabled();
    for (const button of await dialog(page).locator('.quantity').all())
      await expect(button).toBeDisabled();
    await expect(dish.getByRole('button', { name: '加入购物篮' })).toBeDisabled();
    await expect(dialog(page).locator('.el-dialog__headerbtn')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toBeVisible();
    await page.locator('.el-overlay:visible').click({ position: { x: 2, y: 2 }, force: true });
    await expect(dialog(page)).toBeVisible();
    release();
    await expect(page.locator('.el-message')).toContainText('点单暂时中断，请重试');
    await expect(dialog(page).locator('textarea')).toBeEnabled();
    await expect(dialog(page).locator('textarea')).toHaveValue(note);
    await expect(dialog(page).locator('.cart-row')).toContainText(name);
  } finally {
    release();
    await Promise.allSettled(tasks);
    await page.unroute('**/api/orders', handler);
  }
  await save(page, 'orders', '一起下单');
  await expect(page.locator('.orders-list')).toContainText(note);
  await expect(
    page.locator('.header-actions').getByRole('button', { name: /购物篮/ }),
  ).toBeDisabled();
});

test('authentication survives a failed profile refresh and both exits work offline', async ({
  page,
  request,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const apiBase = 'http://127.0.0.1:3001/api';
  const status = await (await request.get(`${apiBase}/auth/status`)).json();
  if (!status.initialized) {
    const setup = await request.post(`${apiBase}/auth/setup`, {
      data: {
        username: 'web_owner',
        password: 'little-world-e2e-123',
        nickname: '小林',
        spaceName: '小林与小禾的小世界',
        startDate: '2024-02-29',
      },
    });
    expect(setup.ok(), await setup.text()).toBeTruthy();
  }
  const failProfile = (route: import('@playwright/test').Route) => route.abort('failed');
  await page.route('**/api/auth/me', failProfile);
  await page.route('**/api/auth/logout', (route) => route.abort('failed'));
  await page.goto('/auth');
  await expect(page.locator('.auth-card .el-skeleton')).toHaveCount(0);
  await fill(page.locator('.auth-card'), '账号', 'web_owner');
  await fill(page.locator('.auth-card'), '密码', 'little-world-e2e-123');
  await page.getByRole('button', { name: '回到小世界', exact: true }).click();
  await expect(page.getByRole('heading', { name: '平凡日子，也闪闪发光' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('little-world-token'))).toBeTruthy();
  await page.getByTitle('退出登录', { exact: true }).click();
  await expect(page).toHaveURL(/\/auth$/);
  expect(await page.evaluate(() => localStorage.getItem('little-world-token'))).toBeNull();
  await page.unroute('**/api/auth/me', failProfile);
  await fill(page.locator('.auth-card'), '账号', 'web_owner');
  await fill(page.locator('.auth-card'), '密码', 'little-world-e2e-123');
  await page.getByRole('button', { name: '回到小世界', exact: true }).click();
  await expect(page.getByRole('heading', { name: '平凡日子，也闪闪发光' })).toBeVisible();
  await visit(page, '/settings', '我们的小设置');
  await page.getByRole('button', { name: '暂时离开小世界', exact: true }).click();
  await expect(page).toHaveURL(/\/auth$/);
  expect(await page.evaluate(() => localStorage.getItem('little-world-token'))).toBeNull();
  expect(errors).toEqual([]);
});

test('mood saves protect pending inputs and preserve a failed draft for retry', async ({
  page,
  request,
}) => {
  const apiBase = 'http://127.0.0.1:3001/api';
  const status = await (await request.get(`${apiBase}/auth/status`)).json();
  const signedIn = await request.post(`${apiBase}/auth/${status.initialized ? 'login' : 'setup'}`, {
    data: {
      username: 'web_owner',
      password: 'little-world-e2e-123',
      nickname: '小林',
      spaceName: '小林与小禾的小世界',
      startDate: '2024-02-29',
    },
  });
  expect(signedIn.ok(), await signedIn.text()).toBeTruthy();
  const { token } = await signedIn.json();
  await page.addInitScript((value) => localStorage.setItem('little-world-token', value), token);
  await visit(page, '/', '平凡日子，也闪闪发光');
  const note = `慢网心情 ${stamp}`;
  await page.getByRole('button', { name: '超开心', exact: true }).click();
  await page.getByPlaceholder('留一句今天的小心情…').fill(note);
  let release!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const pending = new Promise<void>((resolve) => (started = resolve));
  const tasks: Promise<void>[] = [];
  const handler = (route: import('@playwright/test').Route) => {
    const task = (async () => {
      started();
      await gate;
      await route.fulfill({ status: 503, json: { message: '心情暂时没有送达，请重试' } });
    })();
    tasks.push(task);
    return task;
  };
  await page.route('**/api/moods', handler);
  try {
    await page.getByRole('button', { name: /记下心情|更新心情/ }).click();
    await pending;
    await expect(page.getByPlaceholder('留一句今天的小心情…')).toBeDisabled();
    for (const option of await page.locator('.mood-options button').all())
      await expect(option).toBeDisabled();
    release();
    await expect(page.locator('.el-message')).toContainText('心情暂时没有送达，请重试');
    await expect(page.getByPlaceholder('留一句今天的小心情…')).toBeEnabled();
    await expect(page.getByPlaceholder('留一句今天的小心情…')).toHaveValue(note);
    await expect(page.getByRole('button', { name: '超开心', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  } finally {
    release();
    await Promise.allSettled(tasks);
    await page.unroute('**/api/moods', handler);
  }
  await page.getByRole('button', { name: /记下心情|更新心情/ }).click();
  await expect(page.locator('.partner-moods')).toContainText(note);
  await page.reload();
  await expect(page.locator('.partner-moods')).toContainText(note);
});

test('photo editors keep pending uploads attached and release controls after failures', async ({
  page,
  request,
}) => {
  const apiBase = 'http://127.0.0.1:3001/api';
  const status = await (await request.get(`${apiBase}/auth/status`)).json();
  const signedIn = await request.post(`${apiBase}/auth/${status.initialized ? 'login' : 'setup'}`, {
    data: {
      username: 'web_owner',
      password: 'little-world-e2e-123',
      nickname: '小林',
      spaceName: '照片上传测试',
      startDate: '2024-02-29',
    },
  });
  expect(signedIn.ok(), await signedIn.text()).toBeTruthy();
  const { token } = await signedIn.json();
  const headers = { Authorization: `Bearer ${token}` };
  const baby = await request.put(`${apiBase}/baby`, { headers, data: { name: '小太阳' } });
  expect(baby.ok(), await baby.text()).toBeTruthy();
  await page.addInitScript((value) => localStorage.setItem('little-world-token', value), token);

  for (const scenario of [
    {
      url: '/memories',
      title: '回忆相册',
      open: '收藏一个瞬间',
      label: '标题',
      save: '保存到小世界',
      endpoint: '/memories',
      method: 'POST',
      key: 'assetIds',
    },
    {
      url: '/work',
      title: '工作手记',
      open: '写一篇手记',
      label: '标题',
      save: '保存到小世界',
      endpoint: '/work',
      method: 'POST',
      key: 'assetIds',
    },
    {
      url: '/meals',
      title: '今天吃什么',
      open: '添加收藏',
      label: '名称',
      save: '保存',
      endpoint: '/menu',
      method: 'POST',
      key: 'assetId',
    },
    {
      url: '/baby',
      title: '宝宝成长',
      open: '记下成长',
      label: '标题',
      save: '收藏这份成长',
      endpoint: '/growth',
      method: 'POST',
      key: 'assetIds',
    },
    {
      url: '/baby',
      title: '宝宝成长',
      open: '编辑宝宝档案',
      label: '宝宝的名字',
      save: '保存小档案',
      endpoint: '/baby',
      method: 'PUT',
      key: 'avatarId',
    },
  ]) {
    await test.step(`${scenario.endpoint} waits for its photo before saving`, async () => {
      await visit(page, scenario.url, scenario.title);
      await page.getByRole('button', { name: scenario.open, exact: true }).first().click();
      await fill(dialog(page), scenario.label, `上传中的记录 ${scenario.endpoint} ${stamp}`);
      let releaseUpload!: () => void;
      const uploadGate = new Promise<void>((resolve) => {
        releaseUpload = resolve;
      });
      let uploadStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        uploadStarted = resolve;
      });
      const uploadTasks: Promise<void>[] = [];
      const uploadRoute = (route: import('@playwright/test').Route) => {
        const task = (async () => {
          if (route.request().method() === 'POST') {
            uploadStarted();
            await uploadGate;
          }
          await route.continue();
        })();
        uploadTasks.push(task);
        return task;
      };
      await page.route('**/api/assets', uploadRoute);
      let writes = 0;
      const trackWrites = (req: import('@playwright/test').Request) => {
        if (req.url().endsWith(`/api${scenario.endpoint}`) && req.method() === scenario.method)
          writes++;
      };
      page.on('request', trackWrites);
      try {
        await dialog(page)
          .locator('input[type=file]')
          .setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: pixel });
        await started;
        await expect(
          dialog(page).getByRole('button', { name: scenario.save, exact: true }),
        ).toBeDisabled();
        await expect(
          dialog(page).getByRole('button', { name: '取消', exact: true }),
        ).toBeDisabled();
        await expect(dialog(page).locator('.el-dialog__headerbtn')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(dialog(page)).toBeVisible();
        await page.locator('.el-overlay:visible').click({ position: { x: 2, y: 2 }, force: true });
        await expect(dialog(page)).toBeVisible();
        // ResourcePage also accepts native form submission via Enter.
        await dialog(page)
          .locator('form')
          .evaluate((form) =>
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
          );
        expect(writes).toBe(0);
        const uploaded = page.waitForResponse(
          (response) =>
            response.url().endsWith('/api/assets') && response.request().method() === 'POST',
        );
        releaseUpload();
        const photoResponse = await uploaded;
        expect(photoResponse.ok(), await photoResponse.text()).toBeTruthy();
        const photo = await photoResponse.json();
        await expect(dialog(page).locator('.upload-photo')).toHaveCount(1);
        await expect(
          dialog(page).getByRole('button', { name: scenario.save, exact: true }),
        ).toBeEnabled();

        let releaseSave!: () => void;
        const saveGate = new Promise<void>((resolve) => {
          releaseSave = resolve;
        });
        const saveRoute = async (route: import('@playwright/test').Route) => {
          if (route.request().method() === scenario.method) await saveGate;
          await route.continue();
        };
        await page.route(`**/api${scenario.endpoint}`, saveRoute);
        try {
          const saveRequest = page.waitForRequest(
            (req) =>
              req.url().endsWith(`/api${scenario.endpoint}`) && req.method() === scenario.method,
          );
          await dialog(page).getByRole('button', { name: scenario.save, exact: true }).click();
          const payload = (await saveRequest).postDataJSON();
          expect(payload[scenario.key]).toEqual(
            scenario.key === 'assetIds' ? [photo.id] : photo.id,
          );
          await expect(
            dialog(page).getByRole('button', { name: '取消', exact: true }),
          ).toBeDisabled();
          await expect(
            dialog(page).getByRole('button', { name: '移除照片', exact: true }),
          ).toBeDisabled();
          const saved = page.waitForResponse(
            (response) =>
              response.url().endsWith(`/api${scenario.endpoint}`) &&
              response.request().method() === scenario.method,
          );
          releaseSave();
          const saveResponse = await saved;
          expect(saveResponse.ok(), await saveResponse.text()).toBeTruthy();
          await expect(dialog(page)).toHaveCount(0);
        } finally {
          releaseSave();
          await page.unroute(`**/api${scenario.endpoint}`, saveRoute);
        }
      } finally {
        releaseUpload();
        await Promise.allSettled(uploadTasks);
        page.off('request', trackWrites);
        await page.unroute('**/api/assets', uploadRoute);
      }
    });
  }

  await visit(page, '/memories', '回忆相册');
  await page.getByRole('button', { name: '收藏一个瞬间', exact: true }).first().click();
  await page.route('**/api/assets', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ message: '照片连接中断，请重试' }),
    }),
  );
  await dialog(page)
    .locator('input[type=file]')
    .setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: pixel });
  await expect(page.locator('.el-message')).toContainText('照片连接中断，请重试');
  await expect(
    dialog(page).getByRole('button', { name: '保存到小世界', exact: true }),
  ).toBeEnabled();
  await dialog(page).getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog(page)).toHaveCount(0);
});

test('baby profile read failure cannot turn an existing profile into a blank replacement', async ({
  page,
  request,
}) => {
  const apiBase = 'http://127.0.0.1:3001/api';
  const status = await (await request.get(`${apiBase}/auth/status`)).json();
  const signedIn = await request.post(`${apiBase}/auth/${status.initialized ? 'login' : 'setup'}`, {
    data: {
      username: 'web_owner',
      password: 'little-world-e2e-123',
      nickname: '小林',
      spaceName: '宝宝档案读取保护',
      startDate: '2024-02-29',
    },
  });
  expect(signedIn.ok(), await signedIn.text()).toBeTruthy();
  const { token } = await signedIn.json();
  const headers = { Authorization: `Bearer ${token}` };
  const photo = await request.post(`${apiBase}/assets`, {
    headers,
    multipart: { file: { name: 'baby-profile.png', mimeType: 'image/png', buffer: pixel } },
  });
  expect(photo.ok(), await photo.text()).toBeTruthy();
  const avatar = await photo.json();
  const original = {
    name: `需要保留的小档案 ${stamp}`,
    birthday: '2025-03-08',
    gender: 'girl',
    notes: '读取失败后仍要保留的生日、备注和照片',
    avatarId: avatar.id,
  };
  const seeded = await request.put(`${apiBase}/baby`, { headers, data: original });
  expect(seeded.ok(), await seeded.text()).toBeTruthy();
  const previous = await seeded.json();
  await page.addInitScript((value) => localStorage.setItem('little-world-token', value), token);
  await page.setViewportSize({ width: 375, height: 812 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const tasks: Promise<void>[] = [];
  let writes = 0;
  page.on('request', (req) => {
    if (req.url().endsWith('/api/baby') && req.method() === 'PUT') writes++;
  });
  const failure = '宝宝档案暂时无法读取，请重试';
  const failRead = (route: import('@playwright/test').Route) => {
    const task = (async () => {
      if (route.request().method() !== 'GET') return route.continue();
      await gate;
      await route.fulfill({ status: 503, json: { message: failure } });
    })();
    tasks.push(task);
    return task;
  };
  await page.route('**/api/baby', failRead);
  try {
    const reading = page.waitForRequest(
      (req) => req.url().endsWith('/api/baby') && req.method() === 'GET',
    );
    await page.goto('/baby');
    await reading;
    await expect(page.getByRole('button', { name: '创建宝宝档案', exact: true })).toBeDisabled();
    await expect(page.locator('.baby-onboarding')).toHaveCount(0);
    await expect(dialog(page)).toHaveCount(0);
    release();
    await expect(page.getByRole('alert').filter({ hasText: failure })).toBeVisible();
    await expect(page.getByRole('button', { name: '创建宝宝档案', exact: true })).toBeDisabled();
    await expect(page.locator('.baby-onboarding')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/baby-web-read-error.png', fullPage: true });
    expect(writes).toBe(0);
  } finally {
    release();
    await Promise.allSettled(tasks);
    await page.unroute('**/api/baby', failRead);
  }
  await page.getByRole('button', { name: '重新连接', exact: true }).click();
  await expect(page.locator('.baby-profile')).toContainText(original.name);
  await expect(page.locator('.baby-profile')).toContainText(original.birthday);
  await page.getByRole('button', { name: '编辑宝宝档案', exact: true }).click();
  await expect(field(dialog(page), '生日').locator('input')).toHaveValue(original.birthday);
  await expect(field(dialog(page), '性别')).toContainText('女孩');
  await expect(field(dialog(page), '想说的话').locator('textarea')).toHaveValue(original.notes);
  await expect(field(dialog(page), '头像').locator('.el-image img').first()).toBeVisible();
  const updatedName = `${original.name}，继续成长`;
  await fill(dialog(page), '宝宝的名字', updatedName);
  const saved = page.waitForResponse(
    (res) => res.url().endsWith('/api/baby') && res.request().method() === 'PUT',
  );
  await dialog(page).getByRole('button', { name: '保存小档案', exact: true }).click();
  expect((await saved).ok()).toBeTruthy();
  await expect(dialog(page)).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.baby-profile')).toContainText(updatedName);
  const persisted = await request.get(`${apiBase}/baby`, { headers });
  expect(persisted.ok()).toBeTruthy();
  expect(await persisted.json()).toMatchObject({ ...original, id: previous.id, name: updatedName });
  expect(writes).toBe(1);
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/baby-web-profile.png', fullPage: true });
});
