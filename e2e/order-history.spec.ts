import { test, expect, type Route } from '@playwright/test';

test('an actual old order snapshot cannot replace the history refreshed after creating an order', async ({
  page,
  request,
}) => {
  const apiBase = 'http://127.0.0.1:3001/api';
  const marker = `order-history-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const name = `${marker} 两个人的晚餐`;
  const note = `${marker} 新点单不能被旧刷新抹掉`;
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
  const headers = { Authorization: `Bearer ${token}` };
  const created = await request.post(`${apiBase}/menu`, {
    headers,
    data: { name, category: 'dish', priceCents: 1815 },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const dish = await created.json();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let releaseOld!: () => void;
  const gate = new Promise<void>((resolve) => (releaseOld = resolve));
  let snapshotCaptured!: () => void;
  const captured = new Promise<void>((resolve) => (snapshotCaptured = resolve));
  let reads = 0;
  let oldRows: any[] = [];
  const tasks: Promise<void>[] = [];
  const handler = (route: Route) => {
    const task = (async () => {
      if (route.request().method() !== 'GET') return route.continue();
      const sequence = ++reads;
      const response = await route.fetch();
      expect(response.ok(), await response.text()).toBeTruthy();
      if (sequence === 1) {
        oldRows = await response.json();
        snapshotCaptured();
        await gate;
      }
      await route.fulfill({ response });
    })();
    tasks.push(task);
    return task;
  };
  try {
    await page.addInitScript((value) => localStorage.setItem('little-world-token', value), token);
    await page.route('**/api/orders', handler);
    await page.goto('/meals');
    await expect(page.getByRole('heading', { name: '今天吃什么', exact: true })).toBeVisible();
    await expect(page.locator('.el-skeleton')).toHaveCount(0);
    await captured;
    expect(oldRows.some((order) => order.note === note)).toBe(false);
    const card = page.locator('article').filter({ hasText: name });
    await expect(card).toHaveCount(1);
    await card.getByRole('button', { name: '加入购物篮', exact: true }).click();
    await page
      .locator('.header-actions')
      .getByRole('button', { name: /购物篮/ })
      .click();
    const basket = page.locator('.el-dialog:visible');
    await basket.getByPlaceholder('给今晚留一句备注，例如：记得加辣').fill(note);
    const posted = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/orders') && response.request().method() === 'POST',
    );
    const refreshed = page.waitForResponse(
      (response) => response.url().endsWith('/api/orders') && response.request().method() === 'GET',
    );
    await basket.getByRole('button', { name: '一起下单', exact: true }).click();
    const saved = await posted;
    expect(saved.ok(), await saved.text()).toBeTruthy();
    const order = await saved.json();
    const latest = await refreshed;
    expect(latest.ok(), await latest.text()).toBeTruthy();
    expect((await latest.json()).some((entry) => entry.id === order.id)).toBe(true);
    await expect(basket).toHaveCount(0);
    const row = page.locator(`.order-row[data-order-id="${order.id}"]`);
    await expect(row).toContainText(name);
    await expect(row).toContainText(note);
    const oldReturned = page.waitForResponse(
      (response) => response.url().endsWith('/api/orders') && response.request().method() === 'GET',
    );
    releaseOld();
    const replayed = await oldReturned;
    expect((await replayed.json()).some((entry) => entry.id === order.id)).toBe(false);
    await page.waitForLoadState('networkidle');
    await expect(row).toContainText(note);
    await expect(row).toContainText('等开饭');
    await expect(row).toHaveCount(1);
    expect(reads).toBe(2);
    await page.unroute('**/api/orders', handler);
    await page.reload();
    await expect(page.locator('.el-skeleton')).toHaveCount(0);
    await expect(row).toContainText(note);
    const persisted = await request.get(`${apiBase}/orders`, { headers });
    expect(persisted.ok()).toBeTruthy();
    const matching = (await persisted.json()).filter((entry) => entry.note === note);
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({
      id: order.id,
      status: 'pending',
      totalCents: 1815,
      note,
      items: [{ menuItemId: dish.id, name, quantity: 1, priceCents: 1815 }],
    });
    await expect(page.locator('.el-message--error')).toHaveCount(0);
    expect(errors).toEqual([]);
    await page.screenshot({
      path: 'test-results/web-order-history-stale-after-create.png',
      fullPage: true,
    });
  } finally {
    releaseOld();
    await Promise.allSettled(tasks);
    await page.unroute('**/api/orders', handler);
    const orders = await request.get(`${apiBase}/orders`, { headers });
    if (orders.ok())
      for (const order of (await orders.json()).filter((entry) => entry.note === note)) {
        const removed = await request.delete(`${apiBase}/orders/${order.id}`, { headers });
        expect(removed.ok(), await removed.text()).toBeTruthy();
      }
    const removed = await request.delete(`${apiBase}/menu/${dish.id}`, { headers });
    expect(removed.ok(), await removed.text()).toBeTruthy();
  }
});
