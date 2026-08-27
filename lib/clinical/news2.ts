export interface VitalSignsInput {
  respirationRate: number; // breaths per min
  spO2: number; // percentage (e.g., 97)
  spO2Scale: 1 | 2; // Scale 1: Standard (target >=96%), Scale 2: Hypercapnic target 88-92%
  onSupplementalOxygen: boolean; // true if patient is on supplemental O2
  systolicBP: number; // mmHg
  heartRate: number; // beats per min
  consciousness: 'Alert' | 'Voice' | 'Pain' | 'Unresponsive' | 'NewConfusion' | 'A' | 'V' | 'P' | 'U' | 'C';
  temperature: number; // Celsius (e.g., 37.2)
}

export type NEWS2RiskLevel = 'Low' | 'Low-Medium' | 'Medium' | 'High';

export interface NEWS2CalculationResult {
  score: number;
  riskLevel: NEWS2RiskLevel;
  clinicalResponse: string;
  hasRedTrigger: boolean; // Single parameter scoring 3
  redTriggerParameters: string[];
  parameterScores: {
    respirationRate: number;
    spO2: number;
    airOrOxygen: number;
    systolicBP: number;
    heartRate: number;
    consciousness: number;
    temperature: number;
  };
}

/**
 * Calculates Royal College of Physicians (RCP UK) NEWS2 Acuity Score
 */
export function calculateNEWS2(vitals: VitalSignsInput): NEWS2CalculationResult {
  const redTriggers: string[] = [];

  // 1. Respiration Rate
  let respScore = 0;
  if (vitals.respirationRate <= 8) {
    respScore = 3;
  } else if (vitals.respirationRate >= 9 && vitals.respirationRate <= 11) {
    respScore = 1;
  } else if (vitals.respirationRate >= 12 && vitals.respirationRate <= 20) {
    respScore = 0;
  } else if (vitals.respirationRate >= 21 && vitals.respirationRate <= 24) {
    respScore = 2;
  } else if (vitals.respirationRate >= 25) {
    respScore = 3;
  }
  if (respScore === 3) redTriggers.push('Respiration Rate');

  // 2. SpO2 (Scale 1 vs Scale 2 for hypercapnic respiratory failure / COPD)
  let spo2Score = 0;
  if (vitals.spO2Scale === 2) {
    // Hypercapnic Scale 2 (Target 88-92%)
    if (vitals.spO2 <= 83) {
      spo2Score = 3;
    } else if (vitals.spO2 >= 84 && vitals.spO2 <= 85) {
      spo2Score = 2;
    } else if (vitals.spO2 >= 86 && vitals.spO2 <= 87) {
      spo2Score = 1;
    } else if (vitals.spO2 >= 88 && vitals.spO2 <= 92) {
      spo2Score = 0;
    } else if (vitals.spO2 >= 93 && vitals.spO2 <= 94) {
      spo2Score = vitals.onSupplementalOxygen ? 1 : 0;
    } else if (vitals.spO2 >= 95 && vitals.spO2 <= 96) {
      spo2Score = vitals.onSupplementalOxygen ? 2 : 0;
    } else if (vitals.spO2 >= 97) {
      spo2Score = vitals.onSupplementalOxygen ? 3 : 0;
    }
  } else {
    // Standard Scale 1 (Target >= 96%)
    if (vitals.spO2 <= 91) {
      spo2Score = 3;
    } else if (vitals.spO2 >= 92 && vitals.spO2 <= 93) {
      spo2Score = 2;
    } else if (vitals.spO2 >= 94 && vitals.spO2 <= 95) {
      spo2Score = 1;
    } else if (vitals.spO2 >= 96) {
      spo2Score = 0;
    }
  }
  if (spo2Score === 3) redTriggers.push('Oxygen Saturation');

  // 3. Air or Oxygen
  const o2Score = vitals.onSupplementalOxygen ? 2 : 0;

  // 4. Systolic Blood Pressure
  let sbpScore = 0;
  if (vitals.systolicBP <= 90) {
    sbpScore = 3;
  } else if (vitals.systolicBP >= 91 && vitals.systolicBP <= 100) {
    sbpScore = 2;
  } else if (vitals.systolicBP >= 101 && vitals.systolicBP <= 110) {
    sbpScore = 1;
  } else if (vitals.systolicBP >= 111 && vitals.systolicBP <= 219) {
    sbpScore = 0;
  } else if (vitals.systolicBP >= 220) {
    sbpScore = 3;
  }
  if (sbpScore === 3) redTriggers.push('Systolic Blood Pressure');

  // 5. Heart Rate / Pulse
  let hrScore = 0;
  if (vitals.heartRate <= 40) {
    hrScore = 3;
  } else if (vitals.heartRate >= 41 && vitals.heartRate <= 50) {
    hrScore = 1;
  } else if (vitals.heartRate >= 51 && vitals.heartRate <= 90) {
    hrScore = 0;
  } else if (vitals.heartRate >= 91 && vitals.heartRate <= 110) {
    hrScore = 1;
  } else if (vitals.heartRate >= 111 && vitals.heartRate <= 130) {
    hrScore = 2;
  } else if (vitals.heartRate >= 131) {
    hrScore = 3;
  }
  if (hrScore === 3) redTriggers.push('Heart Rate');

  // 6. Consciousness (CVPU)
  let consciousnessScore = 0;
  const c = vitals.consciousness.toUpperCase();
  if (c === 'ALERT' || c === 'A') {
    consciousnessScore = 0;
  } else {
    // Voice, Pain, Unresponsive, New Confusion
    consciousnessScore = 3;
    redTriggers.push('Altered Consciousness (CVPU)');
  }

  // 7. Temperature
  let tempScore = 0;
  if (vitals.temperature <= 35.0) {
    tempScore = 3;
  } else if (vitals.temperature >= 35.1 && vitals.temperature <= 36.0) {
    tempScore = 1;
  } else if (vitals.temperature >= 36.1 && vitals.temperature <= 38.0) {
    tempScore = 0;
  } else if (vitals.temperature >= 38.1 && vitals.temperature <= 39.0) {
    tempScore = 1;
  } else if (vitals.temperature >= 39.1) {
    tempScore = 2;
  }
  if (tempScore === 3) redTriggers.push('Temperature');

  const totalScore =
    respScore +
    spo2Score +
    o2Score +
    sbpScore +
    hrScore +
    consciousnessScore +
    tempScore;

  const hasRedTrigger = redTriggers.length > 0;

  // Determine Risk Level & Clinical Response (RCP UK Framework)
  let riskLevel: NEWS2RiskLevel = 'Low';
  let clinicalResponse = '';

  if (totalScore >= 7) {
    riskLevel = 'High';
    clinicalResponse =
      'EMERGENCY RESPONSE: Immediate clinical assessment by Rapid Response / Medical Outreach Team with critical care competencies. Continuous vital sign monitoring. Consider ICU/HDU transfer.';
  } else if (totalScore >= 5 && totalScore <= 6) {
    riskLevel = 'Medium';
    clinicalResponse =
      'URGENT RESPONSE: Urgent review by attending medical team or acute response clinician. Increase monitoring frequency to at least minimum 1-hourly.';
  } else if (hasRedTrigger) {
    riskLevel = 'Low-Medium';
    clinicalResponse =
      'RED TRIGGER ALERT: Single parameter score of 3. Urgent assessment by registered ward nurse and medical team within 30-60 min. Hourly vital monitoring.';
  } else if (totalScore >= 1 && totalScore <= 4) {
    riskLevel = 'Low';
    clinicalResponse =
      'ROUTINE WARD MONITORING: Prompt assessment by registered nurse. Minimum 4-6 hourly monitoring frequency.';
  } else {
    riskLevel = 'Low';
    clinicalResponse =
      'BASELINE NORMAL: Standard clinical care. Minimum 12-hourly monitoring frequency.';
  }

  return {
    score: totalScore,
    riskLevel,
    clinicalResponse,
    hasRedTrigger,
    redTriggerParameters: redTriggers,
    parameterScores: {
      respirationRate: respScore,
      spO2: spo2Score,
      airOrOxygen: o2Score,
      systolicBP: sbpScore,
      heartRate: hrScore,
      consciousness: consciousnessScore,
      temperature: tempScore,
    },
  };
}

/**
 * Helper to get Tailwind color classes for NEWS2 risk badges
 */
export function getNEWS2BadgeClasses(score: number, riskLevel: NEWS2RiskLevel): {
  bg: string;
  text: string;
  border: string;
  ring: string;
} {
  if (score >= 7 || riskLevel === 'High') {
    return {
      bg: 'bg-rose-500 text-white',
      text: 'text-rose-700 dark:text-rose-300',
      border: 'border-rose-300 dark:border-rose-700',
      ring: 'ring-rose-500/30',
    };
  }
  if (score >= 5 || riskLevel === 'Medium') {
    return {
      bg: 'bg-amber-500 text-white',
      text: 'text-amber-700 dark:text-amber-300',
      border: 'border-amber-300 dark:border-amber-700',
      ring: 'ring-amber-500/30',
    };
  }
  if (riskLevel === 'Low-Medium' || score === 3) {
    return {
      bg: 'bg-yellow-500 text-slate-900',
      text: 'text-yellow-800 dark:text-yellow-300',
      border: 'border-yellow-300 dark:border-yellow-700',
      ring: 'ring-yellow-500/30',
    };
  }
  return {
    bg: 'bg-emerald-600 text-white',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-300 dark:border-emerald-700',
    ring: 'ring-emerald-500/30',
  };
}
