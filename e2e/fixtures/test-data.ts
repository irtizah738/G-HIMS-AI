/**
 * G-HIMS OS E2E Lifecycle Testing Fixture Constants
 * Deterministic test data covering multi-department clinical, surgical,
 * pharmacy (FEFO), billing, and double-entry accounting flows.
 */

export const TEST_TENANT_ID = 'hospital-main';

export const TEST_PATIENT_ADMISSION = {
  mrn: 'MRN-2026-9041',
  fullName: 'Eleanor Vance',
  dateOfBirth: '1974-05-12',
  gender: 'Female',
  bloodGroup: 'A+',
  contactNumber: '+1-555-019-4821',
  nationalId: 'SSN-902-14-8891',
  assignedWard: 'Cardiology Intensive Care (CICU)',
  assignedBed: 'CICU-BED-04',
  admissionType: 'Emergency Inpatient',
  chiefComplaint: 'Acute substernal chest pressure radiating to jaw with diaphoresis',
  insurance: {
    providerName: 'BlueCross Health Premier',
    policyNumber: 'BC-9948201-P',
    groupNumber: 'GRP-CARD-880',
    coveragePercentage: 80,
    patientCopayPercentage: 20,
    deductibleMet: true,
  },
};

export const TEST_STAFF_DOCTOR = {
  staffId: 'DOC-CARD-001',
  name: 'Dr. Arthur Sterling, MD, FACC',
  role: 'Cardiothoracic Surgeon',
  department: 'Cardiology / OR',
  licenseNumber: 'MD-NY-89104',
};

export const TEST_STAFF_NURSE = {
  staffId: 'RN-CICU-042',
  name: 'Sarah Jenkins, BSN, RN, CCRN',
  role: 'Critical Care Registered Nurse',
  department: 'CICU',
  licenseNumber: 'RN-883192',
};

export const TEST_SURGICAL_CASE = {
  caseId: 'OR-CASE-2026-081',
  theaterId: 'OR-THEATER-02 (Hybrid Cardiac)',
  procedureName: 'Emergency Percutaneous Transluminal Angioplasty & Stent Placement',
  whoThreeGate: {
    signIn: {
      patientIdentityConfirmed: true,
      surgicalSiteMarked: true,
      anesthesiaSafetyCheckComplete: true,
      pulseOximeterFunctioning: true,
      knownAllergiesReviewed: true,
      difficultAirwayAssessed: true,
      bloodLossRiskAssessed: true,
      signedBy: 'Dr. Arthur Sterling, MD',
    },
    timeOut: {
      teamIntroduced: true,
      patientNameAnnounced: true,
      procedureConfirmed: true,
      antibioticProphylaxisGivenWithin60Min: true,
      criticalEventsReviewed: true,
      imagingDisplayed: true,
      signedBy: 'Dr. Arthur Sterling, MD',
    },
    signOut: {
      procedureRecorded: true,
      instrumentNeedleSpongeCountCorrect: true,
      specimenLabeled: true,
      equipmentIssuesAddressed: true,
      keyRecoveryConcernsReviewed: true,
      signedBy: 'Sarah Jenkins, RN',
    },
  },
  pacuAldrete: {
    activity: 2, // Moves all 4 extremities
    respiration: 2, // Breathes deeply and coughs freely
    circulation: 2, // BP within 20% of preanesthetic level
    consciousness: 2, // Fully awake
    oxygenSaturation: 2, // SpO2 > 95% on room air
    totalScore: 10, // Max 10/10 Aldrete score for discharge
  },
  surgicalCountVerification: {
    spongesInitial: 20,
    spongesFinal: 20,
    needlesInitial: 12,
    needlesFinal: 12,
    instrumentsInitial: 36,
    instrumentsFinal: 36,
    isCountReconciled: true,
  },
};

export const TEST_PHARMACY_FEFO_ITEMS = [
  {
    itemId: 'DRUG-01',
    name: 'IV Heparin Sodium 5,000 USP Units/mL',
    requiredQty: 2,
    unitCost: 45.0,
    batches: [
      { batchNumber: 'LOT-HEP-2026A', expiryDate: '2026-11-30', stockAvailable: 5, unitPrice: 45.0 },
      { batchNumber: 'LOT-HEP-2027B', expiryDate: '2027-04-15', stockAvailable: 15, unitPrice: 45.0 },
    ],
    selectedBatch: 'LOT-HEP-2026A', // FEFO priority batch
  },
  {
    itemId: 'DRUG-02',
    name: 'IV Nitroglycerin 50mg/250mL D5W Infusion',
    requiredQty: 1,
    unitCost: 85.0,
    batches: [
      { batchNumber: 'LOT-NTG-2026X', expiryDate: '2026-10-15', stockAvailable: 3, unitPrice: 85.0 },
      { batchNumber: 'LOT-NTG-2027Y', expiryDate: '2027-02-28', stockAvailable: 10, unitPrice: 85.0 },
    ],
    selectedBatch: 'LOT-NTG-2026X', // FEFO priority batch
  },
  {
    itemId: 'DRUG-03',
    name: 'Ticagrelor (Brilinta) 90mg Tablets',
    requiredQty: 4,
    unitCost: 12.5,
    batches: [
      { batchNumber: 'LOT-TIC-2027A', expiryDate: '2027-06-30', stockAvailable: 50, unitPrice: 12.5 },
    ],
    selectedBatch: 'LOT-TIC-2027A',
  },
];

export const TEST_BILLING_SUMMARY = {
  bedCharges: 1200.0, // 1 day CICU accommodation
  surgicalProcedureFee: 8500.0, // Angioplasty + Stent
  anesthesiaFee: 1400.0,
  pharmacyTotal: 225.0, // (2*45 + 1*85 + 4*12.5)
  totalGrossAmount: 11325.0,
  insuranceCoverageRate: 0.8, // 80%
  insurancePayable: 9060.0, // $11,325 * 0.80
  patientCopayPayable: 2265.0, // $11,325 * 0.20
};

export const TEST_CHART_OF_ACCOUNTS = {
  arPatientSelfPay: '1100', // Debit 2,265.00
  arInsurancePayers: '1110', // Debit 9,060.00
  inpatientWardRevenue: '4010', // Credit 1,200.00
  orSurgicalRevenue: '4020', // Credit 9,900.00 (8500 surgery + 1400 anesthesia)
  pharmacyRevenue: '4030', // Credit 225.00
};
