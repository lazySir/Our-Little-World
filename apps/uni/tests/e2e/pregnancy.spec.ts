import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
  type Route,
} from '@playwright/test';
import { readE2ESetupToken } from '../../../../e2e/setup-token.mts';
import { resolve } from 'node:path';

const api = 'http://127.0.0.1:3002/api';
const pregnancyUrl = api + '/pregnancy';
const currentPage = (page: Page) => page.locator('.page:visible').last();
const sheet = (page: Page) => page.locator('.sheet:visible').last();
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

async function signIn(page: Page) {
  await page.goto('/#/pages/auth/index');
  await expect(page.locator('.title')).toHaveText('欢迎来到我们的小世界');
  const auth = page.locator('.auth-page');
  if (!(await field(auth, '小世界服务地址').isVisible()))
    await page.locator('.auth-bottom').filter({ hasText: '连接设置' }).click();
  await fill(auth, '小世界服务地址', api);
  const checking = page.waitForResponse(api + '/auth/status');
  await press(page, '保存地址并检查连接');
  const status = await checking;
  expect(status.ok(), await status.text()).toBeTruthy();
  const { initialized } = await status.json();
  const form = page.locator('.auth-form');
  await fill(form, '登录账号', 'uni_h5_owner');
  await fill(form, '密码', 'uni-private-test-123');
  if (!initialized) {
    await fill(form, '怎么称呼你', '小熊');
    await fill(form, '首次创建验证码', await readE2ESetupToken());
    await fill(form, '我们的小世界叫做', '孕期手记验收小屋');
  }
  const signingIn = page.waitForResponse(api + '/auth/' + (initialized ? 'login' : 'setup'));
  await press(page, initialized ? '回家啦' : '创建我们的小世界');
  const response = await signingIn;
  expect(response.ok(), await response.text()).toBeTruthy();
  const { token } = await response.json();
  await expect(currentPage(page).locator('.title')).toHaveText('今天，也在好好生活');
  await expect(currentPage(page).locator('.loading')).toHaveCount(0);
  return { Authorization: 'Bearer ' + token, token };
}

test.use({
  locale: 'zh-CN',
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 },
});

test('uni H5 pregnancy journal supports real login, create, edit, refresh, delete and mobile layout', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const { Authorization, token } = await signIn(page);
  const createdIds = new Set<string>();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const isolate = async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const upstream = await route.fetch();
    expect(upstream.ok(), await upstream.text()).toBeTruthy();
    const rows = await upstream.json();
    await route.fulfill({
      response: upstream,
      json: rows.filter((row: { id: string }) => createdIds.has(row.id)),
    });
  };

  await page.route(pregnancyUrl, isolate);
  try {
    await page.addInitScript((value) => localStorage.setItem('little-world-token', value), token);
    await page.goto('/#/pages/pregnancy/index');
    await expect(currentPage(page).locator('.title')).toHaveText('孕期手记');
    await expect(currentPage(page).locator('.loading')).toHaveCount(0);
    await expect(currentPage(page).locator('.empty-title')).toHaveText('这段日子还没有手记');

    await press(currentPage(page).locator('.toolbar'), '＋ 写一条');
    await expect(sheet(page)).toContainText('写下一条孕期手记');
    await fill(sheet(page), '标题', '第一次产检');
    await fill(sheet(page), '写点什么', '今天完成了第一次产检，想把这份心情留给以后。');
    await field(sheet(page), '记录类型').getByText('产检', { exact: true }).click();
    const fileChooserPromise = page.waitForEvent('filechooser');
    await press(sheet(page), '添加照片');
    const fileChooser = await fileChooserPromise;
    expect(fileChooser.isMultiple()).toBeTruthy();
    const uploads = Promise.all(
      Array.from({ length: 2 }, () =>
        page.waitForResponse(
          (response) =>
            response.url() === api + '/assets' && response.request().method() === 'POST',
        ),
      ),
    );
    await fileChooser.setFiles([
      resolve('docs/images/readme/web-calendar-desktop.jpg'),
      resolve('docs/images/readme/web-baby-album.jpg'),
    ]);
    for (const response of await uploads) expect(response.ok(), await response.text()).toBeTruthy();
    await expect(sheet(page).locator('.photo-wrap')).toHaveCount(2);
    const creating = page.waitForResponse(
      (response) => response.url() === pregnancyUrl && response.request().method() === 'POST',
    );
    await press(sheet(page), '保存这一刻');
    const createdResponse = await creating;
    expect(createdResponse.ok(), await createdResponse.text()).toBeTruthy();
    const created = await createdResponse.json();
    createdIds.add(created.id);
    expect(created).toMatchObject({ title: '第一次产检', type: 'checkup' });
    await expect(page.locator('.sheet:visible')).toHaveCount(0);
    const card = currentPage(page)
      .locator('.card')
      .filter({ hasText: '第一次产检' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('产检');
    await expect(card).toContainText('今天完成了第一次产检');
    const photos = card.locator('.photo-preview');
    await expect(photos).toHaveCount(2);
    await photos.nth(1).click();
    await expect(page.locator('#u-a-p > div')).toBeVisible();
    await expect(page.locator('#u-a-p uni-swiper-item')).toHaveCount(2);
    await page.locator('#u-a-p > div').click({ position: { x: 20, y: 20 } });
    await expect(page.locator('#u-a-p > div')).toHaveCount(0);
    const savedToast = page.getByText('已经好好记下啦', { exact: true });
    await expect(savedToast).toBeVisible();
    await expect(savedToast).toBeHidden({ timeout: 5000 });
    await page.setViewportSize({ width: 1280, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBeTruthy();
    await page.screenshot({ path: 'test-results/pregnancy-h5-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/pregnancy-h5-mobile-390.png', fullPage: true });

    await card.getByText('编辑', { exact: true }).click();
    await expect(sheet(page)).toContainText('编辑孕期手记');
    await fill(sheet(page), '写点什么', '复查结果很好，心情也更踏实了。');
    await field(sheet(page), '记录类型').getByText('心情', { exact: true }).click();
    const editing = page.waitForResponse(
      (response) =>
        response.url() === pregnancyUrl + '/' + created.id &&
        response.request().method() === 'POST' &&
        response.request().headers()['x-http-method-override'] === 'PATCH',
    );
    await press(sheet(page), '保存这一刻');
    const editedResponse = await editing;
    expect(editedResponse.ok(), await editedResponse.text()).toBeTruthy();
    expect(await editedResponse.json()).toMatchObject({ id: created.id, type: 'mood' });
    await expect(page.locator('.sheet:visible')).toHaveCount(0);
    await expect(card).toContainText('心情');
    await expect(card).toContainText('复查结果很好');

    const refreshed = page.waitForResponse(
      (response) => response.url() === pregnancyUrl && response.request().method() === 'GET',
    );
    await page.reload();
    const refreshResponse = await refreshed;
    expect(refreshResponse.ok(), await refreshResponse.text()).toBeTruthy();
    await expect(currentPage(page).locator('.loading')).toHaveCount(0);
    const persisted = currentPage(page).locator('.card').filter({ hasText: '第一次产检' });
    await expect(persisted).toContainText('心情');
    await expect(persisted).toContainText('复查结果很好');

    const deleting = page.waitForResponse(
      (response) =>
        response.url() === pregnancyUrl + '/' + created.id &&
        response.request().method() === 'DELETE',
    );
    await persisted.getByText('删除', { exact: true }).click();
    await page.getByText('确定', { exact: true }).last().click();
    const deletedResponse = await deleting;
    expect(deletedResponse.ok(), await deletedResponse.text()).toBeTruthy();
    createdIds.delete(created.id);
    await expect(persisted).toHaveCount(0);
    await expect(currentPage(page).locator('.empty-title')).toHaveText('这段日子还没有手记');

    await page.setViewportSize({ width: 320, height: 740 });
    await expect(currentPage(page).locator('.title')).toHaveText('孕期手记');
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBeTruthy();
    await page.screenshot({ path: 'test-results/pregnancy-h5-mobile-320.png', fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await page.unroute(pregnancyUrl, isolate);
    for (const id of createdIds) {
      const response = await request.delete(pregnancyUrl + '/' + id, {
        headers: { Authorization },
      });
      expect([200, 404]).toContain(response.status());
    }
  }
});
