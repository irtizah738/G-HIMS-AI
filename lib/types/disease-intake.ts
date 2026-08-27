export type DiseaseTemplateId = 'cardiac' | 'stroke' | 'diabetic' | 'ortho_trauma' | 'obgyn' | string;

export type RiskSeverity = 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';

export interface SymptomTreeNode {
  id: string;
  label: string;
  description: string;
  riskWeight: number; // 0 - 10
  isRedFlag?: boolean;
  alertText?: string;
  children?: SymptomTreeNode[];
}

export interface GuidedQuestionOption {
  value: string;
  label: string;
  riskScore: number;
  isRedFlag?: boolean;
  alertMessage?: string;
  helperText?: string;
}

export interface GuidedQuestion {
  id: string;
  label: string;
  category: 'primary_symptom' | 'timeline' | 'severity' | 'associated_signs' | 'examination';
  type: 'select' | 'multiselect' | 'scale' | 'number' | 'boolean' | 'text' | 'time_elapsed';
  options?: GuidedQuestionOption[];
  min?: number;
  max?: number;
  unit?: string;
  helperText?: string;
  defaultValue?: any;
  required?: boolean;
  alertThreshold?: number | string;
  guidelineNote?: string;
}

export interface RiskSignalRule {
  id: string;
  title: string;
  severity: RiskSeverity;
  triggerDescription: string;
  guidelineReference: string;
  immediateAction: string;
  badgeColor: string;
  conditionChecker: (answers: Record<string, any>, specialtyHistory: Record<string, any>, treeNodes: string[]) => boolean;
}

export interface SpecialtyHistoryField {
  key: string;
  label: string;
  type: 'select' | 'boolean' | 'text' | 'number' | 'multiselect';
  options?: string[];
  placeholder?: string;
  defaultValue?: any;
  helperText?: string;
  clinicalImpact?: string;
}

export interface SpecialtyHistoryGroup {
  id: string;
  title: string;
  description: string;
  fields: SpecialtyHistoryField[];
}

export interface LocalizationConfig {
  id: string;
  name: string;
  flagEmoji: string;
  guidelineAgency: string;
  triageSystem: string;
  units: {
    glucose: 'mg/dL' | 'mmol/L';
    temperature: '°F' | '°C';
    weight: 'lbs' | 'kg';
    pressure: 'mmHg';
  };
  emergencyCodeLabels: {
    cardiac: string;
    stroke: string;
    trauma: string;
    obstetric: string;
  };
  notes: string;
}

export interface HospitalTierConfig {
  id: string;
  name: string;
  tierLevel: 'quaternary' | 'trauma_1' | 'community' | 'ambulatory';
  cathLabAvailable: boolean;
  thrombectomyAvailable: boolean;
  pediatricIcuAvailable: boolean;
  bloodBankTier: 'Full Massive Transfusion' | 'Standard Crossmatch' | 'Emergency O-Neg Only';
  specialistEscalationTime: string;
}

export interface DiseaseIntakeTemplate {
  id: DiseaseTemplateId;
  name: string;
  specialty: string;
  badge: string;
  colorScheme: {
    primary: string;
    lightBg: string;
    darkBg: string;
    border: string;
    accent: string;
  };
  description: string;
  symptomTree: SymptomTreeNode;
  guidedQuestions: GuidedQuestion[];
  riskSignals: RiskSignalRule[];
  specialtyHistory: SpecialtyHistoryGroup[];
  clinicalGuidelines: string;
  typicalSpecialists: string[];
}

export interface AiOptimizationResult {
  executiveSummary: string;
  sbar: {
    situation: string;
    background: string;
    assessment: string;
    recommendation: string;
  };
  differentialDiagnoses: {
    condition: string;
    probability: 'High' | 'Moderate' | 'Low';
    justification: string;
    icdCode: string;
  }[];
  statOrders: {
    name: string;
    type: 'lab' | 'imaging' | 'medication' | 'consult';
    urgency: 'STAT' | 'Urgent' | 'Routine';
    cptCode?: string;
  }[];
  criticalRiskMitigations: string[];
  specialistReadinessChecklist: string[];
}
