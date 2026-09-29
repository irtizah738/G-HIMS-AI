import type { Coding } from '@/types/clinical-canonical';

export interface TerminologyConcept extends Coding {
  synonyms?: string[];
  active?: boolean;
}

export interface TerminologyMapping {
  sourceSystem: string;
  sourceCode: string;
  targetSystem: string;
  targetCode: string;
  equivalence: 'EQUIVALENT' | 'WIDER' | 'NARROWER' | 'RELATED';
}

export const CLINICAL_TERMINOLOGY_REGISTRY: TerminologyConcept[] = [
  { system: 'LOINC', code: '8867-4', display: 'Heart rate', synonyms: ['HR', 'Pulse', 'Heart Rate'], active: true },
  { system: 'LOINC', code: '9279-1', display: 'Respiratory rate', synonyms: ['RR', 'Respirations'], active: true },
  { system: 'LOINC', code: '8310-5', display: 'Body temperature', synonyms: ['Temperature', 'Temp'], active: true },
  { system: 'LOINC', code: '2708-6', display: 'Oxygen saturation in arterial blood', synonyms: ['SpO2', 'Oxygen Saturation'], active: true },
  { system: 'LOINC', code: '85354-9', display: 'Blood pressure panel', synonyms: ['Blood Pressure', 'BP'], active: true },
  { system: 'LOINC', code: '8480-6', display: 'Systolic blood pressure', synonyms: ['SBP', 'Systolic BP'], active: true },
  { system: 'LOINC', code: '8462-4', display: 'Diastolic blood pressure', synonyms: ['DBP', 'Diastolic BP'], active: true },

  { system: 'UCUM', code: '/min', display: 'per minute', synonyms: ['bpm', 'breaths/minute', 'beats/minute'], active: true },
  { system: 'UCUM', code: 'Cel', display: 'degree Celsius', synonyms: ['°C', 'Celsius'], active: true },
  { system: 'UCUM', code: '%', display: 'percent', synonyms: ['Percent', 'Percentage'], active: true },
  { system: 'UCUM', code: 'mm[Hg]', display: 'millimeter of mercury', synonyms: ['mmHg'], active: true },
];

export const CLINICAL_TERMINOLOGY_MAPPINGS: TerminologyMapping[] = [
  { sourceSystem: 'LOCAL', sourceCode: 'HR', targetSystem: 'LOINC', targetCode: '8867-4', equivalence: 'EQUIVALENT' },
  { sourceSystem: 'LOCAL', sourceCode: 'RR', targetSystem: 'LOINC', targetCode: '9279-1', equivalence: 'EQUIVALENT' },
  { sourceSystem: 'LOCAL', sourceCode: 'TEMP', targetSystem: 'LOINC', targetCode: '8310-5', equivalence: 'EQUIVALENT' },
  { sourceSystem: 'LOCAL', sourceCode: 'SPO2', targetSystem: 'LOINC', targetCode: '2708-6', equivalence: 'EQUIVALENT' },
  { sourceSystem: 'LOCAL', sourceCode: 'BP', targetSystem: 'LOINC', targetCode: '85354-9', equivalence: 'EQUIVALENT' },
];
