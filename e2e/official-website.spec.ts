import { expect, test } from '@playwright/test';

test.describe('G-HIMS official corporate website', () => {
  test('anonymous visitor can navigate products and privacy', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-ghims-website="true"]')).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Better healthcare');
    await expect(page.locator('[data-ghims-shell="dashboard"]')).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Clinical Intelligence' }).click();
    await expect(page).toHaveURL(/\/products\/clinical-intelligence$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Intelligence that shows');
    await page.getByRole('link', { name: 'Privacy', exact: true }).click();
    await expect(page).toHaveURL(/\/privacy$/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Privacy and responsible');
  });
  test('mobile and tablet menu remains visible without horizontal overflow', async ({ page }) => {
    for (const width of [390, 768]) {
      await page.setViewportSize({ width, height: 850 });
      await page.goto('/');
      await expect(page.locator('[data-ghims-website="true"]')).toBeVisible();
      await page.locator('summary[aria-label="Open website menu"]').click();
      await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();
      await page.getByRole('navigation', { name: 'Mobile navigation' }).getByRole('link', { name: 'Company' }).click();
      await expect(page).toHaveURL(/\/company$/);
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Building the foundations');
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false);
    }
  });
  test('staff login is still available independently', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Staff login' }).first().click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('login-card')).toBeVisible();
  });
});
