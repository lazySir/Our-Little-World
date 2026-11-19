import { test, expect, type Route } from '@playwright/test';

const api = 'http://127.0.0.1:3001/api';
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => (resolve = done));
  return { promise, resolve };
}

test('password form locks all fields while saving, preserves drafts on failure and clears after retry', async ({
  page,
  request,
}) => {
  const statusResponse = await request.get(api + '/auth/status');
  expect(statusResponse.ok(), await statusResponse.text()).toBeTruthy();
  const status = await statusResponse.json();
  const signedIn = await request.post(api + '/auth/' + (status.initialized ? 'login' : 'setup'), {
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
  await page.addInitScript((value) => localStorage.setItem('little-world-token', value), token);

  const captured = deferred();
  const rejectFirst = deferred();
  let attempts = 0;
  const requests: Promise<void>[] = [];
  await page.route('**/api/auth/password', (route: Route) => {
    const task = (async () => {
      attempts += 1;
      if (attempts === 1) {
        captured.resolve();
        await rejectFirst.promise;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: '这次修改暂时失败，请重试' }),
        });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    })();
    requests.push(task);
    return task;
  });

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '我们的小设置' })).toBeVisible();
  const current = page.locator('input[autocomplete="current-password"]');
  const next = page.locator('input[autocomplete="new-password"]').nth(0);
  const confirm = page.locator('input[autocomplete="new-password"]').nth(1);
  const values = ['current-test-password', 'new-test-password', 'new-test-password'];
  await current.fill(values[0]);
  await next.fill(values[1]);
  await confirm.fill(values[2]);
  const failure = page.waitForResponse(
    (response) => response.url().endsWith('/api/auth/password') && response.status() === 503,
  );
  await page.getByRole('button', { name: '修改密码' }).click();
  await captured.promise;

  const disabledWhilePending = [
    await current.isDisabled(),
    await next.isDisabled(),
    await confirm.isDisabled(),
  ];
  await expect(current).toHaveValue(values[0]);
  await expect(next).toHaveValue(values[1]);
  await expect(confirm).toHaveValue(values[2]);

  rejectFirst.resolve();
  await failure;
  expect(disabledWhilePending).toEqual([true, true, true]);
  await expect(page.locator('.el-message')).toContainText('这次修改暂时失败');
  await expect(current).toBeEnabled();
  await expect(current).toHaveValue(values[0]);
  await expect(next).toHaveValue(values[1]);
  await expect(confirm).toHaveValue(values[2]);

  const success = page.waitForResponse(
    (response) => response.url().endsWith('/api/auth/password') && response.status() === 200,
  );
  await page.getByRole('button', { name: '修改密码' }).click();
  await success;
  await expect(current).toHaveValue('');
  await expect(next).toHaveValue('');
  await expect(confirm).toHaveValue('');
  await Promise.all(requests);
});
