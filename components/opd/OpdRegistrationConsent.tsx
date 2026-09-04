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
import { PatientDemographics, ConsentRecord } from '@/types/opd-domain';

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
  const [gender, setGender] = useState<'Male' | 'Female' | 'Other'>(initialData?.gender || 'Female');
  const [dob, setDob] = useState<string>(initialData?.dob || '1990-05-14');
  const [age, setAge] = useState<number>(initialData?.age || 36);
  const [nationalId, setNationalId] = useState<string>(initialData?.nationalId || '');
  const [passportNumber, setPassportNumber] = useState<string>(initialData?.passportNumber || '');
  const [maritalStatus, setMaritalStatus] = useState<'Single' | 'Married' | 'Divorced' | 'Widowed'>('Married');
  const [nationality, setNationality] = useState<string>('Pakistani');
  const [primaryLanguage, setPrimaryLanguage] = useState<string>('English / Urdu');
  const [occupation, setOccupation] = useState<string>('Academic Researcher');

  const [phone, setPhone] = useState<string>(initialData?.phone || '+92 300 8877665');
  const [secondaryPhone, setSecondaryPhone] = useState<string>('');
  const [email, setEmail] = useState<string>('patient@example.org');
  const [residentialAddress, setResidentialAddress] = useState<string>('Sector F-7/2, Islamabad, ICT');

  const [emergencyName, setEmergencyName] = useState<string>('Tariq Vance');
  const [emergencyRelation, setEmergencyRelation] = useState<string>('Spouse');
  const [emergencyPhone, setEmergencyPhone] = useState<string>('+92 321 9988771');

  const [tariffPlan, setTariffPlan] = useState<'OUT_OF_POCKET' | 'CORPORATE_PPO' | 'SEHAT_CARD_UNIVERSAL' | 'STATE_INSURANCE'>('CORPORATE_PPO');
  const [payerName, setPayerName] = useState<string>('Jubilee Life Insurance / PPO');
  const [policyNumber, setPolicyNumber] = useState<string>('POL-992019-JUB');
  const [bloodGroup, setBloodGroup] = useState<'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-' | 'O+' | 'O-'>('O+');
  const [knownAllergies, setKnownAllergies] = useState<string>('Penicillin, NSAIDs');

  // Configurable dynamic consent states
  const [generalConsentGranted, setGeneralConsentGranted] = useState<boolean>(true);
  const [dataSharingGranted, setDataSharingGranted] = useState<boolean>(true);
  const [procedureConsentGranted, setProcedureConsentGranted] = useState<boolean>(true);
  const [consentMethod, setConsentMethod] = useState<'DIGITAL_SIGNATURE' | 'PAPER_SCANNED' | 'VERBAL_WITNESSED'>('DIGITAL_SIGNATURE');

  const handleDobChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDob(val);
    if (val) {
      const birthYear = new Date(val).getFullYear();
      const currentYear = new Date().getFullYear();
      if (!isNaN(birthYear)) {
        setAge(Math.max(0, currentYear - birthYear));
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const mrnGenerated = `MRN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

    const consents: ConsentRecord[] = [
      {
        id: `cst-gen-${Date.now()}`,
        consentType: 'GENERAL_OUTPATIENT',
        title: 'Institutional General Outpatient Care Consent',
        status: generalConsentGranted ? 'GRANTED' : 'WITHHELD',
        version: 'v2.4',
        effectiveDate: new Date().toISOString().slice(0, 10),
        expiryDate: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        method: consentMethod,
        actorName: fullName,
        actorRole: 'Patient / Self',
        witnessName: 'Staff Registrar K. Ahmed',
        documentHash: `SHA256:CONSENT:GEN:${mrnGenerated}`,
      },
      {
        id: `cst-hie-${Date.now()}`,
        consentType: 'DATA_SHARING_HIE',
        title: 'National Health Information Exchange (HIE) Data Sharing Consent',
        status: dataSharingGranted ? 'GRANTED' : 'WITHHELD',
        version: 'v1.2',
        effectiveDate: new Date().toISOString().slice(0, 10),
        expiryDate: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        method: consentMethod,
        actorName: fullName,
        actorRole: 'Patient / Self',
        witnessName: 'Staff Registrar K. Ahmed',
        documentHash: `SHA256:CONSENT:HIE:${mrnGenerated}`,
      },
      {
        id: `cst-proc-${Date.now()}`,
        consentType: 'INVASIVE_PROCEDURE',
        title: 'Minor Outpatient Diagnostics & Procedures Consent',
        status: procedureConsentGranted ? 'GRANTED' : 'WITHHELD',
        version: 'v3.1',
        effectiveDate: new Date().toISOString().slice(0, 10),
        expiryDate: new Date(Date.now() + 180 * 24 * 3600 * 1000).toISOString().slice(0, 10),
        method: consentMethod,
        actorName: fullName,
        actorRole: 'Patient / Self',
        witnessName: 'Staff Registrar K. Ahmed',
        documentHash: `SHA256:CONSENT:PROC:${mrnGenerated}`,
      },
    ];

    const newPatient: PatientDemographics = {
      id: `pat-${Date.now()}`,
      mrn: mrnGenerated,
      fullName,
      preferredName: preferredName || undefined,
      gender,
      dob,
      age,
      nationalId: nationalId || `CNIC-${Math.floor(1000000000000 + Math.random() * 9000000000000)}`,
      passportNumber: passportNumber || undefined,
      maritalStatus,
      nationality,
      primaryLanguage,
      occupation,
      phone,
      secondaryPhone: secondaryPhone || undefined,
      email: email || undefined,
      residentialAddress,
      emergencyContact: {
        name: emergencyName,
        relation: emergencyRelation,
        phone: emergencyPhone,
      },
      tariffPlan,
      insuranceDetails:
        tariffPlan === 'CORPORATE_PPO' || tariffPlan === 'STATE_INSURANCE'
          ? {
              payerName,
              policyNumber,
              coveragePercent: tariffPlan === 'CORPORATE_PPO' ? 80 : 100,
              copayPercent: tariffPlan === 'CORPORATE_PPO' ? 20 : 0,
              expiryDate: '2027-12-31',
            }
          : undefined,
      consents,
      bloodGroup,
      knownAllergies: knownAllergies ? knownAllergies.split(',').map((s) => s.trim()) : [],
      chronicConditions: ['Hypertension'],
      createdAt: Date.now(),
      registeredBy: 'Registrar K. Ahmed (Counter 1)',
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
