import { describe, expect, test } from 'bun:test';
import { isPatient360ClinicalSourceEvent } from '@/lib/clinical/patient360/clinical-source-event-policy';

const nonAuthoritativeEvents = [
  'CLINICAL_INTELLIGENCE_EVIDENCE_SNAPSHOT_CREATED',
  'CLINICAL_INTELLIGENCE_SAFETY_BLOCKED',
  'CLINICAL_DRAFT_GENERATED',
  'CLINICAL_DRAFT_REVIEWED_AND_EDITED',
  'CLINICAL_DRAFT_APPROVED_FOR_SIGNATURE',
  'CLINICAL_DRAFT_REJECTED',
] as const;

describe('CIQP clinical-source boundary', () => {
  test.each(nonAuthoritativeEvents)(
    '%s is retained for audit but cannot advance Patient 360',
    (eventType) => {
      expect(isPatient360ClinicalSourceEvent({ eventType })).toBe(false);
    }
  );

  test.each([
    'CLINICAL_DRAFT_SIGNED',
    'CLINICAL_DOCUMENT_SIGNED',
    'VITALS_RECORDED',
    'CLINICAL_CONDITION_RECORDED',
    'MEDICATION_ORDERED',
    'DIAGNOSTIC_RESULT_VERIFIED',
    'PATIENT_REGISTERED',
  ])('%s remains a clinical source event', (eventType) => {
    expect(isPatient360ClinicalSourceEvent({ eventType })).toBe(true);
  });

  test('new event types remain included unless explicitly classified as non-authoritative', () => {
    expect(isPatient360ClinicalSourceEvent({ eventType: 'OTHER_CLINICAL_EVENT' })).toBe(true);
  });
});
