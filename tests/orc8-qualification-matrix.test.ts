import { describe, expect, test } from 'bun:test';
import {
  DOMAIN_MANIFEST,
  TOTAL_DOMAINS,
  assertDomainCount,
  countReleasedDomains,
  listBlockingDomains,
  listOrcPendingValidation,
} from '@/lib/domain-manifest';
import {
  evaluateQualificationMatrix,
  isCommandRegistered,
} from '../scripts/ops/orc8-qualification-matrix';

describe('ORC-8: Authoritative 56-Domain Qualification Test Matrix', () => {
  test('domain manifest enumerates exactly 56 domains without drift', () => {
    expect(DOMAIN_MANIFEST).toHaveLength(56);
    expect(TOTAL_DOMAINS).toBe(56);
    expect(() => assertDomainCount(56)).not.toThrow();
    expect(() => assertDomainCount(52)).toThrow();
  });

  test('all domains have unique kebab-case identifiers and labels', () => {
    const ids = new Set<string>();
    for (const domain of DOMAIN_MANIFEST) {
      expect(ids.has(domain.domainId)).toBe(false);
      ids.add(domain.domainId);
      expect(domain.domainId).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(domain.label.length).toBeGreaterThan(0);
      expect(domain.apiArea.length).toBeGreaterThan(0);
    }
    expect(ids.size).toBe(56);
  });

  test('evaluator finds zero discrepancies across all 7 qualification dimensions', () => {
    const report = evaluateQualificationMatrix(DOMAIN_MANIFEST);
    expect(report.passed).toBe(true);
    expect(report.discrepancies).toHaveLength(0);
    expect(report.totalDomains).toBe(56);
    expect(report.expectedDomainCount).toBe(56);
  });

  test('fail-closed invariant: zero unearned or premature release sign-offs', () => {
    const report = evaluateQualificationMatrix(DOMAIN_MANIFEST);
    expect(report.counts.release.SIGNED_OFF).toBe(0);
    expect(report.counts.release.PENDING).toBe(56);
    expect(countReleasedDomains()).toBe(0);
  });

  test('fail-closed invariant: all staging statuses remain PENDING until multi-role fixture run', () => {
    const report = evaluateQualificationMatrix(DOMAIN_MANIFEST);
    expect(report.counts.staging.PENDING).toBe(56);
    expect(report.counts.staging.PASSED).toBe(0);
  });

  test('fail-closed invariant: all authorization statuses remain UNTESTED until pipeline tests execute', () => {
    const report = evaluateQualificationMatrix(DOMAIN_MANIFEST);
    expect(report.counts.authorization.UNTESTED).toBe(56);
    expect(report.counts.authorization.TESTED).toBe(0);
  });

  test('all registered domain commands exist in the authoritative command schema registry', () => {
    const allCommands = DOMAIN_MANIFEST.flatMap((d) => d.requiredCommands);
    expect(allCommands.length).toBeGreaterThan(30);

    for (const cmd of allCommands) {
      expect(isCommandRegistered(cmd)).toBe(true);
    }
  });

  test('ORC defect closure gates are accurately mapped in the manifest', () => {
    const orcPending = listOrcPendingValidation();
    expect(orcPending.length).toBeGreaterThanOrEqual(18);

    const pendingIds = new Set(orcPending.map((d) => d.domainId));
    // D1: Tenant hydration & facilities
    expect(pendingIds.has('tenant-hydration')).toBe(true);
    expect(pendingIds.has('facility-management')).toBe(true);
    // D2: HCM credentials & privileges
    expect(pendingIds.has('clinical-credentials')).toBe(true);
    expect(pendingIds.has('clinical-privileges')).toBe(true);
    // D3: ER encounters & triage
    expect(pendingIds.has('er-encounter')).toBe(true);
    expect(pendingIds.has('er-triage')).toBe(true);
    // D4: Vitals & deterioration
    expect(pendingIds.has('record-vitals')).toBe(true);
    expect(pendingIds.has('clinical-deterioration')).toBe(true);
    // D5: Billing & cash receipts
    expect(pendingIds.has('opd-billing')).toBe(true);
    expect(pendingIds.has('cash-receipts')).toBe(true);
    expect(pendingIds.has('billing-reconciliation')).toBe(true);
  });

  test('no domain is currently blocked by missing implementation or failing auth', () => {
    const blocking = listBlockingDomains();
    expect(blocking).toHaveLength(0);
  });
});
