import { afterEach, describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { assertServerFirebaseProjectIsolation } from '../lib/runtime/environment-contract';
import { emitOperationalEvent } from '../lib/observability/server-telemetry';
import { validateSessionRecord } from '../server/auth/session-service';
import { POST as receiveHl7 } from '../app/api/interop/hl7/receive/route';

const source=(file:string)=>readFile(path.join(process.cwd(),file),'utf8');
const originalEnv={...process.env};

afterEach(()=>{
  for(const key of Object.keys(process.env)){
    if(!(key in originalEnv)) delete process.env[key];
  }
  for(const [key,value] of Object.entries(originalEnv)){
    if(value === undefined) delete process.env[key];
    else process.env[key]=value;
  }
});

describe('G-HIMS P3 operational assurance and adversarial matrix',()=>{
  test('production Firebase authority is bound to its declared project',()=>{
    process.env.GHIMS_RUNTIME_MODE='PRODUCTION';
    process.env.GHIMS_FIREBASE_PROJECT_ID_DEMO='ghims-demo';
    process.env.GHIMS_FIREBASE_PROJECT_ID_STAGING='ghims-staging';
    process.env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION='ghims-prod';

    expect(()=>assertServerFirebaseProjectIsolation('ghims-prod')).not.toThrow();
    expect(()=>assertServerFirebaseProjectIsolation('ghims-staging')).toThrow(/ENVIRONMENT_PROJECT_MISMATCH/);
  });

  test('environment contract rejects shared demo/staging/production projects',()=>{
    process.env.GHIMS_RUNTIME_MODE='PRODUCTION';
    process.env.GHIMS_FIREBASE_PROJECT_ID_DEMO='shared-project';
    process.env.GHIMS_FIREBASE_PROJECT_ID_STAGING='shared-project';
    process.env.GHIMS_FIREBASE_PROJECT_ID_PRODUCTION='ghims-prod';

    expect(()=>assertServerFirebaseProjectIsolation('ghims-prod')).toThrow(/ENVIRONMENT_PROJECT_COLLISION/);
  });

  test('revoked and expired sessions fail closed',()=>{
    const base:any={
      sessionId:'sess_test',
      userId:'user-a',
      tenantId:'tenant-a',
      status:'ACTIVE',
      createdAt:new Date().toISOString(),
      lastSeenAt:new Date().toISOString(),
      authenticatedAt:new Date().toISOString(),
      lastActivityAt:new Date().toISOString(),
      expiresAt:new Date(Date.now()+60_000).toISOString(),
    };

    expect(()=>validateSessionRecord({...base,status:'REVOKED'},'user-a')).toThrow();
    expect(()=>validateSessionRecord({...base,status:'EXPIRED'},'user-a')).toThrow();
    expect(()=>validateSessionRecord({...base,expiresAt:new Date(Date.now()-1_000).toISOString()},'user-a')).toThrow();
    expect(()=>validateSessionRecord(base,'different-user')).toThrow();
  });

  test('HL7 receiver rejects forged integration credentials before touching clinical storage',async()=>{
    process.env.GHIMS_INTEGRATION_HL7_STATE='LIVE';
    process.env.GHIMS_HL7_INGEST_API_KEY='expected-key';

    const req=new NextRequest('http://localhost/api/interop/hl7/receive',{
      method:'POST',
      headers:{
        'content-type':'text/plain',
        'x-api-key':'forged-key',
        'x-ghims-tenant-id':'tenant-a',
      },
      body:'MSH|^~\\&|LIS|LAB|GHIMS|HOSP|20260928120000||ORU^R01|MSG-1|P|2.3.1\r',
    });

    const response=await receiveHl7(req);
    expect(response.status).toBe(401);
  });

  test('structured operational telemetry drops PHI-shaped attributes',()=>{
    const originalInfo=console.info;
    let line='';
    console.info=(value?:unknown)=>{ line=String(value||''); };
    try{
      emitOperationalEvent({
        event:'test.telemetry',
        outcome:'SUCCESS',
        tenantId:'tenant-sensitive',
        attributes:{
          patientName:'Jane Doe',
          mrn:'MRN-123',
          count:3,
          queueDepth:2,
        },
      });
    }finally{
      console.info=originalInfo;
    }

    expect(line).toContain('"count":3');
    expect(line).toContain('"queueDepth":2');
    expect(line).not.toContain('Jane Doe');
    expect(line).not.toContain('MRN-123');
    expect(line).not.toContain('tenant-sensitive');
  });

  test('authoritative context does not accept forged actor or role headers',async()=>{
    const context=await source('lib/backend/security/authoritative-context.ts');
    expect(context).not.toContain("x-ghims-role");
    expect(context).not.toContain("x-ghims-actor-id");
    expect(context).not.toContain("x-ghims-permissions");
    expect(context).toContain('resolveAuthorizationContext');
    expect(context).toContain('validateSession');
  });

  test('backup and restore scripts require explicit environment/project targeting',async()=>{
    const backup=await source('scripts/ops/firestore-backup.mjs');
    const restore=await source('scripts/ops/firestore-restore.mjs');
    expect(backup).toContain('GHIMS_BACKUP_BUCKET');
    expect(backup).toContain("GHIMS_FIREBASE_PROJECT_ID_");
    expect(restore).toContain('GHIMS_RESTORE_CONFIRM_PROJECT');
    expect(restore).toContain('GHIMS_ALLOW_PRODUCTION_RESTORE');
  });

  test('legacy browser audit simulation cannot be presented as real evidence',async()=>{
    const audit=await source('lib/audit/logger.ts');
    expect(audit).not.toContain('getFallbackSeedAuditLogs');
    expect(audit).not.toContain("192.168.1.' + Math.floor");
    expect(audit).not.toContain('FNV-1a');
    expect(audit).not.toContain("setDoc(auditDocRef");
  });

  test('readiness and observability docs do not claim provisioned external monitoring or tested DR',async()=>{
    const dr=await source('docs/operations/DISASTER_RECOVERY.md');
    const obs=await source('docs/operations/OBSERVABILITY.md');
    expect(dr).toContain('engineering targets');
    expect(dr).toContain('does **not** claim');
    expect(obs).toContain('does not claim that an external dashboard');
  });

  test('production audit persistence fails closed and SCM never fabricates hash attestation',async()=>{
    const authAudit=await source('server/auth/audit-service.ts');
    const scmAudit=await source('components/supply-chain/scm-audit-compliance-view.tsx');

    expect(authAudit).toContain('AUDIT_STORE_UNAVAILABLE');
    expect(authAudit).toContain('AUDIT_WRITE_FAILED');
    expect(authAudit).not.toContain('central-metro-hospital');

    expect(scmAudit).not.toContain('100% Cryptographically Verified');
    expect(scmAudit).not.toContain('sha256_verified_immutable');
    expect(scmAudit).toContain('Not attested');
  });

  test('status documents no longer declare regulatory approval or unsupported production verification',async()=>{
    const status=await source('G-HIMS_FINAL_SYSTEM_STATUS.md');
    const compliance=await source('G-HIMS_COMPLIANCE_READINESS.md');
    expect(status).not.toContain('APPROVED (PILOT-READY)');
    expect(status).not.toContain('Final Status: `VERIFIED`');
    expect(compliance).not.toContain('TLS 1.3 enforced');
    expect(compliance).not.toContain('AES-256 server-side encryption');
  });
});
