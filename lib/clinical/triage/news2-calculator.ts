/**
 * Royal College of Physicians (RCP) National Early Warning Score 2 (NEWS2) Engine
 * Clinically validated scoring for physiological deterioration and emergency escalation
 */

export interface News2Input {
  respiratoryRate: number; // breaths per min
  spo2Percent: number; // %
  onSupplementalOxygen: boolean;
  systolicBp: number; // mmHg
  heartRate: number; // bpm
  consciousness?: 'ALERT' | 'VOICE' | 'PAIN' | 'UNRESPONSIVE';
  gcsScore?: number; // Glasgow Coma Scale (3-15)
  temperature: number; // °C
}

export function gcsToAvpu(gcs: number): 'ALERT' | 'VOICE' | 'PAIN' | 'UNRESPONSIVE' {
  if (gcs >= 15) return 'ALERT';
  if (gcs >= 12) return 'VOICE';
  if (gcs >= 8) return 'PAIN';
  return 'UNRESPONSIVE';
}

export function avpuToGcs(avpu: 'ALERT' | 'VOICE' | 'PAIN' | 'UNRESPONSIVE'): number {
  switch (avpu) {
    case 'ALERT': return 15;
    case 'VOICE': return 13;
    case 'PAIN': return 9;
    case 'UNRESPONSIVE': return 3;
    default: return 15;
  }
}

export interface News2Result {
  totalScore: number;
  subScores: {
    respiratoryRate: number;
    spo2: number;
    oxygen: number;
    systolicBp: number;
    heartRate: number;
    consciousness: number;
    temperature: number;
  };
  clinicalRisk: 'LOW' | 'LOW_MEDIUM' | 'MEDIUM' | 'HIGH';
  responseLevel: string;
  recommendedRouting: 'STANDARD_OPD' | 'URGENT_MO_QUEUE' | 'EMERGENCY_RESUSCITATION';
  escalationRequired: boolean;
}

export function calculateNews2Score(input: News2Input): News2Result {
  const subScores = {
    respiratoryRate: 0,
    spo2: 0,
    oxygen: 0,
    systolicBp: 0,
    heartRate: 0,
    consciousness: 0,
    temperature: 0,
  };

  // 1. Respiration Rate
  if (input.respiratoryRate <= 8) subScores.respiratoryRate = 3;
  else if (input.respiratoryRate >= 9 && input.respiratoryRate <= 11) subScores.respiratoryRate = 1;
  else if (input.respiratoryRate >= 12 && input.respiratoryRate <= 20) subScores.respiratoryRate = 0;
  else if (input.respiratoryRate >= 21 && input.respiratoryRate <= 24) subScores.respiratoryRate = 2;
  else if (input.respiratoryRate >= 25) subScores.respiratoryRate = 3;

  // 2. SpO2 (Scale 1: Standard)
  if (input.spo2Percent <= 91) subScores.spo2 = 3;
  else if (input.spo2Percent >= 92 && input.spo2Percent <= 93) subScores.spo2 = 2;
  else if (input.spo2Percent >= 94 && input.spo2Percent <= 95) subScores.spo2 = 1;
  else if (input.spo2Percent >= 96) subScores.spo2 = 0;

  // 3. Air / Oxygen
  subScores.oxygen = input.onSupplementalOxygen ? 2 : 0;

  // 4. Systolic Blood Pressure
  if (input.systolicBp <= 90) subScores.systolicBp = 3;
  else if (input.systolicBp >= 91 && input.systolicBp <= 100) subScores.systolicBp = 2;
  else if (input.systolicBp >= 101 && input.systolicBp <= 110) subScores.systolicBp = 1;
  else if (input.systolicBp >= 111 && input.systolicBp <= 219) subScores.systolicBp = 0;
  else if (input.systolicBp >= 220) subScores.systolicBp = 3;

  // 5. Heart Rate (Pulse)
  if (input.heartRate <= 40) subScores.heartRate = 3;
  else if (input.heartRate >= 41 && input.heartRate <= 50) subScores.heartRate = 1;
  else if (input.heartRate >= 51 && input.heartRate <= 90) subScores.heartRate = 0;
  else if (input.heartRate >= 91 && input.heartRate <= 110) subScores.heartRate = 1;
  else if (input.heartRate >= 111 && input.heartRate <= 130) subScores.heartRate = 2;
  else if (input.heartRate >= 131) subScores.heartRate = 3;

  // 6. Consciousness (Glasgow Coma Scale / AVPU)
  // In NEWS2: Alert (GCS 15) = 0, Any Acute Confusion or altered consciousness (GCS < 15 or V/P/U) = 3
  if (input.gcsScore !== undefined) {
    subScores.consciousness = input.gcsScore >= 15 ? 0 : 3;
  } else {
    subScores.consciousness = input.consciousness === 'ALERT' ? 0 : 3;
  }

  // 7. Temperature
  if (input.temperature <= 35.0) subScores.temperature = 3;
  else if (input.temperature >= 35.1 && input.temperature <= 36.0) subScores.temperature = 1;
  else if (input.temperature >= 36.1 && input.temperature <= 38.0) subScores.temperature = 0;
  else if (input.temperature >= 38.1 && input.temperature <= 39.0) subScores.temperature = 1;
  else if (input.temperature >= 39.1) subScores.temperature = 2;

  const totalScore =
    subScores.respiratoryRate +
    subScores.spo2 +
    subScores.oxygen +
    subScores.systolicBp +
    subScores.heartRate +
    subScores.consciousness +
    subScores.temperature;

  const hasExtremeSingleParameter = Object.values(subScores).some((v) => v === 3);

  let clinicalRisk: 'LOW' | 'LOW_MEDIUM' | 'MEDIUM' | 'HIGH' = 'LOW';
  let responseLevel = 'Ward / OPD standard clinical monitoring';
  let recommendedRouting: 'STANDARD_OPD' | 'URGENT_MO_QUEUE' | 'EMERGENCY_RESUSCITATION' = 'STANDARD_OPD';
  let escalationRequired = false;

  if (totalScore >= 7) {
    clinicalRisk = 'HIGH';
    responseLevel = 'Emergency Red Alert: Immediate medical review & continuous vital monitoring';
    recommendedRouting = 'EMERGENCY_RESUSCITATION';
    escalationRequired = true;
  } else if (totalScore >= 5 || hasExtremeSingleParameter) {
    clinicalRisk = 'MEDIUM';
    responseLevel = 'Urgent Clinical Review: Fast-track to Medical Officer / Senior Nurse';
    recommendedRouting = 'URGENT_MO_QUEUE';
    escalationRequired = true;
  } else if (totalScore >= 1) {
    clinicalRisk = 'LOW_MEDIUM';
    responseLevel = 'Routine OPD monitoring: Re-check vitals in 4 hours if symptoms persist';
    recommendedRouting = 'STANDARD_OPD';
    escalationRequired = false;
  }

  return {
    totalScore,
    subScores,
    clinicalRisk,
    responseLevel,
    recommendedRouting,
    escalationRequired,
  };
}
