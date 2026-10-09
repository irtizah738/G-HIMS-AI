export type VectorClock = Record<string, number>;

export type MutationAction = 'CREATE' | 'UPDATE' | 'DELETE';
export type MutationStatus = 'pending' | 'syncing' | 'failed' | 'conflict';

export interface EncryptedEdgePayload {
  v: 1;
  alg: 'AES-GCM';
  keyId: string;
  iv: string;
  ciphertext: string;
}

export interface SyncMutation {
  id: string;
  tenantId: string;
  /** Firebase UID that created this offline command. Never reassigned on replay. */
  actorId?: string;
  collection: string;
  docId: string;
  resourceId?: string;
  action: MutationAction;
  commandType?: string;
  idempotencyKey?: string;
  schemaVersion?: number;
  baseEntityVersion?: number;
  dependsOnMutationIds?: string[];
  payload: Record<string, any>;
  /** AES-GCM envelope used for IndexedDB persistence. Public DB helpers decrypt transparently. */
  encryptedPayload?: EncryptedEdgePayload;
  vectorClock: VectorClock;
  baseVectorClock?: VectorClock;
  timestamp: number;
  clientTimestamp?: number;
  retryCount: number;
  status: MutationStatus;
  errorMessage?: string;
  conflictDetails?: {
    serverState: Record<string, unknown>;
    clientState: Record<string, unknown>;
  };
}

export interface OfflineCacheEntry {
  key: string; // `${tenantId}:${collection}:${docId}`
  tenantId: string;
  collection: string;
  data: Record<string, unknown>;
  encryptedData?: EncryptedEdgePayload;
  actorId?: string;
  updatedAt: number;
  vectorClock: VectorClock;
}

export interface ClinicalPatientEntity {
  id: string;
  tenantId: string;
  mrn: string;
  name: string;
  gender?: 'Male' | 'Female' | 'Other';
  age?: number;
  dob?: string;
  bloodGroup?: string;
  primaryDiagnosis?: string;
  bedId?: string;
  bedNumber?: string;
  wardId?: string;
  wardName?: string;
  acuityScore?: number;
  acuityLevel?: 'Low' | 'Low-Medium' | 'Medium' | 'High';
  attendingDoctor?: string;
  admissionDate?: string;
  updatedAt: number;
  vectorClock?: VectorClock;
}

export interface BedOccupancyEntity {
  id: string;
  tenantId: string;
  wardId: string;
  wardName: string;
  bedNumber: string;
  roomNumber: string;
  status: 'Occupied' | 'Available' | 'Housekeeping' | 'Maintenance' | 'Isolation';
  patientId?: string;
  patientName?: string;
  patientMrn?: string;
  primaryDiagnosis?: string;
  acuityScore?: number;
  acuityLevel?: 'Low' | 'Low-Medium' | 'Medium' | 'High';
  attendingDoctor?: string;
  assignedNurse?: string;
  admissionDate?: string;
  lengthOfStayDays?: number;
  isolationType?: 'none' | 'contact' | 'droplet' | 'airborne';
  oxygenPort?: boolean;
  telemetryEnabled?: boolean;
  notes?: string;
  updatedAt: number;
  vectorClock?: VectorClock;
}

export interface SurgicalCaseEntity {
  id: string;
  tenantId: string;
  patientId: string;
  patientName: string;
  patientMrn: string;
  patientAge?: number;
  patientGender?: string;
  theaterId: string;
  theaterRoom: string;
  procedureName: string;
  cptCode?: string;
  leadSurgeon: string;
  anesthesiologist: string;
  scrubNurse: string;
  circulatingNurse?: string;
  scheduledTime: string;
  status: 'scheduled' | 'pre_op' | 'intra_op' | 'closing' | 'pacu_recovery' | 'completed' | 'cancelled';
  whoChecklist: {
    signIn: {
      completed: boolean;
      completedAt?: string;
      verifiedBy?: string;
      patientIdentityConfirmed: boolean;
      siteMarked: boolean;
      anesthesiaSafetyCheckComplete: boolean;
      pulseOximeterFunctioning: boolean;
      allergyKnown: boolean;
      allergyDetails?: string;
      difficultAirwayRisk: boolean;
      difficultAirwayEquipAvailable?: boolean;
      bloodLossRiskOver500ml: boolean;
      adequateIVAccessAndFluids?: boolean;
    };
    timeOut: {
      completed: boolean;
      completedAt?: string;
      verifiedBy?: string;
      teamIntroducedWithRoles: boolean;
      patientNameAndProcedureConfirmed: boolean;
      antibioticProphylaxisGivenWithin60Min: boolean;
      prophylaxisNameAndDose?: string;
      surgeonCriticalStepsReview: boolean;
      anesthesiaReview: boolean;
      nursingSterilityReview: boolean;
      essentialImagingDisplayed: boolean;
    };
    signOut: {
      completed: boolean;
      completedAt?: string;
      verifiedBy?: string;
      procedureRecordedVerbal: boolean;
      instrumentCountsExact: boolean;
      spongeCountsExact: boolean;
      needleCountsExact: boolean;
      specimenLabeledCorrectly: boolean;
      equipmentProblemsFlagged: boolean;
      recoveryAndPostOpPlanReviewed: boolean;
    };
  };
  surgicalCountReconciliation: {
    spongesInitial: number;
    spongesAdded: number;
    spongesFinal: number;
    needlesInitial: number;
    needlesAdded: number;
    needlesFinal: number;
    instrumentsInitial: number;
    instrumentsAdded: number;
    instrumentsFinal: number;
    scrubNurseSigned: boolean;
    scrubNurseName?: string;
    scrubNurseSignedAt?: string;
    circulatingNurseSigned: boolean;
    circulatingNurseName?: string;
    circulatingNurseSignedAt?: string;
    countsReconciled: boolean;
  };
  aldreteScore?: {
    activity: number; // 0-2
    respiration: number; // 0-2
    circulation: number; // 0-2
    consciousness: number; // 0-2
    oxygenSaturation: number; // 0-2
    totalScore: number; // 0-10
    assessedAt?: string;
    assessedBy?: string;
    dischargeReady: boolean; // >= 9
    notes?: string;
  };
  updatedAt: number;
  vectorClock?: VectorClock;
}


export interface EdgeEntityRecord {
  key: string;
  tenantId: string;
  collection: string;
  entityId: string;
  data: Record<string, unknown>;
  encryptedData?: EncryptedEdgePayload;
  actorId?: string;
  updatedAt: number;
  serverVersion?: number;
  vectorClock?: VectorClock;
  deleted?: boolean;
}

export interface EdgeEntityMapping {
  key: string;
  tenantId: string;
  localId: string;
  canonicalId?: string;
  entityType: string;
  status: 'LOCAL_ONLY' | 'MAPPED' | 'FAILED';
  sourceMutationId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface EdgeSyncMetadata {
  key: string;
  tenantId: string;
  scope: string;
  /** Authenticated actor and hashed authority epoch for protected read cache. */
  actorId?: string;
  authorityEpoch?: string;
  snapshotVersion: string;
  lastHydratedAt: number;
  serverGeneratedAt?: number;
}
