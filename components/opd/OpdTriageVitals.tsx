'use client';

import React, { useState, useMemo } from 'react';
import {
  Activity,
  HeartPulse,
  Brain,
  Baby,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Scale,
  Thermometer,
  Eye,
  MessageSquare,
  Sparkles,
} from 'lucide-react';
import {
  ComprehensiveVitals,
  ComprehensiveOpdEncounter,
  PediatricGrowthMetrics,
} from '@/types/opd-domain';
import { calculateNEWS2 } from '@/lib/clinical/news2';

interface OpdTriageVitalsProps {
  encounter: ComprehensiveOpdEncounter;
  onSaveVitals: (vitals: ComprehensiveVitals) => void;
}

export function OpdTriageVitals({ encounter, onSaveVitals }: OpdTriageVitalsProps) {
  const isPediatric = encounter.age < 12;

  // No production clinical measurement is pre-populated. Existing committed
  // evidence may be displayed for review; a new triage assessment starts blank.
  const blank = Number.NaN;
  const inputValue = (value: number): number | '' =>
    Number.isFinite(value) ? value : '';
  const parseNumericInput = (value: string): number =>
    value.trim() === '' ? Number.NaN : Number(value);
  const [hr, setHr] = useState<number>(encounter.vitalsAssessment?.heartRate ?? blank);
  const [sysBp, setSysBp] = useState<number>(encounter.vitalsAssessment?.systolicBp ?? blank);
  const [diaBp, setDiaBp] = useState<number>(encounter.vitalsAssessment?.diastolicBp ?? blank);
  const [rr, setRr] = useState<number>(encounter.vitalsAssessment?.respiratoryRate ?? blank);
  const [temp, setTemp] = useState<number>(encounter.vitalsAssessment?.temperatureCelsius ?? blank);
  const [spo2, setSpo2] = useState<number>(encounter.vitalsAssessment?.spo2Percent ?? blank);
  const [spO2Scale, setSpO2Scale] = useState<1 | 2 | ''>(
    encounter.vitalsAssessment?.spO2Scale ?? ''
  );
  const [onO2, setOnO2] = useState<boolean | null>(
    encounter.vitalsAssessment?.onSupplementalOxygen ?? null
  );
  const [o2Flow, setO2Flow] = useState<number>(
    encounter.vitalsAssessment?.oxygenFlowRateLpm ?? blank
  );
  const [glucose, setGlucose] = useState<number>(
    encounter.vitalsAssessment?.bloodGlucoseMgDl ?? blank
  );

  const [heightCm, setHeightCm] = useState<number>(
    encounter.vitalsAssessment?.heightCm ?? blank
  );
  const [weightKg, setWeightKg] = useState<number>(
    encounter.vitalsAssessment?.weightKg ?? blank
  );
  const [painScale, setPainScale] = useState<number>(
    encounter.vitalsAssessment?.painScale ?? blank
  );
  const [fallRisk, setFallRisk] = useState<number>(
    encounter.vitalsAssessment?.fallRiskScore ?? blank
  );

  const [gcsEye, setGcsEye] = useState<number>(
    encounter.vitalsAssessment?.gcsEye ?? blank
  );
  const [gcsVerbal, setGcsVerbal] = useState<number>(
    encounter.vitalsAssessment?.gcsVerbal ?? blank
  );
  const [gcsMotor, setGcsMotor] = useState<number>(
    encounter.vitalsAssessment?.gcsMotor ?? blank
  );

  const [feverTravelExposure, setFeverTravelExposure] = useState<boolean>(false);
  const [activeCoughOrRash, setActiveCoughOrRash] = useState<boolean>(false);
  const [isPregnant, setIsPregnant] = useState<boolean>(false);
  const [gestWeeks, setGestWeeks] = useState<number>(blank);
  const [triageNotes, setTriageNotes] = useState<string>(
    encounter.vitalsAssessment?.triageNotes ?? ''
  );

  const [headCircumference, setHeadCircumference] = useState<number>(
    encounter.vitalsAssessment?.pediatricGrowth?.headCircumferenceCm ?? blank
  );
  const [immunizationStatus, setImmunizationStatus] = useState<
    'UP_TO_DATE' | 'DELAYED' | 'EXEMPT' | 'UNKNOWN'
  >(encounter.vitalsAssessment?.pediatricGrowth?.immunizationStatus ?? 'UNKNOWN');
  const [milestones, setMilestones] = useState<
    'APPROPRIATE' | 'DELAY_OBSERVED' | 'UNDER_EVALUATION'
  >(encounter.vitalsAssessment?.pediatricGrowth?.developmentalMilestones ?? 'UNDER_EVALUATION');

  const gcsComplete =
    Number.isInteger(gcsEye) &&
    gcsEye >= 1 &&
    gcsEye <= 4 &&
    Number.isInteger(gcsVerbal) &&
    gcsVerbal >= 1 &&
    gcsVerbal <= 5 &&
    Number.isInteger(gcsMotor) &&
    gcsMotor >= 1 &&
    gcsMotor <= 6;

  const totalGcs = gcsComplete ? gcsEye + gcsVerbal + gcsMotor : Number.NaN;
  const avpuDerived: 'ALERT' | 'VOICE' | 'PAIN' | 'UNRESPONSIVE' | null = useMemo(() => {
    if (!Number.isFinite(totalGcs)) return null;
    if (totalGcs >= 15) return 'ALERT';
    if (totalGcs >= 12) return 'VOICE';
    if (totalGcs >= 8) return 'PAIN';
    return 'UNRESPONSIVE';
  }, [totalGcs]);

  const bmiComputed = useMemo(() => {
    if (!Number.isFinite(heightCm) || !Number.isFinite(weightKg) || heightCm <= 0 || weightKg <= 0) {
      return Number.NaN;
    }
    const hM = heightCm / 100;
    return Number((weightKg / (hM * hM)).toFixed(1));
  }, [heightCm, weightKg]);

  const news2Ready =
    Number.isFinite(hr) &&
    Number.isFinite(sysBp) &&
    Number.isFinite(rr) &&
    Number.isFinite(temp) &&
    Number.isFinite(spo2) &&
    spO2Scale !== '' &&
    onO2 !== null &&
    avpuDerived !== null;

  const liveNews2 = useMemo(() => {
    if (!news2Ready || onO2 === null || avpuDerived === null) return null;

    const result = calculateNEWS2({
      respirationRate: rr,
      spO2: spo2,
      spO2Scale,
      onSupplementalOxygen: onO2,
      systolicBP: sysBp,
      heartRate: hr,
      consciousness: avpuDerived === 'ALERT'
        ? 'Alert'
        : avpuDerived === 'VOICE'
          ? 'Voice'
          : avpuDerived === 'PAIN'
            ? 'Pain'
            : 'Unresponsive',
      gcsScore: totalGcs,
      temperature: temp,
    });

    const risk: 'LOW' | 'LOW_MEDIUM' | 'MEDIUM' | 'HIGH' =
      result.riskLevel === 'High'
        ? 'HIGH'
        : result.riskLevel === 'Medium'
          ? 'MEDIUM'
          : result.riskLevel === 'Low-Medium'
            ? 'LOW_MEDIUM'
            : 'LOW';

    return {
      totalScore: result.score,
      risk,
      routing: result.clinicalResponse,
    };
  }, [news2Ready, rr, spo2, spO2Scale, onO2, sysBp, hr, avpuDerived, totalGcs, temp]);

  const handleSave = () => {
    if (
      !liveNews2 ||
      spO2Scale === '' ||
      onO2 === null ||
      avpuDerived === null ||
      !Number.isFinite(diaBp) ||
      !Number.isFinite(heightCm) ||
      !Number.isFinite(weightKg) ||
      !Number.isFinite(bmiComputed)
    ) {
      alert(
        'Complete all required triage measurements, NEWS2 SpO₂ scale, oxygen status, GCS, height and weight before committing vitals.'
      );
      return;
    }

    if (onO2 && (!Number.isFinite(o2Flow) || o2Flow <= 0)) {
      alert('Enter the supplemental oxygen flow rate before committing vitals.');
      return;
    }

    const pediatricGrowth: PediatricGrowthMetrics | undefined = isPediatric
      ? {
          isPediatric: true,
          ...(Number.isFinite(headCircumference) && headCircumference > 0
            ? { headCircumferenceCm: headCircumference }
            : {}),
          immunizationStatus,
          developmentalMilestones: milestones,
        }
      : undefined;

    const record: ComprehensiveVitals = {
      heartRate: hr,
      systolicBp: sysBp,
      diastolicBp: diaBp,
      respiratoryRate: rr,
      temperatureCelsius: temp,
      spo2Percent: spo2,
      spO2Scale,
      onSupplementalOxygen: onO2,
      oxygenFlowRateLpm: onO2 ? o2Flow : undefined,
      bloodGlucoseMgDl: Number.isFinite(glucose) ? glucose : undefined,
      heightCm,
      weightKg,
      bmi: bmiComputed,
      painScale: Number.isFinite(painScale) ? painScale : undefined,
      fallRiskScore: Number.isFinite(fallRisk) ? fallRisk : undefined,
      infectionScreening: {
        feverTravelExposure,
        activeCoughOrRash,
        isolationRequired: feverTravelExposure && activeCoughOrRash,
      },
      pregnancyScreening:
        encounter.gender === 'Female' && encounter.age >= 12 && encounter.age <= 55
          ? {
              isPregnant,
              gestationalWeeks:
                isPregnant && Number.isFinite(gestWeeks) ? gestWeeks : undefined,
            }
          : undefined,
      gcsScore: totalGcs,
      gcsEye,
      gcsVerbal,
      gcsMotor,
      consciousnessAvpu: avpuDerived,
      news2Score: liveNews2.totalScore,
      news2Risk: liveNews2.risk,
      pediatricGrowth,
      measuredAt: Date.now(),
      triageNotes: triageNotes.trim() || undefined,
    };

    onSaveVitals(record);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Vitals Form Columns (2 cols) */}
      <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-6">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Activity className="w-5 h-5 text-rose-600" />
              Triage Physiological Vitals & Risk Scoring
            </h2>
            <p className="text-xs text-slate-500">
              Patient: <strong className="text-slate-900 dark:text-slate-100">{encounter.patientName}</strong> ({encounter.age}y, {encounter.gender}, MRN: {encounter.mrn})
            </p>
          </div>

          {isPediatric && (
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 flex items-center gap-1">
              <Baby className="w-3.5 h-3.5" />
              Pediatric OPD Protocol
            </span>
          )}
        </div>

        {/* Vital Signs Input Grid */}
        <div className="space-y-4">
          <h3 className="text-xs font-bold uppercase tracking-wider text-rose-600">
            1. Cardiopulmonary & Thermal Measurements
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Heart Rate (bpm)
              </label>
              <input
                data-testid="opd-triage-heart-rate"
                type="number"
                value={inputValue(hr)}
                onChange={(e) => setHr(parseNumericInput(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Systolic BP (mmHg)
              </label>
              <input
                data-testid="opd-triage-systolic"
                type="number"
                value={inputValue(sysBp)}
                onChange={(e) => setSysBp(parseNumericInput(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Diastolic BP (mmHg)
              </label>
              <input
                data-testid="opd-triage-diastolic"
                type="number"
                value={inputValue(diaBp)}
                onChange={(e) => setDiaBp(parseNumericInput(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Resp Rate (breaths/min)
              </label>
              <input
                data-testid="opd-triage-respiratory-rate"
                type="number"
                value={inputValue(rr)}
                onChange={(e) => setRr(parseNumericInput(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Temperature (°C)
              </label>
              <input
                data-testid="opd-triage-temperature"
                type="number"
                step="0.1"
                value={inputValue(temp)}
                onChange={(e) => setTemp(parseNumericInput(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                SpO2 Saturation (%)
              </label>
              <input
                data-testid="opd-triage-spo2"
                type="number"
                value={inputValue(spo2)}
                onChange={(e) => setSpo2(parseNumericInput(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold text-blue-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                NEWS2 SpO₂ Scale
              </label>
              <select
                data-testid="opd-triage-spo2-scale"
                value={spO2Scale}
                onChange={(e) =>
                  setSpO2Scale(e.target.value === '' ? '' : (Number(e.target.value) as 1 | 2))
                }
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
              >
                <option value="">Select scale</option>
                <option value="1">Scale 1 — Standard</option>
                <option value="2">Scale 2 — Hypercapnic respiratory failure</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Oxygen Status
              </label>
              <select
                data-testid="opd-triage-oxygen-status"
                value={onO2 === null ? '' : onO2 ? 'SUPPLEMENTAL' : 'ROOM_AIR'}
                onChange={(e) =>
                  setOnO2(
                    e.target.value === ''
                      ? null
                      : e.target.value === 'SUPPLEMENTAL'
                  )
                }
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
              >
                <option value="">Select oxygen status</option>
                <option value="ROOM_AIR">Room air</option>
                <option value="SUPPLEMENTAL">Supplemental oxygen</option>
              </select>
            </div>
            {onO2 === true && (
              <div>
                <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                  Oxygen Flow (L/min)
                </label>
                <input
                  type="number"
                  value={inputValue(o2Flow)}
                  onChange={(e) => setO2Flow(parseNumericInput(e.target.value))}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
                />
              </div>
            )}
          </div>
        </div>

        {/* Glasgow Coma Scale (GCS) Subscales */}
        <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-600 flex items-center gap-1.5">
              <Brain className="w-4 h-4" />
              2. Glasgow Coma Scale (GCS) Subscale Breakdown
            </h3>
            <span className="text-xs font-mono font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
              Total Score: {gcsComplete ? totalGcs : '—'}/15 (AVPU: {avpuDerived || '—'})
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-[11px] font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Eye Opening (1 - 4)
              </label>
              <select
                data-testid="opd-triage-gcs-eye"
                value={inputValue(gcsEye)}
                onChange={(e) => setGcsEye(parseNumericInput(e.target.value))}
                className="w-full px-2.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              >
                <option value="">Select eye response</option>
                <option value={4}>4 — Spontaneous</option>
                <option value={3}>3 — To Speech / Voice</option>
                <option value={2}>2 — To Pain</option>
                <option value={1}>1 — None</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Verbal Response (1 - 5)
              </label>
              <select
                data-testid="opd-triage-gcs-verbal"
                value={inputValue(gcsVerbal)}
                onChange={(e) => setGcsVerbal(parseNumericInput(e.target.value))}
                className="w-full px-2.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              >
                <option value="">Select verbal response</option>
                <option value={5}>5 — Oriented & Conversing</option>
                <option value={4}>4 — Confused / Disoriented</option>
                <option value={3}>3 — Inappropriate Words</option>
                <option value={2}>2 — Incomprehensible Sounds</option>
                <option value={1}>1 — None</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Motor Response (1 - 6)
              </label>
              <select
                data-testid="opd-triage-gcs-motor"
                value={inputValue(gcsMotor)}
                onChange={(e) => setGcsMotor(parseNumericInput(e.target.value))}
                className="w-full px-2.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              >
                <option value="">Select motor response</option>
                <option value={6}>6 — Obeys Commands</option>
                <option value={5}>5 — Localizes Pain</option>
                <option value={4}>4 — Flexion / Withdrawal</option>
                <option value={3}>3 — Abnormal Decorticate Flexion</option>
                <option value={2}>2 — Abnormal Decerebrate Extension</option>
                <option value={1}>1 — Flaccid / None</option>
              </select>
            </div>
          </div>
        </div>

        {/* Anthropometrics, Pain, Fall & Pediatric */}
        <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
            3. Anthropometrics, Pain Score & Clinical Screening
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold mb-1">Height (cm)</label>
              <input
                data-testid="opd-triage-height"
                type="number"
                value={inputValue(heightCm)}
                onChange={(e) => setHeightCm(parseNumericInput(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Weight (kg)</label>
              <input
                data-testid="opd-triage-weight"
                type="number"
                step="0.1"
                value={inputValue(weightKg)}
                onChange={(e) => setWeightKg(parseNumericInput(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Computed BMI</label>
              <div className="px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 font-black text-slate-900 dark:text-slate-100">
                {Number.isFinite(bmiComputed) ? bmiComputed : '—'} kg/m²
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1">Pain VAS (0 - 10)</label>
              <input
                type="number"
                min={0}
                max={10}
                value={inputValue(painScale)}
                onChange={(e) => setPainScale(parseNumericInput(e.target.value))}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold text-center"
              />
            </div>
          </div>

          {/* Pediatric growth inputs if child */}
          {isPediatric && (
            <div className="p-3.5 rounded-xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Head Circumference (cm)</label>
                <input
                  type="number"
                  step="0.5"
                  value={inputValue(headCircumference)}
                  onChange={(e) => setHeadCircumference(parseNumericInput(e.target.value))}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-purple-200 dark:border-purple-700 bg-white dark:bg-slate-900"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Immunization Review</label>
                <select
                  value={immunizationStatus}
                  onChange={(e) => setImmunizationStatus(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-purple-200 dark:border-purple-700 bg-white dark:bg-slate-900"
                >
                  <option value="UP_TO_DATE">Up to Date (EPI Schedule)</option>
                  <option value="DELAYED">Delayed Immunizations</option>
                  <option value="EXEMPT">Exempt / Medical Grounds</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold mb-1">Developmental Milestones</label>
                <select
                  value={milestones}
                  onChange={(e) => setMilestones(e.target.value as any)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-purple-200 dark:border-purple-700 bg-white dark:bg-slate-900"
                >
                  <option value="APPROPRIATE">Age Appropriate</option>
                  <option value="DELAY_OBSERVED">Delay Observed</option>
                  <option value="UNDER_EVALUATION">Under Evaluation</option>
                </select>
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold mb-1">Nursing Triage Clinical Narrative</label>
            <textarea
              rows={2}
              value={triageNotes}
              onChange={(e) => setTriageNotes(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
          </div>
        </div>

        <div className="pt-4 border-t border-slate-100 dark:border-slate-800 flex justify-end">
          <button
            data-testid="opd-triage-submit"
            onClick={handleSave}
            className="px-6 py-2.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            Commit Immutable Vitals & Advance Stage
          </button>
        </div>
      </div>

      {/* Right Column: Real-Time NEWS2 Scorecard & Triage Decision Support */}
      <div className="space-y-4">
        <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <HeartPulse className="w-4 h-4 text-rose-600" />
            NEWS2 Real-Time Scorecard
          </h3>

          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-center">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Calculated NEWS2 Total</span>
            <p className="text-4xl font-black text-rose-600 my-1">
              {liveNews2 ? liveNews2.totalScore : '—'}
            </p>
            <span
              className={`inline-block px-3 py-1 rounded-full text-xs font-black uppercase ${
                !liveNews2
                  ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                  : liveNews2.risk === 'HIGH'
                    ? 'bg-red-100 text-red-800 dark:bg-red-900/60 dark:text-red-200'
                    : liveNews2.risk === 'MEDIUM'
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200'
                      : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200'
              }`}
            >
              {liveNews2 ? `${liveNews2.risk} Clinical Risk` : 'Incomplete NEWS2'}
            </span>
          </div>

          <div className="space-y-2 text-xs">
            <span className="font-semibold text-slate-700 dark:text-slate-300">Triage Decision Routing:</span>
            <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200 font-bold">
              {liveNews2?.routing || 'Complete required NEWS2 inputs to calculate routing.'}
            </div>
          </div>
        </div>

        {/* Infection & Safety Screening */}
        <div className="p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
            <ShieldAlert className="w-4 h-4 text-amber-500" />
            Infection & Risk Control
          </h4>

          <div className="space-y-2 text-xs">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={feverTravelExposure}
                onChange={(e) => setFeverTravelExposure(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded"
              />
              <span>Fever / Endemic Travel Exposure</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={activeCoughOrRash}
                onChange={(e) => setActiveCoughOrRash(e.target.checked)}
                className="w-4 h-4 text-blue-600 rounded"
              />
              <span>Active Productive Cough or Unexplained Rash</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}
