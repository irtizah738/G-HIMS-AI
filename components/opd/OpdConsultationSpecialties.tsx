'use client';

import React, { useState } from 'react';
import {
  Stethoscope,
  ShieldCheck,
  Search,
  CheckCircle2,
  FileText,
  Activity,
  Plus,
  Trash2,
} from 'lucide-react';
import { EncounterPreparationPanel } from './EncounterPreparationPanel';
import {
  ComprehensiveOpdEncounter,
  OpdSpecialtyTemplate,
  SoapDocumentation,
  Icd10Diagnosis,
} from '@/types/opd-domain';

interface OpdConsultationSpecialtiesProps {
  encounter: ComprehensiveOpdEncounter;
  onSaveConsultation: (soap: SoapDocumentation) => void;
  onPlaceDiagnosticOrders?: () => void;
  onPlacePrescriptions?: () => void;
  offline?: boolean;
}

const COMMON_ICD10_DB: Icd10Diagnosis[] = [
  { code: 'I10', description: 'Essential (primary) hypertension', isPrincipal: true, category: 'Circulatory' },
  { code: 'E11.9', description: 'Type 2 diabetes mellitus without complications', isPrincipal: false, category: 'Endocrine' },
  { code: 'I25.10', description: 'Atherosclerotic heart disease of native coronary artery', isPrincipal: true, category: 'Circulatory' },
  { code: 'J45.909', description: 'Unspecified asthma, uncomplicated', isPrincipal: true, category: 'Respiratory' },
  { code: 'M54.5', description: 'Low back pain', isPrincipal: true, category: 'Musculoskeletal' },
  { code: 'K21.9', description: 'Gastro-esophageal reflux disease without esophagitis', isPrincipal: false, category: 'Digestive' },
  { code: 'F32.9', description: 'Major depressive disorder, single episode, unspecified', isPrincipal: true, category: 'Mental' },
  { code: 'H10.9', description: 'Unspecified conjunctivitis', isPrincipal: true, category: 'Eye' },
  { code: 'H66.90', description: 'Otitis media, unspecified, unspecified ear', isPrincipal: true, category: 'Ear' },
  { code: 'L20.9', description: 'Atopic dermatitis, unspecified', isPrincipal: true, category: 'Skin' },
  { code: 'O80', description: 'Encounter for full-term uncomplicated delivery', isPrincipal: true, category: 'Obstetric' },
  { code: 'K80.20', description: 'Calculus of gallbladder without cholecystitis', isPrincipal: true, category: 'Digestive' },
];

export function OpdConsultationSpecialties({
  encounter,
  onSaveConsultation,
  onPlaceDiagnosticOrders,
  onPlacePrescriptions,
  offline = false,
}: OpdConsultationSpecialtiesProps) {
  const [selectedSpecialty, setSelectedSpecialty] = useState<OpdSpecialtyTemplate>(
    encounter.soap?.specialtyTemplate || (encounter.department as any) || 'GENERAL_MEDICINE'
  );

  // SOAP Core State
  const [subjective, setSubjective] = useState<string>(
    encounter.soap?.subjective || ''
  );
  const [historyOfPresentIllness, setHpi] = useState<string>(
    encounter.soap?.historyOfPresentIllness || ''
  );
  const [reviewOfSystems, setRos] = useState<string>(
    encounter.soap?.reviewOfSystems || ''
  );
  const [objective, setObjective] = useState<string>(
    encounter.soap?.objective || ''
  );
  const [physicalExamination, setPhysicalExam] = useState<string>(
    encounter.soap?.physicalExamination || ''
  );
  const [assessment, setAssessment] = useState<string>(
    encounter.soap?.assessment || ''
  );
  const [plan, setPlan] = useState<string>(
    encounter.soap?.plan || ''
  );

  // Diagnoses
  const [diagnoses, setDiagnoses] = useState<Icd10Diagnosis[]>(
    (encounter.soap?.diagnoses as Icd10Diagnosis[] | undefined) || []
  );
  const [icdSearchTerm, setIcdSearchTerm] = useState<string>('');

  // Specialty-Specific Fields
  const [nyhaClass, setNyhaClass] = useState<'' | 'I' | 'II' | 'III' | 'IV'>('');
  const [cardiacChestPainType, setCardiacChestPainType] = useState<string>('');
  const [pedFeeding, setPedFeeding] = useState<string>('');
  const [obgynGpal, setObgynGpal] = useState<string>('');
  const [obgynLmp, setObgynLmp] = useState<string>('');
  const [orthoJointRom, setOrthoJointRom] = useState<string>('');
  const [ophthVisualAcuity, setOphthVisualAcuity] = useState<string>('');
  const [entOtoscopy, setEntOtoscopy] = useState<string>('');
  const [dermLesion, setDermLesion] = useState<string>('');
  const [neuroCranialNerves, setNeuroCranialNerves] = useState<string>('');
  const [psychMse, setPsychMse] = useState<string>('');
  const [surgAbdomen, setSurgAbdomen] = useState<string>('');

  const handleAddDiagnosis = (diag: Icd10Diagnosis) => {
    if (!diagnoses.find((d) => d.code === diag.code)) {
      setDiagnoses([...diagnoses, diag]);
    }
  };

  const handleRemoveDiagnosis = (code: string) => {
    setDiagnoses(diagnoses.filter((d) => d.code !== code));
  };

  const handleTogglePrincipal = (code: string) => {
    setDiagnoses(
      diagnoses.map((d) => ({
        ...d,
        isPrincipal: d.code === code,
      }))
    );
  };

  const handleCommitSoap = () => {
    const specialtyData: Record<string, any> = {};
    if (selectedSpecialty === 'CARDIOLOGY') {
      if (nyhaClass) specialtyData.nyhaClass = nyhaClass;
      if (cardiacChestPainType.trim()) specialtyData.chestPainType = cardiacChestPainType.trim();
    } else if (selectedSpecialty === 'PEDIATRICS') {
      if (pedFeeding.trim()) specialtyData.feedingHistory = pedFeeding.trim();
    } else if (selectedSpecialty === 'OBSTETRICS_GYNECOLOGY') {
      if (obgynGpal.trim()) specialtyData.gpal = obgynGpal.trim();
      if (obgynLmp) specialtyData.lmp = obgynLmp;
    } else if (selectedSpecialty === 'ORTHOPEDICS') {
      if (orthoJointRom.trim()) specialtyData.jointRom = orthoJointRom.trim();
    } else if (selectedSpecialty === 'OPHTHALMOLOGY') {
      if (ophthVisualAcuity.trim()) specialtyData.visualAcuity = ophthVisualAcuity.trim();
    } else if (selectedSpecialty === 'ENT') {
      if (entOtoscopy.trim()) specialtyData.otoscopy = entOtoscopy.trim();
    } else if (selectedSpecialty === 'DERMATOLOGY') {
      if (dermLesion.trim()) specialtyData.lesionMorphology = dermLesion.trim();
    } else if (selectedSpecialty === 'NEUROLOGY') {
      if (neuroCranialNerves.trim()) specialtyData.cranialNerves = neuroCranialNerves.trim();
    } else if (selectedSpecialty === 'PSYCHIATRY') {
      if (psychMse.trim()) specialtyData.mentalStateExam = psychMse.trim();
    } else if (selectedSpecialty === 'GENERAL_SURGERY') {
      if (surgAbdomen.trim()) specialtyData.abdominalFindings = surgAbdomen.trim();
    }

    const soapDoc: SoapDocumentation = {
      specialtyTemplate: selectedSpecialty,
      subjective,
      historyOfPresentIllness,
      reviewOfSystems,
      objective,
      physicalExamination,
      assessment,
      plan,
      diagnoses,
      specialtySpecificData: specialtyData,
      completedAt: Date.now(),
      completedBy:
        encounter.attendingDoctorName ||
        encounter.attendingDoctorId ||
        'Authenticated clinician',
    };

    onSaveConsultation(soapDoc);
  };

  return (
    <div className="space-y-6">
      <EncounterPreparationPanel
        tenantId={encounter.tenantId}
        patientId={encounter.patientId}
        encounterId={encounter.id}
        offline={offline}
      />

      {/* Specialty Selector Header */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Stethoscope className="w-5 h-5 text-blue-600" />
              Specialist Outpatient Clinical Documentation (SOAP)
            </h2>
            <p className="text-xs text-slate-500">
              Select a specialty template and document clinician-authored findings. CI-10C evidence remains read-only and never prefills the signed note.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Clinical Specialty:</span>
            <select
              value={selectedSpecialty}
              onChange={(e) => setSelectedSpecialty(e.target.value as OpdSpecialtyTemplate)}
              className="px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold text-blue-600"
            >
              <option value="GENERAL_MEDICINE">General Internal Medicine</option>
              <option value="CARDIOLOGY">Cardiology & Heart Failure</option>
              <option value="PEDIATRICS">Pediatrics & Child Health</option>
              <option value="OBSTETRICS_GYNECOLOGY">Obstetrics & Gynecology</option>
              <option value="ORTHOPEDICS">Orthopedics & Joint Health</option>
              <option value="OPHTHALMOLOGY">Ophthalmology</option>
              <option value="ENT">Otorhinolaryngology (ENT)</option>
              <option value="DERMATOLOGY">Dermatology</option>
              <option value="NEUROLOGY">Neurology</option>
              <option value="PSYCHIATRY">Psychiatry & Behavioral Health</option>
              <option value="GENERAL_SURGERY">General & Visceral Surgery</option>
            </select>
          </div>
        </div>

      </div>

      {/* Main SOAP Workspace (2 columns) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Structured SOAP Fields */}
        <div className="lg:col-span-2 space-y-6">
          {/* S: Subjective */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-blue-600 flex items-center gap-1.5">
              <FileText className="w-4 h-4" />
              S — Subjective & History of Present Illness (HPI)
            </h3>
            <textarea
              rows={3}
              value={subjective}
              onChange={(e) => setSubjective(e.target.value)}
              placeholder="Patient's primary narrative, onset, duration, character, aggravating and relieving factors..."
              className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                  History of Present Illness (Chronology)
                </label>
                <input
                  type="text"
                  value={historyOfPresentIllness}
                  onChange={(e) => setHpi(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                  Review of Systems (ROS Pertinent Positives/Negatives)
                </label>
                <input
                  type="text"
                  value={reviewOfSystems}
                  onChange={(e) => setRos(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
            </div>
          </div>

          {/* O: Objective & Specialty-Specific Examination */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-indigo-600 flex items-center gap-1.5">
              <Activity className="w-4 h-4" />
              O — Objective & Specialty Examination Protocol ({selectedSpecialty.replace(/_/g, ' ')})
            </h3>
            <textarea
              rows={3}
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="Physical findings, systemic observations, heart sounds, chest auscultation..."
              className="w-full px-3.5 py-2.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />

            {/* Specialty Custom Section */}
            <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
              <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-blue-600" />
                Specialized Diagnostic Parameters ({selectedSpecialty})
              </h4>

              {selectedSpecialty === 'CARDIOLOGY' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      NYHA Functional Class
                    </label>
                    <select
                      value={nyhaClass}
                      onChange={(e) =>
                        setNyhaClass(
                          e.target.value as '' | 'I' | 'II' | 'III' | 'IV'
                        )
                      }
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold"
                    >
                      <option value="">Select NYHA class…</option>
                      <option value="I">Class I — No limitation of physical activity</option>
                      <option value="II">Class II — Slight limitation; comfortable at rest</option>
                      <option value="III">Class III — Marked limitation; comfortable only at rest</option>
                      <option value="IV">Class IV — Inability to carry on any activity without discomfort</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      Chest Pain Phenotype
                    </label>
                    <input
                      type="text"
                      value={cardiacChestPainType}
                      onChange={(e) => setCardiacChestPainType(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                  </div>
                </div>
              )}

              {selectedSpecialty === 'OBSTETRICS_GYNECOLOGY' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      Obstetric Formula (GPAL)
                    </label>
                    <input
                      type="text"
                      value={obgynGpal}
                      onChange={(e) => setObgynGpal(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      Last Menstrual Period (LMP)
                    </label>
                    <input
                      type="date"
                      value={obgynLmp}
                      onChange={(e) => setObgynLmp(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                    />
                  </div>
                </div>
              )}

              {selectedSpecialty === 'PEDIATRICS' && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Feeding & Nutrition History
                  </label>
                  <input
                    type="text"
                    value={pedFeeding}
                    onChange={(e) => setPedFeeding(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
              )}

              {selectedSpecialty === 'ORTHOPEDICS' && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Joint Range of Motion (ROM) & Ligamentous Stability
                  </label>
                  <input
                    type="text"
                    value={orthoJointRom}
                    onChange={(e) => setOrthoJointRom(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
              )}

              {selectedSpecialty === 'OPHTHALMOLOGY' && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Visual Acuity (OD / OS / Pin-hole)
                  </label>
                  <input
                    type="text"
                    value={ophthVisualAcuity}
                    onChange={(e) => setOphthVisualAcuity(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono"
                  />
                </div>
              )}

              {selectedSpecialty === 'ENT' && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Otoscopy & Anterior Rhinoscopy Findings
                  </label>
                  <input
                    type="text"
                    value={entOtoscopy}
                    onChange={(e) => setEntOtoscopy(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
              )}

              {selectedSpecialty === 'DERMATOLOGY' && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Lesion Morphology & Fitzpatrick Phototype
                  </label>
                  <input
                    type="text"
                    value={dermLesion}
                    onChange={(e) => setDermLesion(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
              )}

              {selectedSpecialty === 'NEUROLOGY' && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Cranial Nerves (I-XII) & Motor Power Examination
                  </label>
                  <input
                    type="text"
                    value={neuroCranialNerves}
                    onChange={(e) => setNeuroCranialNerves(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
              )}

              {selectedSpecialty === 'PSYCHIATRY' && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Mental State Examination (MSE) & Suicidality Screen
                  </label>
                  <input
                    type="text"
                    value={psychMse}
                    onChange={(e) => setPsychMse(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
              )}

              {selectedSpecialty === 'GENERAL_SURGERY' && (
                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Abdominal Quadrant Palpation & Peritoneal Signs
                  </label>
                  <input
                    type="text"
                    value={surgAbdomen}
                    onChange={(e) => setSurgAbdomen(e.target.value)}
                    className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                  />
                </div>
              )}
            </div>
          </div>

          {/* A & P: Assessment & Plan */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-600 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              A & P — Assessment & Comprehensive Care Plan
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                  A — Clinical Synthesis & Differential Assessment
                </label>
                <textarea
                  rows={2}
                  value={assessment}
                  onChange={(e) => setAssessment(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-medium"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                  P — Treatment, Investigations, Patient Counseling & Follow-up Plan
                </label>
                <textarea
                  rows={3}
                  value={plan}
                  onChange={(e) => setPlan(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
            </div>

            {/* Quick Ancillary Order Triggers */}
            <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              {onPlaceDiagnosticOrders && (
                <button
                  type="button"
                  onClick={onPlaceDiagnosticOrders}
                  className="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/60 dark:hover:bg-purple-900/60 text-purple-700 dark:text-purple-300 rounded-lg text-xs font-bold flex items-center gap-1.5 border border-purple-200 dark:border-purple-800 cursor-pointer"
                >
                  <Activity className="w-3.5 h-3.5" />
                  Order Lab / PACS Radiology
                </button>
              )}
              {onPlacePrescriptions && (
                <button
                  type="button"
                  onClick={onPlacePrescriptions}
                  className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 rounded-lg text-xs font-bold flex items-center gap-1.5 border border-emerald-200 dark:border-emerald-800 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Prescribe Medications (e-Rx)
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right Col: clinician coding and sign-off */}
        <div className="space-y-6">
          {/* ICD-10 Coding Station */}
          <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-blue-600" />
              ICD-10 Dual Diagnosis Station
            </h3>
            <p className="text-xs text-slate-500">
              Assign Primary and Co-morbid ICD-10 classifications for insurance adjudication and registry indexing.
            </p>

            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search ICD-10 code (e.g. I10, E11, Asthma)..."
                value={icdSearchTerm}
                onChange={(e) => setIcdSearchTerm(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>

            {/* Matching ICD-10 Search Drops */}
            {icdSearchTerm.trim() && (
              <div className="max-h-36 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-xl divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                {COMMON_ICD10_DB.filter(
                  (c) =>
                    c.code.toLowerCase().includes(icdSearchTerm.toLowerCase()) ||
                    c.description.toLowerCase().includes(icdSearchTerm.toLowerCase())
                ).map((c) => (
                  <button
                    key={c.code}
                    onClick={() => {
                      handleAddDiagnosis(c);
                      setIcdSearchTerm('');
                    }}
                    className="w-full p-2 text-left hover:bg-blue-50 dark:hover:bg-blue-950/40 flex items-center justify-between cursor-pointer"
                  >
                    <div>
                      <span className="font-mono font-bold text-blue-600 mr-2">{c.code}</span>
                      <span className="text-slate-700 dark:text-slate-300">{c.description}</span>
                    </div>
                    <Plus className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  </button>
                ))}
              </div>
            )}

            {/* Selected Diagnoses List */}
            <div className="space-y-2">
              <span className="text-[11px] font-bold text-slate-400 uppercase">Assigned Diagnoses ({diagnoses.length})</span>
              {diagnoses.map((d) => (
                <div
                  key={d.code}
                  className={`p-3 rounded-xl border flex items-center justify-between text-xs ${
                    d.isPrincipal
                      ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/40'
                      : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-bold text-blue-600">{d.code}</span>
                      {d.isPrincipal && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-blue-600 text-white">
                          PRIMARY
                        </span>
                      )}
                    </div>
                    <p className="text-slate-800 dark:text-slate-200 mt-0.5">{d.description}</p>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {!d.isPrincipal && (
                      <button
                        onClick={() => handleTogglePrincipal(d.code)}
                        className="px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 rounded cursor-pointer"
                        title="Set as Principal Diagnosis"
                      >
                        Make Primary
                      </button>
                    )}
                    <button
                      onClick={() => handleRemoveDiagnosis(d.code)}
                      className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Final Commit Button */}
          <button
            onClick={handleCommitSoap}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-xs cursor-pointer transition-all"
          >
            <CheckCircle2 className="w-4 h-4" />
            Sign & Commit Consultation Documentation
          </button>
        </div>
      </div>
    </div>
  );
}
