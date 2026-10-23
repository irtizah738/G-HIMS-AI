import { test, expect, type Browser, type Page, type BrowserContext } from '@playwright/test';

const TENANT = 'ciqp-renal-browser';
const PASS = 'SyntheticBrowserTestOnly!8462';
const UIDS = {
  coordinator: 'cv_browser_coord_001',
  reviewerA: 'cv_browser_clinA_001',
  reviewerB: 'cv_browser_clinB_001',
  adjudicator: 'cv_browser_adjudicator_001',
} as const;
type Role = keyof typeof UIDS;

async function login(browser: Browser, role: Role): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('/login');
  const tenantSelect = page.getByTestId('login-tenant-id');
  await expect(tenantSelect).toBeVisible();
  await expect(tenantSelect.locator('option[value="' + TENANT + '"]')).toHaveCount(1);
  await tenantSelect.selectOption(TENANT);
  await page.getByTestId('login-email').fill(UIDS[role] + '@synthetic.invalid');
  await page.getByTestId('login-password').fill(PASS);
  await page.getByTestId('login-submit').click();
  // Traverse the real application login/session path; no cookies, bearer
  // tokens, auth state or API responses are mocked or injected.
  await expect(page.getByTestId('login-email')).toBeHidden({ timeout: 35_000 });
  await page.goto('/' + TENANT + '/clinical-validation');
  try {
    await expect(page.getByRole('heading', { name: 'Clinical Validation & Review' })).toBeVisible({ timeout: 15_000 });
  } catch {
    const diagnostic = {
      requestedRole: role,
      currentPath: new URL(page.url()).pathname,
      headings: await page.locator('h1,h2,h3').allInnerTexts().catch(() => []),
      alerts: await page.getByRole('alert').allInnerTexts().catch(() => []),
      statuses: (await page.getByRole('status').allInnerTexts().catch(() => [])).slice(0, 8),
      loginFormVisible: await page.getByTestId('login-email').isVisible().catch(() => false),
    };
    throw new Error('CIQP_BROWSER_POST_LOGIN_UI_UNAVAILABLE:' + JSON.stringify(diagnostic));
  }
  await expect(page.getByText('Study renal-ciqp-synthetic-v1')).toBeVisible();
  return { context, page };
}

async function selectCase(page: Page, caseId = 'renal-synthetic-001') {
  await page.getByRole('button', { name: new RegExp(caseId) }).click();
  await expect(page.getByRole('heading', { name: 'Frozen synthetic evidence' })).toBeVisible();
}

async function submitAssessment(page: Page, judgment: string, evidenceId: string) {
  await page.getByRole('checkbox', { name: 'Cite ' + evidenceId }).check();
  await page.getByLabel('Clinical assessment (independent)').selectOption(judgment);
  await page.getByLabel('Clinical reasoning (20–2500 characters)')
    .fill('My independent synthetic evidence assessment notes the measurement chronology and documentation limits.');
  await page.getByRole('checkbox', { name: /I confirm this is my independent clinical assessment/ }).check();
  await page.getByRole('button', { name: /Submit immutable/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Recorded successfully.' })).toBeVisible();
}

test('coordinator assigns, clinicians review independently, adjudicator resolves via actual browser UI', async ({ browser }) => {
  const contexts: BrowserContext[] = [];
  try {
    const coord = await login(browser, 'coordinator'); contexts.push(coord.context);
    await expect(coord.page.getByRole('heading', { name: 'Initialize fixed synthetic study' })).toBeVisible();
    await coord.page.getByLabel('Reviewer A UID').fill(UIDS.reviewerA);
    await coord.page.getByLabel('Reviewer B UID').fill(UIDS.reviewerB);
    await coord.page.getByLabel('Adjudicator UID').fill(UIDS.adjudicator);
    await coord.page.getByRole('button', { name: 'Create synthetic case assignments' }).click();
    await expect(coord.page.getByRole('button', { name: /renal-synthetic-001/ })).toBeVisible();
    await selectCase(coord.page);
    await expect(coord.page.getByText('0.9 mg/dL')).toBeVisible();
    await expect(coord.page.getByRole('button', { name: /Submit immutable/ })).toHaveCount(0);

    const a = await login(browser, 'reviewerA'); contexts.push(a.context);
    await selectCase(a.page);
    await submitAssessment(a.page, 'YES', 'creatinine-a');

    const b = await login(browser, 'reviewerB'); contexts.push(b.context);
    await selectCase(b.page);
    await expect(b.page.getByText('My independent synthetic evidence assessment', { exact: false })).toHaveCount(0);
    await expect(b.page.getByText('Independent primary reviews')).toHaveCount(0);

    const third = await login(browser, 'adjudicator'); contexts.push(third.context);
    await selectCase(third.page);
    await expect(third.page.getByText('Hidden until both primary assessments are locked.')).toBeVisible();
    await expect(third.page.getByRole('button', { name: 'Submit immutable adjudication' })).toBeDisabled();

    await submitAssessment(b.page, 'NO', 'creatinine-c');
    await third.page.getByRole('button', { name: 'Refresh assigned cases' }).click();
    await selectCase(third.page);
    await expect(third.page.getByText('Primary reviewer 1: YES')).toBeVisible();
    await expect(third.page.getByText('Primary reviewer 2: NO')).toBeVisible();
    await submitAssessment(third.page, 'INSUFFICIENT_EVIDENCE', 'context-unknown');

    await coord.page.getByRole('button', { name: 'Refresh assigned cases' }).click();
    await expect(coord.page.getByRole('button', { name: /renal-synthetic-001.*ADJUDICATED/ })).toBeVisible();
    await selectCase(coord.page);
    await expect(coord.page.getByText('Primary reviewer 1: YES')).toHaveCount(0);

    // Already-finalized primary review must not provide an editable form.
    await a.page.getByRole('button', { name: 'Refresh assigned cases' }).click();
    await selectCase(a.page);
    await expect(a.page.getByText('Submitted assessment: YES')).toBeVisible();
    await expect(a.page.getByRole('button', { name: /Submit immutable/ })).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
