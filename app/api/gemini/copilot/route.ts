import { NextRequest, NextResponse } from 'next/server';
import { deriveAuthoritativeContext } from '@/lib/backend/security/authoritative-context';
import { AIGateway } from '@/lib/ai/gateway';
import { AIDraftRepository } from '@/server/ai/ai-draft-repository';

export async function POST(req:NextRequest){
  try{
    const body=await req.json();
    const noteText=String(body.noteText||'');
    const tenantId=String(body.tenantId||'').trim().toLowerCase();
    if(!tenantId||!noteText.trim()){
      return NextResponse.json({error:'tenantId and clinical note text are required'},{status:400});
    }
    const {context}=await deriveAuthoritativeContext(req,tenantId);
    const sourceData={patientContext:body.patientContext||{},clinicalNote:noteText};
    const generation=await AIGateway.generateJson<Record<string,unknown>>({
      purpose:'CLINICAL_COPILOT',
      systemInstruction:'Analyze only supplied clinician-authored evidence. Do not invent diagnoses, orders, medications, procedures, codes, alerts, or follow-up instructions. Return review-only structured candidates.',
      sourceData,
      responseSchema:JSON.stringify({
        chiefComplaint:'string',diagnoses:['string'],medicationsPrescribed:['string'],
        recommendedProcedures:['string'],billingCodes:['object'],followUpDays:'number or null',
        clinicalAlerts:['string'],
      }),
      temperature:0,
    });
    const patientContext=body.patientContext&&typeof body.patientContext==='object'?body.patientContext:{};
    const draft=await AIDraftRepository.create(context,{
      purpose:'CLINICAL_COPILOT',
      patientId:patientContext.patientId?String(patientContext.patientId):undefined,
      encounterId:patientContext.encounterId?String(patientContext.encounterId):undefined,
      sourceEvidenceIds:Array.isArray(body.sourceEvidenceIds)?body.sourceEvidenceIds.map(String):[],
      input:sourceData,output:generation.data,provenance:generation.provenance,
    });
    return NextResponse.json({
      status:draft.status,draftId:draft.draftId,
      result:generation.data,aiProvenance:generation.provenance,
    });
  }catch(error){
    const message=error instanceof Error?error.message:'AI copilot failed';
    const unauthorized=/AUTH|TENANT|UNAUTH|SESSION|DEVICE/i.test(message);
    const unavailable=/AI_|DRAFT_STORE/i.test(message);
    return NextResponse.json({error:unavailable?'AI_UNAVAILABLE':message,message},{status:unauthorized?403:unavailable?503:500});
  }
}
