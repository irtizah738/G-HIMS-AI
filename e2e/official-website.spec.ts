import { expect, test } from '@playwright/test';

test.describe('G-HIMS AI public website', () => {
  test('anonymous visitors see clinical intelligence, not private dashboard', async ({ page }) => {
    await page.goto('/');

    await expect(page.locator('[data-ghims-marketing="true"]')).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 1 })
    ).toContainText('Patient data is fragmented');
    await expect(page.locator('[data-ghims-shell="dashboard"]')).toHaveCount(0);

    await page.getByRole('link', { name: 'Explore the experience' }).click();
    await expect(page).toHaveURL(/#experience$/);

    await page.getByRole('link', { name: 'Staff sign in' }).first().click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByTestId('login-card')).toBeVisible();
  });

  test('mobile navigation remains accessible and does not overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');

    await expect(page.locator('[data-ghims-marketing="true"]')).toBeVisible();
    await page.getByRole('button', { name: 'Open navigation menu' }).count().then(async (buttons) => {
      if (buttons > 0) await page.getByRole('button', { name: 'Open navigation menu' }).click();
      else await page.locator('summary[aria-label="Open navigation menu"]').click();
    });
    await expect(page.getByRole('navigation', { name: 'Mobile navigation' })).toBeVisible();

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1
    );
    expect(horizontalOverflow).toBe(false);
  });
});
