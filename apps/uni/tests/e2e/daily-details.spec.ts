import { test as base, expect, type Page, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
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
    await fill(page.locator('.auth-form'), '我们的小世界叫做', '日常细节回归的小屋');
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

// Every case can initialize a fresh isolated database and signs in through the real H5 UI.
// Its uniquely named records are removed so running the older H5 suite afterward stays independent.
const test = base.extend<{
  world: { marker: string; errors: string[]; headers: Record<string, string> };
}>({
  world: async ({ page, request }, use) => {
    const marker = `details-${randomUUID().slice(0, 8)}`;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const headers = await signIn(page);
    try {
      await use({ marker, errors, headers });
    } finally {
      for (const resource of ['wishes', 'memories']) {
        const response = await request.get(`${api}/${resource}`, { headers });
        expect(response.ok(), await response.text()).toBeTruthy();
        const records: { id: string; title: string }[] = await response.json();
        for (const record of records.filter((item) => item.title.includes(marker))) {
          const deleted = await request.delete(`${api}/${resource}/${record.id}`, { headers });
          expect(deleted.ok(), await deleted.text()).toBeTruthy();
        }
      }
    }
  },
});

async function save(page: Page, resource: string, id?: string) {
  const pending = page.waitForResponse(
    (response) =>
      response.url() === `${api}/${resource}${id ? `/${id}` : ''}` &&
      response.request().method() === 'POST' &&
      (!id || response.request().headers()['x-http-method-override'] === 'PATCH'),
  );
  await press(sheet(page), '保存这一刻');
  const response = await pending;
  expect(response.ok(), await response.text()).toBeTruthy();
  const saved = await response.json();
  await expect(sheet(page)).toHaveCount(0);
  await expect(page.locator('.loading')).toHaveCount(0);
  return saved;
}

async function chooseToday(page: Page, label: string) {
  const date = await page.evaluate(() => {
    const now = new Date();
    return [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');
  });
  const dateField = field(sheet(page), label);
  const before = await dateField.locator('.date-input').textContent();
  await dateField.locator('.date-input').click();
  const picker = page.locator('.uni-picker-custom.uni-picker-toggle');
  await expect(picker).toBeVisible();
  await picker.locator('.uni-picker-action-cancel').click({ trial: true });
  const layers = await picker.evaluate((element) => {
    const describe = (node: Element) => {
      const style = getComputedStyle(node);
      return {
        tag: node.tagName,
        className: node.className,
        position: style.position,
        zIndex: style.zIndex,
        transform: style.transform,
      };
    };
    const ancestors = [];
    for (let node: Element | null = element; node; node = node.parentElement)
      ancestors.push(describe(node));
    const button = element.querySelector('.uni-picker-action-cancel')!;
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      ancestors,
      popups: Array.from(document.querySelectorAll('.wd-popup,.wd-overlay')).map(describe),
      button: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      hit: hit ? describe(hit) : null,
    };
  });
  await test.info().attach('date-picker-layer-state', {
    body: JSON.stringify(layers, null, 2),
    contentType: 'application/json',
  });
  await page.screenshot({ path: test.info().outputPath('date-picker-open.png'), fullPage: true });
  await picker.locator('.uni-picker-action-cancel').click();
  await expect(page.locator('.uni-picker-container:visible')).toHaveCount(0);
  await expect(dateField.locator('.date-input')).toHaveText(before || '');
  await dateField.locator('.date-input').click();
  await expect(picker).toBeVisible();
  await picker.locator('.uni-picker-action-confirm').click();
  await expect(dateField.locator('.date-input')).toContainText(date);
  await expect(page.locator('.uni-picker-container:visible')).toHaveCount(0);
  return date;
}

async function toggleWish(page: Page, card: Locator, id: string) {
  const pending = page.waitForResponse(
    (response) =>
      response.url() === `${api}/wishes/${id}` &&
      response.request().method() === 'POST' &&
      response.request().headers()['x-http-method-override'] === 'PATCH',
  );
  await card.locator('.check').click();
  const response = await pending;
  expect(response.ok(), await response.text()).toBeTruthy();
  await expect(page.locator('.loading')).toHaveCount(0);
}

test('uni H5 edits, completes and reopens a categorized wish without losing its target date', async ({
  page,
  request,
  world,
}) => {
  const original = `一起看清晨的海 ${world.marker}`;
  const updated = `一起尝尝山顶早餐 ${world.marker}`;
  const description = '带上热咖啡，记住期待中的小事。';
  await visit(page, 'wishes', '一起做');
  await press(page, '＋ 添加');
  await fill(sheet(page), '想做什么', original);
  await fill(sheet(page), '说得更具体一点', description);
  await field(sheet(page), '放在哪一类').getByText('想去', { exact: true }).click();
  const targetDate = await chooseToday(page, '希望哪天完成');
  const created = await save(page, 'wishes');
  const search = page.locator('.toolbar .search input');
  const originalCard = page.locator('.card').filter({ hasText: original });
  await expect(originalCard).toContainText('想去');
  await expect(originalCard).toContainText(`目标 ${targetDate}`);
  await search.fill(`不存在的愿望 ${world.marker}`);
  await expect(page.locator('.card')).toHaveCount(0);
  await search.fill(original);
  await expect(originalCard).toBeVisible();
  await originalCard.getByText('编辑', { exact: true }).click();
  await expect(field(sheet(page), '放在哪一类').locator('.chip.active')).toHaveText('想去');
  await expect(field(sheet(page), '希望哪天完成').locator('.date-input')).toContainText(targetDate);
  await fill(sheet(page), '想做什么', updated);
  await field(sheet(page), '放在哪一类').getByText('想吃', { exact: true }).click();
  await save(page, 'wishes', created.id);
  await expect(page.locator('.card')).toHaveCount(0);
  await search.fill(updated);
  const card = page.locator('.card').filter({ hasText: updated });
  await expect(card).toContainText('想吃');
  await expect(card).toContainText(description);
  await expect(card).toContainText(`目标 ${targetDate}`);
  await toggleWish(page, card, created.id);
  await expect(card).toHaveClass(/done/);
  await expect(card).toContainText('完成于');
  const tabs = page.locator('.page > .chips > .chip');
  await tabs.filter({ hasText: '还没完成' }).click();
  await expect(card).toHaveCount(0);
  await tabs.filter({ hasText: '已经完成' }).click();
  await expect(card).toBeVisible();
  await toggleWish(page, card, created.id);
  await expect(card).toHaveCount(0);
  await tabs.filter({ hasText: '还没完成' }).click();
  await expect(card).toBeVisible();
  await expect(card).not.toHaveClass(/done/);
  await expect(card).not.toContainText('完成于');
  await page.reload();
  await expect(card).toBeVisible();
  await expect(card).not.toHaveClass(/done/);
  await expect(card).toContainText('想吃');
  await expect(card).toContainText(`目标 ${targetDate}`);
  await card.getByText('编辑', { exact: true }).click();
  await expect(field(sheet(page), '想做什么').locator('input')).toHaveValue(updated);
  await expect(field(sheet(page), '放在哪一类').locator('.chip.active')).toHaveText('想吃');
  await expect(field(sheet(page), '希望哪天完成').locator('.date-input')).toContainText(targetDate);
  await press(sheet(page), '先放一放');
  const persisted = await request.get(`${api}/wishes`, { headers: world.headers });
  expect(persisted.ok()).toBeTruthy();
  expect(
    (await persisted.json()).find((item: { id: string }) => item.id === created.id),
  ).toMatchObject({
    title: updated,
    category: 'food',
    targetDate,
    description,
    status: 'todo',
    completedAt: null,
  });
  expect(world.errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/daily-details-h5-wish.png', fullPage: true });
});

test('uni H5 opens a calendar wish in its tab despite the current search filter', async ({
  page,
  request,
  world,
}) => {
  const title = '一起去山顶看日出 ' + world.marker;
  const now = new Date();
  const targetDate = [now.getFullYear(), now.getMonth() + 1, 12]
    .map((part) => String(part).padStart(2, '0'))
    .join('-');
  const created = await request.post(api + '/wishes', {
    headers: world.headers,
    data: { title, category: 'travel', targetDate },
  });
  expect(created.ok(), await created.text()).toBeTruthy();

  const current = () => page.locator('.page:visible').last();
  const wish = () => current().locator('.card').filter({ hasText: title });
  const search = current().locator('.toolbar .search input');
  await page.locator('uni-tabbar').getByText('一起做', { exact: true }).click();
  await expect(current().locator('.title')).toHaveText('一起做');
  await expect(wish()).toBeVisible();
  const filter = '排除这条愿望的查询';
  await search.fill(filter);
  await expect(wish()).toHaveCount(0);

  await page.locator('uni-tabbar').getByText('我们', { exact: true }).click();
  await expect(current().locator('.title')).toHaveText('我们的日常');
  await current().locator('.feature').filter({ hasText: '共享日历' }).click();
  await expect(current().locator('.title')).toHaveText('共享日历');
  await current()
    .locator('.calendar-day[aria-label^="' + targetDate + '，"]')
    .click();
  const event = current().locator('.calendar-event').filter({ hasText: title });
  await expect(event.getByText('查看来源', { exact: true })).toBeVisible();
  await press(event, '查看来源');

  await expect(page).toHaveURL((url) => url.hash === '#/pages/wishes/index');
  await expect(current().getByText('来自共享日历', { exact: true })).toBeVisible();
  await expect(wish()).toBeVisible();
  await expect(wish()).toContainText(targetDate);
  await expect(sheet(page)).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(390);
  await press(current(), '查看全部');
  await expect(current().getByText('来自共享日历', { exact: true })).toHaveCount(0);
  await expect(search).toHaveValue(filter);
  await expect(wish()).toHaveCount(0);
  await search.fill('');
  await expect(wish()).toBeVisible();
  expect(world.errors).toEqual([]);
});

test('uni H5 searches an edited memory by its new tags and stops matching the removed tag', async ({
  page,
  request,
  world,
}) => {
  const title = `午后散步的一页 ${world.marker}`;
  const oldTag = `清晨旧标签-${world.marker}`;
  const newTag = `午后新标签-${world.marker}`;
  const content = '路过一排树，收藏平常的一天。';
  await visit(page, 'memories', '回忆相册');
  await press(page, '＋ 写一篇');
  await fill(sheet(page), '给这段回忆起个名字', title);
  await fill(sheet(page), '写点什么', content);
  await fill(sheet(page), '贴几个标签', `${oldTag}，沿途绿树`);
  const created = await save(page, 'memories');
  const search = page.locator('.toolbar .search input');
  const card = page.locator('.card').filter({ hasText: title });
  await expect(card.locator('.pill')).toHaveText([`# ${oldTag}`, '# 沿途绿树']);
  await search.fill(oldTag);
  await expect(card).toBeVisible();
  await search.fill(`没有贴过的标签-${world.marker}`);
  await expect(page.locator('.card')).toHaveCount(0);
  await search.fill(oldTag);
  await card.getByText('编辑', { exact: true }).click();
  await expect(field(sheet(page), '贴几个标签').locator('input')).toHaveValue(
    `${oldTag}，沿途绿树`,
  );
  await fill(sheet(page), '贴几个标签', `${newTag}, 周末`);
  await save(page, 'memories', created.id);
  await expect(page.locator('.card')).toHaveCount(0);
  await search.fill(newTag);
  await expect(card).toBeVisible();
  await expect(card.locator('.pill')).toHaveText([`# ${newTag}`, '# 周末']);
  await expect(card).toContainText(content);
  await page.reload();
  await search.fill(oldTag);
  await expect(page.locator('.loading')).toHaveCount(0);
  await expect(page.locator('.card')).toHaveCount(0);
  await search.fill(newTag);
  await expect(card).toBeVisible();
  await expect(card.locator('.pill')).toHaveText([`# ${newTag}`, '# 周末']);
  await card.getByText('编辑', { exact: true }).click();
  await expect(field(sheet(page), '贴几个标签').locator('input')).toHaveValue(`${newTag}，周末`);
  await press(sheet(page), '先放一放');
  const persisted = await request.get(`${api}/memories`, { headers: world.headers });
  expect(persisted.ok()).toBeTruthy();
  expect(
    (await persisted.json()).find((item: { id: string }) => item.id === created.id),
  ).toMatchObject({
    title,
    content,
    date: created.date,
    tags: [newTag, '周末'],
  });
  expect(world.errors).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/daily-details-h5-memory.png', fullPage: true });
});
