import { test as base, expect, type Page, type Locator, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { readE2ESetupToken } from '../../../../e2e/setup-token.mts';

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
    await fill(page.locator('.auth-form'), '首次创建验证码', await readE2ESetupToken());
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
      for (const resource of ['orders', 'menu']) {
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
async function createMenu(
  request: import('@playwright/test').APIRequestContext,
  headers: Record<string, string>,
  name: string,
  priceCents: number,
) {
  const response = await request.post(`${api}/menu`, {
    headers,
    data: { name, category: 'dish', priceCents },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  return response.json();
}
async function removeMenu(page: Page, name: string, id: string) {
  await page.locator('.card').filter({ hasText: name }).getByText('编辑', { exact: true }).click();
  await sheet(page).getByText('删除这项菜单', { exact: true }).click();
  await expect(page.getByText('再确认一下', { exact: true })).toBeVisible();
  await expect(page.locator('uni-modal:visible')).toHaveCSS('opacity', '1');
  const confirmButton = page.getByText('确定', { exact: true }).last();
  const layers = await confirmButton.evaluate((button) => {
    const describe = (node: Element) => {
      const style = getComputedStyle(node);
      return {
        tag: node.tagName,
        className: node.className,
        position: style.position,
        zIndex: style.zIndex,
        opacity: style.opacity,
      };
    };
    const ancestors = [];
    for (let node: Element | null = button; node; node = node.parentElement)
      ancestors.push(describe(node));
    const bounds = button.getBoundingClientRect();
    const hit = document.elementFromPoint(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2,
    );
    return {
      ancestors,
      hit: hit ? describe(hit) : null,
      popups: Array.from(
        document.querySelectorAll(
          'uni-modal,.uni-mask,.uni-modal,.uni-modal__mask,.wd-popup,.wd-overlay',
        ),
      ).map(describe),
    };
  });
  await test.info().attach(`menu-delete-confirmation-${id}`, {
    body: JSON.stringify(layers, null, 2),
    contentType: 'application/json',
  });
  await writeFile(
    test.info().outputPath(`menu-delete-layers-${id}.json`),
    JSON.stringify(layers, null, 2),
  );
  await page.screenshot({
    path: test.info().outputPath(`menu-delete-confirmation-${id}.png`),
    fullPage: true,
  });
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.url() === `${api}/menu/${id}` && response.request().method() === 'DELETE',
    ),
    confirmButton.click(),
  ]);
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator('.loading')).toHaveCount(0);
  await expect(page.locator('.card').filter({ hasText: name })).toHaveCount(0);
}
async function assertHealthy(page: Page, errors: string[]) {
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test('uni H5 menu deletion keeps surviving basket quantities and total until the last selection is deleted', async ({
  page,
  request,
  world,
}) => {
  const firstName = `番茄面 ${world.marker}`;
  const secondName = `热汤 ${world.marker}`;
  const first = await createMenu(request, world.headers, firstName, 1250);
  const second = await createMenu(request, world.headers, secondName, 825);
  await visit(page, 'menu', '今天吃什么');
  const firstCard = page.locator('.card').filter({ hasText: firstName });
  const secondCard = page.locator('.card').filter({ hasText: secondName });
  for (let quantity = 0; quantity < 2; quantity++)
    await firstCard.locator('.quantity-btn').last().click();
  for (let quantity = 0; quantity < 3; quantity++)
    await secondCard.locator('.quantity-btn').last().click();
  const cart = page.locator('.sticky-cart');
  await fill(cart, '给这一单留个备注', `保留这一单 ${world.marker}`);
  await expect(cart).toContainText('这一顿 · 5 份');
  await expect(cart).toContainText('¥49.75');
  await firstCard.getByText('编辑', { exact: true }).click();
  await sheet(page).getByText('删除这项菜单', { exact: true }).click();
  await expect(page.getByText('再确认一下', { exact: true })).toBeVisible();
  await page.getByText('取消', { exact: true }).last().click();
  await expect(page.locator('uni-modal:visible')).toHaveCount(0);
  await expect(sheet(page)).toBeVisible();
  await expect(firstCard).toHaveCount(1);
  await expect(firstCard.locator('.quantity')).toHaveText(/−\s*2\s*＋/);
  await expect(secondCard.locator('.quantity')).toHaveText(/−\s*3\s*＋/);
  await expect(cart).toContainText('这一顿 · 5 份');
  await expect(cart).toContainText('¥49.75');
  const afterCancel = await request.get(`${api}/menu`, { headers: world.headers });
  expect(afterCancel.ok(), await afterCancel.text()).toBeTruthy();
  expect((await afterCancel.json()).some((item: { id: string }) => item.id === first.id)).toBe(
    true,
  );
  await press(sheet(page), '先放一放');
  await expect(sheet(page)).toHaveCount(0);
  await removeMenu(page, firstName, first.id);
  await expect(cart).toContainText('这一顿 · 3 份');
  await expect(cart).toContainText('¥24.75');
  await expect(secondCard.locator('.quantity')).toHaveText(/−\s*3\s*＋/);
  await expect(field(cart, '给这一单留个备注').locator('input')).toHaveValue(
    `保留这一单 ${world.marker}`,
  );
  await assertHealthy(page, world.errors);
  await page.screenshot({
    path: test.info().outputPath('basket-after-menu-deletion.png'),
    fullPage: true,
  });
  await removeMenu(page, secondName, second.id);
  await expect(cart).toHaveCount(0);
  await assertHealthy(page, world.errors);
  await page.screenshot({
    path: test.info().outputPath('basket-after-last-deletion.png'),
    fullPage: true,
  });
});

for (const action of ['create', 'complete', 'delete'] as const) {
  test(`uni H5 ignores an actual old order snapshot delivered after a real ${action}`, async ({
    page,
    request,
    world,
  }) => {
    const foodName = `一起开饭 ${world.marker}`;
    const food = await createMenu(request, world.headers, foodName, 1234);
    const note = `本次点单 ${world.marker}`;
    let orderId = '';
    if (action !== 'create') {
      const seeded = await request.post(`${api}/orders`, {
        headers: world.headers,
        data: { items: [{ menuItemId: food.id, quantity: 2 }], note, status: 'pending' },
      });
      expect(seeded.ok(), await seeded.text()).toBeTruthy();
      orderId = (await seeded.json()).id;
    }
    await visit(page, 'menu', '今天吃什么');
    const orderCard = page
      .locator('.card')
      .filter({ has: page.locator('.card-text').filter({ hasText: note }) });
    if (action !== 'create') await expect(orderCard).toContainText('等着开饭');
    else {
      const foodCard = page.locator('.card').filter({ hasText: foodName });
      await foodCard.locator('.quantity-btn').last().click();
      await foodCard.locator('.quantity-btn').last().click();
      await fill(page.locator('.sticky-cart'), '给这一单留个备注', note);
    }
    const gate = deferred();
    const captured = deferred();
    const tasks: Promise<void>[] = [];
    let held = false;
    let snapshot: { id: string; status: string; note: string }[] = [];
    const intercept = (route: Route) => {
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
    await page.route(`${api}/orders`, intercept);
    try {
      // Real uni navigation returns to the same menu instance and invokes its onShow hooks.
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
      await expect(page.locator('.title').last()).toHaveText('我们的设置');
      await page.evaluate(
        () =>
          new Promise<void>((resolve, reject) =>
            (window as any).uni.navigateBack({ success: () => resolve(), fail: reject }),
          ),
      );
      await expect(page.locator('.title')).toHaveText('今天吃什么');
      await captured.promise;
      await expect(page.locator('.loading')).toHaveCount(0);
      if (action === 'create') expect(snapshot.some((order) => order.note === note)).toBe(false);
      else expect(snapshot.find((order) => order.id === orderId)?.status).toBe('pending');
      const newer = page.waitForResponse(
        (response) => response.url() === `${api}/orders` && response.request().method() === 'GET',
      );
      if (action === 'create') {
        const created = page.waitForResponse(
          (response) =>
            response.url() === `${api}/orders` && response.request().method() === 'POST',
        );
        await press(page, '提交点单');
        const response = await created;
        expect(response.ok(), await response.text()).toBeTruthy();
        orderId = (await response.json()).id;
      } else if (action === 'complete') {
        await orderCard.getByText('✓ 完成这单', { exact: true }).click();
      } else {
        await orderCard.getByText('删除', { exact: true }).click();
        await expect(page.getByText('再确认一下', { exact: true })).toBeVisible();
        await page.getByText('确定', { exact: true }).last().click();
      }
      const fresh = await newer;
      expect(fresh.ok(), await fresh.text()).toBeTruthy();
      const latest = await fresh.json();
      if (action === 'delete') {
        expect(latest.some((order: { id: string }) => order.id === orderId)).toBe(false);
        await expect(orderCard).toHaveCount(0);
      } else {
        expect(latest.find((order: { id: string }) => order.id === orderId)).toMatchObject({
          status: action === 'create' ? 'pending' : 'done',
        });
        await expect(orderCard).toContainText(action === 'create' ? '等着开饭' : '已经吃好啦');
      }
      const oldResponse = page.waitForResponse(
        (response) => response.url() === `${api}/orders` && response.request().method() === 'GET',
      );
      gate.resolve();
      const delivered = await oldResponse;
      await delivered.finished();
      expect(await delivered.json()).toEqual(snapshot);
      await frames(page);
      if (action === 'delete') await expect(orderCard).toHaveCount(0);
      else await expect(orderCard).toContainText(action === 'create' ? '等着开饭' : '已经吃好啦');
      const persisted = await request.get(`${api}/orders`, { headers: world.headers });
      expect(persisted.ok(), await persisted.text()).toBeTruthy();
      expect(await persisted.json()).toEqual(latest);
      await assertHealthy(page, world.errors);
      await page.screenshot({
        path: test.info().outputPath(`orders-after-stale-${action}.png`),
        fullPage: true,
      });
    } finally {
      gate.resolve();
      await Promise.allSettled(tasks);
      await page.unroute(`${api}/orders`, intercept);
    }
  });
}
