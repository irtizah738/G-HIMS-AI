import { expect, test } from '@playwright/test';

test('sign-in actions and footer fit a compact desktop viewport at 100% zoom', async ({ page }) => {
  for (const viewport of [
    { width: 1366, height: 720 },
    { width: 1440, height: 768 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/login', { waitUntil: 'domcontentloaded' });

    const card = page.getByTestId('login-card');
    const footer = page.getByTestId('login-footer');
    const submit = page.getByTestId('login-submit');
    const google = page.getByTestId('login-google-identity');
    const sso = page.getByTestId('login-hospital-sso');

    await expect(card).toBeVisible();
    await expect(submit).toBeVisible();
    await expect(google).toBeVisible();
    await expect(sso).toBeVisible();
    await expect(footer).toBeVisible();

    const bounds = await page.evaluate(() => {
      const get = (id: string) => {
        const element = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
        if (!element) throw new Error(`Missing login element: ${id}`);
        return element.getBoundingClientRect();
      };
      return {
        ssoBottom: get('login-hospital-sso').bottom,
        footerBottom: get('login-footer').bottom,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
      };
    });

    expect(bounds.ssoBottom, `SSO should fit at ${viewport.width}x${viewport.height}`)
      .toBeLessThanOrEqual(viewport.height);
    expect(bounds.footerBottom, `Footer should fit at ${viewport.width}x${viewport.height}`)
      .toBeLessThanOrEqual(viewport.height + 2);
    expect(bounds.horizontalOverflow).toBe(false);
  }
});

test('mobile login remains usable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 667 });
  await page.goto('/login', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('login-tenant-id')).toBeVisible();
  await expect(page.getByTestId('login-email')).toBeVisible();
  await expect(page.getByTestId('login-password')).toBeVisible();
  await page.getByTestId('login-hospital-sso').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('login-hospital-sso')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  expect(overflow).toBe(false);
});
