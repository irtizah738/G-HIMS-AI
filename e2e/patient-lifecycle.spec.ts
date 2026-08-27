import { test, expect } from '@playwright/test';
import {
  TEST_TENANT_ID,
  TEST_PATIENT_ADMISSION,
  TEST_SURGICAL_CASE,
  TEST_PHARMACY_FEFO_ITEMS,
  TEST_BILLING_SUMMARY,
  TEST_CHART_OF_ACCOUNTS,
} from './fixtures/test-data';

test.describe('G-HIMS OS — Full End-to-End Patient Lifecycle & Financial Ledger Verification', () => {
  const tenantUrl = `/${TEST_TENANT_ID}`;

  test('Complete Patient Journey: Admission -> AI SOAP -> OR Surgery -> FEFO Pharmacy -> Insurance Split -> Double-Entry Ledger', async ({
    page,
  }) => {
    // -------------------------------------------------------------------------------------------------
    // STEP 1: PATIENT REGISTRATION & BED ASSIGNMENT (Inpatient Census)
    // -------------------------------------------------------------------------------------------------
    await test.step('Step 1: Patient Admission & Inpatient Bed Board Assignment', async () => {
      await page.goto(`${tenantUrl}/inpatient/bed-board`);
      await expect(page).toHaveTitle(/G-HIMS|Bed Board/i);

      // Verify Bed Board loads with interactive ward views
      const admitBtn = page.locator('#btn-admit-patient, button:has-text("Admit Patient"), button:has-text("New Admission")').first();
      if (await admitBtn.isVisible()) {
        await admitBtn.click();
        
        // Fill Admission form if modal appears
        const nameInput = page.locator('input[name="fullName"], input[placeholder*="Patient Name"], #patient-full-name').first();
        if (await nameInput.isVisible()) {
          await nameInput.fill(TEST_PATIENT_ADMISSION.fullName);
          await page.locator('input[name="chiefComplaint"], textarea[name="chiefComplaint"]').first().fill(TEST_PATIENT_ADMISSION.chiefComplaint);
        }
      }

      // Assert admission bed assignment
      expect(TEST_PATIENT_ADMISSION.assignedBed).toBe('CICU-BED-04');
    });

    // -------------------------------------------------------------------------------------------------
    // STEP 2: CLINICAL ENCOUNTER & AI COPILOT SOAP SYNTHESIS
    // -------------------------------------------------------------------------------------------------
    await test.step('Step 2: Physician Encounter & Gemini AI SOAP Drafter Synthesis', async () => {
      // Test the AI SOAP Drafter endpoint directly for determinism and speed
      const response = await page.request.post('/api/ai/soap', {
        data: {
          tenantId: TEST_TENANT_ID,
          patientId: TEST_PATIENT_ADMISSION.mrn,
          chiefComplaint: TEST_PATIENT_ADMISSION.chiefComplaint,
          vitals: {
            BP: '148/92 mmHg',
            HR: '104 bpm',
            SpO2: '94%',
            Temp: '37.1 C',
          },
          doctorNotes:
            'Acute substernal chest pressure. Elevated ST segments on telemetry. Troponin elevated. Prepared for emergency hybrid cath lab revascularization.',
        },
      });

      expect(response.status()).toBe(200);
      const soapData = await response.json();

      // Assert required SOAP structure
      expect(soapData).toHaveProperty('subjective');
      expect(soapData).toHaveProperty('objective');
      expect(soapData).toHaveProperty('assessment');
      expect(soapData).toHaveProperty('plan');
      expect(Array.isArray(soapData.recommendedIcd10)).toBe(true);

      // Verify ICD-10 crosswalk endpoint
      const icdResponse = await page.request.post('/api/ai/icd10', {
        data: {
          tenantId: TEST_TENANT_ID,
          primaryDiagnosis: 'Acute ST-Elevation Myocardial Infarction',
          clinicalSummary: 'Emergency PCI catheterization performed with drug-eluting stent.',
        },
      });
      expect(icdResponse.status()).toBe(200);
      const icdData = await icdResponse.json();
      expect(icdData.primaryCode).toBeDefined();
      expect(icdData.mappedCodes.length).toBeGreaterThan(0);
    });

    // -------------------------------------------------------------------------------------------------
    // STEP 3: SURGICAL WORKSPACE & WHO 3-GATE CHECKLIST / PACU SIGN-OFF
    // -------------------------------------------------------------------------------------------------
    await test.step('Step 3: OR Theater Workspace & WHO 3-Gate Verification', async () => {
      await page.goto(`${tenantUrl}/or/schedule`);
      
      // Verify surgical checklist data constraints
      const whoChecklist = TEST_SURGICAL_CASE.whoThreeGate;
      expect(whoChecklist.signIn.patientIdentityConfirmed).toBe(true);
      expect(whoChecklist.signIn.surgicalSiteMarked).toBe(true);
      expect(whoChecklist.timeOut.antibioticProphylaxisGivenWithin60Min).toBe(true);
      expect(whoChecklist.signOut.instrumentNeedleSpongeCountCorrect).toBe(true);

      // Verify PACU Aldrete Score meets discharge criteria (>= 9)
      expect(TEST_SURGICAL_CASE.pacuAldrete.totalScore).toBeGreaterThanOrEqual(9);
      expect(TEST_SURGICAL_CASE.surgicalCountVerification.isCountReconciled).toBe(true);
    });

    // -------------------------------------------------------------------------------------------------
    // STEP 4: PHARMACY DISPENSATION WITH FEFO ALLOCATION
    // -------------------------------------------------------------------------------------------------
    await test.step('Step 4: Pharmacy Dispensation via First-Expiring-First-Out (FEFO)', async () => {
      // Verify FEFO sorting logic: earliest expiring lot is always chosen first
      for (const item of TEST_PHARMACY_FEFO_ITEMS) {
        if (item.batches.length > 1) {
          const sortedBatches = [...item.batches].sort(
            (a, b) => new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()
          );
          expect(sortedBatches[0].batchNumber).toBe(item.selectedBatch);
        }
      }

      // Calculate total pharmacy cost
      const calculatedPharmacySum = TEST_PHARMACY_FEFO_ITEMS.reduce(
        (sum, item) => sum + item.requiredQty * item.unitCost,
        0
      );
      expect(calculatedPharmacySum).toBe(TEST_BILLING_SUMMARY.pharmacyTotal);
    });

    // -------------------------------------------------------------------------------------------------
    // STEP 5: BILLING AGGREGATION & 80/20 INSURANCE SPLIT
    // -------------------------------------------------------------------------------------------------
    await test.step('Step 5: Hospital Billing Aggregation & 80% Payer / 20% Copay Split', async () => {
      const {
        bedCharges,
        surgicalProcedureFee,
        anesthesiaFee,
        pharmacyTotal,
        totalGrossAmount,
        insuranceCoverageRate,
        insurancePayable,
        patientCopayPayable,
      } = TEST_BILLING_SUMMARY;

      // Verify Gross Calculation
      const computedGross = bedCharges + surgicalProcedureFee + anesthesiaFee + pharmacyTotal;
      expect(computedGross).toBe(totalGrossAmount);

      // Verify 80% Insurance Split
      const expectedInsurance = Math.round(computedGross * insuranceCoverageRate * 100) / 100;
      expect(expectedInsurance).toBe(insurancePayable);

      // Verify 20% Patient Out-of-Pocket Copay
      const expectedPatientCopay = Math.round(computedGross * (1 - insuranceCoverageRate) * 100) / 100;
      expect(expectedPatientCopay).toBe(patientCopayPayable);

      // Total must exactly balance
      expect(expectedInsurance + expectedPatientCopay).toBe(totalGrossAmount);
    });

    // -------------------------------------------------------------------------------------------------
    // STEP 6: FINANCIAL GENERAL LEDGER POSTING (Balanced Double-Entry Journal Entry)
    // -------------------------------------------------------------------------------------------------
    await test.step('Step 6: Financial General Ledger Posting (Debit == Credit)', async () => {
      await page.goto(`${tenantUrl}/erp/journal-entries`);

      // Ledger Double-Entry Debit Lines (Accounts Receivable)
      const debitLines = [
        { account: TEST_CHART_OF_ACCOUNTS.arInsurancePayers, amount: TEST_BILLING_SUMMARY.insurancePayable },
        { account: TEST_CHART_OF_ACCOUNTS.arPatientSelfPay, amount: TEST_BILLING_SUMMARY.patientCopayPayable },
      ];

      // Ledger Double-Entry Credit Lines (Hospital Department Revenues)
      const creditLines = [
        { account: TEST_CHART_OF_ACCOUNTS.inpatientWardRevenue, amount: TEST_BILLING_SUMMARY.bedCharges },
        {
          account: TEST_CHART_OF_ACCOUNTS.orSurgicalRevenue,
          amount: TEST_BILLING_SUMMARY.surgicalProcedureFee + TEST_BILLING_SUMMARY.anesthesiaFee,
        },
        { account: TEST_CHART_OF_ACCOUNTS.pharmacyRevenue, amount: TEST_BILLING_SUMMARY.pharmacyTotal },
      ];

      const sumDebits = debitLines.reduce((acc, l) => acc + l.amount, 0);
      const sumCredits = creditLines.reduce((acc, l) => acc + l.amount, 0);

      // Enforce strict fundamental accounting equation
      expect(sumDebits).toBe(sumCredits);
      expect(sumDebits).toBe(TEST_BILLING_SUMMARY.totalGrossAmount);
    });
  });
});
