import { test, expect, type Route } from '@playwright/test';

test('a completed wish converts once through a delayed failure and real retry on a small phone', async ({
  page,
  request,
}) => {
  const apiBase = 'http://127.0.0.1:3001/api';
  const marker = `wish-conversion-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const title = `${marker} 一起看海边日落`;
  const description = `${marker} 把完成的心愿好好收藏`;
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
  const created = await request.post(`${apiBase}/wishes`, {
    headers,
    data: { title, description, category: 'travel', status: 'todo' },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const wish = await created.json();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let releaseFailure!: () => void;
  let releaseRetry!: () => void;
  const failureGate = new Promise<void>((resolve) => (releaseFailure = resolve));
  const retryGate = new Promise<void>((resolve) => (releaseRetry = resolve));
  let firstStarted!: () => void;
  let retryStarted!: () => void;
  const firstPending = new Promise<void>((resolve) => (firstStarted = resolve));
  const retryPending = new Promise<void>((resolve) => (retryStarted = resolve));
  let postAttempts = 0;
  const tasks: Promise<void>[] = [];
  const handler = (route: Route) => {
    const task = (async () => {
      if (route.request().method() !== 'POST') return route.continue();
      postAttempts++;
      if (postAttempts === 1) {
        firstStarted();
        await failureGate;
        await route.fulfill({ status: 503, json: { message: '回忆保存暂时中断，请重试' } });
      } else {
        retryStarted();
        await retryGate;
        const response = await route.fetch();
        await route.fulfill({ response });
      }
    })();
    tasks.push(task);
    return task;
  };
  try {
    await page.addInitScript((value) => localStorage.setItem('little-world-token', value), token);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/wishes');
    await expect(page.getByRole('heading', { name: '一起做', exact: true })).toBeVisible();
    await expect(page.locator('.el-skeleton')).toHaveCount(0);
    await page.getByPlaceholder('搜索愿望').fill(marker);
    const card = page.locator('article').filter({ hasText: title });
    await expect(card).toHaveCount(1);
    const completed = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/wishes/${wish.id}`) &&
        response.request().method() === 'PATCH',
    );
    await card.getByRole('button', { name: '标记完成', exact: true }).click();
    expect((await completed).ok()).toBeTruthy();
    await expect(card).toContainText('已完成');
    const convert = card.getByRole('button', { name: '收藏为回忆', exact: true });
    await expect(convert).toBeVisible();
    await page.route('**/api/memories', handler);
    await convert.dblclick();
    await firstPending;
    await expect(convert).toBeDisabled();
    await expect(convert).toHaveClass(/is-loading/);
    await expect(convert.locator('.is-loading')).toBeVisible();
    expect(postAttempts).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({
      path: 'test-results/web-wish-conversion-pending-mobile.png',
      fullPage: true,
    });
    const beforeRetry = await request.get(`${apiBase}/memories`, { headers });
    expect(beforeRetry.ok()).toBeTruthy();
    expect((await beforeRetry.json()).filter((memory) => memory.title === title)).toHaveLength(0);
    releaseFailure();
    await expect(page.locator('.el-message--error')).toContainText('回忆保存暂时中断，请重试');
    await expect(convert).toBeEnabled();
    await expect(convert).not.toHaveClass(/is-loading/);
    await expect(card).toContainText(title);
    await expect(card).toContainText(description);
    await convert.dblclick();
    await retryPending;
    await expect(convert).toBeDisabled();
    await expect(convert).toHaveClass(/is-loading/);
    expect(postAttempts).toBe(2);
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/memories') &&
        response.request().method() === 'POST' &&
        response.ok(),
    );
    releaseRetry();
    expect((await saved).ok()).toBeTruthy();
    await expect(page.getByText('已把完成的愿望收藏为回忆', { exact: true })).toHaveCount(1);
    await expect(convert).toBeEnabled();
    await expect(convert).not.toHaveClass(/is-loading/);
    expect(postAttempts).toBe(2);
    const memories = await request.get(`${apiBase}/memories`, { headers });
    expect(memories.ok()).toBeTruthy();
    const matching = (await memories.json()).filter((memory) => memory.title === title);
    expect(matching).toHaveLength(1);
    expect(matching[0]).toMatchObject({
      title,
      content: description,
      kind: 'couple',
      tags: ['愿望实现'],
      assetIds: [],
    });
    await page.goto('/memories');
    await expect(page.locator('.el-skeleton')).toHaveCount(0);
    await page.getByPlaceholder('搜索回忆').fill(marker);
    await expect(page.locator('article').filter({ hasText: title })).toHaveCount(1);
    await page.reload();
    await expect(page.locator('.el-skeleton')).toHaveCount(0);
    await page.getByPlaceholder('搜索回忆').fill(marker);
    await expect(page.locator('article').filter({ hasText: title })).toHaveCount(1);
    expect(errors).toEqual([]);
  } finally {
    releaseFailure();
    releaseRetry();
    await Promise.allSettled(tasks);
    await page.unroute('**/api/memories', handler);
    const memories = await request.get(`${apiBase}/memories`, { headers });
    if (memories.ok())
      for (const memory of (await memories.json()).filter((memory) => memory.title === title)) {
        const removed = await request.delete(`${apiBase}/memories/${memory.id}`, { headers });
        expect(removed.ok(), await removed.text()).toBeTruthy();
      }
    const removed = await request.delete(`${apiBase}/wishes/${wish.id}`, { headers });
    expect(removed.ok(), await removed.text()).toBeTruthy();
  }
});
