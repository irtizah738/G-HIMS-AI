import { CSSDCycle, CSSDValidationResult } from '@/types/scm-advanced';

/**
 * CSSD Autoclave BI Spore & Sterilization Parameter Validation Engine
 * Enforces ISO 11138 and AAMI ST79 standards for sterile processing release
 * into Operating Room (OR) inventory.
 */
export function validateAndReleaseCSSDCycle(cycle: CSSDCycle): {
  canRelease: boolean;
  validationErrors: string[];
  physicalParametersMet: boolean;
  biSporeCompliant: boolean;
  standardsChecked: string[];
} {
  const validationErrors: string[] = [];
  const standardsChecked: string[] = [];

  // 1. Basic Metadata Verification
  if (!cycle.autoclaveMachineId || cycle.autoclaveMachineId.trim() === '') {
    validationErrors.push('Missing Autoclave Machine ID identifier.');
  }

  if (!cycle.operatorId || cycle.operatorId.trim() === '') {
    validationErrors.push('Sterilization technician / operator ID is required.');
  }

  if (!cycle.trayBarcodes || !Array.isArray(cycle.trayBarcodes) || cycle.trayBarcodes.length === 0) {
    validationErrors.push('No surgical tray barcodes associated with this sterilization batch.');
  }

  let physicalParametersMet = true;

  // 2. Physical Sterilization Parameters Evaluation
  switch (cycle.sterilizationType) {
    case 'Steam':
      standardsChecked.push('ISO 17665 / AAMI ST79 (Moist Heat Sterilization)');
      // High-temp fast cycle: >= 134°C, >= 30 PSI, >= 4 mins
      // Standard cycle: >= 121°C, >= 15 PSI, >= 20 mins
      const isHighTempValid =
        cycle.temperatureCelsius >= 134 &&
        cycle.pressurePSI >= 30 &&
        cycle.exposureTimeMinutes >= 4;

      const isStandardSteamValid =
        cycle.temperatureCelsius >= 121 &&
        cycle.pressurePSI >= 15 &&
        cycle.exposureTimeMinutes >= 20;

      if (!isHighTempValid && !isStandardSteamValid) {
        physicalParametersMet = false;
        if (cycle.temperatureCelsius < 134 && cycle.temperatureCelsius < 121) {
          validationErrors.push(
            `Steam Autoclave Temperature (${cycle.temperatureCelsius}°C) is below minimum threshold (134°C for flash/gravity or 121°C standard).`
          );
        }
        if (cycle.pressurePSI < 30 && cycle.pressurePSI < 15) {
          validationErrors.push(
            `Steam Chamber Pressure (${cycle.pressurePSI} PSI) failed to reach required saturation pressure (min 30 PSI at 134°C or 15 PSI at 121°C).`
          );
        }
        if (cycle.exposureTimeMinutes < 4) {
          validationErrors.push(
            `Sterilization Exposure Time (${cycle.exposureTimeMinutes} mins) is insufficient (min 4.0 mins required at 134°C).`
          );
        }
      }
      break;

    case 'Plasma':
      standardsChecked.push('ISO 14937 (Vaporized Hydrogen Peroxide / Low Temp Gas Plasma)');
      // Low temp plasma: 45°C - 55°C, >= 45 mins
      if (cycle.temperatureCelsius < 45 || cycle.temperatureCelsius > 60) {
        physicalParametersMet = false;
        validationErrors.push(
          `Plasma Sterilization Temperature (${cycle.temperatureCelsius}°C) outside therapeutic plasma window (45°C - 60°C).`
        );
      }
      if (cycle.exposureTimeMinutes < 45) {
        physicalParametersMet = false;
        validationErrors.push(
          `Plasma Diffusion Exposure Time (${cycle.exposureTimeMinutes} mins) below required 45.0 mins.`
        );
      }
      break;

    case 'ETO':
      standardsChecked.push('ISO 11135 (Ethylene Oxide Sterilization)');
      // ETO: >= 54°C, >= 60 mins exposure, >= 10 PSI
      if (cycle.temperatureCelsius < 54) {
        physicalParametersMet = false;
        validationErrors.push(
          `Ethylene Oxide Chamber Temperature (${cycle.temperatureCelsius}°C) is below minimum 54°C.`
        );
      }
      if (cycle.exposureTimeMinutes < 60) {
        physicalParametersMet = false;
        validationErrors.push(
          `ETO Gas Exposure Time (${cycle.exposureTimeMinutes} mins) is below mandatory 60.0 mins.`
        );
      }
      if (cycle.pressurePSI < 10) {
        physicalParametersMet = false;
        validationErrors.push(
          `ETO Gas Pressure (${cycle.pressurePSI} PSI) below mandatory 10.0 PSI.`
        );
      }
      break;

    default:
      physicalParametersMet = false;
      validationErrors.push(`Unsupported or unknown sterilization type '${cycle.sterilizationType}'.`);
  }

  // 3. Biological Indicator (BI) Spore Lot & Result Verification (ISO 11138)
  standardsChecked.push('ISO 11138-1 / ISO 11138-3 (Biological Indicators for Sterilization)');

  let biSporeCompliant = false;

  if (!cycle.biSporeLotNumber || cycle.biSporeLotNumber.trim() === '') {
    validationErrors.push('Missing Biological Indicator (BI) Spore Lot Number.');
  }

  if (cycle.biSporeResult === 'passed') {
    biSporeCompliant = true;
  } else if (cycle.biSporeResult === 'failed') {
    biSporeCompliant = false;
    validationErrors.push(
      'CRITICAL BIO-HAZARD: Biological Indicator (BI) spore test positive/failed (Geobacillus stearothermophilus / B. atrophaeus microbial growth detected). ALL TRAYS MUST BE QUARANTINED & REPROCESSED.'
    );
  } else {
    // pending
    biSporeCompliant = false;
    validationErrors.push(
      'BI Spore incubation is currently PENDING (24/48-hr lab readout incomplete). Surgical trays cannot be released for OR use until BI test is confirmed PASSED.'
    );
  }

  const canRelease = validationErrors.length === 0 && physicalParametersMet && biSporeCompliant;

  return {
    canRelease,
    validationErrors,
    physicalParametersMet,
    biSporeCompliant,
    standardsChecked,
  };
}
