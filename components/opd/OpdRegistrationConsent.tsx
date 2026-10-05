'use client';

import React, { useState } from 'react';
import {
  UserPlus,
  ShieldCheck,
  FileCheck,
  CheckCircle2,
  Calendar,
  Phone,
  CreditCard,
  Building,
  AlertCircle,
  FileText,
  Lock,
} from 'lucide-react';
import { PatientDemographics, ConsentCaptureDecision } from '@/types/opd-domain';

interface OpdRegistrationConsentProps {
  initialData?: Partial<PatientDemographics>;
  onRegisterSuccess: (patient: PatientDemographics) => void;
  onCancel?: () => void;
}

export function OpdRegistrationConsent({
  initialData,
  onRegisterSuccess,
  onCancel,
}: OpdRegistrationConsentProps) {
  const [fullName, setFullName] = useState<string>(initialData?.fullName || '');
  const [preferredName, setPreferredName] = useState<string>(initialData?.preferredName || '');
  const [gender, setGender] = useState<'Male' | 'Female' | 'Other' | ''>(
    initialData?.gender || ''
  );
  const [dob, setDob] = useState<string>(initialData?.dob || '');
  const [age, setAge] = useState<number | ''>(initialData?.age ?? '');
  const [nationalId, setNationalId] = useState<string>(initialData?.nationalId || '');
  const [passportNumber, setPassportNumber] = useState<string>(initialData?.passportNumber || '');
  const [maritalStatus, setMaritalStatus] = useState<
    'Single' | 'Married' | 'Divorced' | 'Widowed' | ''
  >('');
  const [nationality, setNationality] = useState<string>('');
  const [primaryLanguage, setPrimaryLanguage] = useState<string>('');
  const [occupation, setOccupation] = useState<string>('');

  const [phone, setPhone] = useState<string>(initialData?.phone || '');
  const [secondaryPhone, setSecondaryPhone] = useState<string>('');
  const [email, setEmail] = useState<string>('');
  const [residentialAddress, setResidentialAddress] = useState<string>('');

  const [emergencyName, setEmergencyName] = useState<string>('');
  const [emergencyRelation, setEmergencyRelation] = useState<string>('');
  const [emergencyPhone, setEmergencyPhone] = useState<string>('');

  const [tariffPlan, setTariffPlan] = useState<
    'OUT_OF_POCKET' | 'CORPORATE_PPO' | 'SEHAT_CARD_UNIVERSAL' | 'STATE_INSURANCE' | ''
  >('');
  const [payerName, setPayerName] = useState<string>('');
  const [policyNumber, setPolicyNumber] = useState<string>('');
  const [bloodGroup, setBloodGroup] = useState<
    'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-' | 'Unknown'
  >('Unknown');
  const [knownAllergies, setKnownAllergies] = useState<string>('');

  // Consent decisions are explicit and unselected by default. Procedure-specific
  // consent is intentionally not collected as a blanket registration consent.
  const [generalConsentGranted, setGeneralConsentGranted] = useState<boolean | null>(null);
  const [dataSharingGranted, setDataSharingGranted] = useState<boolean | null>(null);
  const consentMethod: ConsentCaptureDecision['method'] = 'DIGITAL_ATTESTATION';

  const handleDobChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDob(val);
    if (!val) {
      setAge('');
      return;
    }
    const birthDate = new Date(`${val}T00:00:00`);
    const now = new Date();
    if (Number.isNaN(birthDate.getTime()) || birthDate > now) {
      setAge('');
      return;
    }
    let calculated = now.getFullYear() - birthDate.getFullYear();
    const monthDelta = now.getMonth() - birthDate.getMonth();
    if (
      monthDelta < 0 ||
      (monthDelta === 0 && now.getDate() < birthDate.getDate())
    ) {
      calculated -= 1;
    }
    setAge(Math.max(0, calculated));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!gender || age === '' || !tariffPlan || !maritalStatus) {
      alert('Complete gender, date of birth, marital status and tariff class before registration.');
      return;
    }
    if (generalConsentGranted === null || dataSharingGranted === null) {
      alert('Record an explicit Grant or Withhold decision for each registration consent.');
      return;
    }
    if (
      (tariffPlan === 'CORPORATE_PPO' || tariffPlan === 'STATE_INSURANCE') &&
      (!payerName.trim() || !policyNumber.trim())
    ) {
      alert('Payer name and policy/card number are required for the selected payer plan.');
      return;
    }

    const consentDecisions: ConsentCaptureDecision[] = [
      {
        consentType: 'GENERAL_OUTPATIENT',
        status: generalConsentGranted ? 'GRANTED' : 'WITHHELD',
        method: consentMethod,
      },
      {
        consentType: 'DATA_SHARING_HIE',
        status: dataSharingGranted ? 'GRANTED' : 'WITHHELD',
        method: consentMethod,
      },
    ];

    const newPatient: PatientDemographics = {
      // IDs/MRN are server-owned and replaced by the registration orchestrator.
      id: '',
      mrn: '',
      fullName: fullName.trim(),
      preferredName: preferredName.trim() || undefined,
      gender,
      dob,
      age,
      nationalId: nationalId.trim(),
      passportNumber: passportNumber.trim() || undefined,
      maritalStatus,
      nationality: nationality.trim(),
      primaryLanguage: primaryLanguage.trim(),
      occupation: occupation.trim() || undefined,
      phone: phone.trim(),
      secondaryPhone: secondaryPhone.trim() || undefined,
      email: email.trim() || undefined,
      residentialAddress: residentialAddress.trim(),
      emergencyContact:
        emergencyName.trim() && emergencyRelation.trim() && emergencyPhone.trim()
          ? {
              name: emergencyName.trim(),
              relation: emergencyRelation.trim(),
              phone: emergencyPhone.trim(),
            }
          : undefined,
      tariffPlan,
      insuranceDetails:
        tariffPlan === 'CORPORATE_PPO' || tariffPlan === 'STATE_INSURANCE'
          ? {
              payerName: payerName.trim(),
              policyNumber: policyNumber.trim(),
            }
          : undefined,
      registrationConsentDecisions: consentDecisions,
      bloodGroup: bloodGroup === 'Unknown' ? ('Unknown' as any) : bloodGroup,
      knownAllergies: knownAllergies.trim()
        ? knownAllergies.split(',').map((value) => value.trim()).filter(Boolean)
        : undefined,
      createdAt: 0,
    };

    onRegisterSuccess(newPatient);
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-xs space-y-6">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-blue-600" />
            Outpatient Registration & Dynamic Consent Ingress
          </h2>
          <p className="text-xs text-slate-500">
            Establish legal patient identity, contact coordinates, payer tariff, and versioned informed consents.
          </p>
        </div>
        {onCancel && (
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
        )}
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Demographics */}
        <div className="space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-blue-600 flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4" />
            1. Core Demographics & Legal Identity
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Full Legal Name *
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Eleanor Vance"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold text-slate-900 dark:text-slate-100"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Preferred Name / Alias
              </label>
              <input
                type="text"
                value={preferredName}
                onChange={(e) => setPreferredName(e.target.value)}
                placeholder="e.g. Nora"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                CNIC / National ID *
              </label>
              <input
                type="text"
                required
                value={nationalId}
                onChange={(e) => setNationalId(e.target.value)}
                placeholder="61101-1234567-8"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Date of Birth & Age
              </label>
              <div className="flex gap-2">
                <input
                  type="date"
                  required
                  value={dob}
                  onChange={handleDobChange}
                  className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
                />
                <input
                  type="number"
                  value={age}
                  onChange={(e) => setAge(Number(e.target.value))}
                  className="w-16 px-2 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-center font-bold"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">Gender</label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value as any)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              >
                <option value="Female">Female</option>
                <option value="Male">Male</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">Blood Group</label>
              <select
                value={bloodGroup}
                onChange={(e) => setBloodGroup(e.target.value as any)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold text-rose-600"
              >
                <option value="A+">A+ (Rh Positive)</option>
                <option value="A-">A- (Rh Negative)</option>
                <option value="B+">B+ (Rh Positive)</option>
                <option value="B-">B- (Rh Negative)</option>
                <option value="AB+">AB+ (Rh Positive)</option>
                <option value="AB-">AB- (Rh Negative)</option>
                <option value="O+">O+ (Rh Positive)</option>
                <option value="O-">O- (Rh Negative)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Section 2: Contact & Emergency */}
        <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <h3 className="text-xs font-bold uppercase tracking-wider text-blue-600 flex items-center gap-1.5">
            <Phone className="w-4 h-4" />
            2. Contact Coordinates & Emergency Proxy
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Primary Phone *
              </label>
              <input
                type="text"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">Residential Address</label>
              <input
                type="text"
                value={residentialAddress}
                onChange={(e) => setResidentialAddress(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">Emergency Contact Name</label>
              <input
                type="text"
                value={emergencyName}
                onChange={(e) => setEmergencyName(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">Relation</label>
              <input
                type="text"
                value={emergencyRelation}
                onChange={(e) => setEmergencyRelation(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">Emergency Phone</label>
              <input
                type="text"
                value={emergencyPhone}
                onChange={(e) => setEmergencyPhone(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
              />
            </div>
          </div>
        </div>

        {/* Section 3: Payer Tariff & Insurance */}
        <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <h3 className="text-xs font-bold uppercase tracking-wider text-blue-600 flex items-center gap-1.5">
            <CreditCard className="w-4 h-4" />
            3. Financial Tariff & Payer Authorization Plan
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">Tariff Class</label>
              <select
                value={tariffPlan}
                onChange={(e) => setTariffPlan(e.target.value as any)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
              >
                <option value="CORPORATE_PPO">Corporate PPO (80% Payer / 20% Co-Pay)</option>
                <option value="SEHAT_CARD_UNIVERSAL">Sehat Sahulat Universal Health Card (100% Free)</option>
                <option value="OUT_OF_POCKET">Private Out-of-Pocket Cash</option>
                <option value="STATE_INSURANCE">State Civil Employee Health Scheme</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">Payer Name</label>
              <input
                type="text"
                value={payerName}
                onChange={(e) => setPayerName(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">Policy / Card #</label>
              <input
                type="text"
                value={policyNumber}
                onChange={(e) => setPolicyNumber(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-mono"
              />
            </div>
          </div>
        </div>

        {/* Section 4: Versioned Consent Engine */}
        <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-blue-600 flex items-center gap-1.5">
              <FileCheck className="w-4 h-4" />
              4. Versioned Informed Consent Engine
            </h3>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500 font-medium">Capture Method:</span>
              <select
                value={consentMethod}
                onChange={(e) => setConsentMethod(e.target.value as any)}
                className="px-2 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold"
              >
                <option value="DIGITAL_SIGNATURE">Digital Signature Pad</option>
                <option value="PAPER_SCANNED">Paper Scanned Document</option>
                <option value="VERBAL_WITNESSED">Verbal Witnessed (Nurse Witnessed)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">General OPD Care (v2.4)</span>
                <input
                  type="checkbox"
                  checked={generalConsentGranted}
                  onChange={(e) => setGeneralConsentGranted(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded"
                />
              </div>
              <p className="text-[11px] text-slate-500">
                Authorizes routine clinical history, non-invasive physical examination, and emergency stabilization.
              </p>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">HIE Data Sharing (v1.2)</span>
                <input
                  type="checkbox"
                  checked={dataSharingGranted}
                  onChange={(e) => setDataSharingGranted(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded"
                />
              </div>
              <p className="text-[11px] text-slate-500">
                Authorizes secure HL7 FHIR laboratory telemetry transmission across regional healthcare networks.
              </p>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-slate-100">Minor Diagnostics (v3.1)</span>
                <input
                  type="checkbox"
                  checked={procedureConsentGranted}
                  onChange={(e) => setProcedureConsentGranted(e.target.checked)}
                  className="w-4 h-4 text-blue-600 rounded"
                />
              </div>
              <p className="text-[11px] text-slate-500">
                Covers venous phlebotomy, diagnostic radiography, and minor dressing applications.
              </p>
            </div>
          </div>
        </div>

        {/* Form Submission Actions */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-3">
          <button
            type="submit"
            className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-xs transition-all cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            Commit Registration & Issue Queue Token
          </button>
        </div>
      </form>
    </div>
  );
}
