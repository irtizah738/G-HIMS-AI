'use client';

import React, { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { useHospital } from '@/lib/context/hospital-context';
import { Patient, Encounter, Vitals, ClinicalNote } from '@/lib/types/ghims';
import { CardSkeleton, Skeleton } from '@/components/ui/skeleton';
import {
  User,
  HeartPulse,
  FileText,
  FlaskConical,
  Receipt,
  Plus,
  QrCode,
  Sparkles,
  Search,
  Activity,
  AlertTriangle,
  Calendar,
  Phone,
  Mail,
  MapPin,
  CheckCircle2,
  Stethoscope,
  Clock,
  Printer,
  ShieldCheck,
  Send,
  UserCheck,
  GitMerge,
  Trash2,
  Siren,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { PatientConsultantRoutingModal, ConsultantDoctor } from '@/components/clinical/patient-consultant-routing-modal';
import { PatientMergeModal } from '@/components/mpi/patient-merge-modal';
import { PatientRecordRemovalModal } from '@/components/mpi/patient-record-removal-modal';
import { useAuth } from '@/lib/auth/auth-context';
import { useRBAC } from '@/lib/auth/rbac-context';
import { AuthClient } from '@/lib/auth/auth-client';
import { executeActiveTenantCommand } from '@/lib/api/command-client';

export function PatientMpiView() {
  const router = useRouter();
  const { patients, selectedPatientId, setSelectedPatientId, registerNewPatient, mergePatients, addClinicalNote, addVitals, beds } = useHospital();
  const auth = useAuth();
  const canRemove = auth.roles.some((role) =>
    ['ADMIN', 'ADMINISTRATOR', 'SYSTEM_ADMIN', 'SUPER_ADMIN'].includes(String(role).trim().toUpperCase())
  );
  const { currentRole, hasPermission, activePatientId, roleDefinition } = useRBAC();
  
  const [searchFilter, setSearchFilter] = useState('');
  const [showNewPatientModal, setShowNewPatientModal] = useState(false);
  const [showWristbandModal, setShowWristbandModal] = useState(false);
  const [showRoutingModal, setShowRoutingModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [removalCandidate, setRemovalCandidate] = useState<Patient | null>(null);
  const [mergeCandidateSecondaryId, setMergeCandidateSecondaryId] = useState<string | undefined>(undefined);
  const [duplicateWarningPatient, setDuplicateWarningPatient] = useState<Patient | null>(null);
  const [overrideDuplicateRegistration, setOverrideDuplicateRegistration] = useState(false);
  const [activeTabSub, setActiveTabSub] = useState<'clinical' | 'vitals' | 'labs' | 'billing'>('clinical');

  // AI note parsing state
  const [rawNoteText, setRawNoteText] = useState('');
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [aiParseError, setAiParseError] = useState<string | null>(null);
  const [aiDraft, setAiDraft] = useState<Record<string, unknown> | null>(null);
  const [noteCategory, setNoteCategory] = useState<'SOAP' | 'Progress' | 'Nursing' | 'Discharge'>('SOAP');
  const authorName = 'Authenticated clinician';

  // New vitals state
  const [newHeartRate, setNewHeartRate] = useState<number | ''>('');
  const [newBp, setNewBp] = useState('');
  const [newTemp, setNewTemp] = useState<number | ''>('');
  const [newResp, setNewResp] = useState<number | ''>('');
  const [newO2, setNewO2] = useState<number | ''>('');
  const [vitalsEncounterId, setVitalsEncounterId] = useState('');
  const [vitalsStatus, setVitalsStatus] = useState<string | null>(null);
  const [vitalsSaving, setVitalsSaving] = useState(false);

  // New patient registration state
  const [newFullName, setNewFullName] = useState('');
  const [newDob, setNewDob] = useState('');
  const [newAge, setNewAge] = useState<number | ''>('');
  const [newGender, setNewGender] = useState<'' | 'Male' | 'Female' | 'Other'>('');
  const [newBlood, setNewBlood] = useState<Patient['bloodGroup']>('Unknown');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [newAllergies, setNewAllergies] = useState('');
  const [newConditions, setNewConditions] = useState('');
  const [registrationError, setRegistrationError] = useState<string | null>(null);

  // ABAC patient dataset gating: If user is 'patient', ONLY show their own record
  const scopedPatients =
    currentRole === 'patient'
      ? activePatientId
        ? patients.filter((p) => p.id === activePatientId)
        : []
      : patients;

  // RULE 10: Patient Identity Safety — Automated MPI Duplicate Pair Detection
  const detectedDuplicatePairs = useMemo(() => {
    const pairs: Array<{ primary: Patient; duplicate: Patient; matchReason: string }> = [];
    const checked = new Set<string>();
    const activeIdentityPatients = scopedPatients.filter(
      (patient) => !['MERGED', 'REMOVED'].includes(String(patient.status || 'ACTIVE').toUpperCase())
    );

    for (let i = 0; i < activeIdentityPatients.length; i++) {
      for (let j = i + 1; j < activeIdentityPatients.length; j++) {
        const p1 = activeIdentityPatients[i];
        const p2 = activeIdentityPatients[j];
        const key = [p1.id, p2.id].sort().join(':');
        if (checked.has(key)) continue;

        const n1 = (p1.fullName || '').trim().toLowerCase();
        const n2 = (p2.fullName || '').trim().toLowerCase();
        const phone1 = (p1.contactNumber || '').replace(/\D/g, '');
        const phone2 = (p2.contactNumber || '').replace(/\D/g, '');

        let reason = '';
        if (n1 === n2 && p1.dateOfBirth === p2.dateOfBirth) {
          reason = `Identical Name ("${p1.fullName}") & Date of Birth (${p1.dateOfBirth})`;
        } else if (phone1.length >= 7 && phone1 === phone2 && n1 === n2) {
          reason = `Identical Name & Contact Number (${p1.contactNumber})`;
        } else if (n1 === n2) {
          reason = `Identical Full Name ("${p1.fullName}")`;
        } else if (phone1.length >= 7 && phone1 === phone2) {
          reason = `Matching Contact Number (${p1.contactNumber})`;
        }

        if (reason) {
          checked.add(key);
          const p1EncCount = p1.encounters?.length || 0;
          const p2EncCount = p2.encounters?.length || 0;
          if (p2EncCount > p1EncCount) {
            pairs.push({ primary: p2, duplicate: p1, matchReason: reason });
          } else {
            pairs.push({ primary: p1, duplicate: p2, matchReason: reason });
          }
        }
      }
    }
    return pairs;
  }, [scopedPatients]);

  const filteredPatients = scopedPatients.filter((p) => {
    if (['MERGED', 'REMOVED'].includes(String(p.status || 'ACTIVE').toUpperCase())) return false;
    const q = searchFilter.toLowerCase();
    return (
      p.fullName.toLowerCase().includes(q) ||
      p.mrn.toLowerCase().includes(q) ||
      p.contactNumber.includes(q) ||
      p.bloodGroup.toLowerCase().includes(q)
    );
  });

  const activePatients = scopedPatients.filter(p => !['MERGED', 'REMOVED'].includes(String(p.status || 'ACTIVE').toUpperCase()));
  const currentPatient = activePatients.find((p) => p.id === selectedPatientId) || activePatients[0];
  const activeEncounter = currentPatient?.encounters?.[0];
  const assignedBed = beds.find((b) => b.id === currentPatient?.activeBedId);

  const handleOpenPatient360 = async () => {
    if (!currentPatient?.id) return;
    const tenantId = await AuthClient.getActiveTenantId();
    router.push(
      `/${encodeURIComponent(tenantId)}/patients/${encodeURIComponent(currentPatient.id)}/360`
    );
  };

  const handleCreatePatient = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegistrationError(null);

    if (
      !newFullName.trim() ||
      !newDob ||
      !newGender ||
      !newPhone.trim() ||
      !newAddress.trim()
    ) {
      setRegistrationError(
        'Full legal name, date of birth, gender, phone number and address are required. G-HIMS will not invent missing demographics.'
      );
      return;
    }

    const birthDate = new Date(`${newDob}T00:00:00Z`);
    const today = new Date();
    if (!Number.isFinite(birthDate.getTime()) || birthDate > today) {
      setRegistrationError('Date of birth is invalid.');
      return;
    }

    let derivedAge = today.getUTCFullYear() - birthDate.getUTCFullYear();
    const monthDelta = today.getUTCMonth() - birthDate.getUTCMonth();
    if (
      monthDelta < 0 ||
      (monthDelta === 0 && today.getUTCDate() < birthDate.getUTCDate())
    ) {
      derivedAge -= 1;
    }
    if (derivedAge < 0 || derivedAge > 130) {
      setRegistrationError('Derived patient age is outside the accepted range.');
      return;
    }

    // Local fuzzy detection is advisory only. The server transaction owns exact
    // identifier uniqueness and will reject an authoritative identity conflict.
    if (!overrideDuplicateRegistration) {
      const normalizedName = newFullName.trim().toLowerCase();
      const normalizedPhone = newPhone.replace(/\D/g, '');
      const duplicate = patients.find((p) => {
        const pName = (p.fullName || '').trim().toLowerCase();
        const pPhone = (p.contactNumber || '').replace(/\D/g, '');
        const nameMatch = pName === normalizedName && p.dateOfBirth === newDob;
        const phoneMatch =
          normalizedPhone.length >= 7 && pPhone === normalizedPhone;
        return nameMatch || phoneMatch;
      });

      if (duplicate) {
        setDuplicateWarningPatient(duplicate);
        return;
      }
    }

    try {
      const created = await registerNewPatient({
        fullName: newFullName.trim(),
        dateOfBirth: newDob,
        age: derivedAge,
        gender: newGender,
        bloodGroup: newBlood,
        contactNumber: newPhone.trim(),
        email: newEmail.trim(),
        address: newAddress.trim(),
        emergencyContact: {
          name: '',
          relationship: '',
          phone: '',
        },
        allergies: newAllergies
          ? newAllergies.split(',').map((value) => value.trim()).filter(Boolean)
          : [],
        chronicConditions: newConditions
          ? newConditions.split(',').map((value) => value.trim()).filter(Boolean)
          : [],
      });

      setSelectedPatientId(created.id);
      setShowNewPatientModal(false);
      setNewFullName('');
      setNewDob('');
      setNewAge('');
      setNewGender('');
      setNewBlood('Unknown');
      setNewPhone('');
      setNewEmail('');
      setNewAddress('');
      setNewAllergies('');
      setNewConditions('');
      setDuplicateWarningPatient(null);
      setOverrideDuplicateRegistration(false);
    } catch (error) {
      setRegistrationError(
        error instanceof Error
          ? error.message
          : 'Patient registration failed.'
      );
    }
  };

  const handleExecuteMerge = async (primaryId: string, secondaryId: string, mergeReason: string) => {
    await mergePatients(primaryId, secondaryId, mergeReason);
    setSelectedPatientId(primaryId);
    setShowMergeModal(false);
    setMergeCandidateSecondaryId(undefined);
  };

  const handleAddVitals = async (e: React.FormEvent) => {
    e.preventDefault();
    setVitalsStatus(null);
    if (!currentPatient) return;
    const encounter = currentPatient.encounters.find(item => item.id === vitalsEncounterId);
    if (!encounter) {
      setVitalsStatus('Select a specific active encounter before recording vitals. If there is no encounter, create an OPD visit or open an ER encounter first.');
      return;
    }
    const bp = /^([0-9]{2,3}) *[/] *([0-9]{2,3})$/.exec(newBp.trim());
    if (
      typeof newHeartRate !== 'number' || newHeartRate < 20 || newHeartRate > 300 ||
      !bp || Number(bp[1]) < Number(bp[2]) ||
      typeof newTemp !== 'number' || newTemp < 25 || newTemp > 45 ||
      typeof newResp !== 'number' || newResp < 4 || newResp > 80 ||
      typeof newO2 !== 'number' || newO2 < 50 || newO2 > 100
    ) {
      setVitalsStatus('Enter measured HR (20–300), BP as systolic/diastolic, temperature (25–45 °C), respiratory rate (4–80), and SpO₂ (50–100). Do not invent values.');
      return;
    }

    setVitalsSaving(true);
    try {
      const result = await executeActiveTenantCommand(
        'RecordVitalsCommand',
        {
          encounterId: encounter.id,
          patientId: currentPatient.id,
          heartRate: newHeartRate,
          bloodPressure: `${Number(bp[1])}/${Number(bp[2])}`,
          temperature: newTemp,
          respiratoryRate: newResp,
          oxygenSaturation: newO2,
          measuredAt: Date.now(),
        }
      );
      if (!result.success || result.queuedOffline) {
        throw new Error(result.error?.message || 'The authoritative server did not commit vitals.');
      }
      setVitalsStatus('Vitals committed to the selected encounter. Open Patient 360 to inspect the authoritative clinical evidence.');
      setNewHeartRate('');
      setNewBp('');
      setNewTemp('');
      setNewResp('');
      setNewO2('');
      window.dispatchEvent(new CustomEvent('ghims:edge-sync-complete', {
        detail: { tenantId: auth.activeTenant?.tenantId },
      }));
    } catch (error) {
      setVitalsStatus(error instanceof Error ? error.message : 'Vitals could not be committed.');
    } finally {
      setVitalsSaving(false);
    }
  };

  const handleAiNoteParse = async () => {
    if (!rawNoteText.trim() || !currentPatient) return;
    setIsAiProcessing(true);
    setAiParseError(null);
    setAiDraft(null);

    try {
      const tenantId = await AuthClient.getActiveTenantId();
      const res = await AuthClient.authorizedFetch('/api/genkit/parse-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          rawNote: rawNoteText,
          patientId: currentPatient.id,
          patientName: currentPatient.fullName,
        }),
      }, tenantId);

      const data = await res.json();
      if (!res.ok || !data.structured) {
        throw new Error(
          data.message || data.error || 'Clinical note AI extraction unavailable'
        );
      }

      // DRP-S safety boundary: generative output is a draft only. It is not
      // committed as accepted diagnoses, medications, procedures or billing.
      setAiDraft(data.structured as Record<string, unknown>);
    } catch (error) {
      setAiParseError(
        error instanceof Error
          ? `AI draft unavailable: ${error.message}`
          : 'AI draft unavailable.'
      );
    } finally {
      setIsAiProcessing(false);
    }
  };

  const handleSaveNarrativeNote = async () => {
    if (!rawNoteText.trim() || !currentPatient) return;
    setAiParseError(null);

    try {
      await addClinicalNote(currentPatient.id, {
        author: authorName,
        role: 'Clinician',
        category: noteCategory,
        content: rawNoteText.trim(),
      });
      setRawNoteText('');
      setAiDraft(null);
    } catch (error) {
      setAiParseError(
        error instanceof Error
          ? error.message
          : 'Clinical note could not be saved.'
      );
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      {/* Duplicate Resolution Center Banner */}
      {detectedDuplicatePairs.length > 0 && (
        <div className="lg:col-span-12 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-800/80 rounded-2xl p-4 shadow-xs">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                    MPI Identity Verification: {detectedDuplicatePairs.length} Potential Duplicate Record {detectedDuplicatePairs.length === 1 ? 'Pair' : 'Pairs'} Detected
                  </h3>
                  <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase rounded-full bg-amber-200/80 dark:bg-amber-800/80 text-amber-900 dark:text-amber-100">
                    Action Required
                  </span>
                </div>
                <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                  G-HIMS Identity Safety Engine flagged matching demographic fingerprints. Consolidate longitudinal encounters, notes, and allergies to prevent fragmented clinical charts.
                </p>
              </div>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {detectedDuplicatePairs.map((pair) => (
              <div
                key={`${pair.primary.id}-${pair.duplicate.id}`}
                className="bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/50 rounded-xl p-3 flex items-center justify-between gap-3 shadow-xs"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {pair.primary.fullName}
                    </span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                      {pair.primary.mrn}
                    </span>
                    <span className="text-slate-400 text-xs">↔</span>
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 font-bold">
                      {pair.duplicate.mrn}
                    </span>
                  </div>
                  <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1">
                    Match: {pair.matchReason}
                  </p>
                </div>

                <button
                  type="button"
                  id={`btn-merge-pair-${pair.duplicate.id}`}
                  onClick={() => {
                    setSelectedPatientId(pair.primary.id);
                    setMergeCandidateSecondaryId(pair.duplicate.id);
                    setShowMergeModal(true);
                  }}
                  className="shrink-0 px-3 py-1.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                >
                  <GitMerge className="w-3.5 h-3.5" /> Merge Records
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Patient Directory Sidebar (Left 4 cols) */}
      <div className="lg:col-span-4 bg-white rounded-xl border border-slate-200/80 shadow-sm flex flex-col h-[calc(100vh-140px)] min-h-[500px]">
        <div className="p-4 border-b border-slate-100 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <User className="w-4 h-4 text-blue-600" />
              Master Patient Index (MPI)
            </h2>
            <button
              id="btn-open-new-patient-modal"
              onClick={() => setShowNewPatientModal(true)}
              className="px-2.5 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-1 shadow-xs transition-colors"
            >
              <Plus className="w-3.5 h-3.5" /> New Patient
            </button>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="input-mpi-search"
              type="text"
              placeholder="Search by Name, MRN, or Phone..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* Patient List */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-100 p-2 space-y-1">
          {filteredPatients.map((patient) => {
            const isSelected = patient.id === currentPatient?.id;
            return (
              <div
                key={patient.id}
                id={`patient-row-${patient.id}`}
                onClick={() => setSelectedPatientId(patient.id)}
                className={`p-3 rounded-lg cursor-pointer transition-all ${
                  isSelected
                    ? 'bg-blue-50/80 border border-blue-200 text-slate-900 shadow-xs'
                    : 'hover:bg-slate-50 border border-transparent text-slate-700'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-xs font-bold text-slate-900">{patient.fullName}</p>
                      {detectedDuplicatePairs.some(
                        (pair) => pair.primary.id === patient.id || pair.duplicate.id === patient.id
                      ) && (
                        <span className="text-[9px] font-extrabold px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 border border-amber-300">
                          Duplicate Alert
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-500 font-mono mt-0.5">MRN: {patient.mrn}</p>
                  </div>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                    {patient.gender}, {patient.age}y
                  </span>
                </div>

                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                  <span>Blood: <strong className="text-slate-700">{patient.bloodGroup}</strong></span>
                  {patient.activeBedId ? (
                    <span className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded font-medium text-[10px]">
                      Inpatient (Bed)
                    </span>
                  ) : (
                    <span className="text-slate-400 text-[10px]">Outpatient</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Patient Record Detail View (Right 8 cols) */}
      <div className="lg:col-span-8 space-y-5">
        {currentPatient ? (
          <>
            {/* Patient Header Banner with QR Code & Wristband Generator */}
            <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  {/* QR Code generator for patient identification */}
                  <div
                    onClick={() => setShowWristbandModal(true)}
                    className="p-2 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer hover:border-blue-300 transition-all group"
                    title="Click to print wristband / enlarge QR"
                  >
                    <QRCodeSVG value={`GHIMS-PATIENT:${currentPatient.mrn}:${currentPatient.id}`} size={64} level="M" />
                    <span className="text-[9px] block text-center text-slate-400 group-hover:text-blue-600 mt-1 font-mono">Scan QR</span>
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <h1 className="text-lg font-bold text-slate-900">{currentPatient.fullName}</h1>
                      <span className="px-2 py-0.5 text-xs font-mono font-bold bg-slate-100 text-slate-800 rounded border border-slate-200">
                        {currentPatient.mrn}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>DOB: {currentPatient.dateOfBirth} ({currentPatient.age} yrs)</span>
                      <span>Gender: {currentPatient.gender}</span>
                      <span>Blood Group: <strong className="text-rose-600">{currentPatient.bloodGroup}</strong></span>
                      {assignedBed && (
                        <span className="text-blue-600 font-medium bg-blue-50 px-2 py-0.5 rounded">
                          Bed: {assignedBed.bedNumber} ({assignedBed.ward})
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex flex-col items-start gap-1">
                    <button
                      id="btn-remove-patient-record"
                      data-testid="mpi-remove-patient-record"
                      type="button"
                      disabled={!canRemove || auth.loading || auth.isOffline}
                      aria-label={`Remove patient record ${currentPatient.mrn} from the active MPI`}
                      title={
                        !canRemove
                          ? 'Hospital administrator role required. Contact your system administrator for verified membership access.'
                          : auth.isOffline
                            ? 'Patient removal requires an online authoritative session.'
                            : 'Remove this record from the active patient registry with a mandatory reason and immutable audit trail.'
                      }
                      onClick={() => setRemovalCandidate(currentPatient)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-800 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-800 dark:bg-rose-950/60 dark:text-rose-200"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Remove Record
                    </button>
                    {!canRemove && !auth.loading && (
                      <span className="max-w-44 text-[10px] leading-tight text-amber-700 dark:text-amber-300">
                        Admin authorization required
                      </span>
                    )}
                  </div>
                  <button
                    id="btn-merge-duplicate-record"
                    type="button"
                    onClick={() => setShowMergeModal(true)}
                    className="px-3 py-1.5 text-xs font-bold bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 rounded-lg flex items-center gap-1.5 transition-colors cursor-pointer"
                    title="Merge duplicate patient record"
                  >
                    <GitMerge className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" /> Merge Record
                  </button>
                  <button
                    id="btn-direct-er-admission"
                    type="button"
                    onClick={() => {
                      const tenant = auth.activeTenant?.tenantId || auth.user?.tenantId;
                      if (!tenant || !currentPatient?.id) return;
                      router.push(`/${encodeURIComponent(tenant)}/clinical/emergency?patientId=${encodeURIComponent(currentPatient.id)}`);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-rose-700 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-800"
                    title="Open governed emergency department intake for this patient"
                  >
                    <Siren className="h-3.5 w-3.5" /> Admit to ER
                  </button>
                  <button
                    id="btn-open-patient360"
                    type="button"
                    onClick={() => void handleOpenPatient360()}
                    className="px-3 py-1.5 text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white rounded-lg flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                  >
                    <Stethoscope className="w-3.5 h-3.5" /> Patient 360
                  </button>
                  <button
                    id="btn-route-specialist"
                    onClick={() => setShowRoutingModal(true)}
                    className="px-3 py-1.5 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                  >
                    <UserCheck className="w-3.5 h-3.5" /> Route to Specialist
                  </button>
                  <button
                    id="btn-print-wristband"
                    onClick={() => setShowWristbandModal(true)}
                    className="px-3 py-1.5 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg flex items-center gap-1.5 transition-colors"
                  >
                    <Printer className="w-3.5 h-3.5 text-slate-600" /> Print Wristband
                  </button>
                </div>
              </div>

              {/* Allergy & Alert Flags */}
              <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500 font-medium">Allergies:</span>
                {currentPatient.allergies.length > 0 ? (
                  currentPatient.allergies.map((allergy, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 font-medium text-[11px] border border-rose-100">
                      <AlertTriangle className="w-3 h-3" /> {allergy}
                    </span>
                  ))
                ) : (
                  <span className="text-amber-700">Allergy status not confirmed</span>
                )}

                <span className="text-slate-300 mx-2">|</span>

                <span className="text-slate-500 font-medium">Chronic:</span>
                {currentPatient.chronicConditions.length > 0 ? (
                  currentPatient.chronicConditions.map((cond, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 font-medium text-[11px] border border-amber-100">
                      {cond}
                    </span>
                  ))
                ) : (
                  <span className="text-amber-700">Problem list not confirmed</span>
                )}
              </div>
            </div>

            {/* Sub-tabs for Medical Record */}
            <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
              <button
                id="subtab-clinical-notes"
                onClick={() => setActiveTabSub('clinical')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all ${
                  activeTabSub === 'clinical'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <FileText className="w-3.5 h-3.5" /> Clinical Notes & AI Copilot
              </button>
              <button
                id="subtab-vitals"
                onClick={() => setActiveTabSub('vitals')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all ${
                  activeTabSub === 'vitals'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <HeartPulse className="w-3.5 h-3.5" /> Vitals Telemetry
              </button>
              <button
                id="subtab-labs"
                onClick={() => setActiveTabSub('labs')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all ${
                  activeTabSub === 'labs'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <FlaskConical className="w-3.5 h-3.5" /> Lab & Pathology
              </button>
              <button
                id="subtab-billing"
                onClick={() => setActiveTabSub('billing')}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-all ${
                  activeTabSub === 'billing'
                    ? 'bg-slate-900 text-white shadow-xs'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Receipt className="w-3.5 h-3.5" /> Clinical Billing
              </button>
            </div>

            {/* TAB CONTENT: Clinical Notes & AI Copilot */}
            {activeTabSub === 'clinical' && (
              <div className="space-y-5">
                {/* AI Copilot Dictation & Structuring Box */}
                <div className="bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-xl p-5 shadow-sm space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/30">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold">GenAI Clinical Note Copilot</h3>
                        <p className="text-[11px] text-slate-300">Enter clinician-authored narrative. AI may generate a non-authoritative draft for review; it never auto-accepts diagnoses, medications, procedures or billing.</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <textarea
                      id="textarea-clinical-raw"
                      rows={3}
                      value={rawNoteText}
                      onChange={(e) => setRawNoteText(e.target.value)}
                      placeholder="Enter clinician-authored narrative. Do not paste information for another patient."
                      className="w-full bg-slate-950/60 border border-slate-700 rounded-lg p-3 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />

                    {aiParseError && (
                      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
                        {aiParseError}
                      </div>
                    )}

                    {aiDraft && (
                      <div className="rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-3 text-[11px] text-blue-100 space-y-2">
                        <div className="font-bold">
                          AI draft — not accepted into the clinical record
                        </div>
                        <pre className="whitespace-pre-wrap break-words">
                          {JSON.stringify(aiDraft, null, 2)}
                        </pre>
                        <div className="text-blue-200">
                          Structured findings require an explicit reviewed acceptance workflow before they can become authoritative clinical data.
                        </div>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                      <div className="flex items-center gap-2">
                        <select
                          id="select-note-category"
                          value={noteCategory}
                          onChange={(e) => setNoteCategory(e.target.value as any)}
                          className="bg-slate-800 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-slate-200"
                        >
                          <option value="SOAP">SOAP Note</option>
                          <option value="Progress">Progress Note</option>
                          <option value="Nursing">Nursing Round</option>
                          <option value="Discharge">Discharge Summary</option>
                        </select>

                        <span className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300">
                          Signer: authenticated session
                        </span>
                      </div>

                      <button
                        id="btn-process-ai-note"
                        disabled={isAiProcessing || !rawNoteText.trim()}
                        onClick={handleAiNoteParse}
                        className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white flex items-center gap-2 shadow-sm transition-all"
                      >
                        {isAiProcessing ? (
                          <>
                            <Activity className="w-3.5 h-3.5 animate-spin" /> Structuring with AI...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5" /> Generate AI Draft
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={!rawNoteText.trim()}
                        onClick={() => void handleSaveNarrativeNote()}
                        className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white shadow-sm transition-all"
                      >
                        Save Clinician Narrative
                      </button>
                    </div>
                  </div>
                </div>

                {/* Timeline of Clinical Notes */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Documented Encounters & Notes</h4>
                  {activeEncounter?.clinicalNotes && activeEncounter.clinicalNotes.length > 0 ? (
                    activeEncounter.clinicalNotes.map((note) => (
                      <div key={note.id} className="bg-white rounded-xl border border-slate-200/80 p-4 shadow-xs space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-blue-50 text-blue-700 border border-blue-100">
                              {note.category}
                            </span>
                            <span className="text-xs font-bold text-slate-800">{note.author} ({note.role})</span>
                          </div>
                          <span className="text-[11px] text-slate-400 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {note.timestamp}
                          </span>
                        </div>

                        <p className="text-xs text-slate-700 whitespace-pre-wrap">{note.content}</p>

                        {/* AI Structured Data Badge Container */}
                        {note.aiStructuredData && (
                          <div className="mt-3 pt-3 border-t border-slate-100 bg-slate-50/70 -mx-4 -mb-4 p-4 rounded-b-xl space-y-2 text-xs">
                            <div className="flex items-center gap-1.5 text-blue-700 font-semibold text-[11px]">
                              <Sparkles className="w-3.5 h-3.5" /> AI Extracted Diagnoses & Billing
                            </div>
                            {note.aiStructuredData.diagnoses && Array.isArray(note.aiStructuredData.diagnoses) && (
                              <div className="flex flex-wrap gap-1.5">
                                {note.aiStructuredData.diagnoses.map((d: any, i: number) => {
                                  const isObj = typeof d === 'object' && d !== null;
                                  const code = isObj ? d.code : undefined;
                                  const description = isObj ? (d.description || d.code || '') : String(d);
                                  const isPrincipal = isObj ? Boolean(d.isPrincipal) : false;
                                  const label = code && d.description && code !== d.description
                                    ? `${code} — ${description}`
                                    : description;

                                  return (
                                    <span
                                      key={i}
                                      className={`px-2 py-0.5 rounded text-[10px] font-medium inline-flex items-center gap-1 ${
                                        isPrincipal
                                          ? 'bg-blue-600 text-white font-semibold'
                                          : 'bg-blue-100/60 text-blue-800'
                                      }`}
                                    >
                                      <span>Dx: {label}</span>
                                      {isPrincipal && (
                                        <span className="text-[9px] bg-blue-700 text-blue-100 px-1 py-0.2 rounded uppercase tracking-wider font-bold">
                                          Primary
                                        </span>
                                      )}
                                    </span>
                                  );
                                })}
                              </div>
                            )}

                            {note.aiStructuredData.billingCodes && Array.isArray(note.aiStructuredData.billingCodes) && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {note.aiStructuredData.billingCodes.map((bc: any, i: number) => {
                                  const isObj = typeof bc === 'object' && bc !== null;
                                  const code = isObj ? bc.code : '';
                                  const desc = isObj ? (bc.description || '') : String(bc);
                                  const feeText = isObj && bc.fee != null ? ` (${formatCurrency(Number(bc.fee))})` : '';

                                  return (
                                    <span key={i} className="px-2 py-0.5 rounded bg-emerald-100/60 text-emerald-800 text-[10px] font-medium">
                                      {code ? `CPT ${code}: ` : ''}{desc}{feeText}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="bg-slate-50 rounded-xl p-8 text-center text-slate-400 text-xs border border-dashed border-slate-200">
                      No clinical notes recorded yet for this encounter. Use the AI copilot box above to document findings.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB CONTENT: Vitals Telemetry */}
            {activeTabSub === 'vitals' && (
              <div className="space-y-5">
                {/* Log new vitals */}
                <form onSubmit={handleAddVitals} className="bg-white rounded-xl border border-slate-200/80 p-4 shadow-sm space-y-3">
                  <h4 className="text-xs font-bold text-slate-900">Record Live Patient Vitals</h4>
                  <label className="block text-xs font-semibold text-slate-700">
                    Verified encounter for these observations
                    <select
                      data-testid="mpi-vitals-encounter"
                      value={vitalsEncounterId}
                      onChange={(event) => { setVitalsEncounterId(event.target.value); setVitalsStatus(null); }}
                      className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-xs"
                    >
                      <option value="">Select patient's active encounter</option>
                      {(currentPatient.encounters || [])
                        .filter(item => !['COMPLETED', 'CLOSED', 'CANCELLED', 'DISCHARGED', 'TRANSFERRED'].includes(String(item.status || '').toUpperCase()))
                        .map(item => (
                          <option key={item.id} value={item.id}>
                            {item.id} · {item.status || 'Unresolved'}
                          </option>
                        ))}
                    </select>
                  </label>
                  {vitalsStatus && <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">{vitalsStatus}</p>}
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">Heart Rate (bpm)</label>
                      <input
                        id="input-vitals-hr"
                        type="number"
                        value={newHeartRate}
                        onChange={(e) => setNewHeartRate(e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full text-xs border border-slate-200 rounded-lg p-2 text-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">BP (mmHg)</label>
                      <input
                        id="input-vitals-bp"
                        type="text"
                        value={newBp}
                        onChange={(e) => setNewBp(e.target.value)}
                        className="w-full text-xs border border-slate-200 rounded-lg p-2 text-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">Temp (&deg;C)</label>
                      <input
                        id="input-vitals-temp"
                        type="number"
                        step="0.1"
                        value={newTemp}
                        onChange={(e) => setNewTemp(e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full text-xs border border-slate-200 rounded-lg p-2 text-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">Resp Rate (/min)</label>
                      <input
                        id="input-vitals-resp"
                        type="number"
                        value={newResp}
                        onChange={(e) => setNewResp(e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full text-xs border border-slate-200 rounded-lg p-2 text-slate-800"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-slate-500 mb-1">SpO2 (%)</label>
                      <input
                        id="input-vitals-o2"
                        type="number"
                        value={newO2}
                        onChange={(e) => setNewO2(e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full text-xs border border-slate-200 rounded-lg p-2 text-slate-800"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <button
                      id="btn-submit-vitals"
                      type="submit"
                      disabled={!vitalsEncounterId || vitalsSaving}
                      className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg shadow-xs"
                    >
                      {vitalsSaving ? 'Recording…' : 'Record Vitals'}
                    </button>
                  </div>
                </form>

                {/* Vitals History Table */}
                <div className="bg-white rounded-xl border border-slate-200/80 shadow-sm overflow-hidden">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="p-3 font-semibold">Timestamp</th>
                        <th className="p-3 font-semibold">Heart Rate</th>
                        <th className="p-3 font-semibold">Blood Pressure</th>
                        <th className="p-3 font-semibold">Temperature</th>
                        <th className="p-3 font-semibold">Respiration</th>
                        <th className="p-3 font-semibold">SpO2</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeEncounter?.vitalsHistory && activeEncounter.vitalsHistory.length > 0 ? (
                        activeEncounter.vitalsHistory.map((v, idx) => (
                          <tr key={idx} className="hover:bg-slate-50">
                            <td className="p-3 font-medium text-slate-600">{v.timestamp}</td>
                            <td className="p-3">
                              <span className={`font-bold ${v.heartRate > 100 || v.heartRate < 60 ? 'text-rose-600' : 'text-slate-800'}`}>
                                {v.heartRate} bpm
                              </span>
                            </td>
                            <td className="p-3 font-medium text-slate-800">{v.bloodPressure}</td>
                            <td className="p-3 text-slate-800">{v.temperature}&deg;C</td>
                            <td className="p-3 text-slate-800">{v.respiratoryRate}/min</td>
                            <td className="p-3">
                              <span className={`font-bold ${v.oxygenSaturation < 95 ? 'text-amber-600' : 'text-emerald-600'}`}>
                                {v.oxygenSaturation}%
                              </span>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="p-6 text-center text-slate-400">
                            No vitals logged yet for this encounter.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB CONTENT: Lab & Pathology */}
            {activeTabSub === 'labs' && (
              <div className="space-y-4">
                {activeEncounter?.labOrders && activeEncounter.labOrders.length > 0 ? (
                  activeEncounter.labOrders.map((order) => (
                    <div key={order.id} className="bg-white rounded-xl border border-slate-200/80 p-4 shadow-xs space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-xs font-bold text-slate-900">{order.testName}</h4>
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                              {order.category}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 mt-0.5">Sample ID: {order.sampleId} &bull; Ordered: {order.orderedAt}</p>
                        </div>
                        <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          {order.status.toUpperCase()}
                        </span>
                      </div>

                      {order.results && (
                        <div className="bg-slate-50 rounded-lg p-3 border border-slate-200/70 overflow-x-auto">
                          <table className="w-full text-xs text-left">
                            <thead>
                              <tr className="text-slate-500 border-b border-slate-200">
                                <th className="pb-1.5 font-medium">Analyte / Parameter</th>
                                <th className="pb-1.5 font-medium">Result</th>
                                <th className="pb-1.5 font-medium">Normal Range</th>
                                <th className="pb-1.5 font-medium">Flag</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200/60">
                              {order.results.map((r, i) => (
                                <tr key={i}>
                                  <td className="py-1.5 font-medium text-slate-700">{r.parameter}</td>
                                  <td className="py-1.5 font-bold text-slate-900">{r.value} {r.unit}</td>
                                  <td className="py-1.5 text-slate-500">{r.normalRange}</td>
                                  <td className="py-1.5">
                                    {r.flag === 'High' ? (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">HIGH</span>
                                    ) : r.flag === 'Low' ? (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">LOW</span>
                                    ) : (
                                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-700">NORMAL</span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="bg-slate-50 rounded-xl p-8 text-center text-slate-400 text-xs border border-dashed border-slate-200">
                    No diagnostic lab orders filed for this encounter.
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT: Clinical Billing */}
            {activeTabSub === 'billing' && (
              <div className="bg-white rounded-xl border border-slate-200/80 p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Encounter Ledger & Itemized Invoice</h3>
                    <p className="text-xs text-slate-500">Auto-calculated insurance coverage and patient co-pay</p>
                  </div>
                  <span className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-50 text-amber-700 border border-amber-200">
                    Status: {activeEncounter?.billing.paymentStatus.toUpperCase() || 'PENDING'}
                  </span>
                  <button
                    id="btn-open-authoritative-billing"
                    type="button"
                    onClick={() => {
                      const tenant = auth.activeTenant?.tenantId || auth.user?.tenantId;
                      if (tenant) router.push(`/${encodeURIComponent(tenant)}/billing/invoices${activeEncounter?.id ? `?encounterId=${encodeURIComponent(activeEncounter.id)}` : ''}`);
                    }}
                    className="rounded-lg bg-teal-700 px-3 py-2 text-xs font-bold text-white hover:bg-teal-800"
                  >
                    Open cashier / clear billing
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                      <tr>
                        <th className="p-2.5 font-semibold">Service / Code</th>
                        <th className="p-2.5 font-semibold">Category</th>
                        <th className="p-2.5 font-semibold text-center">Qty</th>
                        <th className="p-2.5 font-semibold text-right">Unit Price</th>
                        <th className="p-2.5 font-semibold text-right">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeEncounter?.billing.items && activeEncounter.billing.items.length > 0 ? (
                        activeEncounter.billing.items.map((item) => (
                          <tr key={item.id}>
                            <td className="p-2.5 font-medium text-slate-800">
                              {item.description}
                              <span className="block text-[10px] text-slate-400 font-mono">{item.code}</span>
                            </td>
                            <td className="p-2.5 text-slate-600">{item.category}</td>
                            <td className="p-2.5 text-center text-slate-800">{item.quantity}</td>
                            <td className="p-2.5 text-right text-slate-600">{formatCurrency(item.unitPrice)}</td>
                            <td className="p-2.5 text-right font-bold text-slate-900">{formatCurrency(item.totalPrice)}</td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={5} className="p-6 text-center text-slate-400">
                            No billing lines registered.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {activeEncounter?.billing && (
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 text-xs">
                    <div>
                      <p className="text-slate-500">Gross Charges: <strong className="text-slate-800">{formatCurrency(activeEncounter.billing.subtotal)}</strong></p>
                      <p className="text-slate-500">Insurance Adjudication: <strong className="text-emerald-700">-{formatCurrency(activeEncounter.billing.insuranceCoverage)}</strong></p>
                    </div>
                    <div className="text-right">
                      <span className="text-[11px] text-slate-500 block">Patient Out-of-Pocket Balance</span>
                      <span className="text-xl font-bold text-blue-700">{formatCurrency(activeEncounter.billing.patientPayable)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="bg-slate-50 rounded-xl p-12 text-center text-slate-400 text-xs">
            Select a patient from the MPI directory to review their health record.
          </div>
        )}
      </div>

      {/* Patient Wristband QR Modal */}
      {showWristbandModal && currentPatient && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-slate-200 space-y-4 text-center">
            <div className="flex justify-between items-center pb-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" /> Patient Wristband ID
              </h3>
              <button onClick={() => setShowWristbandModal(false)} className="text-slate-400 hover:text-slate-600 text-sm">
                &times;
              </button>
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 inline-block">
              <QRCodeSVG value={`https://ghims.hospital.org/patient/${currentPatient.mrn}`} size={160} level="H" />
            </div>

            <div className="space-y-1">
              <h4 className="text-base font-bold text-slate-900">{currentPatient.fullName}</h4>
              <p className="text-xs font-mono font-bold text-blue-700">{currentPatient.mrn}</p>
              <p className="text-xs text-slate-500">DOB: {currentPatient.dateOfBirth} &bull; Blood: {currentPatient.bloodGroup}</p>
              {assignedBed && (
                <p className="text-xs font-semibold text-slate-800 mt-1">Ward: {assignedBed.ward} &bull; Bed: {assignedBed.bedNumber}</p>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex gap-2">
              <button
                onClick={() => setShowWristbandModal(false)}
                className="w-full py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold hover:bg-slate-800"
              >
                Close & Print
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New Patient Registration Modal */}
      {showNewPatientModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreatePatient}
            className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-slate-200 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <User className="w-4 h-4 text-blue-600" /> New MPI Patient Intake
              </h3>
              <button
                type="button"
                onClick={() => {
                  setShowNewPatientModal(false);
                  setDuplicateWarningPatient(null);
                  setOverrideDuplicateRegistration(false);
                }}
                className="text-slate-400 hover:text-slate-600 text-sm"
              >
                &times;
              </button>
            </div>

            {/* RULE 10: Patient Identity Safety Duplicate Detection Alert */}
            {duplicateWarningPatient && (
              <div className="bg-amber-50 dark:bg-amber-950/50 border-2 border-amber-400 rounded-xl p-3.5 space-y-2 text-xs text-amber-900 dark:text-amber-200 animate-in fade-in duration-150">
                <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>POTENTIAL DUPLICATE PATIENT DETECTED IN MPI</span>
                </div>
                <p>
                  A patient with matching demographics is already registered:
                  <strong className="block text-slate-900 dark:text-slate-100 mt-1">
                    {duplicateWarningPatient.fullName} • MRN: {duplicateWarningPatient.mrn} (DOB: {duplicateWarningPatient.dateOfBirth}, Phone: {duplicateWarningPatient.contactNumber})
                  </strong>
                </p>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPatientId(duplicateWarningPatient.id);
                      setShowNewPatientModal(false);
                      setDuplicateWarningPatient(null);
                    }}
                    className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-bold text-[11px] shadow-xs cursor-pointer"
                  >
                    Open Existing Patient Chart
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOverrideDuplicateRegistration(true);
                      setDuplicateWarningPatient(null);
                    }}
                    className="px-3 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-slate-800 dark:text-slate-200 rounded-lg font-medium text-[11px] cursor-pointer"
                  >
                    Override (Different Individual)
                  </button>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-700 mb-1">Full Legal Name *</label>
                <input
                  id="input-reg-name"
                  type="text"
                  required
                  value={newFullName}
                  onChange={(e) => setNewFullName(e.target.value)}
                  placeholder="Enter legal name exactly as provided"
                  className="w-full border border-slate-200 rounded-lg p-2 text-slate-800 focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Date of Birth</label>
                <input
                  id="input-reg-dob"
                  type="date"
                  value={newDob}
                  required
                  onChange={(e) => {
                    const value = e.target.value;
                    setNewDob(value);
                    if (!value) {
                      setNewAge('');
                      return;
                    }
                    const birth = new Date(`${value}T00:00:00Z`);
                    const now = new Date();
                    if (!Number.isFinite(birth.getTime()) || birth > now) {
                      setNewAge('');
                      return;
                    }
                    let age = now.getUTCFullYear() - birth.getUTCFullYear();
                    const monthDelta = now.getUTCMonth() - birth.getUTCMonth();
                    if (
                      monthDelta < 0 ||
                      (monthDelta === 0 && now.getUTCDate() < birth.getUTCDate())
                    ) {
                      age -= 1;
                    }
                    setNewAge(age);
                  }}
                  className="w-full border border-slate-200 rounded-lg p-2 text-slate-800"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Age</label>
                <input
                  id="input-reg-age"
                  type="number"
                  value={newAge}
                  readOnly
                  aria-label="Age derived from date of birth"
                  className="w-full border border-slate-200 rounded-lg p-2 text-slate-500 bg-slate-50"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Gender</label>
                <select
                  id="select-reg-gender"
                  value={newGender}
                  onChange={(e) => setNewGender(e.target.value as any)}
                  className="w-full border border-slate-200 rounded-lg p-2 text-slate-800"
                  required
                >
                  <option value="">Select gender</option>
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Blood Group</label>
                <select
                  id="select-reg-blood"
                  value={newBlood}
                  onChange={(e) => setNewBlood(e.target.value as any)}
                  className="w-full border border-slate-200 rounded-lg p-2 text-slate-800"
                >
                  <option value="Unknown">Unknown / not tested</option>
                  <option value="O+">O+</option>
                  <option value="O-">O-</option>
                  <option value="A+">A+</option>
                  <option value="A-">A-</option>
                  <option value="B+">B+</option>
                  <option value="B-">B-</option>
                  <option value="AB+">AB+</option>
                  <option value="AB-">AB-</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Phone Number</label>
                <input
                  id="input-reg-phone"
                  type="text"
                  value={newPhone}
                  required
                  onChange={(e) => setNewPhone(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg p-2 text-slate-800"
                />
              </div>

              <div>
                <label className="block font-medium text-slate-700 mb-1">Email Address</label>
                <input
                  id="input-reg-email"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg p-2 text-slate-800"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-700 mb-1">Address *</label>
                <textarea
                  id="input-reg-address"
                  required
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  placeholder="Enter the address supplied by the patient/representative"
                  className="w-full border border-slate-200 rounded-lg p-2 text-slate-800"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-medium text-slate-700 mb-1">Known Allergies (comma-separated)</label>
                <input
                  id="input-reg-allergies"
                  type="text"
                  value={newAllergies}
                  onChange={(e) => setNewAllergies(e.target.value)}
                  placeholder="e.g. Penicillin, Latex"
                  className="w-full border border-slate-200 rounded-lg p-2 text-slate-800"
                />
              </div>
            </div>

            {registrationError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                {registrationError}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowNewPatientModal(false)}
                className="px-4 py-2 text-xs font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg"
              >
                Cancel
              </button>
              <button
                id="btn-confirm-new-patient"
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm"
              >
                Register Patient
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Patient Consultant Routing Modal */}
      {currentPatient && (
        <PatientConsultantRoutingModal
          isOpen={showRoutingModal}
          onClose={() => setShowRoutingModal(false)}
          patientId={currentPatient.id}
          encounterId={
            currentPatient.activeEncounterId ||
            currentPatient.encounters.find((encounter) => encounter.status === 'active')?.id
          }
          patientName={currentPatient.fullName}
          mrn={currentPatient.mrn}
          chiefComplaint={currentPatient.chronicConditions.join(', ') || 'Inpatient / Outpatient Consultation Request'}
          triageCategory="MPI / Longitudinal Chart"
          currentAttending="Unassigned"
          onRoutedSuccess={(consultant, details) => {
            setShowRoutingModal(false);
          }}
        />
      )}

      {removalCandidate && (
        <PatientRecordRemovalModal
          patient={removalCandidate}
          onClose={() => setRemovalCandidate(null)}
          onRemoved={(patientId) => {
            // The modal commits authoritatively; shell projection is refreshed
            // locally only after its server acknowledgement.
            setSelectedPatientId(null);
            window.dispatchEvent(new CustomEvent('ghims:edge-sync-complete', {
              detail: { tenantId: auth.activeTenant?.tenantId },
            }));
          }}
        />
      )}

      {/* RULE 10: Patient Identity Safety — Record Merge Safety Console */}
      {currentPatient && (
        <PatientMergeModal
          isOpen={showMergeModal}
          onClose={() => {
            setShowMergeModal(false);
            setMergeCandidateSecondaryId(undefined);
          }}
          primaryPatient={currentPatient}
          availablePatients={patients}
          initialSecondaryId={mergeCandidateSecondaryId}
          onExecuteMerge={handleExecuteMerge}
        />
      )}
    </div>
  );
}
