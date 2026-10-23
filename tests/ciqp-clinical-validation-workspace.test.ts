import { describe, expect, test } from 'bun:test';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandContext } from '@/lib/backend/types';
import {
  assertValidationSandbox,
  validateIndependentRoster,
  validationRole,
  syntheticCaseSourceHash,
} from '@/lib/clinical/validation/clinical-validation-workspace-service';

const source = (p: string) => readFile(join(process.cwd(), p), 'utf8');

const uidA = 'clinicianA999999';
const uidB = 'clinicianB999999';
const uidC = 'clinicianC999999';

function context(overrides: Partial<CommandContext>): CommandContext {
  return {
    tenantId: 'synthetic-only-tenant',
    actorId: uidA,
    roles: ['DOCTOR'],
    permissions: ['CLINICAL_VALIDATION_REVIEW'],
    clinicalPrivileges: ['SIGN_CLINICAL_NOTES'],
    correlationId: 'corr-synthetic',
    requestId: 'req-synthetic',
    ...overrides,
  };
}

describe('CIQP synthetic clinical validation review authority', () => {
  test('IPv4 localhost is not an implicit tenant subdomain on auth/session routes', () => {
    const session = proxy(new NextRequest('http://127.0.0.1:3000/api/auth/session', {
      headers: { 'x-ghims-tenant-id': 'ciqp-renal-browser' },
    }));
    expect(session.cookies.get('ghims_tenant_id')).toBeUndefined();

    const scoped = proxy(new NextRequest('http://127.0.0.1:3000/ciqp-renal-browser/clinical-validation'));
    expect(scoped.cookies.get('ghims_tenant_id')?.value).toBe('ciqp-renal-browser');
  });

  test('fails closed outside dual TEST runtime and emulator', () => {
    expect(() => assertValidationSandbox('PRODUCTION', 'PRODUCTION')).toThrow('CIQP_VALIDATION_TEST_EMULATOR_REQUIRED');
    expect(() => assertValidationSandbox('TEST', 'PRODUCTION')).toThrow('CIQP_VALIDATION_TEST_EMULATOR_REQUIRED');
    expect(() => assertValidationSandbox('STAGING', 'STAGING')).toThrow('CIQP_VALIDATION_TEST_EMULATOR_REQUIRED');
    const before = process.env.FIRESTORE_EMULATOR_HOST;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    try {
      expect(() => assertValidationSandbox('TEST', 'TEST')).toThrow('CIQP_VALIDATION_TEST_EMULATOR_REQUIRED');
    } finally {
      if (before === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
      else process.env.FIRESTORE_EMULATOR_HOST = before;
    }
  });

  test('requires distinct, well-formed immutable reviewer identities', () => {
    expect(() => validateIndependentRoster([uidA,uidB,uidC])).not.toThrow();
    expect(() => validateIndependentRoster([uidA,uidA,uidC])).toThrow('CIQP_VALIDATION_THREE_DISTINCT_REVIEWERS_REQUIRED');
    expect(() => validateIndependentRoster(['a',uidB,uidC])).toThrow('CIQP_VALIDATION_THREE_DISTINCT_REVIEWERS_REQUIRED');
    expect(() => validateIndependentRoster([uidA,uidB])).toThrow('CIQP_VALIDATION_THREE_DISTINCT_REVIEWERS_REQUIRED');
  });

  test('authenticated reviewer must have clinical role, permission and canonical HCM-derived privilege', () => {
    expect(validationRole(context({}))).toBe('REVIEWER');
    expect(validationRole(context({ clinicalPrivileges: [] }))).toBeNull();
    expect(validationRole(context({ permissions: [] }))).toBeNull();
    expect(validationRole(context({ roles: ['RECEPTIONIST'] }))).toBeNull();
    expect(validationRole(context({ roles: ['SYSTEM_ADMIN'], permissions: ['CLINICAL_VALIDATION_ADMIN'] }))).toBe('COORDINATOR');
    expect(validationRole(context({ roles: ['SYSTEM_ADMIN'], permissions: [] }))).toBeNull();
  });

  test('route uses server-derived identity, does not accept arbitrary uploaded clinical cases', async () => {
    const route = await source('app/api/clinical/validation/route.ts');
    expect(route).toContain('deriveAuthoritativeContext(');
    expect(route).toContain('ClinicalValidationWorkspaceService.seed(');
    expect(route).toContain('ClinicalValidationWorkspaceService.submit(');
    expect(route).not.toContain('body.actorId');
    expect(route).not.toContain('body.role');
    expect(route).not.toContain('body.evidence');
  });

  test('frozen synthetic case hash is insensitive to Firestore object key order', () => {
    const a = { evidence: [{ evidenceId: 'e1', label: 'Synthetic measurement', fact: 'creatinine 1.0 mg/dL' }], question: 'Assess source.' };
    const b = { question: 'Assess source.', evidence: [{ fact: 'creatinine 1.0 mg/dL', label: 'Synthetic measurement', evidenceId: 'e1' }] };
    expect(syntheticCaseSourceHash(a)).toBe(syntheticCaseSourceHash(b));
  });

  test('server keeps primary assessments hidden and writes immutable event/audit evidence', async () => {
    const service = await source('lib/clinical/validation/clinical-validation-workspace-service.ts');
    expect(service).toContain("primary.every(s => s.exists)");
    expect(service).toContain("isAdjudicator && allPrimaries");
    expect(service).toContain("tx.create(submissionRef");
    expect(service).toContain("CIQP_VALIDATION_IMMUTABLE_SUBMISSION_EXISTS");
    expect(service).toContain("tx.create(tenant.collection('events')");
    expect(service).toContain("tx.create(tenant.collection('audit_logs')");
    expect(service).toContain("caseSnap.data() as ValidationSyntheticCase");
    expect(service).toContain("studyCase.sourceHash !== syntheticCaseSourceHash(studyCase)");
    expect(service).toContain("primaryAssessments: primary.map");
    expect(service).toContain("evidenceRefs: data.evidenceRefs, rationale: data.rationale");
    expect(service).not.toContain("primaryAssessments: primary.map(s => s.data() as ValidationAssessment)");
  });

  test('in-app workspace displays no model-output predictions or real patient lookup', async () => {
    const ui = await source('app/[tenantId]/clinical-validation/page.tsx');
    expect(ui).toContain('AuthClient.authorizedFetch');
    expect(ui).toContain('Clinical Validation &amp; Review');
    expect(ui).toContain('synthetic evidence');
    expect(ui).not.toContain('modelPredictions');
    expect(ui).not.toContain('patientId');
  });
});
