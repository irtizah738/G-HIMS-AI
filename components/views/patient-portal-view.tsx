'use client';

import React, { useState } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import { useRBAC } from '@/lib/auth/rbac-context';
import {
  User,
  HeartPulse,
  Pill,
  FlaskConical,
  Receipt,
  Video,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  Download,
  Phone,
  ShieldCheck,
  Sparkles,
  ArrowRight,
  ExternalLink,
  ChevronRight,
  Activity,
  CreditCard,
  Building2,
  Stethoscope,
  Info,
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';

export function PatientPortalView() {
  const { patients, selectedPatientId, setSelectedPatientId, setActiveTab } = useHospital();
  const { currentRole, activePatientId, setRole } = useRBAC();

  // Find patient record (defaults to active patient or p-1001 Elena Rostova)
  const patient = patients.find((p) => p.id === (activePatientId || selectedPatientId || 'p-1001')) || patients[0];
  const [activeSubTab, setActiveSubTab] = useState<'overview' | 'prescriptions' | 'labs' | 'appointments' | 'billing'>('overview');
  const [refillSuccess, setRefillSuccess] = useState<string | null>(null);
  const [paymentSuccess, setPaymentSuccess] = useState<boolean>(false);
  const [isBookingModalOpen, setIsBookingModalOpen] = useState<boolean>(false);
  const [bookingDept, setBookingDept] = useState<string>('Cardiology');
  const [bookingDate, setBookingDate] = useState<string>('2026-09-05');
  const [bookingReason, setBookingReason] = useState<string>('Routine 3-month post-stent follow-up');
  const [bookingToast, setBookingToast] = useState<string | null>(null);

  const handleRequestRefill = (medicationName: string) => {
    setRefillSuccess(`Refill request for ${medicationName} submitted to Dr. Sarah Jenkins (Cardiology). You will receive an SMS confirmation.`);
    setTimeout(() => setRefillSuccess(null), 5000);
  };

  const handlePayInvoice = () => {
    setPaymentSuccess(true);
    setTimeout(() => setPaymentSuccess(false), 5000);
  };

  const handleBookAppointment = (e: React.FormEvent) => {
    e.preventDefault();
    setBookingToast(`Appointment request confirmed with ${bookingDept} for ${bookingDate}. Check-in token will be generated 2 hours prior.`);
    setIsBookingModalOpen(false);
    setTimeout(() => setBookingToast(null), 6000);
  };

  // Mock patient-specific prescriptions
  const prescriptions = [
    {
      id: 'rx-01',
      name: 'Ticagrelor (Brilinta)',
      dosage: '90 mg',
      frequency: 'Twice daily with meals',
      prescriber: 'Dr. Sarah Jenkins, MD',
      startDate: '2026-08-10',
      refillsRemaining: 2,
      status: 'Active',
      indication: 'Post-PCI Secondary Thrombosis Prevention',
    },
    {
      id: 'rx-02',
      name: 'Atorvastatin Calcium (Lipitor)',
      dosage: '80 mg',
      frequency: 'Once daily at bedtime',
      prescriber: 'Dr. Sarah Jenkins, MD',
      startDate: '2026-08-10',
      refillsRemaining: 3,
      status: 'Active',
      indication: 'Hyperlipidemia & Plaque Stabilization',
    },
    {
      id: 'rx-03',
      name: 'Metoprolol Tartrate (Lopressor)',
      dosage: '25 mg',
      frequency: 'Twice daily',
      prescriber: 'Dr. Michael Chen, MD',
      startDate: '2026-08-11',
      refillsRemaining: 1,
      status: 'Active',
      indication: 'Hypertension & Rate Control',
    },
    {
      id: 'rx-04',
      name: 'Metformin HCl',
      dosage: '500 mg',
      frequency: 'Twice daily with breakfast & dinner',
      prescriber: 'Dr. Lisa Wong, MD',
      startDate: '2025-11-15',
      refillsRemaining: 4,
      status: 'Active',
      indication: 'Type 2 Diabetes Mellitus',
    },
  ];

  // Mock patient diagnostic reports
  const labReports = [
    {
      id: 'lab-901',
      testName: 'High-Sensitivity Cardiac Troponin I (hs-cTnI)',
      category: 'Clinical Chemistry',
      orderedBy: 'Dr. Sarah Jenkins, MD',
      date: '2026-08-13',
      result: '0.012 ng/mL',
      referenceRange: '< 0.014 ng/mL',
      status: 'Normal / Optimal',
      isNormal: true,
      notes: 'No ongoing myocardial necrosis. Significant reduction compared to admission baseline.',
    },
    {
      id: 'lab-902',
      testName: 'Comprehensive Lipid Profile (Direct LDL)',
      category: 'Clinical Chemistry',
      orderedBy: 'Dr. Sarah Jenkins, MD',
      date: '2026-08-12',
      result: 'LDL: 64 mg/dL | Total: 138 mg/dL | HDL: 48 mg/dL',
      referenceRange: 'LDL < 70 mg/dL (High-Risk Target)',
      status: 'Target Achieved',
      isNormal: true,
      notes: 'Atorvastatin 80mg therapy is effective. Target LDL < 70 achieved.',
    },
    {
      id: 'lab-903',
      testName: '12-Lead Diagnostic Electrocardiogram (ECG)',
      category: 'Cardiology Diagnostic',
      orderedBy: 'Dr. Sarah Jenkins, MD',
      date: '2026-08-12',
      result: 'Normal Sinus Rhythm, HR 72 bpm',
      referenceRange: 'Sinus Rhythm (60-100 bpm)',
      status: 'Normal Sinus',
      isNormal: true,
      notes: 'Resolution of acute ST-elevations. No acute ischemic changes.',
    },
    {
      id: 'lab-904',
      testName: 'Transthoracic Echocardiogram (2D Echo + Doppler)',
      category: 'Diagnostic Radiology',
      orderedBy: 'Dr. Michael Chen, MD',
      date: '2026-08-11',
      result: 'LVEF: 55% (Preserved Systolic Function)',
      referenceRange: 'LVEF >= 50%',
      status: 'Preserved Ejection Fraction',
      isNormal: true,
      notes: 'Mild hypokinesia of apical anterior segment. Normal valvular hemodynamics.',
    },
  ];

  // Mock patient invoices
  const patientInvoices = [
    {
      id: 'INV-2026-8819',
      date: '2026-08-13',
      encounterId: 'ENC-201',
      description: 'Inpatient Cardiology Ward Care & Diagnostic Monitoring',
      totalAmount: 1840.0,
      insuranceCoverage: 1540.0,
      patientPortion: 300.0,
      amountPaid: 300.0,
      status: 'Paid in Full',
      payer: 'Aetna HMO Gold Premier (#AET-9921)',
    },
    {
      id: 'INV-2026-7910',
      date: '2026-08-10',
      encounterId: 'ENC-189',
      description: 'Emergency Department Trauma Evaluation & Initial 12-Lead ECG',
      totalAmount: 650.0,
      insuranceCoverage: 585.0,
      patientPortion: 65.0,
      amountPaid: 65.0,
      status: 'Paid in Full',
      payer: 'Aetna HMO Gold Premier (#AET-9921)',
    },
    {
      id: 'INV-2026-9044',
      date: '2026-08-20',
      encounterId: 'ENC-205',
      description: 'Outpatient Specialist Consultation & Pharmacy Dispense',
      totalAmount: 230.0,
      insuranceCoverage: 185.0,
      patientPortion: 45.0,
      amountPaid: 0.0,
      status: 'Pending Payment',
      payer: 'Aetna HMO Gold Premier (#AET-9921)',
    },
  ];

  return (
    <div id="patient-portal-container" className="space-y-6 animate-in fade-in duration-200">
      {/* Patient Identity & Welcome Banner */}
      <div className="bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 text-white rounded-3xl p-6 sm:p-8 shadow-xl border border-indigo-500/20 relative overflow-hidden">
        {/* Background Ambient Glow */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex items-start sm:items-center gap-4 sm:gap-5">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-tr from-indigo-500 to-blue-400 text-white flex items-center justify-center font-bold text-2xl sm:text-3xl shadow-lg border-2 border-white/20 shrink-0">
              {patient.fullName.charAt(0)}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Verified Patient Portal (ABAC Protected)
                </span>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-white/10 text-slate-300 border border-white/10">
                  MRN: {patient.mrn}
                </span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                {patient.fullName}
              </h1>
              <p className="text-sm text-indigo-200 mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
                <span>{patient.age} years old ({patient.gender})</span>
                <span>Blood Type: <strong className="text-white font-mono">{patient.bloodGroup}</strong></span>
                <span>Primary Cardiologist: <strong className="text-white">Dr. Sarah Jenkins, MD</strong></span>
              </p>
            </div>
          </div>

          {/* Quick Action CTAs */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              id="btn-patient-book-consult"
              onClick={() => setIsBookingModalOpen(true)}
              className="px-4 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white font-semibold text-xs transition-all shadow-md shadow-blue-500/20 flex items-center gap-2 cursor-pointer"
            >
              <Calendar className="w-4 h-4" />
              <span>Book Appointment</span>
            </button>

            <button
              id="btn-patient-join-telehealth"
              onClick={() => setActiveTab('telehealth')}
              className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-xs border border-white/20 transition-all flex items-center gap-2 cursor-pointer"
            >
              <Video className="w-4 h-4 text-emerald-400" />
              <span>Join Telehealth Visit</span>
            </button>
          </div>
        </div>

        {/* Vital Health Metric Strip */}
        <div className="mt-6 pt-6 border-t border-white/10 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white/5 rounded-2xl p-3 border border-white/10">
            <span className="text-[11px] text-slate-300 block font-medium">Latest Blood Pressure</span>
            <span className="text-lg font-bold text-white font-mono mt-0.5 block">120 / 80 mmHg</span>
            <span className="text-[10px] text-emerald-400 font-semibold">Normal / In-Range</span>
          </div>

          <div className="bg-white/5 rounded-2xl p-3 border border-white/10">
            <span className="text-[11px] text-slate-300 block font-medium">Heart Rate</span>
            <span className="text-lg font-bold text-white font-mono mt-0.5 block">72 bpm</span>
            <span className="text-[10px] text-emerald-400 font-semibold">Regular Sinus</span>
          </div>

          <div className="bg-white/5 rounded-2xl p-3 border border-white/10">
            <span className="text-[11px] text-slate-300 block font-medium">Oxygen Saturation</span>
            <span className="text-lg font-bold text-white font-mono mt-0.5 block">98% SpO2</span>
            <span className="text-[10px] text-emerald-400 font-semibold">Room Air</span>
          </div>

          <div className="bg-white/5 rounded-2xl p-3 border border-white/10">
            <span className="text-[11px] text-slate-300 block font-medium">Next Follow-Up</span>
            <span className="text-lg font-bold text-white mt-0.5 block">Sep 05, 2026</span>
            <span className="text-[10px] text-indigo-300 font-semibold">Cardiology Clinic 4B</span>
          </div>
        </div>
      </div>

      {/* Notifications / Toast alerts */}
      {refillSuccess && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-3 animate-in fade-in duration-150">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-semibold">{refillSuccess}</span>
        </div>
      )}

      {bookingToast && (
        <div className="p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200 text-xs flex items-center gap-3 animate-in fade-in duration-150">
          <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0" />
          <span className="font-semibold">{bookingToast}</span>
        </div>
      )}

      {paymentSuccess && (
        <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs flex items-center gap-3 animate-in fade-in duration-150">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span className="font-semibold">Payment of $45.00 successfully processed via Payer Instant Gateway. Itemized receipt sent to your email.</span>
        </div>
      )}

      {/* Navigation Sub-Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
        <button
          id="tab-patient-overview"
          onClick={() => setActiveSubTab('overview')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            activeSubTab === 'overview'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
          }`}
        >
          <HeartPulse className="w-4 h-4" />
          <span>Health Summary & Allergies</span>
        </button>

        <button
          id="tab-patient-prescriptions"
          onClick={() => setActiveSubTab('prescriptions')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            activeSubTab === 'prescriptions'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
          }`}
        >
          <Pill className="w-4 h-4" />
          <span>My Prescriptions ({prescriptions.length})</span>
        </button>

        <button
          id="tab-patient-labs"
          onClick={() => setActiveSubTab('labs')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            activeSubTab === 'labs'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
          }`}
        >
          <FlaskConical className="w-4 h-4" />
          <span>Lab & Diagnostic Reports ({labReports.length})</span>
        </button>

        <button
          id="tab-patient-appointments"
          onClick={() => setActiveSubTab('appointments')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            activeSubTab === 'appointments'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Appointments & Telehealth</span>
        </button>

        <button
          id="tab-patient-billing"
          onClick={() => setActiveSubTab('billing')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
            activeSubTab === 'billing'
              ? 'bg-blue-600 text-white shadow-xs'
              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-800'
          }`}
        >
          <Receipt className="w-4 h-4" />
          <span>Invoices & Insurance ({patientInvoices.length})</span>
        </button>
      </div>

      {/* Sub-Tab 1: Health Summary & Allergies */}
      {activeSubTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            {/* Chronic Conditions & Clinical Care Plan */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    Active Clinical Care Plan & Diagnoses
                  </h3>
                </div>
                <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800">
                  Plan Active
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200/80 dark:border-slate-800">
                  <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Primary Diagnosis</span>
                  <p className="text-xs font-bold text-slate-900 dark:text-slate-100 mt-1">
                    Post-PCI Angina Pectoris (ICD-10 I20.9)
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    Stent placed in proximal LAD on 2026-08-10. Dual antiplatelet therapy (DAPT) protocol initiated.
                  </p>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200/80 dark:border-slate-800">
                  <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Secondary Chronic Condition</span>
                  <p className="text-xs font-bold text-slate-900 dark:text-slate-100 mt-1">
                    Essential Hypertension (ICD-10 I10)
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                    Monitored with home BP log. Target BP &lt; 130/80 mmHg maintained with Metoprolol.
                  </p>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-blue-50/60 dark:bg-blue-950/30 border border-blue-100 dark:border-blue-900/40 flex items-start gap-3">
                <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                <div className="text-xs text-blue-900 dark:text-blue-200 leading-relaxed">
                  <strong>Patient Instructions from Dr. Sarah Jenkins:</strong> Continue low-sodium Mediterranean diet. Walk 20 minutes daily. Do not discontinue Ticagrelor without consulting your cardiologist.
                </div>
              </div>
            </div>

            {/* Allergies & Adverse Reactions */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-rose-500" />
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Documented Allergies & Drug Sensitivities
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-xs text-rose-900 dark:text-rose-200 block">Penicillin</span>
                    <span className="text-[10px] text-rose-600 dark:text-rose-400">Reaction: Severe Urticaria / Hives</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-200 dark:bg-rose-900 text-rose-800 dark:text-rose-200">
                    High Risk
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-xs text-rose-900 dark:text-rose-200 block">Sulfa Drugs</span>
                    <span className="text-[10px] text-rose-600 dark:text-rose-400">Reaction: Moderate Dermatitis</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-200 dark:bg-rose-900 text-rose-800 dark:text-rose-200">
                    Moderate
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column: Contact & Emergency Information */}
          <div className="space-y-6">
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <User className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <span>Personal & Emergency Info</span>
              </h3>

              <div className="space-y-3 text-xs">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Emergency Contact</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200 mt-0.5 block">Dmitri Rostov (Spouse)</span>
                  <span className="text-slate-500 dark:text-slate-400 font-mono text-[11px]">+1 (555) 987-6543</span>
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Registered Email</span>
                  <span className="font-medium text-slate-700 dark:text-slate-300 font-mono text-[11px]">{patient.email}</span>
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Home Address</span>
                  <span className="text-slate-700 dark:text-slate-300 text-[11px]">{patient.address}</span>
                </div>

                <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Insurance Policy</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200 block">Aetna HMO Gold Premier</span>
                  <span className="text-slate-500 dark:text-slate-400 font-mono text-[10px]">Policy #AET-99210-GH</span>
                </div>
              </div>
            </div>

            {/* Export EHR Record */}
            <div className="bg-slate-50 dark:bg-slate-850 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 text-center space-y-2">
              <FileText className="w-6 h-6 text-blue-600 dark:text-blue-400 mx-auto" />
              <h4 className="font-bold text-xs text-slate-900 dark:text-slate-100">Longitudinal Health Record</h4>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Download your complete clinical history in standard FHIR R4 JSON format.
              </p>
              <button
                onClick={() => {
                  const blob = new Blob([JSON.stringify(patient, null, 2)], { type: 'application/json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `FHIR-EHR-${patient.mrn}.json`;
                  a.click();
                }}
                className="w-full py-2 rounded-xl bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 font-bold text-xs flex items-center justify-center gap-2 cursor-pointer transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export FHIR R4 Record</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-Tab 2: Prescriptions */}
      {activeSubTab === 'prescriptions' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
              Active Prescriptions & Medications
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Prescribed by Central Metro General Hospital Medical Staff
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {prescriptions.map((rx) => (
              <div
                key={rx.id}
                className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col justify-between space-y-4 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
              >
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center font-bold text-xs shrink-0">
                        <Pill className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="font-bold text-xs text-slate-900 dark:text-slate-100">{rx.name}</h4>
                        <span className="text-[11px] font-mono text-blue-600 dark:text-blue-400 font-semibold">{rx.dosage}</span>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                      {rx.status}
                    </span>
                  </div>

                  <div className="mt-3 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
                    <p><strong className="text-slate-800 dark:text-slate-200">Directions:</strong> {rx.frequency}</p>
                    <p><strong className="text-slate-800 dark:text-slate-200">Indication:</strong> {rx.indication}</p>
                    <p className="text-[11px] text-slate-400"><strong className="text-slate-500">Prescriber:</strong> {rx.prescriber}</p>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                  <span className="text-[11px] text-slate-500 font-medium">
                    Refills Remaining: <strong className="text-slate-800 dark:text-slate-200 font-bold">{rx.refillsRemaining}</strong>
                  </span>
                  <button
                    onClick={() => handleRequestRefill(rx.name)}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors cursor-pointer"
                  >
                    Request Refill
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sub-Tab 3: Diagnostic Lab & Radiology Reports */}
      {activeSubTab === 'labs' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
              Laboratory & Diagnostic Imaging Reports
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Reviewed & Authenticated by Laboratory Directors
            </span>
          </div>

          <div className="space-y-3">
            {labReports.map((lab) => (
              <div
                key={lab.id}
                className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <FlaskConical className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <h4 className="font-bold text-xs text-slate-900 dark:text-slate-100">{lab.testName}</h4>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                      {lab.category}
                    </span>
                  </div>
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                    Result: <strong className="text-blue-600 dark:text-blue-400 font-mono">{lab.result}</strong> (Ref: {lab.referenceRange})
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">{lab.notes}</p>
                </div>

                <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0">
                  <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800">
                    {lab.status}
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">{lab.date}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sub-Tab 4: Appointments & Telehealth Visits */}
      {activeSubTab === 'appointments' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
              Scheduled Appointments & Telehealth Encounters
            </h3>
            <button
              onClick={() => setIsBookingModalOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Book New Visit</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">Upcoming Outpatient Visit</span>
                  <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 mt-1">
                    Cardiology Post-PCI Follow-Up
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Dr. Sarah Jenkins, MD | Outpatient Suite 204
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-blue-50 dark:bg-blue-950 text-blue-600 dark:text-blue-400 font-mono text-xs font-bold">
                  Sep 05, 10:30 AM
                </span>
              </div>

              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-850 text-xs text-slate-600 dark:text-slate-300">
                Please bring your current blood pressure log and complete 12-hour fasting prior to scheduled lipid blood draw.
              </div>

              <div className="pt-2 flex items-center justify-between">
                <span className="text-[11px] text-slate-400 font-mono">Token: OPD-CAR-044</span>
                <button
                  onClick={() => setActiveTab('opd')}
                  className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
                >
                  <span>View Clinic Queue</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
              <div className="flex items-start justify-between">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Virtual Care</span>
                  <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100 mt-1">
                    Telehealth Follow-Up Consultation
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Dr. Sarah Jenkins, MD | HD Video Bridge
                  </p>
                </div>
                <span className="px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400 font-mono text-xs font-bold">
                  Available Now
                </span>
              </div>

              <div className="p-3 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/30 text-xs text-emerald-800 dark:text-emerald-200">
                Direct WebRTC consultation link is active. Connect with video or chat directly from your device.
              </div>

              <div className="pt-2 flex items-center justify-between">
                <span className="text-[11px] text-slate-400 font-mono">Enc: TEL-2026-11</span>
                <button
                  onClick={() => setActiveTab('telehealth')}
                  className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Video className="w-3.5 h-3.5" />
                  <span>Launch Telehealth Call</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sub-Tab 5: Invoices, Insurance & Billing */}
      {activeSubTab === 'billing' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
              Hospital Invoices & Co-Pay Statements
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Payer: Aetna HMO Gold Premier (#AET-9921)
            </span>
          </div>

          <div className="space-y-3">
            {patientInvoices.map((inv) => (
              <div
                key={inv.id}
                className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold font-mono text-xs text-slate-900 dark:text-slate-100">{inv.id}</span>
                    <span className="text-[10px] text-slate-400 font-mono">({inv.date})</span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        inv.status === 'Paid in Full'
                          ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                          : 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
                      }`}
                    >
                      {inv.status}
                    </span>
                  </div>
                  <h4 className="font-semibold text-xs text-slate-800 dark:text-slate-200">{inv.description}</h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Total: {formatCurrency(inv.totalAmount)} | Covered by Insurance: {formatCurrency(inv.insuranceCoverage)} | Your Co-pay: <strong>{formatCurrency(inv.patientPortion)}</strong>
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {inv.status === 'Pending Payment' ? (
                    <button
                      onClick={handlePayInvoice}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      <span>Pay {formatCurrency(inv.patientPortion)} Online</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => alert(`Downloading Receipt for Invoice ${inv.id}`)}
                      className="px-3.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 font-semibold text-xs transition-colors flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download Receipt</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Appointment Booking Modal */}
      {isBookingModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150"
          onClick={() => setIsBookingModalOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-600" />
                <span>Book Clinic Appointment</span>
              </h3>
              <button
                onClick={() => setIsBookingModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleBookAppointment} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Department / Specialty
                </label>
                <select
                  value={bookingDept}
                  onChange={(e) => setBookingDept(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-medium"
                >
                  <option value="Cardiology">Cardiology & Post-PCI Care (Dr. Sarah Jenkins)</option>
                  <option value="General OPD">General Internal Medicine (Dr. Michael Chen)</option>
                  <option value="Endocrinology">Endocrinology & Diabetes (Dr. Lisa Wong)</option>
                  <option value="Pulmonology">Pulmonology & Respiratory (Dr. David Rodriguez)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Preferred Appointment Date
                </label>
                <input
                  type="date"
                  value={bookingDate}
                  onChange={(e) => setBookingDate(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-medium"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Reason for Visit / Symptoms
                </label>
                <textarea
                  rows={3}
                  value={bookingReason}
                  onChange={(e) => setBookingReason(e.target.value)}
                  placeholder="Describe your current symptoms or reason for visit..."
                  className="w-full p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-medium"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsBookingModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold transition-colors cursor-pointer"
                >
                  Confirm Appointment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
