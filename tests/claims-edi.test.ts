import { describe, it, expect } from 'bun:test';
import { Edi837Generator, Edi837ClaimPayload } from '../lib/interop/edi-837-generator';

describe('G-HIMS ANSI ASC X12 EDI 837/835 Submissions Engine', () => {
  const sampleClaim: Edi837ClaimPayload = {
    controlNumber: '000001092',
    claimId: 'CLM-2026-88192',
    totalBilledAmount: 4850.00,
    payer: {
      payerId: 'BCBS001',
      name: 'BlueCross BlueShield Premier',
    },
    billingProvider: {
      npi: '1982736450',
      taxId: '82-9382104',
      lastName: 'Jenkins',
      firstName: 'Sarah',
      facilityName: 'Central Metro General Hospital',
      facilityAddress: '1000 Hospital Boulevard',
      city: 'Metro City',
      state: 'NY',
      zip: '10001',
    },
    patient: {
      mrn: 'GH-2026-9812',
      lastName: 'Rostova',
      firstName: 'Elena',
      gender: 'F',
      dob: '19820414',
      address: '742 Evergreen Terrace',
      city: 'Metro City',
      state: 'NY',
      zip: '10001',
      memberId: 'BCBS-98123719',
      relationshipToInsured: '18',
    },
    icd10Codes: ['I21.09', 'I50.9'],
    priorAuthNumber: 'PA-2026-99018',
    serviceLines: [
      {
        lineItemNumber: 1,
        cptCode: '99223',
        chargeAmount: 1850.00,
        unitCount: 1,
        serviceDate: '20260813',
        diagnosisPointers: [1],
      },
      {
        lineItemNumber: 2,
        cptCode: '93000',
        chargeAmount: 500.00,
        unitCount: 1,
        serviceDate: '20260813',
        diagnosisPointers: [1, 2],
      },
      {
        lineItemNumber: 3,
        cptCode: '71045',
        chargeAmount: 2500.00,
        unitCount: 1,
        serviceDate: '20260813',
        diagnosisPointers: [2],
      },
    ],
  };

  it('1. Generates standard HIPAA-compliant ANSI ASC X12 837P claim file', () => {
    const ediOutput = Edi837Generator.generate837P(sampleClaim);

    // Verify critical segments
    expect(ediOutput).toContain('ISA*00*');
    expect(ediOutput).toContain('GS*HC*GHIMS_HOSPITAL*BCBS001*');
    expect(ediOutput).toContain('ST*837*');
    expect(ediOutput).toContain('BHT*0019*00*CLM-2026-88192*');
    expect(ediOutput).toContain('NM1*85*2*Central Metro General Hospital*****XX*1982736450~');
    expect(ediOutput).toContain('NM1*IL*1*Rostova*Elena****MI*BCBS-98123719~');
    expect(ediOutput).toContain('CLM*CLM-2026-88192*4850.00***11:B:1*Y*A*Y*Y~');
    expect(ediOutput).toContain('HI*ABK:I2109*ABF:I509~');
    expect(ediOutput).toContain('REF*G1*PA-2026-99018~');
    expect(ediOutput).toContain('SV1*HC:99223*1850.00*UN*1***1~');
    expect(ediOutput).toContain('SE*');
    expect(ediOutput).toContain('IEA*1*');
  });

  it('2. Parses electronic 835 Remittance Advice and detects payer contractual adjustments', () => {
    const raw835 = `
      ISA*00*          *00*          *ZZ*BCBS001        *ZZ*GHIMS_HOSPITAL *260815*1430*^*00501*000000001*0*P*:~
      GS*HP*BCBS001*GHIMS_HOSPITAL*20260815*1430*1*X*005010X221A1~
      ST*835*0001~
      BPR*I*4120.00*C*ACH*CTX*01*999999992*DA*12345678*1234567890*1234567890*01*999999992*DA*87654321*20260815~
      TRN*1*EFT-992019482*1982736450~
      N1*PR*BlueCross BlueShield Premier~
      N1*PE*Central Metro General Hospital*XX*1982736450~
      CLP*CLM-2026-88192*1*4850.00*4120.00*150.00*12*1029384756~
      CAS*CO*45*580.00~
      CAS*PR*1*150.00~
      SE*10*0001~
      GE*1*1~
      IEA*1*000000001~
    `;

    const parsedAdvice = Edi837Generator.parse835(raw835);

    expect(parsedAdvice.payerName).toBe('BlueCross BlueShield Premier');
    expect(parsedAdvice.checkNumber).toBe('EFT-992019482');
    expect(parsedAdvice.totalPaidAmount).toBe(4120.00);
    expect(parsedAdvice.paymentMethod).toBe('ACH');
    expect(parsedAdvice.claims.length).toBe(1);

    const claimResult = parsedAdvice.claims[0];
    expect(claimResult.claimId).toBe('CLM-2026-88192');
    expect(claimResult.billedAmount).toBe(4850.00);
    expect(claimResult.paidAmount).toBe(4120.00);
    expect(claimResult.patientResponsibility).toBe(150.00);
    expect(claimResult.adjudicationStatus).toBe('PROCESSED_AS_PRIMARY');
    expect(claimResult.adjustments.length).toBe(2);

    const contractualObligation = claimResult.adjustments.find((a) => a.groupCode === 'CO');
    expect(contractualObligation?.amount).toBe(580.00);
  });
});
