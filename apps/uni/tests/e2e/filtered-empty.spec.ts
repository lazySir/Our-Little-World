import { test, expect, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readE2ESetupToken } from '../../../../e2e/setup-token.mts';

const api = 'http://127.0.0.1:3002/api';
const readmeImages = resolve(process.cwd(), 'docs/images/readme');
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
    await fill(page.locator('.auth-form'), '我们的小世界叫做', '筛选体验的小屋');
  }
  const signingIn = page.waitForResponse(`${api}/auth/${initialized ? 'login' : 'setup'}`);
  await press(page, initialized ? '回家啦' : '创建我们的小世界');
  const response = await signingIn;
  expect(response.ok(), await response.text()).toBeTruthy();
  const { token } = await response.json();
  await expect(page.locator('.title')).toHaveText('今天，也在好好生活');
  return { Authorization: `Bearer ${token}` };
}

async function visit(page: Page, route: string, title: string) {
  await page.goto(`/#/pages/${route}/index`);
  await expect(page.locator('.title')).toHaveText(title);
  await expect(page.locator('.loading')).toHaveCount(0);
  await expect(page.locator('.error-box')).toHaveCount(0);
}

test('uni H5 filter empty states recover real records and document phone layouts', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 390, height: 844 });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const headers = await signIn(page);
  const marker = `readme-filter-${randomUUID().slice(0, 8)}`;
  const businessDate = await (await request.get(`${api}/business-date`)).json();
  const records = {
    growth: {
      resource: 'growth',
      body: {
        title: `${marker}-成长`,
        date: businessDate.date,
        type: 'milestone',
        content: '记录一个小小进步。',
        assetIds: [],
      },
    },
    ledger: {
      resource: 'ledger',
      body: {
        type: 'income',
        amountCents: 6880,
        category: '筛选验收',
        date: businessDate.date,
        note: `${marker}-收入`,
        payer: '我们',
      },
    },
    work: {
      resource: 'work',
      body: {
        title: `${marker}-手记`,
        date: businessDate.date,
        content: '这是一条真实的隔离验收记录。',
        tags: ['验收'],
        assetIds: [],
      },
    },
  };
  const created: { resource: string; id: string }[] = [];

  try {
    for (const value of Object.values(records)) {
      const response = await request.post(`${api}/${value.resource}`, {
        headers,
        data: value.body,
      });
      expect(response.ok(), await response.text()).toBeTruthy();
      created.push({ resource: value.resource, id: (await response.json()).id });
    }

    await visit(page, 'baby', '宝宝成长');
    await expect(page.locator('.growth-chart')).toBeVisible();
    await page.locator('.toolbar .search input').fill('还没记录过的瞬间');
    await expect(page.getByText('没有匹配的成长记录', { exact: true })).toBeVisible();
    await page.screenshot({
      path: resolve(readmeImages, 'wechat-growth-filter-empty.png'),
      fullPage: true,
    });
    await press(page, '清除筛选');
    await expect(page.getByText(records.growth.body.title, { exact: true })).toBeVisible();

    await visit(page, 'ledger', '共同账本');
    await expect(page.locator('.search')).toHaveAttribute('aria-label', '搜索分类、备注或付款人');
    const ledgerSearch = page.locator('.search input');
    await ledgerSearch.fill(records.ledger.body.note.toUpperCase());
    await expect(page.getByText(records.ledger.body.note, { exact: true })).toBeVisible();
    await page.getByText('支出', { exact: true }).click();
    await expect(page.getByText(records.ledger.body.note, { exact: true })).toHaveCount(0);
    await expect(page.getByText('没有匹配的账本记录', { exact: true })).toBeVisible();
    await page.getByText('收入', { exact: true }).click();
    await expect(page.getByText(records.ledger.body.note, { exact: true })).toBeVisible();
    await ledgerSearch.fill('没有这条账目');
    await expect(page.getByText('没有匹配的账本记录', { exact: true })).toBeVisible();
    await page.screenshot({
      path: resolve(readmeImages, 'wechat-ledger-filter-empty.png'),
      fullPage: true,
    });
    await press(page, '清除筛选');
    await expect(page.getByText(records.ledger.body.note, { exact: true })).toBeVisible();

    await visit(page, 'work', '工作手记');
    await page.locator('.toolbar .search input').fill('暂时没有的手记');
    await expect(page.getByText('没有匹配的手记', { exact: true })).toBeVisible();
    await page.screenshot({
      path: resolve(readmeImages, 'wechat-work-filter-empty.png'),
      fullPage: true,
    });
    await press(page, '清除筛选');
    await expect(page.getByText(records.work.body.title, { exact: true })).toBeVisible();

    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    for (const record of created) {
      const response = await request.delete(`${api}/${record.resource}/${record.id}`, { headers });
      expect(response.ok(), await response.text()).toBeTruthy();
    }
  }
});
