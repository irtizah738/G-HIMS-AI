/**
 * Pharmacy FEFO (First-Expiring-First-Out) Inventory & Dispensing Engine
 * Validates stock batches, sorts by expiry date, and reserves nearest-expiring batches
 */

import { MedicationBatch, PharmacyPrescriptionItem } from '@/types/clinical-workflow-comprehensive';

export interface DrugInventoryRecord {
  drugId: string;
  drugName: string;
  genericName: string;
  dosageForm: string;
  totalQuantity: number;
  batches: MedicationBatch[];
}

export const MOCK_HOSPITAL_PHARMACY_STOCK: Record<string, DrugInventoryRecord> = {
  'amoxicillin_500': {
    drugId: 'amoxicillin_500',
    drugName: 'Amoxicillin 500mg Capsule',
    genericName: 'Amoxicillin Trihydrate',
    dosageForm: 'Capsule',
    totalQuantity: 450,
    batches: [
      { batchNumber: 'AMX-2025-A', expiryDate: '2026-09-30', quantityInStock: 50, unitCost: 0.35, location: 'Bin A-12' },
      { batchNumber: 'AMX-2026-B', expiryDate: '2027-04-15', quantityInStock: 200, unitCost: 0.38, location: 'Bin A-13' },
      { batchNumber: 'AMX-2026-C', expiryDate: '2027-11-20', quantityInStock: 200, unitCost: 0.40, location: 'Bin A-14' },
    ],
  },
  'atorvastatin_20': {
    drugId: 'atorvastatin_20',
    drugName: 'Atorvastatin 20mg Tablet',
    genericName: 'Atorvastatin Calcium',
    dosageForm: 'Tablet',
    totalQuantity: 320,
    batches: [
      { batchNumber: 'ATV-2025-08', expiryDate: '2026-08-31', quantityInStock: 40, unitCost: 0.65, location: 'Bin B-04' },
      { batchNumber: 'ATV-2026-01', expiryDate: '2027-01-30', quantityInStock: 180, unitCost: 0.70, location: 'Bin B-05' },
      { batchNumber: 'ATV-2026-06', expiryDate: '2027-08-15', quantityInStock: 100, unitCost: 0.72, location: 'Bin B-06' },
    ],
  },
  'ceftriaxone_1g': {
    drugId: 'ceftriaxone_1g',
    drugName: 'Ceftriaxone 1g Injection Vial',
    genericName: 'Ceftriaxone Sodium',
    dosageForm: 'Vial',
    totalQuantity: 120,
    batches: [
      { batchNumber: 'CTX-2025-11', expiryDate: '2026-11-15', quantityInStock: 30, unitCost: 4.50, location: 'Cooler C-02' },
      { batchNumber: 'CTX-2026-04', expiryDate: '2027-04-30', quantityInStock: 90, unitCost: 4.65, location: 'Cooler C-02' },
    ],
  },
  'paracetamol_500': {
    drugId: 'paracetamol_500',
    drugName: 'Paracetamol 500mg Tablet',
    genericName: 'Acetaminophen',
    dosageForm: 'Tablet',
    totalQuantity: 1200,
    batches: [
      { batchNumber: 'PCM-2025-10', expiryDate: '2026-10-31', quantityInStock: 200, unitCost: 0.08, location: 'Bin P-01' },
      { batchNumber: 'PCM-2026-03', expiryDate: '2027-03-31', quantityInStock: 500, unitCost: 0.09, location: 'Bin P-02' },
      { batchNumber: 'PCM-2026-09', expiryDate: '2027-09-30', quantityInStock: 500, unitCost: 0.09, location: 'Bin P-03' },
    ],
  },
};

export class FefoPharmacyEngine {
  /**
   * Identifies the earliest-expiring batch that has sufficient quantity to reserve
   */
  public static allocateFefoBatch(drugKey: string, quantityNeeded: number): {
    success: boolean;
    allocatedBatch?: MedicationBatch;
    message: string;
  } {
    const drugRecord = MOCK_HOSPITAL_PHARMACY_STOCK[drugKey] || Object.values(MOCK_HOSPITAL_PHARMACY_STOCK).find(d => 
      d.drugName.toLowerCase().includes(drugKey.toLowerCase()) || 
      d.genericName.toLowerCase().includes(drugKey.toLowerCase())
    );

    if (!drugRecord) {
      return {
        success: false,
        message: `Drug '${drugKey}' not found in active hospital pharmacy formulary.`,
      };
    }

    // Sort batches by earliest expiry date (FEFO)
    const sortedBatches = [...drugRecord.batches].sort((a, b) => 
      new Date(a.expiryDate).getTime() - new Date(b.expiryDate).getTime()
    );

    const availableBatch = sortedBatches.find(b => b.quantityInStock >= quantityNeeded);

    if (!availableBatch) {
      return {
        success: false,
        message: `Insufficient stock for '${drugRecord.drugName}'. Needed: ${quantityNeeded}, Available in earliest batch: ${sortedBatches[0]?.quantityInStock || 0}`,
      };
    }

    return {
      success: true,
      allocatedBatch: availableBatch,
      message: `FEFO batch ${availableBatch.batchNumber} (Exp: ${availableBatch.expiryDate}) allocated from ${availableBatch.location}.`,
    };
  }

  /**
   * Checks for known allergies against drug name
   */
  public static checkAllergyConflict(drugName: string, knownAllergies: string[]): {
    hasConflict: boolean;
    warningMessage?: string;
  } {
    const lowerDrug = drugName.toLowerCase();
    for (const allergy of knownAllergies) {
      const lowerAllergy = allergy.toLowerCase();
      if (lowerDrug.includes(lowerAllergy) || (lowerAllergy === 'penicillin' && lowerDrug.includes('amoxicillin'))) {
        return {
          hasConflict: true,
          warningMessage: `CRITICAL ALLERGY ALERT: Patient has documented allergy to '${allergy}'. Drug '${drugName}' is contraindicated.`,
        };
      }
    }

    return { hasConflict: false };
  }
}
