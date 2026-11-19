import { test, expect, type Page, type Locator, type Route } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readE2ESetupToken } from './setup-token.mts';

const api = 'http://127.0.0.1:3001/api';
const field = (box: Locator, label: string) =>
  box
    .locator('.el-form-item')
    .filter({ has: box.page().locator('.el-form-item__label').filter({ hasText: label }) })
    .first();
const dialog = (page: Page) => page.locator('.el-dialog:visible');
const fill = (box: Locator, label: string, value: string) =>
  field(box, label).locator('input,textarea').first().fill(value);
async function chartState(page: Page) {
  return page.evaluate(async () => {
    const runtime = performance
      .getEntriesByType('resource')
      .find((entry) => new URL(entry.name).pathname.endsWith('/echarts_core.js'));
    const element = document.querySelector('.growth-canvas .echarts-host');
    if (!runtime || !element) return null;
    const { getInstanceByDom } = await import(/* @vite-ignore */ runtime.name);
    const instance = getInstanceByDom(element);
    if (!instance) return null;
    const option = instance.getOption();
    return {
      dates: option.xAxis[0].data,
      values: option.series[0].data,
      unit: option.yAxis[0].name,
      width: instance.getWidth(),
    };
  });
}
async function series(page: Page) {
  const state = await chartState(page);
  return state && { dates: state.dates, values: state.values, unit: state.unit };
}

test('growth curves preserve same-day points and follow real edits, deletion and mobile resize', async ({
  page,
  request,
}) => {
  const marker = `growth-${randomUUID().slice(0, 8)}`;
  const statusResponse = await request.get(`${api}/auth/status`);
  expect(statusResponse.ok(), await statusResponse.text()).toBeTruthy();
  const status = await statusResponse.json();
  const signedIn = await request.post(`${api}/auth/${status.initialized ? 'login' : 'setup'}`, {
    data: {
      setupToken: status.initialized ? undefined : await readE2ESetupToken(),
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
  const originalResponse = await request.get(`${api}/baby`, { headers });
  expect(originalResponse.ok(), await originalResponse.text()).toBeTruthy();
  const original = await originalResponse.json();
  if (!original) {
    const created = await request.put(`${api}/baby`, { headers, data: { name: '小小禾' } });
    expect(created.ok(), await created.text()).toBeTruthy();
  }
  const ids = new Set<string>();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const isolate = async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    expect(response.ok(), await response.text()).toBeTruthy();
    const rows = await response.json();
    await route.fulfill({
      response,
      json: rows.filter((row: { title: string }) => row.title.startsWith(marker)),
    });
  };
  await page.route(`${api}/growth`, isolate);
  const seed = async (
    title: string,
    date: string,
    heightCm: number | null,
    weightKg: number | null,
    type = 'growth',
  ) => {
    const response = await request.post(`${api}/growth`, {
      headers,
      data: { title: `${marker}-${title}`, date, type, heightCm, weightKg },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const row = await response.json();
    ids.add(row.id);
    return row;
  };
  const open = async () => {
    await page.goto('/baby');
    await expect(page.getByRole('heading', { name: '宝宝成长', exact: true })).toBeVisible();
    await expect(page.locator('.el-skeleton')).toHaveCount(0);
    await expect(page.locator('.growth-chart')).toBeVisible();
  };
  const choose = (label: string) =>
    page.locator('.growth-chart .el-segmented__item').filter({ hasText: label }).click();
  const height = {
    dates: ['2026-10-01', '2026-11-02', '2026-11-02'],
    values: [55.2, 60, 60.5],
    unit: 'cm',
  };
  const weight = { dates: ['2026-11-02', '2026-11-03'], values: [6, 6.2], unit: 'kg' };
  try {
    await page.addInitScript((value) => localStorage.setItem('little-world-token', value), token);
    await open();
    await expect(page.locator('.growth-chart')).toContainText('还没有身高记录');
    await expect(page.locator('.growth-canvas')).toHaveCount(0);
    await seed('历史补录', '2026-10-01', 55.2, null);
    await open();
    await expect(page.locator('.growth-canvas canvas')).toBeVisible();
    await expect
      .poll(() => series(page))
      .toEqual({ dates: ['2026-10-01'], values: [55.2], unit: 'cm' });
    await expect(page.locator('.growth-chart')).toContainText('再添一条');
    await choose('体重');
    await expect(page.locator('.growth-chart')).toContainText('还没有体重记录');
    await seed('同日较早', '2026-11-02', 60, null, 'health');
    await seed('同日较晚', '2026-11-02', 60.5, 6);
    await seed('只填体重', '2026-11-03', null, 6.2);
    await open();
    await expect.poll(() => series(page)).toEqual(height);
    await expect(page.locator('.baby-measurements')).toContainText('60.5');
    await expect(page.locator('.baby-measurements')).toContainText('6.2');
    await page.getByRole('button', { name: '健康备注', exact: true }).click();
    await expect(page.locator('.growth-timeline article')).toHaveCount(1);
    await expect.poll(() => series(page)).toEqual(height);
    await page.getByRole('button', { name: '全部记录', exact: true }).click();
    await page.screenshot({ path: 'test-results/growth-web-desktop.png', fullPage: true });
    await choose('体重');
    await expect.poll(() => series(page)).toEqual(weight);
    // Use the real chart hit target to display its canvas-rendered tooltip.
    const hit = await page.evaluate(async () => {
      const runtime = performance
        .getEntriesByType('resource')
        .find((entry) => new URL(entry.name).pathname.endsWith('/echarts_core.js'))!;
      const { getInstanceByDom } = await import(/* @vite-ignore */ runtime.name);
      const element = document.querySelector('.growth-canvas .echarts-host')!;
      const chart = getInstanceByDom(element);
      const [x, y] = chart.convertToPixel({ seriesIndex: 0 }, [1, 6.2]);
      const rect = element.getBoundingClientRect();
      return { x: rect.x + x, y: rect.y + y };
    });
    await page.mouse.move(hit.x, hit.y);
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const runtime = performance
            .getEntriesByType('resource')
            .find((entry) => new URL(entry.name).pathname.endsWith('/echarts_core.js'))!;
          const { getInstanceByDom } = await import(/* @vite-ignore */ runtime.name);
          const instance = getInstanceByDom(document.querySelector('.growth-canvas .echarts-host'));
          return instance
            .getZr()
            .storage.getDisplayList()
            .filter((item: any) => item.type === 'tspan' && typeof item.style?.text === 'string')
            .map((item: any) => item.style.text)
            .join(' ');
        }),
      )
      .toContain('6.2 kg');
    await page.screenshot({ path: 'test-results/growth-web-tooltip.png' });
    await page
      .locator('.header-actions')
      .getByRole('button', { name: '记下成长', exact: true })
      .click();
    await fill(dialog(page), '标题', `${marker}-页面新增`);
    await fill(dialog(page), '日期', '2026-11-04');
    await field(dialog(page), '日期').locator('input').press('Tab');
    await fill(dialog(page), '体重（kg）', '6.3');
    const creating = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/growth') && response.request().method() === 'POST',
    );
    await dialog(page).getByRole('button', { name: '收藏这份成长', exact: true }).click();
    const created = await creating;
    expect(created.ok(), await created.text()).toBeTruthy();
    const row = await created.json();
    ids.add(row.id);
    await expect(dialog(page)).toHaveCount(0);
    await expect.poll(() => series(page)).toEqual(height);
    await expect(page.locator('.baby-measurements')).toContainText('6.3');
    await choose('体重');
    await expect
      .poll(() => series(page))
      .toEqual({ dates: [...weight.dates, '2026-11-04'], values: [6, 6.2, 6.3], unit: 'kg' });
    const card = page.locator('.growth-timeline article').filter({ hasText: `${marker}-页面新增` });
    await card.getByRole('button', { name: '编辑成长记录', exact: true }).click();
    await fill(dialog(page), '日期', '2026-11-01');
    await field(dialog(page), '日期').locator('input').press('Tab');
    await fill(dialog(page), '体重（kg）', '6.4');
    const editing = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/growth/${row.id}`) && response.request().method() === 'PATCH',
    );
    await dialog(page).getByRole('button', { name: '收藏这份成长', exact: true }).click();
    expect((await editing).ok()).toBeTruthy();
    await expect(dialog(page)).toHaveCount(0);
    await choose('体重');
    await expect
      .poll(() => series(page))
      .toEqual({ dates: ['2026-11-01', ...weight.dates], values: [6.4, 6, 6.2], unit: 'kg' });
    await expect(page.locator('.baby-measurements')).toContainText('6.2');
    await page.reload();
    await expect(page.locator('.el-skeleton')).toHaveCount(0);
    await expect.poll(() => series(page)).toEqual(height);
    await card.getByRole('button', { name: '删除成长记录', exact: true }).click();
    const deleting = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/api/growth/${row.id}`) &&
        response.request().method() === 'DELETE',
    );
    await page
      .locator('.el-message-box')
      .getByRole('button', { name: '删除', exact: true })
      .click();
    expect((await deleting).ok()).toBeTruthy();
    ids.delete(row.id);
    await expect(card).toHaveCount(0);
    await choose('体重');
    await expect.poll(() => series(page)).toEqual(weight);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expect
        .poll(async () => {
          const state = await chartState(page);
          const box = await page.locator('.growth-canvas').boundingBox();
          return (
            state &&
            box &&
            Math.abs(state.width - box.width) < 2 &&
            box.width > 150 &&
            box.width < width
          );
        })
        .toBeTruthy();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBeTruthy();
      expect(
        await page.locator('.baby-measurements small').evaluateAll((labels) =>
          labels.map((label) => {
            const range = document.createRange();
            range.selectNodeContents(label);
            return range.getClientRects().length;
          }),
        ),
        'Both latest-measurement labels must remain readable on one line',
      ).toEqual([1, 1]);
    }
    await page.screenshot({ path: 'test-results/growth-web-mobile.png', fullPage: true });
    await page.goto('/work');
    await open();
    await expect.poll(() => series(page)).toEqual(height);
    expect(errors).toEqual([]);
  } finally {
    await page.unroute(`${api}/growth`, isolate);
    for (const id of ids) {
      const response = await request.delete(`${api}/growth/${id}`, { headers });
      expect(response.ok(), await response.text()).toBeTruthy();
    }
  }
});
