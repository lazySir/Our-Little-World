import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { readE2ESetupToken } from './setup-token.mts';

const api = 'http://127.0.0.1:3001/api';

async function signIn(request: APIRequestContext, page: Page) {
  const status = await request.get(api + '/auth/status');
  expect(status.ok(), await status.text()).toBeTruthy();
  const { initialized } = await status.json();
  const response = await request.post(api + (initialized ? '/auth/login' : '/auth/setup'), {
    data: {
      setupToken: initialized ? undefined : await readE2ESetupToken(),
      username: 'web_owner',
      password: 'little-world-e2e-123',
      nickname: '小林',
      spaceName: '小林与小禾的小世界',
      startDate: '2024-02-29',
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const { token } = await response.json();
  await page.addInitScript((value) => localStorage.setItem('little-world-token', value), token);
  return { Authorization: 'Bearer ' + token };
}

function dateInMonth(offset: number, day: number) {
  const now = new Date();
  const date = new Date(now.getFullYear(), now.getMonth() + offset, day);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-');
}

const dayButton = (page: Page, date: string) =>
  page.getByRole('button', { name: new RegExp('^' + date + '，') });
const sourceLink = (page: Page, title: string) =>
  page
    .locator('.calendar-event')
    .filter({ hasText: title })
    .getByRole('link', { name: /查看来源/ });

test('mobile Web opens a recurring calendar occurrence at its original record', async ({
  page,
  request,
}) => {
  const headers = await signIn(request, page);
  const todayOccurrence = dateInMonth(0, 12);
  const originalDate = String(Number(todayOccurrence.slice(0, 4)) - 2) + todayOccurrence.slice(4);
  const title = '第一次一起看海';
  const created = await request.post(api + '/anniversaries', {
    headers,
    data: {
      title,
      date: originalDate,
      recurring: true,
      description: '每年这天，一起去海边走走。',
    },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const calendar = await request.get(api + '/calendar?month=' + todayOccurrence.slice(0, 7), {
      headers,
    });
    expect(calendar.ok(), await calendar.text()).toBeTruthy();
    const { events } = await calendar.json();
    expect(events).toContainEqual(
      expect.objectContaining({
        id: id + ':' + todayOccurrence,
        sourceId: id,
        date: todayOccurrence,
      }),
    );

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/calendar');
    await dayButton(page, todayOccurrence).click();
    const link = sourceLink(page, title);
    await expect(link).toHaveAttribute('href', '/anniversaries?record=' + id);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
      .toBeLessThanOrEqual(390);
    await link.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
    await page.screenshot({ path: 'test-results/calendar-source-web-mobile.jpg', fullPage: false });
    await link.click();

    await expect(page).toHaveURL(
      (url) => url.pathname === '/anniversaries' && url.searchParams.get('record') === id,
    );
    const original = page.locator('[data-record-id="' + id + '"]');
    await expect(original).toBeFocused();
    await expect(original).toContainText(title);
    await expect(original).toContainText(originalDate);
    await expect(page.getByText('来自共享日历', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.screenshot({
      path: 'test-results/calendar-source-web-record-mobile.jpg',
      fullPage: true,
    });
    await page.getByRole('link', { name: '查看全部', exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === '/anniversaries' && !url.search);
    await expect(page.getByText('来自共享日历', { exact: true })).toHaveCount(0);
    await expect(original).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    const removed = await request.delete(api + '/anniversaries/' + id, { headers });
    expect(removed.ok(), await removed.text()).toBeTruthy();
  }
});

test('opening a future letter from the Web calendar keeps its text sealed', async ({
  page,
  request,
}) => {
  const headers = await signIn(request, page);
  const unlockDate = dateInMonth(1, 15);
  const title = '写给下个月的我们';
  const secret = '这段正文只在解锁日期后出现。';
  const created = await request.post(api + '/letters', {
    headers,
    data: { title, content: secret, unlockDate },
  });
  expect(created.ok(), await created.text()).toBeTruthy();
  const { id } = await created.json();
  try {
    await page.goto('/calendar');
    await expect(dayButton(page, dateInMonth(0, 15))).toBeVisible();
    await page.getByRole('button', { name: '下个月' }).click();
    await dayButton(page, unlockDate).click();
    await expect(page.locator('.calendar-details')).not.toContainText(secret);
    const link = sourceLink(page, title);
    await expect(link).toBeVisible();
    await link.click();
    const letter = page.locator('[data-record-id="' + id + '"]');
    await expect(letter).toBeFocused();
    await expect(letter).toContainText('未到解锁日');
    await expect(page.locator('body')).not.toContainText(secret);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  } finally {
    const removed = await request.delete(api + '/letters/' + id, { headers });
    expect(removed.ok(), await removed.text()).toBeTruthy();
  }
});
