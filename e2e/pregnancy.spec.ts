import { test, expect, type APIRequestContext, type Locator, type Route } from '@playwright/test';
import { readE2ESetupToken } from './setup-token.mts';
import { resolve } from 'node:path';

const api = 'http://127.0.0.1:3001/api';

const formItem = (box: Locator, label: string) =>
  box
    .locator('.el-form-item')
    .filter({ has: box.page().locator('.el-form-item__label').filter({ hasText: label }) })
    .first();

const fill = (box: Locator, label: string, value: string) =>
  formItem(box, label).locator('input,textarea').first().fill(value);

async function signIn(request: APIRequestContext) {
  const statusResponse = await request.get(`${api}/auth/status`);
  expect(statusResponse.ok(), await statusResponse.text()).toBeTruthy();
  const status = await statusResponse.json();
  const response = await request.post(`${api}/auth/${status.initialized ? 'login' : 'setup'}`, {
    data: {
      setupToken: status.initialized ? undefined : await readE2ESetupToken(),
      username: 'web_owner',
      password: 'little-world-e2e-123',
      nickname: '小林',
      spaceName: '小林与小禾的小世界',
      startDate: '2024-02-29',
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const { token } = await response.json();
  return { Authorization: `Bearer ${token}`, token };
}

test('web pregnancy journal supports real login, create, edit, refresh, delete and mobile layout', async ({
  page,
  request,
}) => {
  test.setTimeout(120000);
  const { Authorization } = await signIn(request);
  await page.goto('/auth');
  await expect(page.locator('.auth-card .el-skeleton')).toHaveCount(0);
  const auth = page.locator('.auth-card');
  await fill(auth, '账号', 'web_owner');
  await fill(auth, '密码', 'little-world-e2e-123');
  const signingIn = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/auth/login') && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '回到小世界', exact: true }).click();
  const loginResponse = await signingIn;
  expect(loginResponse.ok(), await loginResponse.text()).toBeTruthy();
  await expect(page.getByRole('heading', { name: '平凡日子，也闪闪发光' })).toBeVisible();
  const token = await page.evaluate(() => localStorage.getItem('little-world-token'));
  expect(token).toBeTruthy();
  const createdIds = new Set<string>();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const isolate = async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBeTruthy();
    const rows = await response.json();
    await route.fulfill({
      response,
      json: rows.filter((row: { id: string }) => createdIds.has(row.id)),
    });
  };

  await page.route(`${api}/pregnancy`, isolate);
  try {
    await page.addInitScript((value) => localStorage.setItem('little-world-token', value), token);
    await page.goto('/pregnancy');
    await expect(page.getByRole('heading', { name: '孕期手记', exact: true })).toBeVisible();
    await expect(page.locator('.el-skeleton')).toHaveCount(0);
    await expect(page.locator('.empty-state')).toContainText('这段日子还没有手记');
    await page.getByRole('button', { name: /^心情/ }).click();
    await expect(page.locator('.empty-state')).toContainText('没有找到匹配的记录');
    await page.locator('.empty-state').getByRole('button', { name: '清除筛选' }).click();
    await expect(page.locator('.empty-state')).toContainText('这段日子还没有手记');
    await expect(page.locator('.empty-state').getByRole('button', { name: '写一条手记' })).toBeVisible();

    await page
      .locator('.page-header .header-actions')
      .getByRole('button', { name: '写一条手记', exact: true })
      .click();
    const dialog = page.locator('.el-dialog:visible');
    await expect(dialog).toContainText('写一条手记');
    await fill(dialog, '标题', '第一次产检');
    await fill(dialog, '写点什么', '今天完成了第一次产检，想把这份心情留给以后。');
    await formItem(dialog, '记录类型').locator('.el-select').click();
    await page.getByRole('option', { name: '产检', exact: true }).click();
    const uploads = Promise.all(
      Array.from({ length: 2 }, () =>
        page.waitForResponse(
          (response) =>
            response.url().endsWith('/api/assets') && response.request().method() === 'POST',
        ),
      ),
    );
    await dialog.locator('.photo-uploader input[type="file"]').setInputFiles([
      resolve('docs/images/readme/web-calendar-desktop.jpg'),
      resolve('docs/images/readme/web-baby-album.jpg'),
    ]);
    for (const response of await uploads) expect(response.ok(), await response.text()).toBeTruthy();
    await expect(dialog.locator('.upload-photo')).toHaveCount(2);
    const creating = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/pregnancy') && response.request().method() === 'POST',
    );
    await dialog.getByRole('button', { name: '保存到小世界', exact: true }).click();
    const createdResponse = await creating;
    expect(createdResponse.ok(), await createdResponse.text()).toBeTruthy();
    const created = await createdResponse.json();
    createdIds.add(created.id);
    expect(created).toMatchObject({ title: '第一次产检', type: 'checkup' });
    await expect(dialog).toHaveCount(0);

    const card = page.locator('article.record-card').filter({ hasText: '第一次产检' });
    await expect(card).toBeVisible();
    await expect(card).toContainText('第一次产检');
    await expect(card).toContainText('今天完成了第一次产检');
    const photos = card.locator('.photos-grid .el-image');
    await expect(photos).toHaveCount(2);
    const secondPhoto = await photos.nth(1).locator('img').getAttribute('src');
    await photos.nth(1).click();
    const viewer = page.locator('.el-image-viewer__wrapper');
    await expect(viewer).toBeVisible();
    await expect(viewer.locator('.el-image-viewer__img')).toHaveAttribute('src', secondPhoto!);
    await page.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);
    await page.screenshot({ path: 'test-results/pregnancy-web-desktop.png', fullPage: true });

    await card.getByTitle('编辑').click();
    await expect(page.locator('.el-dialog:visible')).toContainText('编辑记录');
    const editDialog = page.locator('.el-dialog:visible');
    await fill(editDialog, '写点什么', '复查结果很好，心情也更踏实了。');
    await formItem(editDialog, '记录类型').locator('.el-select').click();
    await page.getByRole('option', { name: '心情', exact: true }).click();
    const editing = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/pregnancy/${created.id}`) &&
        response.request().method() === 'PATCH',
    );
    await editDialog.getByRole('button', { name: '保存到小世界', exact: true }).click();
    const editedResponse = await editing;
    expect(editedResponse.ok(), await editedResponse.text()).toBeTruthy();
    expect(await editedResponse.json()).toMatchObject({ id: created.id, type: 'mood' });
    await expect(page.locator('.el-dialog:visible')).toHaveCount(0);
    await expect(card).toContainText('心情');
    await expect(card).toContainText('复查结果很好');

    const refreshed = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/pregnancy') && response.request().method() === 'GET',
    );
    await page.reload();
    expect((await refreshed).ok()).toBeTruthy();
    await expect(page.locator('.el-skeleton')).toHaveCount(0);
    const persisted = page.locator('article.record-card').filter({ hasText: '第一次产检' });
    await expect(persisted).toContainText('心情');
    await expect(persisted).toContainText('复查结果很好');

    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBeTruthy();
    await page.screenshot({ path: 'test-results/pregnancy-web-mobile.png', fullPage: true });

    const deleting = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/pregnancy/${created.id}`) &&
        response.request().method() === 'DELETE',
    );
    await persisted.getByTitle('删除').click();
    await page
      .locator('.el-message-box:visible')
      .getByRole('button', { name: '删除', exact: true })
      .click();
    const deletedResponse = await deleting;
    expect(deletedResponse.ok(), await deletedResponse.text()).toBeTruthy();
    createdIds.delete(created.id);
    await expect(persisted).toHaveCount(0);
    await expect(page.locator('.empty-state')).toContainText('这段日子还没有手记');

    expect(errors).toEqual([]);
  } finally {
    await page.unroute(`${api}/pregnancy`, isolate);
    for (const id of createdIds) {
      const response = await request.delete(`${api}/pregnancy/${id}`, {
        headers: { Authorization },
      });
      expect([200, 404]).toContain(response.status());
    }
  }
});
