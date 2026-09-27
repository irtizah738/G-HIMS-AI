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

function assertCompleteOutput(value: unknown): DenialAppealOutput {
  if (!value || typeof value !== 'object') {
    throw new Error('AI_UNAVAILABLE: Denial appeal model returned an invalid payload.');
  }

  const result = value as Partial<DenialAppealOutput>;
  if (
    typeof result.appealLetterSubject !== 'string' ||
    typeof result.appealLetterBody !== 'string' ||
    !Array.isArray(result.citedMedicalNecessityGuidelines) ||
    !Array.isArray(result.supportingEvidenceRequired)
  ) {
    throw new Error('AI_UNAVAILABLE: Denial appeal model returned an incomplete payload.');
  }

  return {
    appealLetterSubject: result.appealLetterSubject,
    appealLetterBody: result.appealLetterBody,
    citedMedicalNecessityGuidelines: result.citedMedicalNecessityGuidelines.map(String),
    supportingEvidenceRequired: result.supportingEvidenceRequired.map(String),
  };
}

export const generateDenialAppealFlow = defineClinicalFlow<DenialAppealInput, DenialAppealOutput>({
  name: 'generateDenialAppealFlow',
  description: 'Generates a draft insurance denial appeal for authorized human review.',
  execute: async (input): Promise<DenialAppealOutput> => {
    const ai = getGenAIClient();

    if (!ai) {
      throw new Error('AI_UNAVAILABLE: Denial appeal AI provider is not configured.');
    }

    const patientSummary = Object.entries(input.patientDemographics || {})
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');

    const systemPrompt = `You are assisting an authorized hospital revenue-cycle professional with a DRAFT insurance denial appeal.

STRICT SAFETY REQUIREMENTS:
1. Use only facts supplied in the input. Do not invent diagnoses, physician attestations, procedures, payer policies, dates, or patient facts.
2. Do not claim that any law, CMS policy, MCG criterion, InterQual criterion, or payer rule applies unless the supplied input contains enough information to support that statement.
3. If a guideline or policy must be verified before submission, state that verification is required instead of inventing an exact citation.
4. This output is a draft requiring human clinical, coding, legal, and revenue-cycle review before external submission.
5. Output STRICT JSON ONLY.

JSON Schema:
{
  "appealLetterSubject": "string",
  "appealLetterBody": "string",
  "citedMedicalNecessityGuidelines": ["Only supported citations or verification-required statements"],
  "supportingEvidenceRequired": ["string"]
}`;

    const userPrompt = `Claim ID: ${input.claimId}
Denial Code: ${input.denialReasonCode}
Denial Reason: ${input.denialDescription}
Patient Demographics: ${patientSummary}
Procedure / Service: ${input.clinicalProcedure}
Physician Attestation / Clinical Notes: ${input.doctorAttestation}`;

    try {
      const response = await ai.models.generateContent({
        model: DEFAULT_CLINICAL_MODEL,
        contents: [
          { role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] },
        ],
        config: {
          responseMimeType: 'application/json',
          temperature: 0,
        },
      });

      return assertCompleteOutput(JSON.parse(response.text || '{}'));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown model failure';
      throw new Error(`AI_UNAVAILABLE: Denial appeal generation failed: ${message}`);
    }
  },
});
