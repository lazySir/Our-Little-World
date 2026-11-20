import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
  type Route,
} from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readE2ESetupToken } from '../../../../e2e/setup-token.mts';

const api = 'http://127.0.0.1:3002/api';
const growthUrl = `${api}/growth`;
const currentPage = (page: Page) => page.locator('.page:visible').last();
const chart = (page: Page) => currentPage(page).locator('.growth-chart');
const sheet = (page: Page) => page.locator('.sheet:visible').last();
const field = (box: Locator, label: string) =>
  box
    .locator('.form-field')
    .filter({ has: box.page().locator('.form-label').filter({ hasText: label }) })
    .first();
const fill = (box: Locator, label: string, value: string) =>
  field(box, label).locator('input,textarea').first().fill(value);

type Measurement = {
  id: string;
  title: string;
  date: string;
  type: 'growth' | 'health' | 'milestone';
  heightCm: number | null;
  weightKg: number | null;
  createdAt: string;
};
type Point = { date: string; value: number };
type ChartSnapshot = {
  dates: string[];
  values: number[];
  width: number;
  height: number;
  point: number[] | null;
  tooltip: { shown: boolean; text: string };
};

async function press(box: Page | Locator, text: string) {
  const button = box.locator('uni-button:visible').filter({ hasText: text });
  await (
    (await button.count()) ? button.last() : box.getByText(text, { exact: true }).last()
  ).click();
}

// Use the real form so uni's storage encoding and session initialization are exercised.
async function signIn(page: Page) {
  await page.goto('/#/pages/auth/index');
  await expect(page.locator('.title')).toHaveText('欢迎来到我们的小世界');
  const auth = page.locator('.auth-page');
  if (!(await field(auth, '小世界服务地址').isVisible()))
    await page.locator('.auth-bottom').filter({ hasText: '连接设置' }).click();
  await fill(auth, '小世界服务地址', api);
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
    await fill(page.locator('.auth-form'), '我们的小世界叫做', '成长曲线回归的小屋');
  }
  const signingIn = page.waitForResponse(`${api}/auth/${initialized ? 'login' : 'setup'}`);
  await press(page, initialized ? '回家啦' : '创建我们的小世界');
  const response = await signingIn;
  expect(response.ok(), await response.text()).toBeTruthy();
  const { token } = await response.json();
  expect(token).toEqual(expect.any(String));
  await expect(currentPage(page).locator('.title')).toHaveText('今天，也在好好生活');
  await expect(currentPage(page).locator('.loading')).toHaveCount(0);
  return { Authorization: `Bearer ${token}` };
}

async function records(request: APIRequestContext, headers: Record<string, string>) {
  const response = await request.get(growthUrl, { headers });
  expect(response.ok(), await response.text()).toBeTruthy();
  return (await response.json()) as Measurement[];
}

async function openBaby(page: Page) {
  await page.goto('/#/pages/baby/index');
  await expect(currentPage(page).locator('.title')).toHaveText('宝宝成长');
  await expect(currentPage(page).locator('.loading')).toHaveCount(0);
  await expect(currentPage(page).locator('.error-box')).toHaveCount(0);
  await expect(chart(page).getByText('成长曲线', { exact: true })).toBeVisible();
}

async function refresh(page: Page) {
  const reading = page.waitForResponse(
    (response) => response.url() === growthUrl && response.request().method() === 'GET',
  );
  await page.reload();
  const response = await reading;
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect(currentPage(page).locator('.loading')).toHaveCount(0);
  await expect(chart(page)).toBeVisible();
}

async function selectMetric(page: Page, label: '身高（cm）' | '体重（kg）') {
  const item = chart(page).locator('.wd-segmented__item').filter({ hasText: label });
  await item.click();
  await expect(item).toHaveClass(/is-active/);
}

// Read UniEcharts' existing public exposure, never a production-only testing hook.
// Its root <view> can belong to a uni host component, so walk Vue's parent chain.
async function readChart(page: Page, pointIndex = 0): Promise<ChartSnapshot | null> {
  return chart(page)
    .locator('.uni-echarts')
    .evaluate((root, index) => {
      let component = (root as any).__vueParentComponent;
      while (component) {
        const exposed = component.exposed;
        if (typeof exposed?.getOption === 'function') {
          try {
            const option = exposed.getOption();
            const series = option.series?.[0];
            if (!series || !option.xAxis?.[0]) return null;
            const values = (series.data || []).map((value: any) =>
              typeof value === 'number' ? value : value.value,
            );
            const instance = exposed.chart?.value || exposed.chart;
            const tooltipModel = instance?.getModel?.().getComponent('tooltip');
            const tooltipView = tooltipModel && instance.getViewOfComponentModel(tooltipModel);
            const tooltipContent = tooltipView?._tooltipContent;
            return {
              dates: option.xAxis[0].data,
              values,
              width: exposed.getWidth(),
              height: exposed.getHeight(),
              point:
                values[index] == null
                  ? null
                  : exposed.convertToPixel({ seriesIndex: 0 }, [index, values[index]]),
              tooltip: {
                shown: Boolean(tooltipContent?.isShow?.()),
                text: String(
                  tooltipContent?.el?.style?.text || tooltipContent?.el?.textContent || '',
                ),
              },
            };
          } catch {
            // UniEcharts exposes methods before its asynchronous canvas initialization.
            return null;
          }
        }
        component = component.parent;
      }
      return null;
    }, pointIndex);
}

async function expectPoints(page: Page, points: Point[]) {
  await expect(chart(page).locator('.uni-echarts canvas').first()).toBeVisible();
  await expect
    .poll(async () => {
      const snapshot = await readChart(page);
      return snapshot && { dates: snapshot.dates, values: snapshot.values };
    })
    .toEqual({
      dates: points.map((point) => point.date),
      values: points.map((point) => point.value),
    });
  const snapshot = (await readChart(page))!;
  expect(snapshot.width).toBeGreaterThan(0);
  expect(snapshot.height).toBeGreaterThan(0);
  expect(snapshot.values).not.toContain(0);
}

async function expectSummary(
  page: Page,
  metric: '身高' | '体重',
  unit: 'cm' | 'kg',
  points: Point[],
) {
  const summary = chart(page).locator('.growth-chart-summary');
  const latest = points.at(-1)!;
  await expect(summary).toContainText(`最近${metric}`);
  await expect(summary).toContainText(
    new RegExp(String.raw`${String(latest.value).replace('.', '[.]')}\s*${unit}`),
  );
  await expect(summary).toContainText(latest.date);
  await expect(summary).toContainText(new RegExp(String.raw`共\s*${points.length}\s*次记录`));
}

async function expectNoOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
  const bounds = await chart(page).boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(-1);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  if (await chart(page).locator('.uni-echarts').count()) {
    const snapshot = await readChart(page);
    expect(snapshot!.width).toBeLessThanOrEqual(bounds!.width + 1);
  }
}

test.use({
  locale: 'zh-CN',
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 },
});

test('uni H5 keeps real independent growth measurements through touch, CRUD, filtering and mobile re-entry', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const headers = await signIn(page);
  const marker = `growth-h5-${randomUUID().slice(0, 8)}-`;
  const originalRecords = await records(request, headers);
  const babyResponse = await request.get(`${api}/baby`, { headers });
  expect(babyResponse.ok(), await babyResponse.text()).toBeTruthy();
  const originalBaby = await babyResponse.json();
  const createdIds = new Set<string>();
  const isolate = async (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const upstream = await route.fetch();
    expect(upstream.ok(), await upstream.text()).toBeTruthy();
    const actual = (await upstream.json()) as Measurement[];
    // The server still supplies every displayed field. Only this test's display is isolated;
    // no existing growth rows or baby profile are deleted, replaced, or edited.
    await route.fulfill({
      response: upstream,
      json: actual.filter((record) => record.title.startsWith(marker)),
    });
  };
  const seed = async (
    suffix: string,
    date: string,
    heightCm: number | null,
    weightKg: number | null,
    type: Measurement['type'] = 'growth',
  ) => {
    const response = await request.post(growthUrl, {
      headers,
      data: {
        title: `${marker}${suffix}`,
        date,
        type,
        heightCm,
        weightKg,
        content: '',
        assetIds: [],
      },
    });
    expect(response.ok(), await response.text()).toBeTruthy();
    const record = (await response.json()) as Measurement;
    createdIds.add(record.id);
    return record;
  };

  await page.route(growthUrl, isolate);
  try {
    await openBaby(page);
    await expect(chart(page).locator('.wd-segmented__item-label')).toHaveText([
      '身高（cm）',
      '体重（kg）',
    ]);
    await expect(chart(page).locator('.growth-chart-empty')).toContainText('还没有身高测量');
    await expect(chart(page).locator('.uni-echarts canvas')).toHaveCount(0);
    await selectMetric(page, '体重（kg）');
    await expect(chart(page).locator('.growth-chart-empty')).toContainText('还没有体重测量');
    await selectMetric(page, '身高（cm）');
    await page.screenshot({ path: 'test-results/growth-h5-empty.png', fullPage: true });

    // Create the first real measurement in the UI. Leave weight genuinely unset.
    await press(currentPage(page).locator('.toolbar'), '＋ 记录');
    await fill(sheet(page), '这一刻叫什么', `${marker}ui-height`);
    await field(sheet(page), '记录类型').getByText('身高体重', { exact: true }).click();
    await fill(sheet(page), '身高（cm，选填）', '72.4');
    const uiDate = (await field(sheet(page), '日期').locator('.date-input').innerText()).match(
      /\d{4}-\d{2}-\d{2}/,
    )![0];
    const creating = page.waitForResponse(
      (response) => response.url() === growthUrl && response.request().method() === 'POST',
    );
    await press(sheet(page), '保存这一刻');
    const created = await creating;
    expect(created.ok(), await created.text()).toBeTruthy();
    const uiRecord = (await created.json()) as Measurement;
    createdIds.add(uiRecord.id);
    expect(uiRecord).toMatchObject({ date: uiDate, heightCm: 72.4, weightKg: null });
    await expect(page.locator('.sheet:visible')).toHaveCount(0);
    await expectPoints(page, [{ date: uiDate, value: 72.4 }]);
    await expectSummary(page, '身高', 'cm', [{ date: uiDate, value: 72.4 }]);
    await expect(chart(page)).toContainText('再添一条身高测量，就能连成曲线');
    await page.screenshot({ path: 'test-results/growth-h5-single-height.png', fullPage: true });
    await selectMetric(page, '体重（kg）');
    await expect(chart(page).locator('.growth-chart-empty')).toContainText('还没有体重测量');
    await expect(chart(page).locator('.uni-echarts canvas')).toHaveCount(0);

    // Deliberately create dates out of order. A health record's fields also count.
    const sameFirst = await seed('same-day-health', '2024-02-03', 64.2, 6.6, 'health');
    const sameSecond = await seed('same-day-growth', '2024-02-03', 65.5, null);
    await seed('latest-weight-only', uiDate, null, 8.4);
    await seed('backfilled-oldest', '2024-01-02', 60, 6.1);
    await seed('no-measurements', '2024-03-04', null, null, 'milestone');
    const sameDay = [sameFirst, sameSecond].sort(
      (left, right) =>
        Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
    const heights: Point[] = [
      { date: '2024-01-02', value: 60 },
      ...sameDay.map((record) => ({ date: '2024-02-03', value: record.heightCm! })),
      { date: uiDate, value: 72.4 },
    ];
    // Hard-coded expected dates/values independently prove ordering and absence of zero-fill.
    const weights: Point[] = [
      { date: '2024-01-02', value: 6.1 },
      { date: '2024-02-03', value: 6.6 },
      { date: uiDate, value: 8.4 },
    ];
    await refresh(page);
    await selectMetric(page, '身高（cm）');
    await expectPoints(page, heights);
    await expectSummary(page, '身高', 'cm', heights);
    await selectMetric(page, '体重（kg）');
    await expectPoints(page, weights);
    await expectSummary(page, '体重', 'kg', weights);

    // List search and type chips must not supply a filtered series to the chart.
    await currentPage(page).locator('.search input').fill(`${marker}no-measurements`);
    await expect(currentPage(page).locator('.timeline-item')).toHaveCount(1);
    await expectPoints(page, weights);
    await currentPage(page)
      .locator('.chips > .chip')
      .filter({ hasText: /^喂养$/ })
      .first()
      .click();
    await expect(currentPage(page).locator('.timeline-item')).toHaveCount(0);
    await expectPoints(page, weights);
    await selectMetric(page, '身高（cm）');
    await expectPoints(page, heights);
    await expectSummary(page, '身高', 'cm', heights);
    await currentPage(page).locator('.search input').fill('');
    await currentPage(page).locator('.chips > .chip[aria-label="全部记录"]').click();

    // Edit through the existing UI and verify the actual persisted result before reloading.
    const uiCard = currentPage(page)
      .locator('.card')
      .filter({ hasText: `${marker}ui-height` });
    await uiCard.getByText('编辑', { exact: true }).click();
    await fill(sheet(page), '身高（cm，选填）', '73.1');
    const editing = page.waitForResponse(
      (response) =>
        response.url() === `${growthUrl}/${uiRecord.id}` &&
        response.request().method() === 'POST' &&
        response.request().headers()['x-http-method-override'] === 'PATCH',
    );
    await press(sheet(page), '保存这一刻');
    const edited = await editing;
    expect(edited.ok(), await edited.text()).toBeTruthy();
    expect(await edited.json()).toMatchObject({ id: uiRecord.id, heightCm: 73.1, weightKg: null });
    await expect(page.locator('.sheet:visible')).toHaveCount(0);
    heights[heights.length - 1] = { date: uiDate, value: 73.1 };
    await expectPoints(page, heights);
    await expectSummary(page, '身高', 'cm', heights);
    expect(
      (await records(request, headers)).find((record) => record.id === uiRecord.id),
    ).toMatchObject({
      heightCm: 73.1,
      weightKg: null,
    });
    await refresh(page);
    await selectMetric(page, '身高（cm）');
    await expectPoints(page, heights);
    await expectSummary(page, '身高', 'cm', heights);
    await expectNoOverflow(page);
    await page.screenshot({ path: 'test-results/growth-h5-mobile-390.png', fullPage: true });

    // Re-enter a fresh page at a narrow phone width, exercising chart disposal/recreation.
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto('/#/pages/more/index');
    await expect(currentPage(page).locator('.title')).toHaveText('我们的日常');
    await currentPage(page).locator('.feature').filter({ hasText: '宝宝成长' }).click();
    await expect(currentPage(page).locator('.title')).toHaveText('宝宝成长');
    await expect(currentPage(page).locator('.loading')).toHaveCount(0);
    await selectMetric(page, '体重（kg）');
    await expectPoints(page, weights);
    await expectSummary(page, '体重', 'kg', weights);
    await expectNoOverflow(page);
    await page.screenshot({ path: 'test-results/growth-h5-mobile-320.png', fullPage: true });

    // Touch a real point. Inspect the renderer's tooltip only after the physical touch;
    // dispatchAction(showTip) would not exercise uni-echarts' touch bridge.
    await chart(page).locator('.uni-echarts').scrollIntoViewIfNeeded();
    const lastIndex = weights.length - 1;
    const snapshot = (await readChart(page, lastIndex))!;
    const canvasBounds = await chart(page).locator('.uni-echarts').boundingBox();
    expect(snapshot.point).not.toBeNull();
    await page.touchscreen.tap(
      canvasBounds!.x + snapshot.point![0],
      canvasBounds!.y + snapshot.point![1],
    );
    await expect.poll(async () => (await readChart(page, lastIndex))?.tooltip.shown).toBe(true);
    const tooltip = (await readChart(page, lastIndex))!.tooltip.text;
    expect(tooltip).toContain(uiDate);
    expect(tooltip).toContain('8.4');
    expect(tooltip).toContain('kg');
    await chart(page).screenshot({ path: 'test-results/growth-h5-tooltip.png' });

    // Delete only our UI-created row, then check chart and summary after a real refresh.
    const deleting = page.waitForResponse(
      (response) =>
        response.url() === `${growthUrl}/${uiRecord.id}` &&
        response.request().method() === 'DELETE',
    );
    await currentPage(page)
      .locator('.card')
      .filter({ hasText: `${marker}ui-height` })
      .getByText('删除', { exact: true })
      .click();
    await page.getByText('确定', { exact: true }).last().click();
    const deleted = await deleting;
    expect(deleted.ok(), await deleted.text()).toBeTruthy();
    await expect(currentPage(page).getByText(`${marker}ui-height`, { exact: true })).toHaveCount(0);
    heights.pop();
    await selectMetric(page, '身高（cm）');
    await expectPoints(page, heights);
    await expectSummary(page, '身高', 'cm', heights);
    await selectMetric(page, '体重（kg）');
    await expectPoints(page, weights);
    await refresh(page);
    await selectMetric(page, '身高（cm）');
    await expectPoints(page, heights);
    await expectSummary(page, '身高', 'cm', heights);
    expect((await records(request, headers)).some((record) => record.id === uiRecord.id)).toBe(
      false,
    );
    expect(errors).toEqual([]);
    await expectNoOverflow(page);
  } finally {
    await page.unroute(growthUrl, isolate);
    // Discover by a fresh, unique marker as well, covering a UI save that persisted
    // just before a failed browser assertion prevented its response being recorded.
    const beforeCleanup = await records(request, headers);
    for (const record of beforeCleanup) {
      if (record.title.startsWith(marker)) createdIds.add(record.id);
    }
    const originalIds = new Set(originalRecords.map((record) => record.id));
    for (const id of createdIds) {
      expect(originalIds.has(id)).toBe(false);
      const response = await request.delete(`${growthUrl}/${id}`, { headers });
      expect([200, 404]).toContain(response.status());
    }
    const afterCleanup = await records(request, headers);
    expect(afterCleanup.filter((record) => originalIds.has(record.id))).toEqual(originalRecords);
    expect(afterCleanup.some((record) => record.title.startsWith(marker))).toBe(false);
    const baby = await request.get(`${api}/baby`, { headers });
    expect(baby.ok(), await baby.text()).toBeTruthy();
    expect(await baby.json()).toEqual(originalBaby);
  }
});
