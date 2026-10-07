'use client';

import React, { useState } from 'react';
import { PatientMPI, PatientIdentifier, Gender } from '@/types/mpi';
import { normalizeCnic, normalizeMrn } from '@/lib/clinical/mpi/patient-mpi';
import type { RegistrationRequest } from '@/lib/api/command-client';
import {
  Search,
  UserPlus,
  UserCheck,
  ShieldCheck,
  CreditCard,
  Phone,
  AlertCircle,
  Sparkles,
  Calendar,
  MapPin,
  HeartPulse,
  Activity,
  Plus,
  Trash2,
  CheckCircle2,
  FileText,
} from 'lucide-react';

interface PatientSearchAndRegistrationPanelProps {
  existingPatients: PatientMPI[];
  onSelectPatient: (patient: PatientMPI) => void;
  onRegisterPatient: (params: RegistrationRequest) => Promise<void>;
  isLoading?: boolean;
}

export function PatientSearchAndRegistrationPanel({
  existingPatients,
  onSelectPatient,
  onRegisterPatient,
  isLoading = false,
}: PatientSearchAndRegistrationPanelProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFilter, setSearchFilter] = useState<'ALL' | 'CNIC' | 'MRN' | 'PHONE'>('MRN');

  // Form State
  const [fullName, setFullName] = useState('');
  const [gender, setGender] = useState<Gender>('female');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [address, setAddress] = useState('');
  const [bloodGroup, setBloodGroup] = useState('O+');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [department, setDepartment] = useState('General Medicine');
  const [priority, setPriority] = useState<'ROUTINE' | 'URGENT' | 'EMERGENCY'>('ROUTINE');
  const [idType, setIdType] = useState<'CNIC' | 'PASSPORT' | 'PHONE'>('CNIC');
  const [idValue, setIdValue] = useState('');
  const [identifiers, setIdentifiers] = useState<PatientIdentifier[]>([]);
  const [allergiesText, setAllergiesText] = useState('');
  const [chronicConditionsText, setChronicConditionsText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Filter existing patients. MRN and CNIC are exact identity lookups;
  // name/phone remain broader convenience searches.
  const filteredPatients = existingPatients.filter((p) => {
    if (!searchQuery.trim()) return true;

    const q = searchQuery.trim();
    const qLower = q.toLowerCase();
    const normalizedMrn = normalizeMrn(q);
    const normalizedCnic = normalizeCnic(q);
    const matchName = p.fullName.toLowerCase().includes(qLower);
    const matchMrn = normalizeMrn(p.mrn) === normalizedMrn;
    const matchPhone = p.contactPhone?.toLowerCase().includes(qLower);
    const matchCnic =
      Boolean(normalizedCnic) &&
      Boolean(
        p.identifiers?.some(
          (id) =>
            id.type === 'CNIC' &&
            normalizeCnic(id.value) === normalizedCnic
        )
      );
    const matchId = p.identifiers?.some((id) =>
      id.value.toLowerCase().includes(qLower)
    );

    if (searchFilter === 'CNIC') return matchCnic;
    if (searchFilter === 'MRN') return Boolean(normalizedMrn) && matchMrn;
    if (searchFilter === 'PHONE') return Boolean(matchPhone);

    return matchName || matchMrn || matchCnic || Boolean(matchPhone) || Boolean(matchId);
  });

  const handleAddIdentifier = () => {
    if (!idValue.trim()) return;
    setIdentifiers((prev) => [
      ...prev,
      { type: idType, value: idValue.trim(), issuer: 'Government Authority' },
    ]);
    setIdValue('');
  };

  const handleRemoveIdentifier = (index: number) => {
    setIdentifiers((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmitRegistration = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!fullName.trim()) {
      setFormError('Patient full legal name is required.');
      return;
    }
    if (!contactPhone.trim()) {
      setFormError('Valid contact phone number is required for notification.');
      return;
    }

    const payload: RegistrationRequest = {
      fullName: fullName.trim(),
      gender,
      dateOfBirth,
      contactPhone: contactPhone.trim(),
      address: address.trim(),
      bloodGroup,
      identifiers,
      allergies: allergiesText
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      chronicConditions: chronicConditionsText
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      department,
      priority,
      chiefComplaint,
    };

    try {
      await onRegisterPatient(payload);
      // Reset form
      setFullName('');
      setChiefComplaint('');
    } catch (err: unknown) {
      const error = err as Error;
      setFormError(error.message || 'Registration failed.');
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
      {/* LEFT COLUMN: Master Patient Index Query & Match Finder (5 Cols) */}
      <div className="lg:col-span-5 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-5 shadow-xs flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold">
              <Search className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Master Patient Index (MPI) Lookup
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                MRN is the permanent hospital Patient ID • exact MRN/CNIC lookup
              </p>
            </div>
          </div>
          <span className="text-[11px] font-bold text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-md">
            {filteredPatients.length} indexed
          </span>
        </div>

        {/* Search input with type filter */}
        <div className="flex flex-col gap-2">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              id="mpi-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Enter MRN or CNIC for exact patient lookup..."
              className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-1 text-[11px]">
            <span className="text-slate-400 font-medium mr-1">Filter:</span>
            {(['MRN', 'CNIC', 'ALL', 'PHONE'] as const).map((filter) => (
              <button
                key={filter}
                type="button"
                onClick={() => setSearchFilter(filter)}
                className={`px-2 py-0.5 rounded-md font-semibold transition-colors ${
                  searchFilter === filter
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        </div>

        {/* Matches List */}
        <div className="flex flex-col gap-2.5 max-h-[480px] overflow-y-auto pr-1">
          {filteredPatients.length === 0 ? (
            <div className="text-center py-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl p-4">
              <UserPlus className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto mb-2" />
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                No matching MPI record found
              </p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Register this patient in the right panel to allocate an MRN & start workflow.
              </p>
            </div>
          ) : (
            filteredPatients.map((patient) => (
              <div
                key={patient.id}
                id={`mpi-patient-${patient.id}`}
                className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-700 bg-slate-50/50 dark:bg-slate-800/30 hover:bg-white dark:hover:bg-slate-800 transition-all flex flex-col gap-2 group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                        {patient.fullName}
                      </span>
                      <span className="text-[10px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                        {patient.gender}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5">
                      {patient.mrn}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => onSelectPatient(patient)}
                    className="px-2.5 py-1 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-1 shadow-xs"
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Select</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200/60 dark:border-slate-800">
                  <div className="flex items-center gap-1.5 truncate">
                    <Phone className="w-3 h-3 text-slate-400 shrink-0" />
                    <span className="truncate">{patient.contactPhone || 'N/A'}</span>
                  </div>
                  <div className="flex items-center gap-1.5 truncate">
                    <Calendar className="w-3 h-3 text-slate-400 shrink-0" />
                    <span>DOB: {patient.dateOfBirth}</span>
                  </div>
                </div>

                {patient.identifiers && patient.identifiers.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {patient.identifiers.map((id, i) => (
                      <span
                        key={i}
                        className="text-[10px] font-mono bg-slate-200/70 dark:bg-slate-700/60 text-slate-700 dark:text-slate-300 px-1.5 py-0.5 rounded"
                      >
                        {id.type}: {id.value}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: New Patient Registration & Encounter Dispatch Form (7 Cols) */}
      <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200/90 dark:border-slate-800 rounded-2xl p-6 shadow-xs flex flex-col gap-5">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center font-bold">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Front Desk Patient Intake & Orchestrator
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Executes atomic MPI creation, encounter launch, workflow compilation & HL7 emission
              </p>
            </div>
          </div>
          <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 dark:text-emerald-300 px-2 py-1 rounded-md border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5" />
            Atomic Txn
          </span>
        </div>

        {formError && (
          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 flex items-center gap-2 text-xs text-rose-700 dark:text-rose-300">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSubmitRegistration} className="flex flex-col gap-4">
          {/* Section 1: Demographics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Full Legal Name *
              </label>
              <input
                id="input-patient-name"
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Eleanor Vance"
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Gender *
                </label>
                <select
                  id="select-patient-gender"
                  value={gender}
                  onChange={(e) => setGender(e.target.value as Gender)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                  <option value="unknown">Unknown</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Blood Group
                </label>
                <select
                  id="select-patient-blood"
                  value={bloodGroup}
                  onChange={(e) => setBloodGroup(e.target.value)}
                  className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="A+">A+</option>
                  <option value="A-">A-</option>
                  <option value="B+">B+</option>
                  <option value="B-">B-</option>
                  <option value="AB+">AB+</option>
                  <option value="AB-">AB-</option>
                  <option value="O+">O+</option>
                  <option value="O-">O-</option>
                </select>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Date of Birth *
              </label>
              <input
                id="input-patient-dob"
                type="date"
                required
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Contact Phone *
              </label>
              <input
                id="input-patient-phone"
                type="text"
                required
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Residential Address
            </label>
            <input
              id="input-patient-address"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Full street address and city"
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          {/* Section 2: National Identifiers / MPI Deduplication keys */}
          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200/80 dark:border-slate-800 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <CreditCard className="w-3.5 h-3.5 text-blue-600" />
                Deterministic National Identifiers (CNIC / Passport)
              </span>
            </div>

            <div className="flex gap-2">
              <select
                id="select-id-type"
                value={idType}
                onChange={(e) => setIdType(e.target.value as any)}
                className="w-32 px-2.5 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100"
              >
                <option value="CNIC">CNIC</option>
                <option value="PASSPORT">Passport</option>
                <option value="PHONE">Phone</option>
              </select>
              <input
                id="input-id-val"
                type="text"
                value={idValue}
                onChange={(e) => setIdValue(e.target.value)}
                placeholder="ID Number..."
                className="flex-1 px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 font-mono"
              />
              <button
                type="button"
                onClick={handleAddIdentifier}
                className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 text-xs font-bold rounded-lg flex items-center gap-1 text-slate-800 dark:text-slate-200 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>

            {identifiers.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {identifiers.map((id, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1 text-[11px] font-mono bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-300 px-2 py-0.5 rounded-md"
                  >
                    <strong>{id.type}:</strong> {id.value}
                    <button
                      type="button"
                      onClick={() => handleRemoveIdentifier(idx)}
                      className="text-blue-500 hover:text-red-500 ml-1"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Section 3: Encounter & Clinical Intake Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Routing Department *
              </label>
              <select
                id="select-encounter-dept"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="General Medicine">General Medicine</option>
                <option value="Cardiology">Cardiology</option>
                <option value="Emergency Care">Emergency Care</option>
                <option value="Pediatrics">Pediatrics</option>
                <option value="Orthopedics">Orthopedics</option>
                <option value="Pulmonology">Pulmonology</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Encounter Priority *
              </label>
              <select
                id="select-encounter-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as any)}
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="ROUTINE">Routine Consult (Level 4/5)</option>
                <option value="URGENT">Urgent Care (Level 3)</option>
                <option value="EMERGENCY">Emergency Triage (Level 1/2)</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Chief Complaint / Reason for Visit *
            </label>
            <input
              id="input-chief-complaint"
              type="text"
              required
              value={chiefComplaint}
              onChange={(e) => setChiefComplaint(e.target.value)}
              placeholder="e.g. Acute chest discomfort and shortness of breath"
              className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Allergies (comma-separated)
              </label>
              <input
                id="input-allergies"
                type="text"
                value={allergiesText}
                onChange={(e) => setAllergiesText(e.target.value)}
                placeholder="e.g. Penicillin, NSAIDs"
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Chronic Conditions
              </label>
              <input
                id="input-chronic"
                type="text"
                value={chronicConditionsText}
                onChange={(e) => setChronicConditionsText(e.target.value)}
                placeholder="e.g. Hypertension, Type 2 Diabetes"
                className="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-slate-100 placeholder-slate-400"
              />
            </div>
          </div>

          {/* Submit Registration Button */}
          <div className="pt-2">
            <button
              id="btn-submit-registration"
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-400 text-white font-bold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {isLoading ? (
                <>
                  <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Committing Atomic Transaction...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Execute Multi-Doc Atomic Intake & Launch OPD Workflow</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
