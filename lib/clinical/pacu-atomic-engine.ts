import { Bed } from '@/types/inpatient-or';

export interface PACUBedLockResult {
  success: boolean;
  allocatedBedId?: string;
  allocatedBedNumber?: string;
  allocatedWardName?: string;
  lockToken?: string;
  error?: string;
  conflictDetails?: {
    attemptedBedId: string;
    alreadyOccupiedByCaseId?: string;
    timestamp: string;
  };
}

/**
 * In-memory / persistent atomic lock manager for PACU beds.
 * Simulates high-concurrency race condition protections and transactional reservation.
 */
class PACUAtomicLockEngine {
  private bedLocks: Map<string, { caseId: string; lockToken: string; timestamp: number }> = new Map();
  private localBeds: Map<string, Bed> = new Map();

  constructor() {
    this.seedDefaultPACUBeds();
  }

  private seedDefaultPACUBeds() {
    const beds: Bed[] = [
      {
        id: 'bed-pacu-01',
        tenantId: 'central-metro-hospital',
        wardId: 'ward-pacu',
        wardName: 'Post-Anesthesia Care Unit (PACU)',
        bedNumber: 'PACU-Bay-01',
        roomNumber: 'PACU Main Floor',
        class: 'icu',
        status: 'available',
        oxygenPort: true,
        telemetryEnabled: true,
        isolationType: 'none',
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'bed-pacu-02',
        tenantId: 'central-metro-hospital',
        wardId: 'ward-pacu',
        wardName: 'Post-Anesthesia Care Unit (PACU)',
        bedNumber: 'PACU-Bay-02',
        roomNumber: 'PACU Main Floor',
        class: 'icu',
        status: 'occupied',
        currentPatientId: 'p-1001',
        patientName: 'Eleanor Vance',
        patientMRN: 'GH-2026-3391',
        oxygenPort: true,
        telemetryEnabled: true,
        isolationType: 'none',
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'bed-pacu-03',
        tenantId: 'central-metro-hospital',
        wardId: 'ward-pacu',
        wardName: 'Post-Anesthesia Care Unit (PACU)',
        bedNumber: 'PACU-Bay-03',
        roomNumber: 'PACU Main Floor',
        class: 'icu',
        status: 'available',
        oxygenPort: true,
        telemetryEnabled: true,
        isolationType: 'none',
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'bed-pacu-04',
        tenantId: 'central-metro-hospital',
        wardId: 'ward-pacu',
        wardName: 'Post-Anesthesia Care Unit (PACU)',
        bedNumber: 'PACU-Bay-04 (Isolation Bay)',
        roomNumber: 'PACU Isolation Room 1',
        class: 'icu',
        status: 'available',
        oxygenPort: true,
        telemetryEnabled: true,
        isolationType: 'contact',
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'bed-pacu-05',
        tenantId: 'central-metro-hospital',
        wardId: 'ward-pacu',
        wardName: 'Post-Anesthesia Care Unit (PACU)',
        bedNumber: 'PACU-Bay-05 (Pediatric Recovery)',
        roomNumber: 'PACU Pediatric Pod',
        class: 'icu',
        status: 'available',
        oxygenPort: true,
        telemetryEnabled: true,
        isolationType: 'none',
        updatedAt: new Date().toISOString(),
      },
    ];

    beds.forEach((b) => this.localBeds.set(b.id, b));
  }

  public getPACUBeds(): Bed[] {
    return Array.from(this.localBeds.values());
  }

  /**
   * Atomically attempts to reserve a PACU bed for a surgical case.
   * If two simultaneous requests target the same bed, exactly ONE succeeds and the other receives a conflict rejection.
   */
  public async reservePACUBedAtomic(
    caseId: string,
    targetBedId?: string
  ): Promise<PACUBedLockResult> {
    // Artificial jitter to realistically model multi-client network arrival
    await new Promise((r) => setTimeout(r, Math.random() * 80 + 20));

    // If specific bed requested:
    if (targetBedId) {
      const bed = this.localBeds.get(targetBedId);
      if (!bed) {
        return {
          success: false,
          error: `PACU bed ${targetBedId} does not exist in registry.`,
        };
      }

      // Check atomic lock map
      if (this.bedLocks.has(targetBedId)) {
        const existingLock = this.bedLocks.get(targetBedId)!;
        return {
          success: false,
          error: `RACE CONDITION DETECTED: Bed ${bed.bedNumber} is already atomically locked by Case ${existingLock.caseId}.`,
          conflictDetails: {
            attemptedBedId: targetBedId,
            alreadyOccupiedByCaseId: existingLock.caseId,
            timestamp: new Date().toISOString(),
          },
        };
      }

      if (bed.status !== 'available') {
        return {
          success: false,
          error: `Bed ${bed.bedNumber} is currently occupied (${bed.status}). Cannot allocate.`,
          conflictDetails: {
            attemptedBedId: targetBedId,
            alreadyOccupiedByCaseId: bed.currentPatientId,
            timestamp: new Date().toISOString(),
          },
        };
      }

      // Atomically claim bed
      const lockToken = `lock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      this.bedLocks.set(targetBedId, { caseId, lockToken, timestamp: Date.now() });

      bed.status = 'reserved';
      bed.updatedAt = new Date().toISOString();
      this.localBeds.set(targetBedId, bed);

      return {
        success: true,
        allocatedBedId: bed.id,
        allocatedBedNumber: bed.bedNumber,
        allocatedWardName: bed.wardName,
        lockToken,
      };
    }

    // Auto-allocate first available bed
    for (const [bedId, bed] of this.localBeds.entries()) {
      if (bed.status === 'available' && !this.bedLocks.has(bedId)) {
        const lockToken = `lock-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        this.bedLocks.set(bedId, { caseId, lockToken, timestamp: Date.now() });

        bed.status = 'reserved';
        bed.updatedAt = new Date().toISOString();
        this.localBeds.set(bedId, bed);

        return {
          success: true,
          allocatedBedId: bed.id,
          allocatedBedNumber: bed.bedNumber,
          allocatedWardName: bed.wardName,
          lockToken,
        };
      }
    }

    return {
      success: false,
      error: 'CRITICAL PACU CAPACITY ALERT: Zero PACU beds currently available. All beds occupied or locked.',
    };
  }

  /**
   * Release or mark occupied
   */
  public occupyPACUBed(bedId: string, caseId: string, patientName: string, patientMrn: string) {
    const bed = this.localBeds.get(bedId);
    if (bed) {
      bed.status = 'occupied';
      bed.patientName = patientName;
      bed.patientMRN = patientMrn;
      bed.updatedAt = new Date().toISOString();
      this.localBeds.set(bedId, bed);
    }
  }

  public releasePACUBed(bedId: string) {
    this.bedLocks.delete(bedId);
    const bed = this.localBeds.get(bedId);
    if (bed) {
      bed.status = 'available';
      bed.patientName = undefined;
      bed.patientMRN = undefined;
      bed.currentPatientId = undefined;
      bed.updatedAt = new Date().toISOString();
      this.localBeds.set(bedId, bed);
    }
  }

  public resetLocks() {
    this.bedLocks.clear();
    this.seedDefaultPACUBeds();
  }
}

export const pacuAtomicEngine = new PACUAtomicLockEngine();
