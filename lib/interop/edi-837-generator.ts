/**
 * G-HIMS ANSI ASC X12 EDI structural encoder/parser.
 *
 * IMPORTANT: this code performs deterministic structural validation only. It is not a
 * substitute for payer-specific companion-guide validation, clearinghouse certification,
 * HIPAA transaction certification, or external conformance testing.
 */

export interface EdiClaimPayer {
  payerId: string;
  name: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface EdiClaimProvider {
  npi: string;
  taxId: string;
  lastName: string;
  firstName: string;
  facilityName: string;
  facilityAddress: string;
  city: string;
  state: string;
  zip: string;
}

export interface EdiClaimPatient {
  mrn: string;
  lastName: string;
  firstName: string;
  gender: 'M' | 'F' | 'U';
  dob: string; // YYYYMMDD
  address: string;
  city: string;
  state: string;
  zip: string;
  memberId: string;
  relationshipToInsured: '18' | '01' | '19'; // 18 = Self, 01 = Spouse, 19 = Child
}

export interface EdiClaimServiceLine {
  lineItemNumber: number;
  cptCode: string;
  modifiers?: string[];
  chargeAmount: number; // in cents or dollars (represented as decimal in X12: e.g. 150.00)
  unitCount: number;
  serviceDate: string; // YYYYMMDD
  diagnosisPointers: number[]; // e.g. [1, 2]
}

export interface Edi837ClaimPayload {
  controlNumber: string;
  claimId: string;
  totalBilledAmount: number;
  payer: EdiClaimPayer;
  billingProvider: EdiClaimProvider;
  patient: EdiClaimPatient;
  icd10Codes: string[];
  serviceLines: EdiClaimServiceLine[];
  priorAuthNumber?: string;
}

export interface Edi835RemittanceAdvice {
  checkNumber: string;
  paymentMethod: 'ACH' | 'CHK' | 'NON';
  totalPaidAmount: number;
  paymentDate: string;
  payerName: string;
  payeeNpi: string;
  claims: Array<{
    claimId: string;
    patientControlNumber: string;
    billedAmount: number;
    paidAmount: number;
    patientResponsibility: number;
    adjudicationStatus: 'PROCESSED_AS_PRIMARY' | 'DENIED' | 'PROCESSED_AS_SECONDARY';
    adjustments: Array<{
      groupCode: 'CO' | 'PR' | 'OA' | 'CR'; // Contractual Obligation, Patient Responsibility, etc.
      reasonCode: string; // e.g. 45 (charge exceeds fee schedule), 97 (benefit included in other service)
      amount: number;
    }>;
  }>;
}

export interface EdiConformanceReport {
  valid: boolean;
  level: 'STRUCTURAL_ONLY';
  certifiedExternalConformance: false;
  errors: string[];
  warnings: string[];
}

function isYyyyMmDd(value: string): boolean {
  return /^\d{8}$/.test(value);
}

function validateClaimPayload(claim: Edi837ClaimPayload): void {
  const errors: string[] = [];
  if (!claim.controlNumber) errors.push('controlNumber is required');
  if (!claim.claimId) errors.push('claimId is required');
  if (!(claim.totalBilledAmount > 0)) errors.push('totalBilledAmount must be positive');
  if (!claim.payer?.payerId) errors.push('payer.payerId is required');
  if (!claim.billingProvider?.npi || !/^\d{10}$/.test(claim.billingProvider.npi)) errors.push('billingProvider.npi must be 10 digits');
  if (!claim.patient?.memberId) errors.push('patient.memberId is required');
  if (!isYyyyMmDd(claim.patient?.dob || '')) errors.push('patient.dob must be YYYYMMDD');
  if (!Array.isArray(claim.icd10Codes) || claim.icd10Codes.length === 0) errors.push('at least one ICD-10 code is required');
  if (!Array.isArray(claim.serviceLines) || claim.serviceLines.length === 0) errors.push('at least one service line is required');
  for (const line of claim.serviceLines || []) {
    if (!line.cptCode) errors.push('service line CPT/HCPCS code is required');
    if (!(line.chargeAmount >= 0)) errors.push('service line chargeAmount must be non-negative');
    if (!(line.unitCount > 0)) errors.push('service line unitCount must be positive');
    if (!isYyyyMmDd(line.serviceDate)) errors.push('service line serviceDate must be YYYYMMDD');
    if (!Array.isArray(line.diagnosisPointers) || line.diagnosisPointers.length === 0) errors.push('service line diagnosisPointers are required');
  }
  if (errors.length > 0) {
    throw new Error('EDI_CLAIM_VALIDATION_FAILED: ' + errors.join('; '));
  }
}

export class Edi837Generator {
  /**
   * Generates a structurally validated ANSI X12 837P transaction candidate.
   * External payer/clearinghouse conformance certification is still required before LIVE use.
   */
  public static generate837P(claim: Edi837ClaimPayload): string {
    validateClaimPayload(claim);
    const today = new Date();
    const dateStr = today.toISOString().slice(0, 10).replace(/-/g, '');
    const timeStr = today.toTimeString().slice(0, 5).replace(/:/g, '');
    const ctrlNum = claim.controlNumber.padStart(9, '0').slice(-9);

    const segments: string[] = [];

    // Interchange Control Header
    segments.push(`ISA*00*          *00*          *ZZ*GHIMS_HOSPITAL *ZZ*${claim.payer.payerId.padEnd(15)}*${dateStr.slice(2)}*${timeStr}*^*00501*${ctrlNum}*0*P*:~`);
    
    // Functional Group Header (HC = Health Care Claim)
    segments.push(`GS*HC*GHIMS_HOSPITAL*${claim.payer.payerId}*${dateStr}*${timeStr}*1*X*005010X222A1~`);

    // Transaction Set Header (837 = Health Care Claim)
    segments.push(`ST*837*${ctrlNum}*005010X222A1~`);
    segments.push(`BHT*0019*00*${claim.claimId}*${dateStr}*${timeStr}*CH~`);

    // Loop 1000A - Submitter Name
    segments.push(`NM1*41*2*CENTRAL METRO HEALTH SYSTEM*****46*GHIMS001~`);
    segments.push(`PER*IC*EDI OPERATIONS*TE*5550192834*EM*edi@centralmetro.health~`);

    // Loop 1000B - Receiver Name
    segments.push(`NM1*40*2*${claim.payer.name}*****46*${claim.payer.payerId}~`);

    // Loop 2000A - Billing Provider Hierarchical Level (HL*1**20*1)
    segments.push(`HL*1**20*1~`);
    segments.push(`PRV*BI*PXC*207Q00000X~`);
    segments.push(`NM1*85*2*${claim.billingProvider.facilityName}*****XX*${claim.billingProvider.npi}~`);
    segments.push(`N3*${claim.billingProvider.facilityAddress}~`);
    segments.push(`N4*${claim.billingProvider.city}*${claim.billingProvider.state}*${claim.billingProvider.zip}~`);
    segments.push(`REF*EI*${claim.billingProvider.taxId.replace(/-/g, '')}~`);

    // Loop 2000B - Subscriber Hierarchical Level (HL*2*1*22*0)
    segments.push(`HL*2*1*22*0~`);
    segments.push(`SBR*P*18*******CI~`); // P = Primary, 18 = Self, CI = Commercial Insurance
    segments.push(`NM1*IL*1*${claim.patient.lastName}*${claim.patient.firstName}****MI*${claim.patient.memberId}~`);
    segments.push(`N3*${claim.patient.address}~`);
    segments.push(`N4*${claim.patient.city}*${claim.patient.state}*${claim.patient.zip}~`);
    segments.push(`DMG*D8*${claim.patient.dob}*${claim.patient.gender}~`);

    // Loop 2010BB - Payer Name
    segments.push(`NM1*PR*2*${claim.payer.name}*****PI*${claim.payer.payerId}~`);

    // Loop 2300 - Claim Information
    segments.push(`CLM*${claim.claimId}*${claim.totalBilledAmount.toFixed(2)}***11:B:1*Y*A*Y*Y~`);
    
    // Principal Diagnoses (HI Segments)
    const hiSegments = claim.icd10Codes.map((code, idx) => {
      const qualifier = idx === 0 ? 'ABK' : 'ABF'; // ABK = Primary, ABF = Secondary
      return `${qualifier}:${code.replace('.', '')}`;
    }).join('*');
    if (hiSegments) {
      segments.push(`HI*${hiSegments}~`);
    }

    if (claim.priorAuthNumber) {
      segments.push(`REF*G1*${claim.priorAuthNumber}~`);
    }

    // Loop 2400 - Service Lines
    claim.serviceLines.forEach((line) => {
      const modifierStr = line.modifiers && line.modifiers.length > 0 ? `:${line.modifiers.join(':')}` : '';
      const diagPointers = line.diagnosisPointers.join(':');
      segments.push(`LX*${line.lineItemNumber}~`);
      segments.push(`SV1*HC:${line.cptCode}${modifierStr}*${line.chargeAmount.toFixed(2)}*UN*${line.unitCount}***${diagPointers}~`);
      segments.push(`DTP*472*D8*${line.serviceDate}~`);
    });

    // Transaction Set Trailer
    const segmentCount = segments.length + 1; // including SE
    segments.push(`SE*${segmentCount}*${ctrlNum}~`);

    // Functional Group Trailer
    segments.push(`GE*1*1~`);

    // Interchange Control Trailer
    segments.push(`IEA*1*${ctrlNum}~`);

    const edi = segments.join('\n');
    const report = this.validate837PStructure(edi);
    if (!report.valid) {
      throw new Error('EDI_STRUCTURAL_VALIDATION_FAILED: ' + report.errors.join('; '));
    }
    return edi;
  }

  public static validate837PStructure(ediText: string): EdiConformanceReport {
    const segments = String(ediText || '').split('~').map((s) => s.trim()).filter(Boolean);
    const errors: string[] = [];
    const warnings: string[] = [
      'Structural validation only; payer companion-guide and clearinghouse certification remain required.',
    ];

    const required = ['ISA', 'GS', 'ST', 'BHT', 'CLM', 'SE', 'GE', 'IEA'];
    for (const tag of required) {
      if (!segments.some((segment) => segment.startsWith(tag + '*'))) {
        errors.push('Missing required segment ' + tag);
      }
    }

    const st = segments.find((segment) => segment.startsWith('ST*'))?.split('*') || [];
    const se = segments.find((segment) => segment.startsWith('SE*'))?.split('*') || [];
    if (st[2] && se[2] && st[2] !== se[2]) {
      errors.push('ST02 and SE02 transaction control numbers do not match');
    }

    const isa = segments.find((segment) => segment.startsWith('ISA*'))?.split('*') || [];
    const iea = segments.find((segment) => segment.startsWith('IEA*'))?.split('*') || [];
    if (isa[13] && iea[2] && isa[13] !== iea[2]) {
      errors.push('ISA13 and IEA02 interchange control numbers do not match');
    }

    const seIndex = segments.findIndex((segment) => segment.startsWith('SE*'));
    const stIndex = segments.findIndex((segment) => segment.startsWith('ST*'));
    if (stIndex >= 0 && seIndex >= stIndex && se[1]) {
      const declared = Number.parseInt(se[1], 10);
      const actual = seIndex - stIndex + 1;
      if (declared !== actual) errors.push('SE01 segment count does not match transaction-set segment count');
    }

    return {
      valid: errors.length === 0,
      level: 'STRUCTURAL_ONLY',
      certifiedExternalConformance: false,
      errors,
      warnings,
    };
  }

  /**
   * Scans and parses an ANSI X12 835 Remittance Advice response.
   */
  public static parse835(ediText: string): Edi835RemittanceAdvice {
    const cleanLines = ediText
      .split('~')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    let checkNumber = 'ELECTRONIC-EFT';
    let paymentMethod: 'ACH' | 'CHK' | 'NON' = 'ACH';
    let totalPaid = 0;
    let paymentDate = new Date().toISOString().slice(0, 10);
    let payerName = 'Unknown Payer';
    let payeeNpi = '';
    const claims: Edi835RemittanceAdvice['claims'] = [];

    let currentClaim: Edi835RemittanceAdvice['claims'][0] | null = null;

    for (const segment of cleanLines) {
      const elements = segment.split('*');
      const tag = elements[0];

      if (tag === 'BPR') {
        // Financial Information
        totalPaid = parseFloat(elements[2]) || 0;
        paymentMethod = elements[4] === 'CHK' ? 'CHK' : 'ACH';
        if (elements[16]) {
          paymentDate = elements[16];
        }
      } else if (tag === 'TRN') {
        // Trace Number / Check Number
        checkNumber = elements[2] || checkNumber;
      } else if (tag === 'N1' && elements[1] === 'PR') {
        payerName = elements[2] || payerName;
      } else if (tag === 'N1' && elements[1] === 'PE') {
        payeeNpi = elements[4] || payeeNpi;
      } else if (tag === 'CLP') {
        // Claim Level Data
        if (currentClaim) {
          claims.push(currentClaim);
        }
        const claimId = elements[1];
        const statusVal = elements[2];
        const billed = parseFloat(elements[3]) || 0;
        const paid = parseFloat(elements[4]) || 0;
        const patResp = parseFloat(elements[5]) || 0;

        let status: 'PROCESSED_AS_PRIMARY' | 'DENIED' | 'PROCESSED_AS_SECONDARY' = 'PROCESSED_AS_PRIMARY';
        if (statusVal === '4' || paid === 0) {
          status = 'DENIED';
        } else if (statusVal === '2') {
          status = 'PROCESSED_AS_SECONDARY';
        }

        currentClaim = {
          claimId,
          patientControlNumber: claimId,
          billedAmount: billed,
          paidAmount: paid,
          patientResponsibility: patResp,
          adjudicationStatus: status,
          adjustments: [],
        };
      } else if (tag === 'CAS' && currentClaim) {
        // Claim Adjustment Segment
        const groupCode = (elements[1] as 'CO' | 'PR' | 'OA' | 'CR') || 'CO';
        const reasonCode = elements[2] || '45';
        const adjAmount = parseFloat(elements[3]) || 0;

        currentClaim.adjustments.push({
          groupCode,
          reasonCode,
          amount: adjAmount,
        });
      }
    }

    if (currentClaim) {
      claims.push(currentClaim);
    }

    return {
      checkNumber,
      paymentMethod,
      totalPaidAmount: totalPaid,
      paymentDate,
      payerName,
      payeeNpi,
      claims,
    };
  }
}
