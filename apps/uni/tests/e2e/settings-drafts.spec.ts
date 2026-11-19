import { test as base, expect, type Locator, type Page, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readE2ESetupToken } from '../../../../e2e/setup-token.mts';

const api = 'http://127.0.0.1:3002/api';
const currentPage = (page: Page) => page.locator('.page:visible').last();
const field = (box: Locator, label: string) =>
  box
    .locator('.form-field')
    .filter({ has: box.page().locator('.form-label').filter({ hasText: label }) })
    .first();
const fill = (box: Locator, label: string, value: string) =>
  field(box, label).locator('input,textarea').first().fill(value);
async function press(box: Page | Locator, text: string) {
  const button = box.locator('uni-button:visible').filter({ hasText: text });
  await (
    (await button.count()) ? button.last() : box.getByText(text, { exact: true }).last()
  ).click();
}
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
    await fill(page.locator('.auth-form'), '首次创建验证码', await readE2ESetupToken());
    await fill(page.locator('.auth-form'), '我们的小世界叫做', '设置弱网回归的小屋');
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
type SpaceFields = { name: string; startDate: string; theme: string };
const test = base.extend<{
  world: { marker: string; errors: string[]; headers: Record<string, string> };
}>({
  world: async ({ page, request }, use) => {
    const marker = `settings-${randomUUID().slice(0, 8)}`;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const headers = await signIn(page);
    const originalResponse = await request.get(`${api}/auth/me`, { headers });
    expect(originalResponse.ok(), await originalResponse.text()).toBeTruthy();
    const original: { user: { nickname: string }; space: SpaceFields } =
      await originalResponse.json();
    try {
      const seeded = await request.patch(`${api}/space`, {
        headers,
        data: { startDate: '2020-01-01', theme: 'cream' },
      });
      expect(seeded.ok(), await seeded.text()).toBeTruthy();
      // Reload the home, then wait for its actual session read before opening settings.
      await page.reload();
      await expect(page.locator('.title')).toHaveText('今天，也在好好生活');
      await expect(page.locator('.loading')).toHaveCount(0);
      await use({ marker, errors, headers });
    } finally {
      const profile = await request.patch(`${api}/auth/profile`, {
        headers,
        data: { nickname: original.user.nickname },
      });
      expect(profile.ok(), await profile.text()).toBeTruthy();
      const space = await request.patch(`${api}/space`, {
        headers,
        data: {
          name: original.space.name,
          startDate: original.space.startDate,
          theme: original.space.theme,
        },
      });
      expect(space.ok(), await space.text()).toBeTruthy();
    }
  },
});
test.use({ locale: 'zh-CN' });

async function nextDay(page: Page) {
  const date = field(currentPage(page), '故事开始的那一天').locator('.date-input');
  await expect(date).toContainText('2020-01-01');
  await date.click();
  const picker = page.locator('.uni-picker-custom.uni-picker-toggle');
  await expect(picker).toBeVisible();
  const day = picker.locator('uni-picker-view-column').nth(2);
  const content = day.locator('.uni-picker-view-content');
  const before = await content.getAttribute('style');
  await day.hover();
  await page.mouse.wheel(0, 40);
  await expect(content).not.toHaveAttribute('style', before || '');
  await frames(page);
  await picker.locator('.uni-picker-action-confirm').click();
  await expect(date).toContainText('2020-01-02');
  await expect(page.locator('.uni-picker-container:visible')).toHaveCount(0);
}
async function assertDrafts(page: Page, nickname: string, name: string) {
  const box = currentPage(page);
  await expect(field(box, '怎么称呼我').locator('input')).toHaveValue(nickname);
  await expect(field(box, '小世界的名字').locator('input')).toHaveValue(name);
  await expect(field(box, '故事开始的那一天').locator('.date-input')).toContainText('2020-01-02');
  await expect(box.getByText('玫瑰日记', { exact: true })).toHaveClass(/accent/);
}
const isPatch = (route: Route) =>
  route.request().method() === 'POST' &&
  route.request().headers()['x-http-method-override'] === 'PATCH';
async function save(page: Page, resource: 'auth/profile' | 'space') {
  const written = page.waitForResponse(
    (response) =>
      response.url() === `${api}/${resource}` &&
      response.request().method() === 'POST' &&
      response.request().headers()['x-http-method-override'] === 'PATCH',
  );
  const refreshed = page.waitForResponse(
    (response) => response.url() === `${api}/auth/me` && response.request().method() === 'GET',
  );
  const label = resource === 'auth/profile' ? '保存昵称' : '保存小世界';
  await press(currentPage(page), label);
  const response = await written;
  expect(response.ok(), await response.text()).toBeTruthy();
  const refresh = await refreshed;
  expect(refresh.ok(), await refresh.text()).toBeTruthy();
  await refresh.finished();
  await expect(currentPage(page).locator('uni-button').filter({ hasText: label })).not.toHaveClass(
    /is-loading/,
  );
  await expect(currentPage(page).locator('.error-box')).toHaveCount(0);
}

for (const resource of ['auth/profile', 'space'] as const) {
  test(`uni H5 keeps settings drafts when an old session read follows a failed ${resource} save and permits a real retry`, async ({
    page,
    request,
    world,
  }) => {
    const gate = deferred();
    const captured = deferred();
    const tasks: Promise<void>[] = [];
    let held = false;
    let failed = false;
    let snapshot: { user: { nickname: string }; space: SpaceFields } | undefined;
    const holdRead = (route: Route) => {
      const task = (async () => {
        if (route.request().method() !== 'GET' || held) return route.continue();
        held = true;
        const upstream = await route.fetch();
        expect(upstream.ok(), await upstream.text()).toBeTruthy();
        snapshot = await upstream.json();
        captured.resolve();
        await gate.promise;
        await route.fulfill({ response: upstream });
      })();
      tasks.push(task);
      return task;
    };
    const failOnce = (route: Route) => {
      const task = (async () => {
        if (!isPatch(route) || failed) return route.continue();
        failed = true;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: '这次保存暂时失败，请重试' }),
        });
      })();
      tasks.push(task);
      return task;
    };
    await page.route(`${api}/auth/me`, holdRead);
    await page.route(`${api}/${resource}`, failOnce);
    try {
      // This opens a real page over the loaded home and preserves the existing Pinia session.
      await page.evaluate(
        () =>
          new Promise<void>((resolve, reject) =>
            (window as any).uni.navigateTo({
              url: '/pages/settings/index',
              success: () => resolve(),
              fail: reject,
            }),
          ),
      );
      await expect(currentPage(page).locator('.title')).toHaveText('我们的设置');
      await captured.promise;
      expect(snapshot?.space.startDate).toBe('2020-01-01');
      expect(snapshot?.space.theme).toBe('cream');
      const nickname = `慢网昵称 ${world.marker}`;
      const name = `慢网小屋 ${world.marker}`;
      await fill(currentPage(page), '怎么称呼我', nickname);
      await fill(currentPage(page), '小世界的名字', name);
      await nextDay(page);
      await currentPage(page).getByText('玫瑰日记', { exact: true }).click();
      await assertDrafts(page, nickname, name);
      const failure = page.waitForResponse(
        (response) => response.url() === `${api}/${resource}` && response.status() === 503,
      );
      await press(currentPage(page), resource === 'auth/profile' ? '保存昵称' : '保存小世界');
      await failure;
      await expect(currentPage(page).locator('.error-box')).toContainText('这次保存暂时失败');
      await assertDrafts(page, nickname, name);
      const stale = page.waitForResponse(
        (response) => response.url() === `${api}/auth/me` && response.request().method() === 'GET',
      );
      gate.resolve();
      const delivered = await stale;
      await delivered.finished();
      expect(await delivered.json()).toEqual(snapshot);
      await frames(page);
      await assertDrafts(page, nickname, name);
      await expect(currentPage(page).locator('.error-box')).toContainText('这次保存暂时失败');
      await page.screenshot({
        path: test.info().outputPath(`settings-${resource.replace('/', '-')}-draft-retained.png`),
        fullPage: true,
      });

      await save(page, 'auth/profile');
      await assertDrafts(page, nickname, name);
      await save(page, 'space');
      await expect(currentPage(page)).toHaveClass(/theme-rose/);
      await page.reload();
      await expect(currentPage(page).locator('.title')).toHaveText('我们的设置');
      await assertDrafts(page, nickname, name);
      await expect(currentPage(page)).toHaveClass(/theme-rose/);
      const persisted = await request.get(`${api}/auth/me`, { headers: world.headers });
      expect(persisted.ok(), await persisted.text()).toBeTruthy();
      expect(await persisted.json()).toMatchObject({
        user: { nickname },
        space: { name, startDate: '2020-01-02', theme: 'rose' },
      });
      expect(world.errors).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: test.info().outputPath(`settings-${resource.replace('/', '-')}-retry-persisted.png`),
        fullPage: true,
      });
    } finally {
      gate.resolve();
      await Promise.allSettled(tasks);
      await page.unroute(`${api}/auth/me`, holdRead);
      await page.unroute(`${api}/${resource}`, failOnce);
    }
  });
}

test('uni H5 locks password fields while saving, keeps a failed draft, and clears it after retry', async ({
  page,
  world,
}) => {
  const gate = deferred();
  const captured = deferred();
  let attempts = 0;
  const savePassword = async (route: Route) => {
    if (!isPatch(route)) return route.continue();
    attempts += 1;
    if (attempts === 1) {
      captured.resolve();
      await gate.promise;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: '密码暂时无法更新，请重试' }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  };
  await page.route(`${api}/auth/password`, savePassword);
  try {
    await page.evaluate(
      () =>
        new Promise<void>((resolve, reject) =>
          (window as any).uni.navigateTo({
            url: '/pages/settings/index',
            success: () => resolve(),
            fail: reject,
          }),
        ),
    );
    const box = currentPage(page);
    await expect(box.locator('.title')).toHaveText('我们的设置');
    const values = {
      current: 'uni-private-test-123',
      next: 'uni-password-test-next',
    };
    await fill(box, '当前密码', values.current);
    await fill(box, '新密码', values.next);
    await fill(box, '再输入一次新密码', values.next);

    const request = page.waitForRequest(
      (entry) =>
        entry.url() === `${api}/auth/password` &&
        entry.method() === 'POST' &&
        entry.headers()['x-http-method-override'] === 'PATCH',
    );
    await press(box, '更新密码');
    await request;
    await captured.promise;
    const inputs = [
      field(box, '当前密码').locator('input').first(),
      field(box, '新密码').locator('input').first(),
      field(box, '再输入一次新密码').locator('input').first(),
    ];
    for (const input of inputs) await expect(input).toBeDisabled();

    const failure = page.waitForResponse(
      (response) => response.url() === `${api}/auth/password` && response.status() === 503,
    );
    gate.resolve();
    await failure;
    await expect(box.locator('.error-box')).toContainText('密码暂时无法更新');
    await expect(inputs[0]).toHaveValue(values.current);
    await expect(inputs[1]).toHaveValue(values.next);
    await expect(inputs[2]).toHaveValue(values.next);
    for (const input of inputs) await expect(input).toBeEnabled();

    const success = page.waitForResponse(
      (response) => response.url() === `${api}/auth/password` && response.status() === 200,
    );
    await press(box, '更新密码');
    await success;
    for (const input of inputs) await expect(input).toHaveValue('');
    expect(attempts).toBe(2);
    expect(world.errors).toEqual([]);
  } finally {
    gate.resolve();
    await page.unroute(`${api}/auth/password`, savePassword);
  }
});
