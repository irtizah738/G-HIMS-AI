import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { evaluateEnvironmentPolicy } from '../lib/runtime/environment-policy';
import { buildStructuredLog } from '../server/observability/structured-logger';

const source=(file:string)=>readFile(path.join(process.cwd(),file),'utf8');

describe('G-HIMS P3 production evidence boundary',()=>{
  test('production environment policy blocks emulator, project mismatch, stale restore evidence and missing ops config',()=>{
    const result=evaluateEnvironmentPolicy({
      runtimeMode:'PRODUCTION',
      nodeEnv:'production',
      firebaseProjectId:'ghims-test',
      publicFirebaseProjectId:'ghims-prod',
      firestoreEmulatorHost:'127.0.0.1:8080',
      backupBucket:'',
      backupProjectId:'wrong-project',
      backupRetentionDays:'0',
      lastRestoreDrillAt:'2020-01-01T00:00:00Z',
      rpoTargetMinutes:'',
      rtoTargetMinutes:'abc',
      alertingDestination:'',
    }, Date.parse('2026-09-28T00:00:00Z'));

    expect(result.ready).toBe(false);
    const codes=result.findings.map((f)=>f.code);
    expect(codes).toContain('FIREBASE_PROJECT_MISMATCH');
    expect(codes).toContain('PRODUCTION_PROJECT_LOOKS_NON_PRODUCTION');
    expect(codes).toContain('EMULATOR_FORBIDDEN');
    expect(codes).toContain('BACKUP_BUCKET_REQUIRED');
    expect(codes).toContain('BACKUP_PROJECT_MISMATCH');
    expect(codes).toContain('RESTORE_DRILL_STALE');
    expect(codes).toContain('RPO_TARGET_REQUIRED');
    expect(codes).toContain('RTO_TARGET_REQUIRED');
    expect(codes).toContain('ALERTING_DESTINATION_REQUIRED');
  });

  test('a fully explicit production configuration can satisfy repository readiness policy',()=>{
    const now=Date.parse('2026-09-28T00:00:00Z');
    const result=evaluateEnvironmentPolicy({
      runtimeMode:'PRODUCTION',
      nodeEnv:'production',
      firebaseProjectId:'ghims-prod-pk-01',
      publicFirebaseProjectId:'ghims-prod-pk-01',
      backupBucket:'ghims-prod-backups',
      backupProjectId:'ghims-prod-pk-01',
      backupRetentionDays:'35',
      lastRestoreDrillAt:'2026-09-20T00:00:00Z',
      rpoTargetMinutes:'60',
      rtoTargetMinutes:'240',
      alertingDestination:'primary-oncall',
    },now);
    expect(result.ready).toBe(true);
    expect(result.findings.filter((f)=>f.severity==='BLOCKER')).toHaveLength(0);
  });

  test('structured operational logs redact sensitive healthcare and credential fields',()=>{
    const log=buildStructuredLog({
      event:'READINESS_TEST',
      tenantId:'tenant-a',
      metadata:{
        patientName:'Jane Doe',
        nested:{authorization:'Bearer secret',count:2},
        password:'nope',
        queueDepth:7,
      },
    });
    const metadata=log.metadata as any;
    expect(metadata.patientName).toBe('[REDACTED]');
    expect(metadata.password).toBe('[REDACTED]');
    expect(metadata.nested.authorization).toBe('[REDACTED]');
    expect(metadata.nested.count).toBe(2);
    expect(metadata.queueDepth).toBe(7);
  });

  test('browser audit module cannot fabricate compliance evidence',async()=>{
    const audit=await source('lib/audit/logger.ts');
    expect(audit).not.toContain('setDoc(');
    expect(audit).not.toContain('192.168.1.');
    expect(audit).not.toContain('getFallbackSeedAuditLogs');
    expect(audit).not.toContain('FNV-1a');
    expect(audit).toContain('CLIENT_INTENT_UNPERSISTED');
    expect(audit).toContain('SHA256_UNAVAILABLE');
  });

  test('server auth audit has no fabricated tenant and fails closed in production-like runtime',async()=>{
    const audit=await source('server/auth/audit-service.ts');
    expect(audit).not.toContain('central-metro-hospital');
    expect(audit).toContain('AUDIT_STORE_UNAVAILABLE');
    expect(audit).toContain('AUDIT_WRITE_FAILED');
    expect(audit).toContain('auth/pre-tenant');
  });

  test('audit UI no longer synthesizes historical cryptographic success or uptime claims',async()=>{
    const integrity=await source('components/audit/CryptographicIntegritySection.tsx');
    const ledger=await source('components/views/audit-ledger-view.tsx');
    expect(integrity).not.toContain('30-Day Historical Verification Success Rate Trend');
    expect(integrity).not.toContain('100% Unbroken');
    expect(ledger).not.toContain('99.9% Full Read/Write Continuity');
    expect(ledger).not.toContain('Deterministic Vector Clocks (LWW-Physician Priority)');
    expect(ledger).toContain('cryptographic chain attestation is not currently implemented');
  });

  test('current status documents do not self-approve compliance, pilot or recovery performance',async()=>{
    const docs=await Promise.all([
      source('G-HIMS_FINAL_SYSTEM_STATUS.md'),
      source('G-HIMS_FINAL_EVIDENCE_MATRIX.md'),
      source('G-HIMS_COMPLIANCE_READINESS.md'),
      source('G-HIMS_PRODUCTION_BLOCKERS.md'),
    ]);
    const all=docs.join('\n');
    expect(all).not.toContain('APPROVED (PILOT-READY)');
    expect(all).not.toContain('TLS 1.3 enforced');
    expect(all).not.toContain('AES-256 server-side encryption');
    expect(all).not.toContain('Lead II ST-elevation analysis');
    expect(all).toContain('successful isolated restore drill');
  });

  test('health readiness response exposes control codes, not deployment secrets',async()=>{
    const route=await source('app/api/health/ready/route.ts');
    expect(route).toContain("status: readiness.ready ? 'ready' : 'not_ready'");
    expect(route).toContain('.map((finding) => finding.code)');
    expect(route).not.toContain('GHIMS_BACKUP_BUCKET');
    expect(route).not.toContain('FIREBASE_PRIVATE_KEY');
  });

  test('runbooks explicitly separate targets from achieved recovery evidence',async()=>{
    const dr=await source('G-HIMS_DISASTER_RECOVERY_RUNBOOK.md');
    const deploy=await source('G-HIMS_PRODUCTION_DEPLOYMENT_RUNBOOK.md');
    expect(dr).toContain('not evidence that recovery objectives have been achieved');
    expect(dr).toContain('never restore over production');
    expect(deploy).toContain('A green repository build proves only the checks executed by CI');
  });
});
