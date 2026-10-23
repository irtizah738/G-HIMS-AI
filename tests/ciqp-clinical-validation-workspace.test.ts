import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CommandContext } from '@/lib/backend/types';
import {
  assertValidationSandbox,
  validateIndependentRoster,
  validationRole,
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

  test('server keeps primary assessments hidden and writes immutable event/audit evidence', async () => {
    const service = await source('lib/clinical/validation/clinical-validation-workspace-service.ts');
    expect(service).toContain("primary.every(s => s.exists)");
    expect(service).toContain("isAdjudicator && allPrimaries");
    expect(service).toContain("tx.create(submissionRef");
    expect(service).toContain("CIQP_VALIDATION_IMMUTABLE_SUBMISSION_EXISTS");
    expect(service).toContain("tx.create(tenant.collection('events')");
    expect(service).toContain("tx.create(tenant.collection('audit_logs')");
    expect(service).toContain("caseSnap.data() as ValidationSyntheticCase");
    expect(service).toContain("studyCase.sourceHash !== sourceHash(studyCase)");
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
