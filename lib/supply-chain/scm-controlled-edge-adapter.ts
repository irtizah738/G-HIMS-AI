'use client';

import { executeActiveTenantCommand } from '@/lib/api/command-client';
import type {
  RecordColdChainObservationPayload,
  RecordControlledCustodyPayload,
  ReviewColdChainExcursionPayload,
} from '@/types/scm-controlled';

async function executeOnline<T>(
  commandType:string,payload:Record<string,unknown>,idempotencyKey?:string
):Promise<T>{
  const result=await executeActiveTenantCommand<T>(commandType,payload,{
    idempotencyKey,schemaVersion:1,
  });
  if(!result.success) throw new Error(result.error?.message||`${commandType} failed.`);
  return result.data as T;
}

export const recordColdChainObservationEdge=(payload:RecordColdChainObservationPayload,idempotencyKey?:string)=>
  executeOnline('RecordColdChainObservationCommand',payload as unknown as Record<string,unknown>,idempotencyKey);

export const reviewColdChainExcursionEdge=(payload:ReviewColdChainExcursionPayload,idempotencyKey?:string)=>
  executeOnline('ReviewColdChainExcursionCommand',payload as unknown as Record<string,unknown>,idempotencyKey);

export const recordControlledCustodyEdge=(payload:RecordControlledCustodyPayload,idempotencyKey?:string)=>
  executeOnline('RecordControlledCustodyCommand',payload as unknown as Record<string,unknown>,idempotencyKey);
