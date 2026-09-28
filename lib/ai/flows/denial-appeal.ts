import { AIGateway, type AIGenerationProvenance } from '../gateway';
export interface DenialAppealInput {
  claimId:string; denialReasonCode:string; denialDescription:string; patientDemographics:Record<string,unknown>;
  clinicalProcedure:string; doctorAttestation:string;
}
export interface DenialAppealOutput {
  appealLetterSubject:string; appealLetterBody:string; citedMedicalNecessityGuidelines:string[];
  supportingEvidenceRequired:string[]; aiProvenance:AIGenerationProvenance; draftId?:string;
}
type ProviderOutput=Omit<DenialAppealOutput,'aiProvenance'|'draftId'>;
function validate(value:unknown):ProviderOutput{
  if(!value||typeof value!=='object') throw new Error('AI_INVALID_RESPONSE: denial appeal draft must be an object.');
  const v=value as Partial<ProviderOutput>;
  if(typeof v.appealLetterSubject!=='string'||typeof v.appealLetterBody!=='string'||!Array.isArray(v.citedMedicalNecessityGuidelines)||!Array.isArray(v.supportingEvidenceRequired)){
    throw new Error('AI_INVALID_RESPONSE: denial appeal draft is incomplete.');
  }
  return {
    appealLetterSubject:v.appealLetterSubject,
    appealLetterBody:v.appealLetterBody,
    citedMedicalNecessityGuidelines:v.citedMedicalNecessityGuidelines.map(String),
    supportingEvidenceRequired:v.supportingEvidenceRequired.map(String),
  };
}
export const generateDenialAppealFlow={
  name:'generateDenialAppealFlow',
  description:'Produces a review-only denial appeal draft from supplied claim evidence.',
  async run(input:DenialAppealInput):Promise<DenialAppealOutput>{
    let generation;
    try {
      generation=await AIGateway.generateJson<ProviderOutput>({
      purpose:'DENIAL_APPEAL_DRAFT',
      systemInstruction:[
        'Draft an insurance denial appeal for authorized human review.',
        'Use only facts supplied in source data.',
        'Do not invent diagnoses, attestations, payer policies, laws, CMS policy, MCG/InterQual criteria, dates, or clinical facts.',
        'If a policy or guideline must be verified, explicitly say verification is required instead of fabricating a citation.',
        'The result must not claim it has been submitted.',
      ].join(' '),
      sourceData:input,
      responseSchema:JSON.stringify({appealLetterSubject:'string',appealLetterBody:'string',citedMedicalNecessityGuidelines:['supported citation or verification-required statement'],supportingEvidenceRequired:['string']}),
        temperature:0,
      });
    } catch (error) {
      const message=error instanceof Error?error.message:'unknown AI failure';
      throw new Error('AI_UNAVAILABLE: '+message);
    }
    return {...validate(generation.data),aiProvenance:generation.provenance};
  },
};
