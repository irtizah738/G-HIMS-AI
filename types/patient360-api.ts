import type {
  Patient360Projection,
  Patient360TimelineItem,
} from '@/types/patient360-projection';

export type Patient360FreshnessStatus =
  | 'FRESH'
  | 'STALE'
  | 'NOT_READY'
  | 'UNKNOWN';

export interface Patient360Freshness {
  status: Patient360FreshnessStatus;
  projectionRevision?: number;
  authoritativeEventCount: number;
  lagEventCount: number;
  projectedAt?: number;
  ageMs?: number;
  projectionCheckpoint?: {
    eventId: string;
    recordedAt: number;
  };
  authoritativeCheckpoint?: {
    eventId: string;
    recordedAt: number;
  };
}

export interface Patient360ProjectionResponse {
  success: true;
  tenantId: string;
  patientId: string;
  projection: Patient360Projection;
  freshness: Patient360Freshness;
}

export interface Patient360TimelinePage {
  success: true;
  tenantId: string;
  patientId: string;
  items: Patient360TimelineItem[];
  page: {
    limit: number;
    nextCursor?: string;
    hasMore: boolean;
  };
  projection: {
    projectionVersion: number;
    revision: number;
    contentHash: string;
    sourceCheckpoint: string;
    freshness: Patient360FreshnessStatus;
  };
}

export interface Patient360ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    canonicalPatientId?: string;
  };
}
