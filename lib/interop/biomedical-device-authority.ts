import type { ResourceMaster, ResourceType } from '@/types/resource-management';
import { DomainStateRepository } from '@/server/repositories/domain-state-repository';

const BIOMEDICAL_RESOURCE_TYPES = new Set<ResourceType>([
  'MEDICAL_DEVICE',
  'LAB_EQUIPMENT',
  'RADIOLOGY_EQUIPMENT',
  'SURGICAL_EQUIPMENT',
]);

function calibrationDueMs(resource: ResourceMaster): number | null {
  if (!resource.nextCalibrationDate) return null;
  const parsed = Date.parse(resource.nextCalibrationDate + 'T23:59:59.999Z');
  return Number.isFinite(parsed) ? parsed : null;
}

export interface BiomedicalInteropBinding {
  tenantId: string;
  resourceId: string;
  expectedManufacturer?: string;
  expectedModel?: string;
  expectedSerialNumber?: string;
  requiredThroughMs?: number;
}

export async function assertBiomedicalInteropReady(
  binding: BiomedicalInteropBinding
): Promise<ResourceMaster> {
  const resource = await DomainStateRepository.getById<ResourceMaster>(
    binding.tenantId,
    'resources',
    binding.resourceId
  );

  if (!resource) {
    throw new Error('BIOMEDICAL_RESOURCE_NOT_FOUND');
  }
  if (!BIOMEDICAL_RESOURCE_TYPES.has(resource.resourceType)) {
    throw new Error('BIOMEDICAL_RESOURCE_TYPE_INVALID');
  }
  if (
    ['OUT_OF_SERVICE', 'MAINTENANCE', 'LOST', 'RETIRED'].includes(resource.status) ||
    resource.lifecycleState !== 'IN_SERVICE'
  ) {
    throw new Error('BIOMEDICAL_RESOURCE_NOT_IN_SERVICE');
  }
  if (resource.calibrationRequired) {
    if (resource.calibrationStatus !== 'VALID') {
      throw new Error('BIOMEDICAL_CALIBRATION_LOCKOUT');
    }
    const dueMs = calibrationDueMs(resource);
    if (!dueMs) throw new Error('BIOMEDICAL_CALIBRATION_EXPIRY_MISSING');
    const requiredThroughMs = binding.requiredThroughMs ?? Date.now();
    if (requiredThroughMs > dueMs) {
      throw new Error('BIOMEDICAL_CALIBRATION_EXPIRED');
    }
  }

  const same = (a: unknown, b: unknown) =>
    String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase();

  if (
    binding.expectedManufacturer &&
    resource.manufacturer &&
    !same(binding.expectedManufacturer, resource.manufacturer)
  ) {
    throw new Error('BIOMEDICAL_MANUFACTURER_MISMATCH');
  }
  if (
    binding.expectedModel &&
    resource.model &&
    !same(binding.expectedModel, resource.model)
  ) {
    throw new Error('BIOMEDICAL_MODEL_MISMATCH');
  }
  if (
    binding.expectedSerialNumber &&
    resource.serialNumber &&
    !same(binding.expectedSerialNumber, resource.serialNumber)
  ) {
    throw new Error('BIOMEDICAL_SERIAL_MISMATCH');
  }

  return resource;
}
