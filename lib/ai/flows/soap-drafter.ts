import { AIGateway, type AIGenerationProvenance } from '../gateway';

export interface SoapDrafterInput {
  patientId: string;
  chiefComplaint: string;
  vitals: Record<string, unknown>;
  doctorNotes: string;
  labResults?: string[];
  patientName?: string;
  age?: number;
  gender?: string;
}
export interface RecommendedIcd10 { code: string; description: string; confidence: number; }
export interface SoapDrafterOutput {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  recommendedIcd10: RecommendedIcd10[];
  aiProvenance: AIGenerationProvenance;
  draftId?: string;
}
type ProviderOutput = Omit<SoapDrafterOutput, 'aiProvenance' | 'draftId'>;

function validate(value: unknown): ProviderOutput {
  if (!value || typeof value !== 'object') throw new Error('AI_INVALID_RESPONSE: SOAP draft must be an object.');
  const v=value as Partial<ProviderOutput>;
  if (typeof v.subjective!=='string'||typeof v.objective!=='string'||typeof v.assessment!=='string'||typeof v.plan!=='string'||!Array.isArray(v.recommendedIcd10)) {
    throw new Error('AI_INVALID_RESPONSE: SOAP draft is incomplete.');
  }
  return {
    subjective:v.subjective,
    objective:v.objective,
    assessment:v.assessment,
    plan:v.plan,
    recommendedIcd10:v.recommendedIcd10.map((item)=>({
      code:String(item?.code||'').trim(),
      description:String(item?.description||'').trim(),
      confidence:Number(item?.confidence),
    })).filter((item)=>item.code&&item.description&&Number.isFinite(item.confidence)&&item.confidence>=0&&item.confidence<=1),
  };
}

export const draftSoapNoteFlow = {
  name:'draftSoapNoteFlow',
  description:'Produces a review-only SOAP draft from explicitly supplied evidence.',
  async run(input:SoapDrafterInput):Promise<SoapDrafterOutput>{
    const generation=await AIGateway.generateJson<ProviderOutput>({
      purpose:'CLINICAL_SOAP_DRAFT',
      systemInstruction:[
        'Create a DRAFT SOAP note for clinician review.',
        'Do not invent examination findings, diagnoses, medications, orders, procedures, stability statements, or follow-up instructions.',
        'If evidence is absent, state that it is not documented rather than filling it in.',
        'ICD-10 suggestions are non-authoritative candidates and must be supported by supplied evidence.',
      ].join(' '),
      sourceData:input,
      responseSchema:JSON.stringify({
        subjective:'string', objective:'string', assessment:'string', plan:'string',
        recommendedIcd10:[{code:'string',description:'string',confidence:'number 0..1'}],
      }),
      temperature:0,
    });
    return {...validate(generation.data),aiProvenance:generation.provenance};
  },
};
