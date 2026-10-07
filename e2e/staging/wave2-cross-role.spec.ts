import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

const tenantId = String(
  process.env.GHIMS_P7_TENANT_ID || 'p7-hospital-zero'
).trim().toLowerCase();
const confirmedTenant = String(
  process.env.GHIMS_WAVE2_CONFIRM_TENANT || ''
).trim().toLowerCase();
const password = String(process.env.GHIMS_P7_BOOTSTRAP_PASSWORD || '');
const patientId = String(process.env.GHIMS_WAVE2_PATIENT_ID || '').trim();
const encounterId = String(
  process.env.GHIMS_WAVE2_IPD_ENCOUNTER_ID || ''
).trim();
const medicationOrderId = String(
  process.env.GHIMS_WAVE2_ACTIVE_MEDICATION_ORDER_ID || ''
).trim();
const evidenceId = String(process.env.GHIMS_WAVE2_EVIDENCE_ID || '').trim();
const acceptedHandoffId = String(
  process.env.GHIMS_WAVE2_ACCEPTED_HANDOFF_ID || ''
).trim();

const emails = {
  doctor: process.env.GHIMS_P7_DOCTOR_EMAIL || 'p7.doctor@g-hims.invalid',
  nurse: process.env.GHIMS_P7_NURSE_EMAIL || 'p7.nurse@g-hims.invalid',
};

function assertEnvironment() {
  if (!tenantId || confirmedTenant !== tenantId) {
    throw new Error(
      'WAVE2_TENANT_CONFIRMATION_REQUIRED: GHIMS_WAVE2_CONFIRM_TENANT must exactly match GHIMS_P7_TENANT_ID.'
    );
  }
  if (password.length < 16) {
    throw new Error(
      'WAVE2_PASSWORD_REQUIRED: GHIMS_P7_BOOTSTRAP_PASSWORD must contain the provisioned staging credential.'
    );
  }
  const fixtures = {
    GHIMS_WAVE2_PATIENT_ID: patientId,
    GHIMS_WAVE2_IPD_ENCOUNTER_ID: encounterId,
    GHIMS_WAVE2_ACTIVE_MEDICATION_ORDER_ID: medicationOrderId,
    GHIMS_WAVE2_EVIDENCE_ID: evidenceId,
    GHIMS_WAVE2_ACCEPTED_HANDOFF_ID: acceptedHandoffId,
  };
  const missing = Object.entries(fixtures)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    throw new Error(
      `WAVE2_FIXTURE_REQUIRED: disposable staging fixture is incomplete: ${missing.join(', ')}`
    );
  }
}

async function login(
  browser: Browser,
  email: string
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto('/login');
  await page.getByTestId('login-tenant-id').fill(tenantId);
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL((url) => url.pathname !== '/login', {
    timeout: 40_000,
  });
  await page.goto(`/${encodeURIComponent(tenantId)}`);
  return { context, page };
}

async function openDomain(
  page: Page,
  moduleId: string,
  tab: 'nursing' | 'renal' | 'obstetrics' | 'oncology' | 'rehabilitation'
) {
  const nav = page.locator(`#sidebar-nav-${moduleId}`);
  await expect(nav).toBeVisible();
  await nav.click();
  await expect(page.getByTestId('wave2-clinical-workspace')).toBeVisible();
  await page.getByTestId(`wave2-tab-${tab}`).click();
  await page.getByTestId('wave2-patient-id').fill(patientId);
  await page.getByTestId('wave2-encounter-id').fill(encounterId);
  await page.getByTestId('wave2-load-workspace').click();
  await expect(page.getByTestId('wave2-message')).toContainText(
    'Authoritative Wave 2 workspace loaded'
  );
}

function localDateTimeInput(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    '-',
    pad(date.getMonth() + 1),
    '-',
    pad(date.getDate()),
    'T',
    pad(date.getHours()),
    ':',
    pad(date.getMinutes()),
  ].join('');
}

test.describe.serial('Wave 2 deployed cross-role staging qualification', () => {
  let emarSlotId = '';
  let medicationAdministrationId = '';

  test.beforeAll(async ({ request }) => {
    assertEnvironment();
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

  test('Doctor creates order-bound eMAR slot and nursing plan', async ({
    browser,
  }) => {
    const doctor = await login(browser, emails.doctor);
    await openDomain(doctor.page, 'nursing-emar', 'nursing');

    await doctor.page
      .getByTestId('wave2-medication-order')
      .selectOption(medicationOrderId);
    await doctor.page
      .getByTestId('wave2-emar-scheduled-for')
      .fill(localDateTimeInput(Date.now() + 5 * 60_000));
    await doctor.page.getByTestId('wave2-emar-schedule').click();
    await expect(doctor.page.getByTestId('wave2-message')).toContainText(
      'Committed:'
    );

    await doctor.page.getByLabel('Plan title').fill('Wave 2 staging nursing plan');
    await doctor.page
      .getByLabel('Goals (one per line)')
      .fill('Maintain safe medication administration');
    await doctor.page
      .getByLabel('Interventions (one per line)')
      .fill('Administer medication per governed eMAR slot');
    await doctor.page
      .getByRole('button', { name: 'Create nursing care plan' })
      .click();
    await expect(doctor.page.getByTestId('wave2-message')).toContainText(
      'Committed:'
    );

    await doctor.context.close();
  });

  test('Nurse administers scheduled medication and closes intervention', async ({
    browser,
  }) => {
    const nurse = await login(browser, emails.nurse);
    await openDomain(nurse.page, 'nursing-emar', 'nursing');

    const slot = nurse.page.getByTestId('wave2-emar-slot');
    await expect(slot).not.toHaveValue('');
    emarSlotId = await slot.inputValue();
    expect(emarSlotId).toBeTruthy();
    medicationAdministrationId = `medadm_${emarSlotId}`;

    await nurse.page.getByTestId('wave2-emar-outcome').selectOption('GIVEN');
    await nurse.page.getByTestId('wave2-emar-administer').click();
    await expect(nurse.page.getByTestId('wave2-message')).toContainText(
      'Committed:'
    );

    await nurse.page.getByLabel('New status').selectOption('COMPLETED');
    await nurse.page
      .getByRole('button', { name: 'Update intervention' })
      .click();
    await expect(nurse.page.getByTestId('wave2-message')).toContainText(
      'Committed:'
    );

    await nurse.context.close();
  });

  test('Doctor orders dialysis; nurse executes and completes session', async ({
    browser,
  }) => {
    const doctor = await login(browser, emails.doctor);
    await openDomain(doctor.page, 'dialysis-nephrology', 'renal');
    await doctor.page.getByLabel('Vascular access plan').fill('Existing AV fistula');
    await doctor.page.getByRole('button', { name: 'Create dialysis order' }).click();
    await expect(doctor.page.getByTestId('wave2-message')).toContainText(
      'Committed:'
    );
    await doctor.context.close();

    const nurse = await login(browser, emails.nurse);
    await openDomain(nurse.page, 'dialysis-nephrology', 'renal');
    await nurse.page.getByLabel('Machine ID').fill('WAVE2-STAGING-HD-01');
    await nurse.page.getByLabel('Pre-dialysis weight (kg)').fill('70');
    await nurse.page.getByRole('button', { name: 'Start dialysis session' }).click();
    await expect(nurse.page.getByTestId('wave2-message')).toContainText(
      'Committed:'
    );

    await nurse.page.getByLabel('Post-dialysis weight (kg)').fill('68.5');
    await nurse.page.getByLabel('Ultrafiltration (mL)').fill('1500');
    await nurse.page
      .getByRole('button', { name: 'Complete dialysis session' })
      .click();
    await expect(nurse.page.getByTestId('wave2-message')).toContainText(
      'Committed:'
    );
    await nurse.context.close();
  });

  test('Doctor and nurse complete governed obstetric timeline', async ({
    browser,
  }) => {
    const doctor = await login(browser, emails.doctor);
    await openDomain(
      doctor.page,
      'maternity-labor-delivery',
      'obstetrics'
    );
    await doctor.page.getByRole('button', { name: 'Open obstetric episode' }).click();
    await expect(doctor.page.getByTestId('wave2-message')).toContainText(
      'Committed:'
    );
    await doctor.context.close();

    const nurse = await login(browser, emails.nurse);
    await openDomain(nurse.page, 'maternity-labor-delivery', 'obstetrics');
    await nurse.page.getByLabel('Fetal HR').fill('140');
    await nurse.page.getByLabel('Cervical dilation cm').fill('5');
    await nurse.page.getByLabel('Maternal HR').fill('88');
    await nurse.page.getByLabel('Systolic BP').fill('120');
    await nurse.page.getByLabel('Diastolic BP').fill('80');
    await nurse.page.getByLabel('Contractions / 10 min').fill('3');
    await nurse.page.getByRole('button', { name: 'Record partogram' }).click();
    await expect(nurse.page.getByTestId('wave2-message')).toContainText(
      'Committed:'
    );
    await nurse.context.close();

    const doctorTransition = await login(browser, emails.doctor);
    await openDomain(
      doctorTransition.page,
      'maternity-labor-delivery',
      'obstetrics'
    );
    await doctorTransition.page.getByLabel('Target stage').selectOption('LABOR');
    await doctorTransition.page
      .getByLabel('Clinical reason')
      .fill('Active labor confirmed on clinical examination.');
    await doctorTransition.page
      .getByRole('button', { name: 'Commit stage transition' })
      .click();
    await expect(
      doctorTransition.page.getByTestId('wave2-message')
    ).toContainText('Committed:');

    await doctorTransition.page.getByLabel('Target stage').selectOption('DELIVERY');
    await doctorTransition.page
      .getByLabel('Clinical reason')
      .fill('Progression to delivery stage documented.');
    await doctorTransition.page
      .getByRole('button', { name: 'Commit stage transition' })
      .click();
    await expect(
      doctorTransition.page.getByTestId('wave2-message')
    ).toContainText('Committed:');

    await doctorTransition.page
      .getByLabel('Maternal outcome')
      .fill('Stable after synthetic staging delivery.');
    await doctorTransition.page
      .getByLabel('Neonatal outcome')
      .fill('Stable synthetic staging newborn outcome.');
    await doctorTransition.page
      .getByRole('button', { name: 'Record delivery outcome' })
      .click();
    await expect(
      doctorTransition.page.getByTestId('wave2-message')
    ).toContainText('Committed:');
    await doctorTransition.context.close();
  });

  test('Doctor completes oncology evidence → board → regimen → administration → toxicity chain', async ({
    browser,
  }) => {
    const doctor = await login(browser, emails.doctor);
    await openDomain(doctor.page, 'oncology-tumor-board', 'oncology');

    const caseCard = doctor.page
      .locator('section')
      .filter({ hasText: 'Oncology case' });
    await caseCard
      .getByLabel('Primary diagnosis')
      .fill('Synthetic staging oncology diagnosis');
    await caseCard
      .getByRole('button', { name: new RegExp(evidenceId) })
      .click();
    await caseCard
      .getByRole('button', { name: 'Open evidence-linked case' })
      .click();
    await expect(doctor.page.getByTestId('wave2-message')).toContainText(
      'Committed:'
    );

    const boardCard = doctor.page
      .locator('section')
      .filter({ hasText: 'Tumor board' });
    await boardCard
      .getByLabel('Attendees')
      .fill('staging-doctor-1\nstaging-doctor-2');
    await boardCard
      .getByLabel('Recommendation')
      .fill('Proceed with synthetic staging regimen after multidisciplinary review.');
    if (
      !(await boardCard
        .getByRole('button', { name: new RegExp(evidenceId) })
        .getAttribute('class'))?.includes('bg-slate-900')
    ) {
      await boardCard
        .getByRole('button', { name: new RegExp(evidenceId) })
        .click();
    }
    await boardCard
      .getByRole('button', { name: 'Record tumor board recommendation' })
      .click();
    await expect(doctor.page.getByTestId('wave2-message')).toContainText(
      'Committed:'
    );

    const regimenCard = doctor.page
      .locator('section')
      .filter({ hasText: 'Regimen approval' });
    await regimenCard.getByLabel('Regimen name').fill('WAVE2-STAGING-REGIMEN');
    await regimenCard
      .getByRole('button', { name: new RegExp(medicationOrderId) })
      .click();
    await regimenCard.getByRole('button', { name: 'Approve regimen' }).click();
    await expect(doctor.page.getByTestId('wave2-message')).toContainText(
      'Committed:'
    );

    const chemoCard = doctor.page
      .locator('section')
      .filter({ hasText: 'Chemotherapy administration linkage' });
    await chemoCard
      .getByLabel('Given medication administration')
      .selectOption(medicationAdministrationId);
    await chemoCard
      .getByRole('button', { name: 'Link chemotherapy administration' })
      .click();
    await expect(doctor.page.getByTestId('wave2-message')).toContainText(
      'Committed:'
    );

    const toxicityCard = doctor.page
      .locator('section')
      .filter({ hasText: 'Toxicity monitoring' });
    await toxicityCard.getByLabel('Toxicity grade 0–5').fill('1');
    await toxicityCard
      .getByLabel('Findings')
      .fill('Mild synthetic staging toxicity finding.');
    await toxicityCard
      .getByRole('button', { name: 'Record toxicity assessment' })
      .click();
    await expect(doctor.page.getByTestId('wave2-message')).toContainText(
      'Committed:'
    );
    await doctor.context.close();
  });

  test('Doctor completes rehabilitation plan through accepted handoff', async ({
    browser,
  }) => {
    const doctor = await login(browser, emails.doctor);
    await openDomain(doctor.page, 'rehab-physical-therapy', 'rehabilitation');

    await doctor.page
      .getByLabel('Goals')
      .fill('Independent safe transfer for synthetic staging qualification');
    await doctor.page
      .getByRole('button', { name: 'Create rehabilitation plan' })
      .click();
    await expect(doctor.page.getByTestId('wave2-message')).toContainText(
      'Committed:'
    );

    await doctor.page
      .getByLabel('Session outcome')
      .fill('Goal practiced and tolerated during synthetic staging session.');
    await doctor.page
      .getByRole('button', { name: 'Record therapy session' })
      .click();
    await expect(doctor.page.getByTestId('wave2-message')).toContainText(
      'Committed:'
    );

    await doctor.page
      .getByRole('button', { name: 'Mark goal achieved' })
      .click();
    await expect(doctor.page.getByTestId('wave2-message')).toContainText(
      'Committed:'
    );

    await doctor.page
      .getByLabel('Accepted clinical handoff')
      .selectOption(acceptedHandoffId);
    await doctor.page
      .getByRole('button', { name: 'Complete rehabilitation plan' })
      .click();
    await expect(doctor.page.getByTestId('wave2-message')).toContainText(
      'Committed:'
    );

    await doctor.context.close();
  });
});
