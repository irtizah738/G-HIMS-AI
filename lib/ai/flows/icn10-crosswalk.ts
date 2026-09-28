import { AIGateway, type AIGenerationProvenance } from '../gateway';
export interface Icd10CrosswalkInput { clinicalSummary:string; primaryDiagnosis:string; }
export interface MappedIcd10Code { icd10Code:string; description:string; clinicalRationale:string; confidence?:number; }
export interface Icd10CrosswalkOutput {
  mappedCodes:MappedIcd10Code[]; primaryCode:string; aiProvenance:AIGenerationProvenance; draftId?:string;
}
type ProviderOutput=Omit<Icd10CrosswalkOutput,'aiProvenance'|'draftId'>;
function validate(value:unknown):ProviderOutput{
  if(!value||typeof value!=='object') throw new Error('AI_INVALID_RESPONSE: ICD-10 draft must be an object.');
  const v=value as Partial<ProviderOutput>;
  if(!Array.isArray(v.mappedCodes)) throw new Error('AI_INVALID_RESPONSE: mappedCodes is required.');
  const mappedCodes=v.mappedCodes.map((item)=>({
    icd10Code:String(item?.icd10Code||'').trim(),
    description:String(item?.description||'').trim(),
    clinicalRationale:String(item?.clinicalRationale||'').trim(),
    ...(Number.isFinite(Number(item?.confidence))?{confidence:Number(item?.confidence)}:{}),
  })).filter((item)=>item.icd10Code&&item.description&&item.clinicalRationale);
  const primaryCode=String(v.primaryCode||'').trim();
  if(!mappedCodes.length||!primaryCode||!mappedCodes.some((item)=>item.icd10Code===primaryCode)){
    throw new Error('AI_INVALID_RESPONSE: evidence-supported primary coding candidate is required.');
  }
  return {mappedCodes,primaryCode};
}
export const crosswalkIcd10Flow={
  name:'crosswalkIcd10Flow',
  description:'Produces evidence-grounded ICD-10 coding candidates for human review.',
  async run(input:Icd10CrosswalkInput):Promise<Icd10CrosswalkOutput>{
    const generation=await AIGateway.generateJson<ProviderOutput>({
      purpose:'ICD10_CODING_DRAFT',
      systemInstruction:[
        'Return only coding candidates directly supported by supplied clinician documentation.',
        'Never invent comorbidities, specificity, laterality, acuity, complications, or encounter facts.',
        'If documentation is insufficient, use only the least-specific supported candidate and say why.',
        'These are draft coding suggestions requiring authorized human review.',
      ].join(' '),
      sourceData:input,
      responseSchema:JSON.stringify({primaryCode:'string',mappedCodes:[{icd10Code:'string',description:'string',clinicalRationale:'string',confidence:'optional number 0..1'}]}),
      temperature:0,
    });
    return {...validate(generation.data),aiProvenance:generation.provenance};
  },
};
