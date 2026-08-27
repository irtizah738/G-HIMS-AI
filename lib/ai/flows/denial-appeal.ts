import { defineClinicalFlow, getGenAIClient, DEFAULT_CLINICAL_MODEL } from '../genkit-config';

export interface DenialAppealInput {
  claimId: string;
  denialReasonCode: string;
  denialDescription: string;
  patientDemographics: Record<string, unknown>;
  clinicalProcedure: string;
  doctorAttestation: string;
}

export interface DenialAppealOutput {
  appealLetterSubject: string;
  appealLetterBody: string;
  citedMedicalNecessityGuidelines: string[];
  supportingEvidenceRequired: string[];
}

export const generateDenialAppealFlow = defineClinicalFlow<DenialAppealInput, DenialAppealOutput>({
  name: 'generateDenialAppealFlow',
  description: 'Generates formal, legally grounded medical necessity appeal letters for insurance claims denied by commercial and government payers.',
  execute: async (input): Promise<DenialAppealOutput> => {
    const ai = getGenAIClient();

    const demoStr = Object.entries(input.patientDemographics || {})
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ') || 'Patient Record On File';

    if (!ai) {
      return generateFallbackDenialAppeal(input, demoStr);
    }

    const systemPrompt = `You are a Senior Healthcare Appeals Attorney and Physician Utilization Reviewer.
Draft an assertive, medically rigorous, and legally compliant Insurance Denial Appeal Letter contesting an adverse claim adjudication.

STRICT REQUIREMENTS:
1. Reference official Medical Necessity Guidelines (e.g., Milliman Care Guidelines [MCG], InterQual, CMS National Coverage Determinations [NCD/LCD], or AMA CPT conventions).
2. Clearly counter the Payer Denial Reason Code.
3. List the supporting clinical documentation required for expedited reconsideration.
4. Output STRICT JSON ONLY.

JSON Schema:
{
  "appealLetterSubject": "Formal Subject Line with Claim # and Patient MRN",
  "appealLetterBody": "Comprehensive, formal 3-4 paragraph appeal letter with clinical rationale, legal citations, and demand for peer-to-peer review or immediate reversal",
  "citedMedicalNecessityGuidelines": ["Specific guideline citation strings"],
  "supportingEvidenceRequired": ["Required clinical attachment items"]
}`;

    const userPrompt = `Claim ID: ${input.claimId}
Denial Code: ${input.denialReasonCode}
Denial Reason: ${input.denialDescription}
Patient Demographics: ${demoStr}
Procedure / Service Performed: ${input.clinicalProcedure}
Physician Attestation / Clinical Notes:
${input.doctorAttestation}`;

    try {
      const response = await ai.models.generateContent({
        model: DEFAULT_CLINICAL_MODEL,
        contents: [
          { role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] },
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0.2,
        },
      });

      const responseText = response.text || '{}';
      const parsed = JSON.parse(responseText) as DenialAppealOutput;

      return {
        appealLetterSubject: parsed.appealLetterSubject || `EXPEDITED RECONSIDERATION APPEAL: Claim #${input.claimId}`,
        appealLetterBody: parsed.appealLetterBody || `Please accept this formal appeal regarding Claim #${input.claimId}.`,
        citedMedicalNecessityGuidelines: Array.isArray(parsed.citedMedicalNecessityGuidelines)
          ? parsed.citedMedicalNecessityGuidelines
          : ['InterQual Clinical Review Guidelines', 'CMS Title XVIII Social Security Act §1862(a)(1)(A)'],
        supportingEvidenceRequired: Array.isArray(parsed.supportingEvidenceRequired)
          ? parsed.supportingEvidenceRequired
          : ['Operative Report', 'Physician Orders', 'Vital Signs Log'],
      };
    } catch (err) {
      console.warn('AI Denial Appeal generation failed, using structured template:', err);
      return generateFallbackDenialAppeal(input, demoStr);
    }
  },
});

function generateFallbackDenialAppeal(input: DenialAppealInput, demoStr: string): DenialAppealOutput {
  const subject = `FORMAL APPEAL & EXPEDITED MEDICAL NECESSITY RECONSIDERATION: Claim ID #${input.claimId} - Denial Code: ${input.denialReasonCode}`;

  const body = `To: Claims Adjudication & Appeals Department / Medical Director

RE: Formal Appeal of Adverse Benefit Determination
Claim ID: ${input.claimId}
Denial Code: ${input.denialReasonCode} (${input.denialDescription})
Patient Identification: ${demoStr}
Service / Procedure Billed: ${input.clinicalProcedure}

Dear Medical Review Board,

Please accept this formal written appeal on behalf of the attending physician and patient contesting the adverse coverage determination for Claim ID #${input.claimId}. The denial issued under reason code "${input.denialReasonCode}" (${input.denialDescription}) is clinically unsubstantiated and contradicts standard-of-care medical necessity criteria.

CLINICAL JUSTIFICATION & MEDICAL NECESSITY:
The patient presented with acute clinical indications necessitating the immediate execution of ${input.clinicalProcedure}. As documented by the attending physician: "${input.doctorAttestation}". Delaying or withholding this treatment would have posed an imminent risk of significant clinical deterioration, irreversible physiological harm, and increased morbidity.

REGULATORY & CLINICAL GUIDELINE COMPLIANCE:
Under Title XVIII of the Social Security Act §1862(a)(1)(A), CMS National Coverage Determinations (NCD), and MCG Care Guidelines, services that are reasonable and necessary for the diagnosis or treatment of illness or injury are mandated for coverage. The clinical record unequivocally validates that conservative management was insufficient and that ${input.clinicalProcedure} was the most appropriate evidence-based intervention.

DEMAND FOR RELIEF:
Based on the enclosed medical documentation, we respectfully request an immediate reversal of this adverse adjudication and full payment of the claim. In the event of a continued denial, we formally request an immediate Peer-to-Peer consultation between our attending physician and a board-certified medical director in the same specialty within 5 business days.

Sincerely,
Clinical Appeals & Utilization Management Division
G-HIMS OS Healthcare Network`;

  return {
    appealLetterSubject: subject,
    appealLetterBody: body,
    citedMedicalNecessityGuidelines: [
      'CMS Social Security Act §1862(a)(1)(A) (Reasonable & Necessary Standard)',
      'MCG Health Inpatient & Surgical Care 28th Edition Guidelines',
      'AMA CPT Coding & Medical Necessity Policy',
      'InterQual Clinical Decision Support Criteria',
    ],
    supportingEvidenceRequired: [
      'Certified Physician Orders and Clinical Progress Notes',
      'Intraoperative Surgical & Anesthesia Record',
      'Diagnostic Imaging / Pathology Reports confirming pathology',
      'Detailed Hospital Itemized Statement (UB-04 / CMS-1500)',
    ],
  };
}
