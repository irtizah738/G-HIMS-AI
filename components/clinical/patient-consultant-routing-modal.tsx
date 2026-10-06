'use client';

import React, { useEffect, useState } from 'react';
import {
  Stethoscope,
  UserCheck,
  Zap,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Search,
  Building2,
  PhoneCall,
  Activity,
  HeartPulse,
  Brain,
  Bone,
  Flame,
  ShieldAlert,
  Send,
  X,
  FileCheck,
  Layers,
  Sparkles,
  ArrowRight,
} from 'lucide-react';
import { useHospital } from '@/lib/context/hospital-context';
import { useAuth } from '@/lib/auth/auth-context';
import {
  loadConsultantDirectory,
  requestClinicalConsultation,
} from '@/lib/clinical/intelligence/consultant-worklist-client';
import type { EligibleConsultant } from '@/lib/clinical/intelligence/consultant-directory-service';

const IS_DEMO_RUNTIME = process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE === 'DEMO';

export interface ConsultantDoctor {
  id: string;
  name: string;
  title: string;
  department: string;
  subSpecialty: string;
  badge: string;
  status:
    | 'ON_DUTY_AVAILABLE'
    | 'IN_PROCEDURE'
    | 'ON_CALL_PAGER'
    | 'OFF_DUTY'
    | 'AVAILABILITY_UNKNOWN';
  currentQueueCount: number;
  assignedBayOrRoom: string;
  contactExtension: string;
  qualifications: string;
  avgReviewTimeMinutes: number;
  matchScore?: number;
}

export const DEMO_CONSULTANT_REGISTRY: ConsultantDoctor[] = [
  {
    id: 'doc-card-01',
    name: 'Dr. Sarah Jenkins, MD, FACC',
    title: 'Consultant Interventional Cardiologist',
    department: 'Cardiovascular Institute',
    subSpecialty: 'Coronary Angioplasty & Structural Heart',
    badge: 'Cath Lab Lead',
    status: 'ON_DUTY_AVAILABLE',
    currentQueueCount: 1,
    assignedBayOrRoom: 'Cath Lab Suite 01 / Bay 4',
    contactExtension: 'Ext. 4401',
    qualifications: 'MD (Johns Hopkins), Fellowship (Cleveland Clinic)',
    avgReviewTimeMinutes: 8,
  },
  {
    id: 'doc-card-02',
    name: 'Dr. Kamran Baig, MD, FHRS',
    title: 'Consultant Cardiac Electrophysiologist',
    department: 'Cardiovascular Institute',
    subSpecialty: 'Arrhythmias & Device Implantation',
    badge: 'EP Lab On-Duty',
    status: 'ON_DUTY_AVAILABLE',
    currentQueueCount: 2,
    assignedBayOrRoom: 'OPD Suite 204',
    contactExtension: 'Ext. 4402',
    qualifications: 'MD (Oxford), Board Certified Cardiology',
    avgReviewTimeMinutes: 12,
  },
  {
    id: 'doc-neuro-01',
    name: 'Dr. Michael Chen, MD, PhD',
    title: 'Consultant Neuro-Interventionist & Stroke Neurologist',
    department: 'Neurosciences & Stroke Institute',
    subSpecialty: 'Acute Stroke, LVO Thrombectomy & Aneurysms',
    badge: 'Code Stroke Lead',
    status: 'ON_DUTY_AVAILABLE',
    currentQueueCount: 0,
    assignedBayOrRoom: 'Neuro-ICU / CT Angio Suite',
    contactExtension: 'Ext. 5501',
    qualifications: 'MD (Harvard), Neurovascular Fellowship (UCSF)',
    avgReviewTimeMinutes: 6,
  },
  {
    id: 'doc-neuro-02',
    name: 'Dr. Aisha Al-Nuaimi, MD',
    title: 'Consultant Clinical Neurologist',
    department: 'Neurosciences & Stroke Institute',
    subSpecialty: 'Epilepsy, Neuro-Immunology & Movement Disorders',
    badge: 'EEG Lab Director',
    status: 'IN_PROCEDURE',
    currentQueueCount: 3,
    assignedBayOrRoom: 'Neuro OPD Bay 3',
    contactExtension: 'Ext. 5504',
    qualifications: 'MBBS, FRCP (UK), FAAN',
    avgReviewTimeMinutes: 20,
  },
  {
    id: 'doc-ortho-01',
    name: 'Dr. David Rodriguez, MD, FAAOS',
    title: 'Consultant Orthopedic Trauma Surgeon',
    department: 'Orthopedic & Trauma Surgery',
    subSpecialty: 'Complex Polytrauma & Open Fractures',
    badge: 'Trauma Alpha Attending',
    status: 'ON_DUTY_AVAILABLE',
    currentQueueCount: 1,
    assignedBayOrRoom: 'Trauma OR 02 / Bay T-1',
    contactExtension: 'Ext. 6601',
    qualifications: 'MD (Columbia), AO Trauma Fellowship (Bern)',
    avgReviewTimeMinutes: 10,
  },
  {
    id: 'doc-endo-01',
    name: 'Dr. Lisa Wong, MD, FACE',
    title: 'Consultant Endocrinologist & Diabetologist',
    department: 'Internal Medicine & Endocrinology',
    subSpecialty: 'DKA/HHS Protocols, Insulin Pumps & Thyroid',
    badge: 'Metabolic Triage Lead',
    status: 'ON_DUTY_AVAILABLE',
    currentQueueCount: 2,
    assignedBayOrRoom: 'Metabolic Suite 108',
    contactExtension: 'Ext. 3302',
    qualifications: 'MD (Yale), Board Certified Endo & Metabolism',
    avgReviewTimeMinutes: 15,
  },
  {
    id: 'doc-obgyn-01',
    name: 'Dr. Fatima Zahra, MD, FACOG',
    title: 'Consultant Maternal-Fetal Medicine & High-Risk Obstetrics',
    department: 'Obstetrics & Gynecology (OB/GYN)',
    subSpecialty: 'High-Risk Pregnancy, Preeclampsia, Fetal Ultrasound & Labor Ward Care',
    badge: 'Maternal-Fetal Medicine Lead',
    status: 'ON_DUTY_AVAILABLE',
    currentQueueCount: 1,
    assignedBayOrRoom: 'L&D Suite 301 / Antenatal Care',
    contactExtension: 'Ext. 7701',
    qualifications: 'MD (Imperial College London), MFM Fellowship (King’s Health)',
    avgReviewTimeMinutes: 8,
  },
  {
    id: 'doc-obgyn-02',
    name: 'Dr. Evelyn Vance, MD, FACOG, FACS',
    title: 'Consultant Gynecologic Surgeon & Urogynecology',
    department: 'Obstetrics & Gynecology (OB/GYN)',
    subSpecialty: 'Minimally Invasive Laparoscopy, Robotic Myomectomy & Pelvic Reconstruction',
    badge: 'Gynecologic Surgery Lead',
    status: 'ON_DUTY_AVAILABLE',
    currentQueueCount: 2,
    assignedBayOrRoom: 'Gyn Pavilion Suite 303',
    contactExtension: 'Ext. 7702',
    qualifications: 'MD (Columbia), Advanced Pelvic Surgery Fellowship',
    avgReviewTimeMinutes: 12,
  },
  {
    id: 'doc-obgyn-03',
    name: 'Dr. Layla Mansour, MD, MRCOG',
    title: 'Consultant Obstetrician & Reproductive Medicine',
    department: 'Obstetrics & Gynecology (OB/GYN)',
    subSpecialty: 'Antenatal Triage, Gestational Diabetes, Infertility & Delivery Suites',
    badge: 'L&D Delivery Attending',
    status: 'ON_DUTY_AVAILABLE',
    currentQueueCount: 1,
    assignedBayOrRoom: 'Labor & Delivery Suite 302',
    contactExtension: 'Ext. 7703',
    qualifications: 'MBBS, MRCOG (UK), Reproductive Endocrinology Fellowship',
    avgReviewTimeMinutes: 10,
  },
  {
    id: 'doc-icu-01',
    name: 'Dr. Marcus Vance, MD, FCCM',
    title: 'Chief Critical Care Intensivist',
    department: 'Critical Care & Resuscitation',
    subSpecialty: 'Septic Shock, ARDS & ECMO Management',
    badge: 'ICU Medical Director',
    status: 'ON_DUTY_AVAILABLE',
    currentQueueCount: 2,
    assignedBayOrRoom: 'Main Medical ICU (Bed 101-112)',
    contactExtension: 'Ext. 9901',
    qualifications: 'MD (Penn Medicine), Critical Care Fellowship',
    avgReviewTimeMinutes: 5,
  },
  {
    id: 'doc-onco-01',
    name: 'Dr. Tariq Mansoor, MD, FACP',
    title: 'Consultant Medical Oncologist & Hematologist',
    department: 'Oncology & Infusion Center',
    subSpecialty: 'Solid Tumors, Chemotherapy Regimens & Immunotherapy',
    badge: 'Tumor Board Chair',
    status: 'ON_DUTY_AVAILABLE',
    currentQueueCount: 1,
    assignedBayOrRoom: 'Infusion Suite 401',
    contactExtension: 'Ext. 8801',
    qualifications: 'MD (MD Anderson), Fellowship (Memorial Sloan Kettering)',
    avgReviewTimeMinutes: 18,
  },
  {
    id: 'doc-peds-01',
    name: 'Dr. Zainab Qureshi, MD, FAAP',
    title: 'Consultant Pediatrician & Neonatologist',
    department: 'Pediatrics & Child Health',
    subSpecialty: 'Neonatal Critical Care & Pediatric Emergencies',
    badge: 'NICU Attending',
    status: 'ON_DUTY_AVAILABLE',
    currentQueueCount: 2,
    assignedBayOrRoom: 'Pediatric Ward Suite 402',
    contactExtension: 'Ext. 6602',
    qualifications: 'MD (Boston Children’s), FAAP',
    avgReviewTimeMinutes: 12,
  },
  {
    id: 'doc-gi-01',
    name: 'Dr. Faisal Hayat, MD, FACG',
    title: 'Consultant Gastroenterologist & Hepatologist',
    department: 'Gastroenterology & Endoscopy',
    subSpecialty: 'GI Bleed, ERCP, Endoscopic Hemostasis & Liver Cirrhosis',
    badge: 'Endoscopy Lead',
    status: 'ON_DUTY_AVAILABLE',
    currentQueueCount: 1,
    assignedBayOrRoom: 'Endoscopy Suite 201',
    contactExtension: 'Ext. 3305',
    qualifications: 'MD (Mayo Clinic), Advanced Endoscopy Fellowship',
    avgReviewTimeMinutes: 14,
  },
  {
    id: 'doc-rad-01',
    name: 'Dr. Liam Reynolds, MD, FSIR',
    title: 'Consultant Interventional Radiologist',
    department: 'Diagnostic & Interventional Radiology',
    subSpecialty: 'Vascular Embolization, CT Biopsy & Fluoroscopy',
    badge: 'PACS & IR Lead',
    status: 'ON_DUTY_AVAILABLE',
    currentQueueCount: 0,
    assignedBayOrRoom: 'IR Angio Suite 102',
    contactExtension: 'Ext. 4491',
    qualifications: 'MD (Johns Hopkins), Vascular & IR Fellowship',
    avgReviewTimeMinutes: 7,
  },
  {
    id: 'doc-anes-01',
    name: 'Dr. Ananya Sharma, MD, FASA',
    title: 'Consultant Anesthesiologist & Perioperative Lead',
    department: 'Anesthesiology & Surgical Services',
    subSpecialty: 'Cardiothoracic & Trauma Anesthesia, Acute Pain Management',
    badge: 'OR Theater Director',
    status: 'ON_DUTY_AVAILABLE',
    currentQueueCount: 1,
    assignedBayOrRoom: 'Main Operating Pavilion',
    contactExtension: 'Ext. 9923',
    qualifications: 'MD (Stanford), Perioperative Medicine Fellowship',
    avgReviewTimeMinutes: 6,
  },
];

interface PatientConsultantRoutingModalProps {
  isOpen: boolean;
  onClose: () => void;
  patientId?: string;
  encounterId?: string;
  patientName?: string;
  mrn?: string;
  chiefComplaint?: string;
  triageCategory?: string;
  currentAttending?: string;
  initialClinicalQuestion?: string;
  onRoutedSuccess?: (consultant: ConsultantDoctor, routingDetails: any) => void;
}

export function PatientConsultantRoutingModal({
  isOpen,
  onClose,
  patientId,
  encounterId,
  patientName = IS_DEMO_RUNTIME ? 'Elena Rostova' : '',
  mrn = IS_DEMO_RUNTIME ? 'GH-DEMO-2026-9812' : '',
  chiefComplaint = IS_DEMO_RUNTIME
    ? 'Acute retrosternal chest pain radiating to jaw, diaphoresis'
    : '',
  triageCategory = IS_DEMO_RUNTIME
    ? 'Cardiology / Acute Coronary Syndrome'
    : '',
  currentAttending = IS_DEMO_RUNTIME
    ? 'Triage Officer / Emergency MO'
    : '',
  initialClinicalQuestion = '',
  onRoutedSuccess,
}: PatientConsultantRoutingModalProps) {
  const { addClinicalNote } = useHospital();
  const auth = useAuth();
  const tenantId = String(auth.activeTenant?.tenantId || auth.user?.tenantId || '').trim();

  const [consultants, setConsultants] = useState<ConsultantDoctor[]>(() =>
    IS_DEMO_RUNTIME ? DEMO_CONSULTANT_REGISTRY : []
  );
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedDoctorId, setSelectedDoctorId] = useState<string>(() =>
    IS_DEMO_RUNTIME ? 'doc-card-01' : ''
  );
  const [routingUrgency, setRoutingUrgency] =
    useState<'STAT' | 'URGENT' | 'PRIORITY' | 'ROUTINE'>('ROUTINE');
  const [assignedRoom, setAssignedRoom] = useState<string>('');
  const [clinicalHandoffNote, setClinicalHandoffNote] =
    useState<string>(initialClinicalQuestion);

  const [isDispatching, setIsDispatching] = useState<boolean>(false);
  const [dispatchedConfirmation, setDispatchedConfirmation] = useState<any | null>(null);

  useEffect(() => {
    if (isOpen) {
      setClinicalHandoffNote(initialClinicalQuestion);
      setDispatchedConfirmation(null);
      setDirectoryError(null);
    }
  }, [isOpen, initialClinicalQuestion]);

  useEffect(() => {
    if (!isOpen || IS_DEMO_RUNTIME) return;
    if (!tenantId) {
      setConsultants([]);
      setDirectoryError('No active tenant context is available for consultant routing.');
      return;
    }

    let cancelled = false;
    setDirectoryError(null);
    void loadConsultantDirectory(tenantId)
      .then((directory) => {
        if (cancelled) return;
        const mapped: ConsultantDoctor[] = directory.map((consultant: EligibleConsultant) => ({
          id: consultant.consultantId,
          name: consultant.displayName,
          title: consultant.positionTitle,
          department: consultant.departmentName || consultant.departmentId,
          subSpecialty:
            [consultant.specialty, ...consultant.subSpecialties].filter(Boolean).join(' • ') ||
            consultant.departmentName,
          badge: consultant.credentialVerified ? 'Credential Verified' : 'Credential Required',
          status:
            consultant.availability === 'ON_DUTY'
              ? 'ON_DUTY_AVAILABLE'
              : consultant.availability === 'ON_CALL'
                ? 'ON_CALL_PAGER'
                : consultant.availability === 'OFF_DUTY'
                  ? 'OFF_DUTY'
                  : 'AVAILABILITY_UNKNOWN',
          currentQueueCount: -1,
          assignedBayOrRoom: consultant.departmentName || consultant.departmentId,
          contactExtension: '',
          qualifications: 'Verified HCM credential and active clinical privilege',
          avgReviewTimeMinutes: 0,
        }));
        setConsultants(mapped);
        setSelectedDoctorId((current) =>
          mapped.some((item) => item.id === current) ? current : ''
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setConsultants([]);
        setDirectoryError(
          error instanceof Error ? error.message : 'Consultant directory could not be loaded.'
        );
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, tenantId]);

  if (!isOpen) return null;

  // Compute AI Recommended Match
  const getAiRecommendedDoctorId = (): string => {
    const text = (chiefComplaint + ' ' + triageCategory).toLowerCase();
    if (text.includes('arrhythmia') || text.includes('ep') || text.includes('tachycardia') || text.includes('svt') || text.includes('fibrillation')) {
      return 'doc-card-02';
    }
    if (text.includes('chest') || text.includes('stemi') || text.includes('cardiac') || text.includes('heart') || text.includes('angina')) {
      return 'doc-card-01';
    }
    if (text.includes('stroke') || text.includes('lvo') || text.includes('thrombectomy') || text.includes('paralysis') || text.includes('hemiparesis')) {
      return 'doc-neuro-01';
    }
    if (text.includes('seizure') || text.includes('epilepsy') || text.includes('eeg') || text.includes('neuropathy')) {
      return 'doc-neuro-02';
    }
    if (text.includes('fracture') || text.includes('trauma') || text.includes('bone') || text.includes('fall') || text.includes('ortho')) {
      return 'doc-ortho-01';
    }
    if (text.includes('diabet') || text.includes('dka') || text.includes('sugar') || text.includes('glucose') || text.includes('thyroid')) {
      return 'doc-endo-01';
    }
    if (
      text.includes('pregnan') ||
      text.includes('obstetric') ||
      text.includes('gynec') ||
      text.includes('ob/gyn') ||
      text.includes('obgyn') ||
      text.includes('labor') ||
      text.includes('preeclampsia') ||
      text.includes('fetal') ||
      text.includes('fetus') ||
      text.includes('antenatal') ||
      text.includes('postpartum') ||
      text.includes('c-section') ||
      text.includes('cesarean') ||
      text.includes('cervix') ||
      text.includes('uterine') ||
      text.includes('ovarian') ||
      text.includes('myomectomy') ||
      text.includes('gestation') ||
      text.includes('maternity')
    ) {
      if (text.includes('myomectomy') || text.includes('pelvic') || text.includes('laparoscop') || text.includes('fibroid')) {
        return 'doc-obgyn-02';
      }
      if (text.includes('ultrasound') || text.includes('infertility') || text.includes('first trimester')) {
        return 'doc-obgyn-03';
      }
      return 'doc-obgyn-01';
    }
    if (text.includes('cancer') || text.includes('tumor') || text.includes('chemo') || text.includes('onco') || text.includes('lymphoma')) {
      return 'doc-onco-01';
    }
    if (text.includes('pediatric') || text.includes('child') || text.includes('infant') || text.includes('nicu') || text.includes('baby')) {
      return 'doc-peds-01';
    }
    if (text.includes('gi bleed') || text.includes('gastric') || text.includes('liver') || text.includes('endoscopy') || text.includes('cirrhosis')) {
      return 'doc-gi-01';
    }
    if (text.includes('radiolog') || text.includes('ct scan') || text.includes('mri') || text.includes('biopsy') || text.includes('x-ray')) {
      return 'doc-rad-01';
    }
    if (text.includes('anesthes') || text.includes('sedation') || text.includes('perioperative') || text.includes('pain')) {
      return 'doc-anes-01';
    }
    if (text.includes('icu') || text.includes('shock') || text.includes('sepsis') || text.includes('ards') || text.includes('ventilator')) {
      return 'doc-icu-01';
    }
    return 'doc-card-01';
  };

  const aiMatchId = getAiRecommendedDoctorId();

  const departmentOptions = [
    'ALL',
    ...Array.from(
      new Set(
        consultants
          .map((doctor) => doctor.department.trim())
          .filter(Boolean)
      )
    ).sort(),
  ];

  const filteredDoctors = consultants.filter((doc) => {
    const matchesDept =
      selectedDepartment === 'ALL' || doc.department === selectedDepartment;
    const q = searchQuery.trim().toLowerCase();
    const matchesSearch =
      !q ||
      doc.name.toLowerCase().includes(q) ||
      doc.subSpecialty.toLowerCase().includes(q) ||
      doc.department.toLowerCase().includes(q) ||
      doc.title.toLowerCase().includes(q) ||
      doc.qualifications.toLowerCase().includes(q);
    return matchesDept && matchesSearch;
  });

  const selectedDoctor = consultants.find((d) => d.id === selectedDoctorId);

  const handleDispatchConsultant = async () => {
    if (!selectedDoctor) {
      setDirectoryError('Select an eligible consultant before routing.');
      return;
    }
    setIsDispatching(true);
    setDirectoryError(null);

    const routingPayload = {
      routedAt: new Date().toISOString(),
      patientId,
      patientName,
      mrn,
      consultant: selectedDoctor,
      urgency: routingUrgency,
      assignedRoom,
      handoffNote: clinicalHandoffNote,
      slaMinutes:
        routingUrgency === 'STAT'
          ? 10
          : routingUrgency === 'URGENT'
            ? 30
            : routingUrgency === 'PRIORITY'
              ? 60
              : undefined,
    };

    try {
      if (IS_DEMO_RUNTIME) {
        if (patientId) {
          addClinicalNote(patientId, {
            author: 'DEMO Specialist Routing',
            role: 'DEMO_ONLY',
            category: 'Consultation',
            content: `DEMO CONSULTATION ROUTED: ${selectedDoctor.name} — ${clinicalHandoffNote}`,
          });
        }
      } else {
        if (!tenantId || !patientId || !encounterId) {
          throw new Error(
            'Authoritative consultant routing requires tenant, patient and encounter identity.'
          );
        }
        await requestClinicalConsultation(tenantId, {
          patientId,
          encounterId,
          requestedSpecialty: selectedDoctor.subSpecialty || selectedDoctor.department,
          requestedConsultantId: selectedDoctor.id,
          clinicalQuestion:
            clinicalHandoffNote.trim() ||
            `${chiefComplaint}. Specialist review requested from ${selectedDoctor.department}.`,
          priority:
            routingUrgency === 'STAT'
              ? 'STAT'
              : routingUrgency === 'URGENT' || routingUrgency === 'PRIORITY'
                ? 'URGENT'
                : 'ROUTINE',
          sourceRefs: [],
        });
      }

      setDispatchedConfirmation(routingPayload);
      if (onRoutedSuccess) onRoutedSuccess(selectedDoctor, routingPayload);
    } catch (error) {
      setDirectoryError(
        error instanceof Error ? error.message : 'Specialist consultation request failed.'
      );
    } finally {
      setIsDispatching(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[92vh] flex flex-col overflow-hidden my-auto">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-400/30 flex items-center justify-center text-blue-400">
              <Stethoscope className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-extrabold tracking-tight">Patient Specialist Routing Engine</h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-500/30 text-blue-300 border border-blue-400/30">
                  CLINICAL CONSULTATION ROUTING
                </span>
              </div>
              <p className="text-xs text-slate-300">
                Route a governed consultation to an HCM-credentialed clinician with explicit urgency and handoff context
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Patient Clinical Context Banner */}
        <div className="px-6 py-3 bg-blue-50/70 border-b border-blue-100 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
          <div className="flex items-center gap-4 flex-wrap">
            <div>
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Patient</span>
              <span className="font-extrabold text-slate-900 text-sm">{patientName}</span>
            </div>
            <div className="border-l border-blue-200 pl-3">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">MRN</span>
              <span className="font-mono font-bold text-slate-800">{mrn}</span>
            </div>
            <div className="border-l border-blue-200 pl-3">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Triage Category</span>
              <span className="font-semibold text-indigo-900">{triageCategory}</span>
            </div>
            <div className="border-l border-blue-200 pl-3">
              <span className="text-[10px] text-slate-500 font-bold uppercase tracking-wider block">Chief Complaint</span>
              <span className="font-medium text-slate-700 max-w-xs truncate block">&ldquo;{chiefComplaint}&rdquo;</span>
            </div>
          </div>
          {IS_DEMO_RUNTIME ? (
            <div className="flex items-center gap-1.5 bg-indigo-100 text-indigo-900 px-3 py-1 rounded-lg font-bold text-[11px]">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              DEMO Auto-Match
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-emerald-100 text-emerald-900 px-3 py-1 rounded-lg font-bold text-[11px]">
              <ShieldAlert className="w-3.5 h-3.5 text-emerald-700" />
              HCM Credentialed Directory
            </div>
          )}
        </div>

        {directoryError && (
          <div className="mx-6 mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-semibold text-rose-800">
            {directoryError}
          </div>
        )}

        {/* Modal Content Body */}
        {dispatchedConfirmation ? (
          <div className="p-8 text-center space-y-6 flex-1 overflow-y-auto">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto ring-8 ring-emerald-50">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            <div className="max-w-md mx-auto space-y-2">
              <h3 className="text-xl font-black text-slate-900 dark:text-slate-100">
                Consultation Request Created
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                A governed consultation request for{' '}
                <strong className="text-slate-900 dark:text-slate-100">
                  {dispatchedConfirmation.patientName}
                </strong>{' '}
                was sent to{' '}
                <strong className="text-blue-700 dark:text-blue-300">
                  {dispatchedConfirmation.consultant.name}
                </strong>.
                This does not create diagnostic or treatment orders.
              </p>
            </div>

            <div className="max-w-lg mx-auto bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl p-5 text-left text-xs space-y-3">
              <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                <span className="text-slate-500 font-semibold">Assigned Specialist:</span>
                <span className="font-bold text-slate-900">{dispatchedConfirmation.consultant.name}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-slate-200">
                <span className="text-slate-500 font-semibold">Specialty / Department:</span>
                <span className="font-bold text-indigo-700">{dispatchedConfirmation.consultant.department}</span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-slate-700">
                <span className="text-slate-500 font-semibold">Consultant Location:</span>
                <span className="font-bold text-slate-900 dark:text-slate-100">
                  {dispatchedConfirmation.assignedRoom || 'Not specified in HCM directory'}
                </span>
              </div>
              <div className="flex justify-between items-center pb-2 border-b border-slate-200 dark:border-slate-700">
                <span className="text-slate-500 font-semibold">Requested Priority:</span>
                <span className="px-2 py-0.5 rounded font-black text-[10px] bg-blue-600 text-white">
                  {dispatchedConfirmation.urgency}
                  {dispatchedConfirmation.slaMinutes
                    ? ` • target ${dispatchedConfirmation.slaMinutes} min`
                    : ''}
                </span>
              </div>
              {dispatchedConfirmation.consultant.contactExtension && (
                <div className="flex justify-between items-center">
                  <span className="text-slate-500 font-semibold">Pager / Extension:</span>
                  <span className="font-mono font-bold text-emerald-700">{dispatchedConfirmation.consultant.contactExtension}</span>
                </div>
              )}
            </div>

            <div className="pt-4 flex justify-center gap-3">
              <button
                onClick={() => setDispatchedConfirmation(null)}
                className="px-4 py-2 border border-slate-300 hover:bg-slate-50 rounded-xl text-xs font-bold text-slate-700 cursor-pointer"
              >
                Route Another Specialist
              </button>
              <button
                onClick={onClose}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer"
              >
                Close & Return to Workspace
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1 overflow-y-auto">
            {/* Left Column: Doctor Selection & Roster (7 cols) */}
            <div className="lg:col-span-7 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <UserCheck className="w-4 h-4 text-blue-600" />
                  Select Eligible Consultant
                </h3>

                <select
                  value={selectedDepartment}
                  onChange={(event) => setSelectedDepartment(event.target.value)}
                  className="min-w-52 px-3 py-2 text-[11px] font-bold rounded-lg border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  aria-label="Filter consultants by department"
                >
                  {departmentOptions.map((department) => (
                    <option key={department} value={department}>
                      {department === 'ALL' ? 'All departments' : department}
                    </option>
                  ))}
                </select>
              </div>

              {/* Search Bar */}
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search doctor by name, sub-specialty, or qualification..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>

              {/* Doctors Roster List */}
              <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
                {filteredDoctors.length === 0 && (
                  <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
                    <UserCheck className="mx-auto h-7 w-7 text-slate-300" />
                    <p className="mt-2 text-xs font-bold text-slate-700">
                      No eligible consultants match this filter.
                    </p>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Check the HCM roster, credentials and active clinical privileges, or clear the department/search filter.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDepartment('ALL');
                        setSearchQuery('');
                      }}
                      className="mt-3 text-[11px] font-bold text-blue-600 hover:underline"
                    >
                      Clear filters
                    </button>
                  </div>
                )}
                {filteredDoctors.map((doc) => {
                  const isAiMatch = doc.id === aiMatchId;
                  const isSelected = doc.id === selectedDoctorId;

                  return (
                    <div
                      key={doc.id}
                      onClick={() => {
                        setSelectedDoctorId(doc.id);
                        setAssignedRoom(doc.assignedBayOrRoom);
                      }}
                      className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-blue-50/80 border-blue-400 ring-2 ring-blue-500/20 shadow-xs'
                          : 'bg-white hover:bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-extrabold text-xs text-slate-900">{doc.name}</span>
                            {IS_DEMO_RUNTIME && isAiMatch && (
                              <span className="px-2 py-0.2 rounded-full text-[9px] font-black bg-emerald-600 text-white animate-pulse flex items-center gap-0.5">
                                <Sparkles className="w-2.5 h-2.5" /> 98% BEST MATCH
                              </span>
                            )}
                            <span className="px-2 py-0.2 rounded-md text-[9px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                              {doc.badge}
                            </span>
                          </div>

                          <p className="text-[11px] font-semibold text-blue-700">{doc.title}</p>
                          <p className="text-[10px] text-slate-500">{doc.subSpecialty} • {doc.qualifications}</p>

                          <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-600 pt-1">
                            <span className="flex items-center gap-1">
                              <Building2 className="w-3 h-3 text-slate-400" />
                              {doc.assignedBayOrRoom}
                            </span>
                            {doc.contactExtension && (
                              <span className="flex items-center gap-1 font-mono text-emerald-700 font-bold">
                                <PhoneCall className="w-3 h-3 text-emerald-600" />
                                {doc.contactExtension}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Status & Load Pill */}
                        <div className="text-right shrink-0">
                          <span
                            className={`inline-block px-2 py-0.5 rounded text-[9px] font-black uppercase ${
                              doc.status === 'ON_DUTY_AVAILABLE'
                                ? 'bg-emerald-100 text-emerald-800'
                                : doc.status === 'IN_PROCEDURE'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {doc.status.replace(/_/g, ' ')}
                          </span>
                          {doc.currentQueueCount >= 0 && (
                            <span className="text-[10px] text-slate-500 block mt-1">
                              Queue: <strong className="text-slate-900">{doc.currentQueueCount} waiting</strong>
                            </span>
                          )}
                          {doc.avgReviewTimeMinutes > 0 && (
                            <span className="text-[9px] text-slate-400 block font-mono">
                              ~{doc.avgReviewTimeMinutes}m demo review estimate
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Routing Parameters & Handoff (5 cols) */}
            <div className="lg:col-span-5 bg-slate-50/80 border border-slate-200 rounded-xl p-4 space-y-4 flex flex-col justify-between">
              <div className="space-y-4">
                <h3 className="text-xs font-black text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-amber-600" />
                  Consultation Request
                </h3>

                {/* Urgency SLA Selection */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1.5">
                    Clinical Urgency & Response SLA
                  </label>
                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setRoutingUrgency('STAT')}
                      className={`p-2 rounded-lg font-black text-[11px] flex items-center justify-center gap-1 transition-all cursor-pointer ${
                        routingUrgency === 'STAT'
                          ? 'bg-rose-600 text-white shadow-xs'
                          : 'bg-white text-rose-700 border border-rose-200 hover:bg-rose-50'
                      }`}
                    >
                      <Flame className="w-3.5 h-3.5" />
                      STAT (&lt;10 min)
                    </button>
                    <button
                      type="button"
                      onClick={() => setRoutingUrgency('URGENT')}
                      className={`p-2 rounded-lg font-black text-[11px] flex items-center justify-center gap-1 transition-all cursor-pointer ${
                        routingUrgency === 'URGENT'
                          ? 'bg-amber-600 text-white shadow-xs'
                          : 'bg-white text-amber-700 border border-amber-200 hover:bg-amber-50'
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      URGENT (&lt;30 min)
                    </button>
                    <button
                      type="button"
                      onClick={() => setRoutingUrgency('PRIORITY')}
                      className={`p-2 rounded-lg font-bold text-[11px] flex items-center justify-center gap-1 transition-all cursor-pointer ${
                        routingUrgency === 'PRIORITY'
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'bg-white text-indigo-700 border border-indigo-200 hover:bg-indigo-50'
                      }`}
                    >
                      PRIORITY (&lt;60 min)
                    </button>
                    <button
                      type="button"
                      onClick={() => setRoutingUrgency('ROUTINE')}
                      className={`p-2 rounded-lg font-bold text-[11px] flex items-center justify-center gap-1 transition-all cursor-pointer ${
                        routingUrgency === 'ROUTINE'
                          ? 'bg-slate-700 text-white shadow-xs'
                          : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      ROUTINE OPD
                    </button>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Selected consultant location
                  </span>
                  <span className="mt-1 block text-xs font-semibold text-slate-800">
                    {selectedDoctor?.assignedBayOrRoom || 'Select a consultant to view location'}
                  </span>
                  <p className="mt-1 text-[10px] text-slate-500">
                    Routing creates a consultation request only. Diagnostic orders must be placed through the governed ordering workflow.
                  </p>
                </div>

                {/* Clinical Handoff SBAR Summary */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-700 mb-1">
                    Clinical question / handoff context
                  </label>
                  <textarea
                    rows={3}
                    value={clinicalHandoffNote}
                    onChange={(e) => setClinicalHandoffNote(e.target.value)}
                    className="w-full p-2 text-xs rounded-lg border border-slate-300 bg-white focus:ring-2 focus:ring-blue-500/20"
                    placeholder={`Why is specialist review needed? Current complaint: ${chiefComplaint || 'not documented'}`}
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="w-1/3 py-2.5 border border-slate-300 hover:bg-slate-100 rounded-xl text-xs font-bold text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDispatching || !selectedDoctor || !clinicalHandoffNote.trim()}
                  onClick={handleDispatchConsultant}
                  className="w-2/3 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl text-xs font-black flex items-center justify-center gap-1.5 shadow-md transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                >
                  {isDispatching ? (
                    <span>Requesting consultation...</span>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>
                        {!selectedDoctor
                          ? 'Select an eligible consultant'
                          : !clinicalHandoffNote.trim()
                            ? 'Add the clinical question'
                            : `Request consultation from ${selectedDoctor.name.split(',')[0]}`}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
