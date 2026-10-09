import { describe, expect, test } from 'bun:test';
import { hasTelehealthClinicalActivity } from '@/lib/clinical/telehealth-unused-care-policy';
import type { TelehealthSession } from '@/lib/types/ghims';

function unused(overrides: Partial<TelehealthSession> = {}): TelehealthSession {
  return {
    id: 'session-test',
    encounterId: 'encounter-test',
    patientId: 'patient-test',
    status: 'IN_CONSULTATION',
    roomToken: 'ROOM-LEGACY-INVALID',
    soapNote: {
      subjective: '', objective: '', assessment: '', plan: '',
      icd10Codes: [], cptCodes: [],
    },
    prescriptions: [], transcription: [],
    callDurationSeconds: 0,
    isRecording: false,
    vitals: { bp: '', hr: 0, spo2: 0, temp: 0, lastSync: 'Not yet captured' },
    ...overrides,
  } as TelehealthSession;
}

describe('unused Telehealth cancellation — fail-closed clinical activity policy', () => {
  test('unused session is locally empty even if legacy room token cannot connect', () => {
    expect(hasTelehealthClinicalActivity(unused())).toBe(false);
  });

  test('SOAP text, diagnoses, or signed evidence always prohibit no-care cancellation', () => {
    expect(hasTelehealthClinicalActivity(unused({
      soapNote: { subjective: 'Patient reported symptom', objective: '', assessment: '', plan: '' },
    }))).toBe(true);
    expect(hasTelehealthClinicalActivity(unused({
      soapNote: { subjective: '', objective: '', assessment: '', plan: '',
        icd10Codes: [{ code: 'R50.9', description: 'Fever' }] },
    }))).toBe(true);
    expect(hasTelehealthClinicalActivity(unused({ signedEvidenceId: 'ev_signed_1' }))).toBe(true);
  });

  test('recorded vitals, transcription, prescriptions and media activity prohibit cancellation', () => {
    expect(hasTelehealthClinicalActivity(unused({
      vitals: { bp: '120/80', hr: 0, spo2: 0, temp: 0 },
    }))).toBe(true);
    expect(hasTelehealthClinicalActivity(unused({
      transcription: [{ id: 'x', timestamp: 'now', speaker: 'PATIENT', text: 'Hello' }],
    }))).toBe(true);
    expect(hasTelehealthClinicalActivity(unused({
      prescriptions: [{ id: 'med' } as TelehealthSession['prescriptions'][number]],
    }))).toBe(true);
    expect(hasTelehealthClinicalActivity(unused({ callDurationSeconds: 1 }))).toBe(true);
    expect(hasTelehealthClinicalActivity(unused({ isRecording: true }))).toBe(true);
  });

  test('malformed or incomplete session evidence is never interpreted as no care', () => {
    expect(hasTelehealthClinicalActivity(unused({ soapNote: undefined as never }))).toBe(true);
    expect(hasTelehealthClinicalActivity(unused({ vitals: null as never }))).toBe(true);
    expect(hasTelehealthClinicalActivity(unused({ prescriptions: null as never }))).toBe(true);
    expect(hasTelehealthClinicalActivity(unused({ callDurationSeconds: Number.NaN }))).toBe(true);
  });
});
