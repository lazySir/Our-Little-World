import { expect, test } from '@playwright/test';

test('offline banner scrolls away instead of covering page content', async ({ page }) => {
  await page.goto('/auth');
  await page.evaluate(() => {
    const content = document.createElement('div');
    content.style.height = '1600px';
    document.body.append(content);
  });
  await page.context().setOffline(true);

  const banner = page.getByRole('status');
  await expect(banner).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 500));
  await expect.poll(() => banner.evaluate((element) => element.getBoundingClientRect().bottom)).toBeLessThan(0);
});
