import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const tenantId = String(
  process.env.GHIMS_P7_TENANT_ID || 'p7-hospital-zero'
).trim().toLowerCase();
const confirmedTenant = String(
  process.env.GHIMS_OPD_SQ1_CONFIRM_TENANT || ''
).trim().toLowerCase();
const password = String(process.env.GHIMS_P7_BOOTSTRAP_PASSWORD || '');

const emails = {
  reception:
    process.env.GHIMS_P7_RECEPTION_EMAIL || 'p7.reception@g-hims.invalid',
  billing:
    process.env.GHIMS_P7_BILLING_EMAIL || 'p7.billing@g-hims.invalid',
  nurse: process.env.GHIMS_P7_NURSE_EMAIL || 'p7.nurse@g-hims.invalid',
  doctor: process.env.GHIMS_P7_DOCTOR_EMAIL || 'p7.doctor@g-hims.invalid',
};

function assertQualificationEnvironment() {
  if (!tenantId || confirmedTenant !== tenantId) {
    throw new Error(
      'OPD_SQ1_TENANT_CONFIRMATION_REQUIRED: GHIMS_OPD_SQ1_CONFIRM_TENANT must exactly match GHIMS_P7_TENANT_ID.'
    );
  }
  if (password.length < 16) {
    throw new Error(
      'OPD_SQ1_PASSWORD_REQUIRED: GHIMS_P7_BOOTSTRAP_PASSWORD must contain the provisioned staging credential.'
    );
  }
}

async function loginAs(
  browser: Browser,
  email: string,
  encounterId?: string
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('/login');
  await page.getByTestId('login-tenant-id').fill(tenantId);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();

  await page.waitForURL((url) => url.pathname !== '/login', {
    timeout: 30_000,
  });

  const query = encounterId
    ? `?opdEncounterId=${encodeURIComponent(encounterId)}`
    : '';
  await page.goto(`/${encodeURIComponent(tenantId)}${query}`);

  await expect(page.locator('#sidebar-nav-opd')).toBeVisible();
  await page.locator('#sidebar-nav-opd').click();
  await expect(
    page.getByText('OPD Master Operational Runtime Suite (11-Stage Journey)')
  ).toBeVisible();

  if (encounterId) {
    await expect(page.getByTestId('opd-active-patient-banner')).toHaveAttribute(
      'data-encounter-id',
      encounterId
    );
  }

  return { context, page };
}

async function selectEncounterTab(
  page: Page,
  tab: string,
  encounterId: string
) {
  await page.getByTestId(`opd-tab-${tab}`).click();
  await expect(page.getByTestId('opd-active-patient-banner')).toHaveAttribute(
    'data-encounter-id',
    encounterId
  );
}

test.describe.serial('OPD-SQ1 deployed cross-role staging qualification', () => {
  test.beforeAll(async ({ request }) => {
    assertQualificationEnvironment();

    const response = await request.get('/api/health/ready');
    expect(response.ok()).toBe(true);

    const health = (await response.json()) as {
      status?: string;
      runtime?: string;
      blockers?: string[];
    };

    expect(health.status).toBe('ready');
    expect(health.runtime).toBe('STAGING');
    expect(health.blockers || []).toEqual([]);
  });

  test('Reception → Cashier → Nurse → Doctor → Cashier → Doctor', async ({
    browser,
  }) => {
    const suffix = String(Date.now()).slice(-9);
    const patientName = `OPD SQ1 Patient ${suffix}`;
    const nationalId = `61101-${suffix.slice(-7)}-${suffix.slice(-1)}`;
    const phone = `+92300${suffix.slice(-7)}`;

    // 1. Reception: register a synthetic patient and create the authoritative
    // encounter + consultation invoice.
    const reception = await loginAs(browser, emails.reception);
    await reception.page.getByTestId('opd-tab-registration').click();

    await reception.page
      .getByTestId('opd-registration-full-name')
      .fill(patientName);
    await reception.page
      .getByTestId('opd-registration-national-id')
      .fill(nationalId);
    await reception.page.getByTestId('opd-registration-dob').fill('1990-01-15');
    await reception.page
      .getByTestId('opd-registration-gender')
      .selectOption('Male');
    await reception.page.getByTestId('opd-registration-phone').fill(phone);
    await reception.page
      .getByTestId('opd-registration-address')
      .fill('Synthetic OPD staging qualification address');
    await expect(
      reception.page.getByTestId('opd-registration-facility')
    ).toHaveValue('P7H0');
    await reception.page
      .getByTestId('opd-registration-tariff')
      .selectOption('OUT_OF_POCKET');
    await reception.page.getByTestId('opd-consent-general-grant').click();
    await reception.page.getByTestId('opd-consent-hie-grant').click();
    await reception.page.getByTestId('opd-registration-submit').click();

    // Registration returns to Overview. Re-open an authorized tab so the
    // selected encounter banner exposes the server encounter identity.
    await reception.page.getByTestId('opd-tab-registration').click();
    const receptionBanner = reception.page.getByTestId(
      'opd-active-patient-banner'
    );
    await expect(receptionBanner).toContainText(patientName);
    const encounterId = await receptionBanner.getAttribute('data-encounter-id');
    const patientId = await receptionBanner.getAttribute('data-patient-id');
    expect(encounterId).toBeTruthy();
    expect(patientId).toBeTruthy();
    await reception.context.close();

    // 2. Cashier: consultation prepayment must clear before the queue is usable.
    const cashierIngress = await loginAs(
      browser,
      emails.billing,
      encounterId!
    );
    await selectEncounterTab(cashierIngress.page, 'billing', encounterId!);
    const amount = cashierIngress.page.getByTestId('opd-billing-amount');
    await expect(amount).toBeVisible();
    expect(Number(await amount.inputValue())).toBeGreaterThan(0);
    await cashierIngress.page.getByTestId('opd-billing-collect').click();

    // After settlement, the cashier stays on the billing-authorized surface;
    // the Queue tab must not be exposed through programmatic navigation.
    await expect(
      cashierIngress.page.getByTestId('opd-tab-queue')
    ).toHaveCount(0);
    await expect(
      cashierIngress.page.getByText('Final OPD billing reconciliation')
    ).toBeVisible();
    await cashierIngress.context.close();

    // 3. Nurse: call the now-paid token, start service and commit complete NEWS2.
    const nurse = await loginAs(browser, emails.nurse, encounterId!);
    await selectEncounterTab(nurse.page, 'queue', encounterId!);
    const queueRow = nurse.page.locator('tr').filter({ hasText: patientName });
    await expect(queueRow).toBeVisible();
    await queueRow.getByRole('button', { name: 'Call Token' }).click();
    await expect(queueRow).toContainText('CALLED');
    await queueRow.getByRole('button', { name: 'Admit to Bay' }).click();

    await expect(nurse.page.getByTestId('opd-triage-submit')).toBeVisible();
    await nurse.page.getByTestId('opd-triage-heart-rate').fill('80');
    await nurse.page.getByTestId('opd-triage-systolic').fill('120');
    await nurse.page.getByTestId('opd-triage-diastolic').fill('80');
    await nurse.page
      .getByTestId('opd-triage-respiratory-rate')
      .fill('16');
    await nurse.page.getByTestId('opd-triage-temperature').fill('37');
    await nurse.page.getByTestId('opd-triage-spo2').fill('98');
    await nurse.page.getByTestId('opd-triage-spo2-scale').selectOption('1');
    await nurse.page
      .getByTestId('opd-triage-oxygen-status')
      .selectOption('ROOM_AIR');
    await nurse.page.getByTestId('opd-triage-gcs-eye').selectOption('4');
    await nurse.page.getByTestId('opd-triage-gcs-verbal').selectOption('5');
    await nurse.page.getByTestId('opd-triage-gcs-motor').selectOption('6');
    await nurse.page.getByTestId('opd-triage-height').fill('170');
    await nurse.page.getByTestId('opd-triage-weight').fill('70');
    await nurse.page.getByTestId('opd-triage-submit').click();

    await expect(nurse.page.getByTestId('opd-tab-consultation')).toHaveCount(0);
    await nurse.context.close();

    // 4. Doctor: sign a real SOAP note + principal diagnosis. No ancillary
    // orders are placed in this mandatory core-path qualification.
    const doctorConsult = await loginAs(browser, emails.doctor, encounterId!);
    await selectEncounterTab(doctorConsult.page, 'consultation', encounterId!);

    await doctorConsult.page
      .getByTestId('opd-consultation-subjective')
      .fill('Synthetic staging patient reports stable mild headache without red flags.');
    await doctorConsult.page
      .getByTestId('opd-consultation-objective')
      .fill('Alert, comfortable, clinically stable after normal triage observations.');
    await doctorConsult.page
      .getByTestId('opd-consultation-assessment')
      .fill('Essential hypertension reviewed during controlled staging qualification.');
    await doctorConsult.page
      .getByTestId('opd-consultation-plan')
      .fill('Continue routine outpatient care, safety-net instructions and follow-up.');
    await doctorConsult.page
      .getByTestId('opd-consultation-icd-search')
      .fill('I10');
    await doctorConsult.page.getByTestId('opd-consultation-icd-I10').click();
    await doctorConsult.page.getByTestId('opd-consultation-submit').click();

    await expect(
      doctorConsult.page.getByText('Diagnostics, LIS / RIS and Procedures')
    ).toBeVisible();
    await doctorConsult.context.close();

    // 5. Cashier: with no ancillary orders, there is no second invoice.
    // Final reconciliation must prove all authoritative financial state before
    // unlocking disposition.
    const cashierClose = await loginAs(browser, emails.billing, encounterId!);
    await selectEncounterTab(cashierClose.page, 'billing', encounterId!);
    await expect(
      cashierClose.page.getByText('Final OPD billing reconciliation')
    ).toBeVisible();
    await cashierClose.page.getByTestId('opd-final-reconcile').click();
    await expect(cashierClose.page.getByTestId('opd-final-reconcile')).toHaveText(
      'Billing reconciled'
    );
    await expect(cashierClose.page.getByTestId('opd-tab-disposition')).toHaveCount(
      0
    );
    await cashierClose.context.close();

    // 6. Doctor: commit a routine home discharge and verify the immutable audit
    // surface opens for the same encounter.
    const doctorDisposition = await loginAs(
      browser,
      emails.doctor,
      encounterId!
    );
    await selectEncounterTab(
      doctorDisposition.page,
      'disposition',
      encounterId!
    );
    await doctorDisposition.page
      .getByTestId('opd-disposition-instructions')
      .fill(
        'Continue prescribed outpatient plan and attend scheduled follow-up if symptoms persist.'
      );
    await doctorDisposition.page
      .getByTestId('opd-disposition-warning-signs')
      .fill(
        'Seek emergency care for chest pain, severe breathlessness, syncope or new neurological deficit.'
      );
    await doctorDisposition.page.getByTestId('opd-disposition-submit').click();

    await expect(
      doctorDisposition.page.getByText(
        'Authoritative Encounter Timeline & Audit Provenance'
      )
    ).toBeVisible();
    await expect(
      doctorDisposition.page.getByTestId('opd-active-patient-banner')
    ).toContainText(patientName);

    await doctorDisposition.context.close();
  });
});
