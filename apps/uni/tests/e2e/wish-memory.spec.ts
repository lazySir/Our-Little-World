import { test as base, expect, type Page, type Locator, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const api = 'http://127.0.0.1:3002/api';
const sheet = (page: Page) => page.locator('.sheet:visible');
const field = (box: Locator, label: string) =>
  box
    .locator('.form-field')
    .filter({ has: box.page().locator('.form-label').filter({ hasText: label }) })
    .first();
const fill = (box: Locator, label: string, value: string) =>
  field(box, label).locator('input,textarea').first().fill(value);
async function press(box: Page | Locator, text: string) {
  const button = box.locator('uni-button').filter({ hasText: text });
  await (
    (await button.count()) ? button.last() : box.getByText(text, { exact: true }).last()
  ).click();
}
async function visit(page: Page, feature: string, title: string) {
  await page.goto(`/#/pages/${feature}/index`);
  await expect(page.locator('.title')).toHaveText(title);
  await expect(page.locator('.loading')).toHaveCount(0);
  await expect(page.locator('.error-box')).toHaveCount(0);
}
async function signIn(page: Page) {
  await page.goto('/#/pages/auth/index');
  await expect(page.locator('.title')).toHaveText('欢迎来到我们的小世界');
  const server = field(page.locator('.auth-page'), '小世界服务地址');
  if (!(await server.isVisible()))
    await page.locator('.auth-bottom').filter({ hasText: '连接设置' }).click();
  await fill(page.locator('.auth-page'), '小世界服务地址', api);
  const checking = page.waitForResponse(`${api}/auth/status`);
  await press(page, '保存地址并检查连接');
  const status = await checking;
  expect(status.ok(), await status.text()).toBeTruthy();
  const { initialized } = await status.json();
  await fill(page.locator('.auth-form'), '登录账号', 'uni_h5_owner');
  await fill(page.locator('.auth-form'), '密码', 'uni-private-test-123');
  if (!initialized) {
    await fill(page.locator('.auth-form'), '怎么称呼你', '小熊');
    await fill(page.locator('.auth-form'), '我们的小世界叫做', '写入并发回归的小屋');
  }
  const signingIn = page.waitForResponse(`${api}/auth/${initialized ? 'login' : 'setup'}`);
  await press(page, initialized ? '回家啦' : '创建我们的小世界');
  const response = await signingIn;
  expect(response.ok(), await response.text()).toBeTruthy();
  const { token } = await response.json();
  await expect(page.locator('.title')).toHaveText('今天，也在好好生活');
  await expect(page.locator('.loading')).toHaveCount(0);
  return { Authorization: `Bearer ${token}` };
}
const test = base.extend<{
  world: { marker: string; errors: string[]; headers: Record<string, string> };
}>({
  world: async ({ page, request }, use) => {
    const marker = `write-races-${randomUUID().slice(0, 8)}`;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const headers = await signIn(page);
    try {
      await use({ marker, errors, headers });
    } finally {
      for (const resource of ['memories', 'wishes']) {
        const response = await request.get(`${api}/${resource}`, { headers });
        expect(response.ok(), await response.text()).toBeTruthy();
        const records: { id: string; title?: string; name?: string; note?: string }[] =
          await response.json();
        for (const record of records.filter((item) =>
          [item.title, item.name, item.note].some((value) => value?.includes(marker)),
        )) {
          const deleted = await request.delete(`${api}/${resource}/${record.id}`, { headers });
          expect(deleted.ok(), await deleted.text()).toBeTruthy();
        }
      }
    }
  },
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const frames = (page: Page) =>
  page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
async function assertHealthy(page: Page, errors: string[]) {
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('uni H5 wish conversion stays busy, rejects duplicate taps and retries one real memory after failure', async ({
  page,
  request,
  world,
}) => {
  const title = `一起完成的小事 ${world.marker}`;
  const created = await request.post(`${api}/wishes`, {
    headers: world.headers,
    data: {
      title,
      description: '失败后仍能把完成的愿望收藏起来。',
      status: 'done',
      completedAt: new Date().toISOString(),
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  await visit(page, 'wishes', '一起做');
  const card = page.locator('.card').filter({ hasText: title });
  const convert = card.locator('uni-button').filter({ hasText: '写成一段回忆' });
  await expect(card).toHaveClass(/done/);
  const gate = deferred();
  const tasks: Promise<void>[] = [];
  let attempts = 0;
  const intercept = (route: Route) => {
    const task = (async () => {
      if (route.request().method() !== 'POST') return route.continue();
      attempts++;
      if (attempts === 1) {
        await gate.promise;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: '回忆暂时无法保存，请重试' }),
        });
      } else {
        const response = await route.fetch();
        await route.fulfill({ response });
      }
    })();
    tasks.push(task);
    return task;
  };
  await page.route(`${api}/memories`, intercept);
  try {
    const started = page.waitForRequest(
      (request) => request.url() === `${api}/memories` && request.method() === 'POST',
    );
    await convert.click();
    await started;
    await expect(convert).toHaveClass(/is-loading/);
    await expect(convert).toHaveClass(/is-disabled/);
    const bounds = await convert.boundingBox();
    expect(bounds).toBeTruthy();
    for (let tap = 0; tap < 2; tap++)
      await page.mouse.click(bounds!.x + bounds!.width / 2, bounds!.y + bounds!.height / 2);
    await frames(page);
    expect(attempts).toBe(1);
    await page.screenshot({
      path: test.info().outputPath('wish-conversion-busy.png'),
      fullPage: true,
    });
    const failed = page.waitForResponse(
      (response) => response.url() === `${api}/memories` && response.request().method() === 'POST',
    );
    gate.resolve();
    expect((await failed).status()).toBe(503);
    await expect(page.getByText('回忆暂时无法保存，请重试', { exact: true })).toBeVisible();
    await expect(convert).not.toHaveClass(/is-loading|is-disabled/);
    await expect(page.locator('.title')).toHaveText('一起做');
    const beforeRetry = await request.get(`${api}/memories`, { headers: world.headers });
    expect(
      (await beforeRetry.json()).filter((item: { title: string }) => item.title === title),
    ).toHaveLength(0);
    const saved = page.waitForResponse(
      (response) => response.url() === `${api}/memories` && response.request().method() === 'POST',
    );
    await convert.click();
    const response = await saved;
    expect(response.ok(), await response.text()).toBeTruthy();
    expect(attempts).toBe(2);
    await expect(page.locator('.title')).toHaveText('回忆相册');
    await expect(page.locator('.card').filter({ hasText: title })).toHaveCount(1);
    await page.reload();
    await expect(page.locator('.card').filter({ hasText: title })).toHaveCount(1);
    const memories = await request.get(`${api}/memories`, { headers: world.headers });
    expect(memories.ok(), await memories.text()).toBeTruthy();
    expect(
      (await memories.json()).filter((item: { title: string }) => item.title === title),
    ).toHaveLength(1);
    await assertHealthy(page, world.errors);
    await page.screenshot({
      path: test.info().outputPath('wish-conversion-saved.png'),
      fullPage: true,
    });
  } finally {
    gate.resolve();
    await Promise.allSettled(tasks);
    await page.unroute(`${api}/memories`, intercept);
  }
});
