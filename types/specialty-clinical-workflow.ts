/**
 * G-HIMS Specialty-Aware Clinical Workflow Domain Models
 * Supporting Multi-Stage Clinical Enrichment Pipeline:
 * 1. Nursing Care / Triage
 * 2. General Assessment (MO Intake)
 * 3. Disease-Centric Structured Intake (Cardiology & Medical Specialties)
 * 4. Consultant Specialist (Investigations, SOAP, Lifestyle, Med Reconciliation, Routing)
 */

export type ClinicalSpecialty =
  | 'CARDIOLOGY'
  | 'PULMONOLOGY'
  | 'NEUROLOGY'
  | 'ORTHOPEDICS'
  | 'NEPHROLOGY'
  | 'GASTROENTEROLOGY'
  | 'ENDOCRINOLOGY'
  | 'GENERAL_INTERNAL_MEDICINE';

// ============================================================================
// STAGE 1: NURSING CARE / TRIAGE
// ============================================================================

export interface NursingTriageIntake {
  assessedAt: number;
  nurseId: string;
  nurseName: string;
  chiefComplaint: string;
  symptomDuration: string;
  painScale: number; // 0-10
  fallRiskScore: number;
  consciousnessAvpu: 'ALERT' | 'VOICE' | 'PAIN' | 'UNRESPONSIVE';
  glasgowComaScale: number; // 3-15
  vitals: {
    heartRate: number;
    systolicBp: number;
    diastolicBp: number;
    respiratoryRate: number;
    temperatureCelsius: number;
    spo2Percent: number;
    onSupplementalOxygen: boolean;
    oxygenFlowRateLpm?: number;
    news2Score: number;
    clinicalRisk: 'LOW' | 'MEDIUM' | 'HIGH';
    triageCategory: 'RED_IMMEDIATE' | 'ORANGE_VERY_URGENT' | 'YELLOW_URGENT' | 'GREEN_STANDARD' | 'BLUE_NON_URGENT';
  };
  knownAllergies: {
    allergen: string;
    reaction: string;
    severity: 'MILD' | 'MODERATE' | 'SEVERE_ANAPHYLAXIS';
  }[];
  redFlagAlerts: string[];
  intakeNotes: string;
}

// ============================================================================
// STAGE 2: GENERAL ASSESSMENT / MO INTAKE
// ============================================================================

export interface GeneralAssessmentMoIntake {
  assessedAt: number;
  moId: string;
  moName: string;
  historyOfPresentIllness: string;
  pastMedicalHistory: string[];
  pastSurgicalHistory: string[];
  socialHistory: {
    smokingStatus: 'NEVER' | 'FORMER' | 'CURRENT';
    packYears?: number;
    alcoholUse: 'NONE' | 'OCCASIONAL' | 'MODERATE' | 'HEAVY';
    occupation: string;
    exerciseLevel: 'SEDENTARY' | 'MODERATE' | 'ACTIVE';
  };
  reviewOfSystems: {
    constitutional: string;
    cardiovascular: string;
    respiratory: string;
    gastrointestinal: string;
    neurological: string;
    musculoskeletal: string;
    genitourinary: string;
  };
  baselineInvestigations: {
    testName: string;
    status: 'ORDERED' | 'RESULTED' | 'NOT_REQUIRED';
    value?: string;
    unit?: string;
    isAbnormal?: boolean;
  }[];
  provisionalDiagnoses: {
    code: string;
    description: string;
  }[];
  recommendedSpecialty: ClinicalSpecialty;
  urgencyLevel: 'ROUTINE' | 'PRIORITY' | 'STAT_EMERGENCY';
  preliminaryTriageNotes: string;
}

// ============================================================================
// STAGE 3: DISEASE-CENTRIC STRUCTURED INTAKE (CARDIOLOGY SCHEMA & SPECIALTIES)
// ============================================================================

export interface CardiacPqrstChestPain {
  hasChestPain: boolean;
  provocation: string; // e.g., Exertion, Post-prandial, Rest, Cold weather
  palliation: string; // e.g., Rest, Sublingual Nitroglycerin, Leaning forward
  quality: 'CRUSHING_PRESSURE' | 'SQUEEZING' | 'BURNING_ACHING' | 'SHARP_PLEURITIC' | 'THROBBING';
  regionAndRadiation: string[]; // e.g., Retrosternal, Left Arm, Jaw, Back, Epigastric
  severityScale: number; // 1-10
  temporalPattern: string; // e.g., Sudden onset, Episodic 10-15 mins, Constant >2 hrs
  associatedDiaphoresis: boolean;
  associatedNausea: boolean;
}

export interface CardiologyStructuredIntake {
  specialty: 'CARDIOLOGY';
  recordedAt: number;
  recordedBy: string;

  // 1. Cardiac History
  cardiacHistory: {
    priorMyocardialInfarction: boolean;
    priorMiYear?: number;
    knownCoronaryArteryDisease: boolean;
    heartFailureHistory: boolean;
    nyhaBaselineClass?: 'I' | 'II' | 'III' | 'IV';
    arrhythmiaHistory: boolean;
    arrhythmiaType?: string; // e.g., Atrial Fibrillation, SVT, VT
    valvularHeartDisease: boolean;
    valvularLesion?: string; // e.g., Aortic Stenosis, Mitral Regurgitation
    hypertensionYears: number;
    dyslipidemiaYears: number;
    diabetesMellitusYears: number;
  };

  // 2. Cardiac Symptoms
  symptoms: {
    chestPain: CardiacPqrstChestPain;
    dyspneaNyhaClass: 'CLASS_I_NO_LIMITATION' | 'CLASS_II_SLIGHT_LIMITATION' | 'CLASS_III_MARKED_LIMITATION' | 'CLASS_IV_AT_REST';
    palpitations: {
      present: boolean;
      pattern?: 'RAPID_REGULAR' | 'CHAOTIC_IRREGULAR' | 'FLUTTERING_PAUSES';
      frequency?: string;
    };
    syncopeOrPresyncope: {
      hasSyncope: boolean;
      episodesCountLast6Months: number;
      exertionalTrigger: boolean;
      prodromalSymptoms?: string;
    };
    intermittentClaudication: {
      present: boolean;
      claudicationDistanceMeters?: number;
    };
  };

  // 3. Cardiac-Specific Questions
  cardiacQuestions: {
    orthopneaPillowsCount: number; // 0, 1, 2, 3+
    paroxysmalNocturnalDyspnea: boolean;
    bilateralPedalEdema: 'NONE' | 'GRADE_1_MILD' | 'GRADE_2_MODERATE' | 'GRADE_3_SEVERE_ANASARCA';
    recentWeightGainLastWeekKg?: number;
    exerciseToleranceEquivalentMets: number; // e.g. 1-4 METs (low), 4-7 METs (moderate), >7 METs
  };

  // 4. Surgical & Intervention History
  surgicalHistory: {
    priorPciWithStents: boolean;
    pciVessels?: string[]; // e.g., LAD, LCx, RCA
    pciYear?: number;
    stentTypes?: 'DRUG_ELUTING' | 'BARE_METAL' | 'BIORESORBABLE';
    priorCabg: boolean;
    cabgYear?: number;
    cabgGraftsCount?: number;
    cardiacDeviceImplants: 'NONE' | 'PACEMAKER_SINGLE' | 'PACEMAKER_DUAL' | 'ICD' | 'CRT_D';
    valveSurgeries?: string;
  };

  // 5. Cardiac Medication History & Adherence
  medicationHistory: {
    onAntiplatelets: boolean;
    antiplateletDrugs?: string[]; // e.g., Aspirin, Clopidogrel, Ticagrelor
    onBetaBlockers: boolean;
    betaBlockerDrug?: string; // e.g., Bisoprolol, Metoprolol
    onAceiArbArni: boolean;
    aceiDrug?: string; // e.g., Sacubitril/Valsartan, Ramipril
    onStatins: boolean;
    statinDrug?: string; // e.g., Atorvastatin 80mg, Rosuvastatin
    onAnticoagulants: boolean;
    anticoagulantDrug?: string; // e.g., Rivaroxaban, Apixaban, Warfarin
    onDiuretics: boolean;
    diureticDrug?: string; // e.g., Furosemide, Spironolactone
    selfReportedAdherencePercent: number; // 0 - 100%
  };

  // 6. Family Cardiac History
  familyCardiacHistory: {
    prematureCadFirstDegreeRelative: boolean; // Male <55, Female <65
    suddenCardiacDeathHistory: boolean;
    familialHypercholesterolemia: boolean;
    cardiomyopathyFamilyHistory: boolean;
    affectedRelativesDetails: string;
  };
}

export interface PulmonologyStructuredIntake {
  specialty: 'PULMONOLOGY';
  recordedAt: number;
  recordedBy: string;
  dyspneaMmrcScale: 'GRADE_0' | 'GRADE_1' | 'GRADE_2' | 'GRADE_3' | 'GRADE_4';
  coughCharacteristics: {
    hasCough: boolean;
    durationWeeks: number;
    sputumType: 'NONE' | 'MUCOID_WHITE' | 'PURULENT_YELLOW_GREEN' | 'HEMOPTYSIS_BLOOD_TINGED';
    nocturnalWorsening: boolean;
  };
  wheezingAndTriggers: {
    present: boolean;
    triggers: string[]; // Cold air, Allergens, Exertion, Smoke
  };
  priorAsthmaOrCopdDiagnosis: boolean;
  historyOfPneumothoraxOrTb: boolean;
  inhalerTechniqueAndAdherence: string;
}

export interface NeurologyStructuredIntake {
  specialty: 'NEUROLOGY';
  recordedAt: number;
  recordedBy: string;
  strokeTiaHistory: boolean;
  seizureDisorderHistory: boolean;
  headacheProfile: {
    present: boolean;
    quality: 'THROBBING_HEMICRANIAL' | 'BAND_LIKE_TENSION' | 'THUNDERCLAP' | 'STABBING';
    photophobiaPhonophobia: boolean;
  };
  cranialNerveDeficits: string[];
  motorSensoryDeficits: string;
  gaitAndBalanceAssessment: 'NORMAL' | 'HEMIPARETIC' | 'ATAXIC' | 'PARKINSONIAN_SHUFFLING';
}

export interface GenericSpecialtyIntake {
  specialty: ClinicalSpecialty;
  recordedAt: number;
  recordedBy: string;
  specialtySpecificSymptoms: Record<string, any>;
  focusedExamFindings: string;
  diseaseDurationYears: number;
  priorSpecialtyProcedures: string[];
  targetedQuestionnaireAnswers: Record<string, string>;
}

export type StructuredSpecialtyIntakeData =
  | CardiologyStructuredIntake
  | PulmonologyStructuredIntake
  | NeurologyStructuredIntake
  | GenericSpecialtyIntake;

// ============================================================================
// STAGE 4: CONSULTANT SPECIALIST (CARDIOLOGIST / SPECIALIST MD)
// ============================================================================

export interface SpecialInvestigationItem {
  id: string;
  code: string;
  name: string;
  modality: 'ECG' | 'ECHO' | 'LAB_CARDIAC' | 'ANGIOGRAM' | 'IMAGING' | 'STRESS_TEST';
  indication: string;
  urgency: 'ROUTINE' | 'URGENT' | 'STAT';
  status: 'ORDERED' | 'IN_PROCESSING' | 'FINALIZED';
  orderedAt: number;
  resultSummary?: string;
  keyFindings?: {
    ecgRhythm?: string; // e.g. "Sinus rhythm, ST elevation in V1-V4"
    echoLvefPercent?: number; // e.g. 45%
    troponinValue?: string; // e.g. "0.084 ng/mL (High)"
    ntProBnpValue?: string; // e.g. "1,850 pg/mL"
    coronaryAngioNotes?: string;
  };
  criticalAlert?: boolean;
}

export interface StructuredSoapDocumentation {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  primaryDiagnosis: {
    icd10Code: string;
    title: string;
    isChronic: boolean;
  };
  secondaryDiagnoses: {
    icd10Code: string;
    title: string;
  }[];
  clinicalRiskScores: {
    ascvd10YearRiskPercent?: number;
    nyhaFunctionalClass?: 'CLASS_I' | 'CLASS_II' | 'CLASS_III' | 'CLASS_IV';
    cha2ds2VascScore?: number;
    framinghamScore?: number;
  };
  cptBillingProcedures: {
    code: string;
    description: string;
    fee: number;
  }[];
  consultantId: string;
  consultantName: string;
  consultantSpecialty: string;
  signedAt: number;
  isSigned: boolean;
}

export interface LifestyleModificationPrescription {
  dietaryPlan: {
    sodiumRestrictionGramsPerDay: number; // e.g. 2.0g
    fluidRestrictionLitersPerDay?: number; // e.g. 1.5L
    mediterraneanDietAdvised: boolean;
    diabeticCarbRestriction: boolean;
  };
  exerciseAndRehab: {
    cardiacRehabEnrolled: boolean;
    exerciseFrequencyDaysPerWeek: number; // e.g. 5 days
    targetMinutesPerSession: number; // e.g. 30 mins
    prescribedIntensity: 'LIGHT_WALKING' | 'MODERATE_AEROBIC' | 'SUPERVISED_CARDIAC_REHAB';
    contraindicationsWarning?: string;
  };
  smokingCessationPlan: {
    activeIntervention: boolean;
    nicotineReplacementTherapy: boolean;
    counselingReferral: boolean;
  };
  weightManagementGoalKg?: number;
  prescribedAt: number;
}

export interface ReconciledMedicationItem {
  id: string;
  drugName: string;
  dosage: string;
  route: 'ORAL' | 'IV' | 'SUBLINGUAL' | 'SC' | 'INHALATION';
  frequency: string;
  indication: string;
  reconciliationAction: 'CONTINUED_UNCHANGED' | 'MODIFIED_DOSE' | 'NEWLY_PRESCRIBED' | 'DISCONTINUED_HOLD';
  discontinuationReason?: string;
  potentialInteractionsAlert?: string;
  durationDays: number;
  dispensedStatus: 'PENDING_PHARMACY' | 'VERIFIED' | 'DISPENSED';
}

export interface ClinicalRoutingDecision {
  destinationType: 'DISCHARGE_HOME' | 'REVISIT_OPD' | 'INTER_SPECIALTY_REFERRAL' | 'CATH_LAB_ADMISSION' | 'CCU_ICU_ADMISSION' | 'INPATIENT_WARD' | 'TELEHEALTH_VIRTUAL';
  targetDepartment: string;
  targetSpecialistId?: string;
  targetSpecialistName?: string;
  revisitIntervalDays?: number;
  scheduledRevisitDate?: string;
  routingPriority: 'ROUTINE' | 'PRIORITY' | 'STAT_EMERGENCY';
  clinicalHandoffSummary: string;
  routedAt: number;
  routedBy: string;
}

// ============================================================================
// LONGITUDINAL ENCOUNTER AGGREGATE
// ============================================================================

export interface LongitudinalEncounterRecord {
  encounterId: string;
  tenantId: string;
  patientId: string;
  mrn: string;
  patientName: string;
  gender: string;
  age: number;
  encounterDate: number;
  specialty: ClinicalSpecialty;
  currentWorkflowStage: 'TRIAGE' | 'MO_GENERAL_ASSESSMENT' | 'SPECIALTY_INTAKE' | 'CONSULTANT_EVALUATION' | 'ROUTING_COMPLETED';

  // Multi-Stage Clinical Pipeline Payloads
  nursingTriage?: NursingTriageIntake;
  generalAssessment?: GeneralAssessmentMoIntake;
  specialtyIntake?: StructuredSpecialtyIntakeData;
  consultantDocumentation?: {
    specialInvestigations: SpecialInvestigationItem[];
    soap: StructuredSoapDocumentation;
    lifestyleModification: LifestyleModificationPrescription;
    medications: ReconciledMedicationItem[];
    routing: ClinicalRoutingDecision;
  };

  // Event Derived Timeline Audit
  lifecycleEvents: {
    eventId: string;
    eventType: string;
    stageName: string;
    timestamp: number;
    actor: string;
    summary: string;
  }[];
}
