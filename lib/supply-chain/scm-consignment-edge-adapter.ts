'use client';
import { executeActiveTenantCommand } from '@/lib/api/command-client';
import type {
  ApproveConsignmentAgreementPayload,
  CreateConsignmentAgreementPayload,
  ReceiveConsignmentStockPayload,
  RecordConsignmentUsagePayload,
} from '@/types/scm-consignment';

async function run<T>(commandType:string,payload:Record<string,unknown>,idempotencyKey?:string):Promise<T>{
  const result=await executeActiveTenantCommand<T>(commandType,payload,{idempotencyKey,schemaVersion:1});
  if(!result.success)throw new Error(result.error?.message||`${commandType} failed.`);
  return result.data as T;
}
export const createConsignmentAgreementEdge=(p:CreateConsignmentAgreementPayload,k?:string)=>run('CreateConsignmentAgreementCommand',p as unknown as Record<string,unknown>,k);
export const approveConsignmentAgreementEdge=(p:ApproveConsignmentAgreementPayload,k?:string)=>run('ApproveConsignmentAgreementCommand',p as unknown as Record<string,unknown>,k);
export const receiveConsignmentStockEdge=(p:ReceiveConsignmentStockPayload,k?:string)=>run('ReceiveConsignmentStockCommand',p as unknown as Record<string,unknown>,k);
export const recordConsignmentUsageEdge=(p:RecordConsignmentUsagePayload,k?:string)=>run('RecordConsignmentUsageCommand',p as unknown as Record<string,unknown>,k);
