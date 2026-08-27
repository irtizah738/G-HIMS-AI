'use client';

import React, { useState } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import {
  Scissors,
  CheckSquare,
  Clock,
  UserCheck,
  AlertCircle,
  Activity,
  Heart,
  Plus,
  ShieldCheck,
  CheckCircle2,
  Calendar,
  Layers,
  Thermometer,
} from 'lucide-react';

interface SurgeryScheduleItem {
  id: string;
  room: string;
  procedureName: string;
  cptCode: string;
  patientName: string;
  patientMrn: string;
  age: number;
  gender: string;
  leadSurgeon: string;
  anesthesiologist: string;
  scrubNurse: string;
  startTime: string;
  durationMinutes: number;
  status: 'pre_op' | 'in_progress' | 'closing' | 'pacu_recovery' | 'completed';
  whoChecklist: {
    signIn: boolean;
    timeOut: boolean;
    signOut: boolean;
  };
  pacuAldreteScore?: number; // 0-10
}

export function SurgeryTheaterView() {
  const [theaters, setTheaters] = useState<SurgeryScheduleItem[]>([
    {
      id: 'ot-01',
      room: 'OT Suite 1 (Cardiothoracic)',
      procedureName: 'Off-Pump Coronary Artery Bypass Graft (CABG x3)',
      cptCode: 'CPT 33512',
      patientName: 'Robert Martinez',
      patientMrn: 'GH-2026-1042',
      age: 63,
      gender: 'Male',
      leadSurgeon: 'Dr. Sarah Jenkins, FACS',
      anesthesiologist: 'Dr. Marcus Vance',
      scrubNurse: 'Sister Clara Oswald',
      startTime: '08:30 AM',
      durationMinutes: 240,
      status: 'in_progress',
      whoChecklist: { signIn: true, timeOut: true, signOut: false },
      pacuAldreteScore: undefined,
    },
    {
      id: 'ot-02',
      room: 'OT Suite 2 (Orthopedics & Trauma)',
      procedureName: 'Total Knee Arthroplasty (Robotic-Assisted TKA)',
      cptCode: 'CPT 27447',
      patientName: 'Eleanor Vance',
      patientMrn: 'GH-2026-3391',
      age: 71,
      gender: 'Female',
      leadSurgeon: 'Dr. Kamran Baig',
      anesthesiologist: 'Dr. Elena Drake',
      scrubNurse: 'Nurse David K.',
      startTime: '10:00 AM',
      durationMinutes: 120,
      status: 'closing',
      whoChecklist: { signIn: true, timeOut: true, signOut: true },
      pacuAldreteScore: 8,
    },
    {
      id: 'ot-03',
      room: 'OT Suite 3 (Laparoscopic & GI)',
      procedureName: 'Laparoscopic Cholecystectomy with Cholangiogram',
      cptCode: 'CPT 47563',
      patientName: 'Sofia Chen',
      patientMrn: 'GH-2026-7731',
      age: 31,
      gender: 'Female',
      leadSurgeon: 'Dr. Michael Chang',
      anesthesiologist: 'Dr. Marcus Vance',
      scrubNurse: 'Nurse Emma Watson',
      startTime: '11:45 AM',
      durationMinutes: 75,
      status: 'pre_op',
      whoChecklist: { signIn: true, timeOut: false, signOut: false },
      pacuAldreteScore: undefined,
    },
    {
      id: 'ot-04',
      room: 'OT Suite 4 (Emergency & General)',
      procedureName: 'Exploratory Laparotomy & Splenorrhaphy (Trauma)',
      cptCode: 'CPT 49000',
      patientName: 'Zubair Ahmed',
      patientMrn: 'GH-2026-3108',
      age: 26,
      gender: 'Male',
      leadSurgeon: 'Dr. Sarah Jenkins',
      anesthesiologist: 'Dr. Elena Drake',
      scrubNurse: 'Sister Clara Oswald',
      startTime: '01:15 PM',
      durationMinutes: 90,
      status: 'pre_op',
      whoChecklist: { signIn: false, timeOut: false, signOut: false },
      pacuAldreteScore: undefined,
    },
  ]);

  const [selectedOtId, setSelectedOtId] = useState<string>('ot-01');
  const activeOt = theaters.find((t) => t.id === selectedOtId) || theaters[0];

  const handleToggleChecklist = (otId: string, itemKey: 'signIn' | 'timeOut' | 'signOut') => {
    setTheaters((prev) =>
      prev.map((ot) => {
        if (ot.id === otId) {
          return {
            ...ot,
            whoChecklist: {
              ...ot.whoChecklist,
              [itemKey]: !ot.whoChecklist[itemKey],
            },
          };
        }
        return ot;
      })
    );
  };

  const getStatusBadge = (status: SurgeryScheduleItem['status']) => {
    switch (status) {
      case 'in_progress':
        return <span className="px-2.5 py-0.5 rounded text-[10px] font-black bg-rose-600 text-white animate-pulse">SURGERY IN PROGRESS</span>;
      case 'closing':
        return <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">CLOSING / SUTURING</span>;
      case 'pre_op':
        return <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">PRE-OP INDUCTION</span>;
      case 'pacu_recovery':
        return <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">PACU RECOVERY</span>;
      case 'completed':
        return <span className="px-2.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">COMPLETED</span>;
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl p-6 border border-slate-200 dark:border-slate-800 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold shadow-2xs">
              <Scissors className="w-4 h-4" />
            </span>
            <h1 className="text-lg font-bold text-slate-900 dark:text-slate-100">Operating Theater & Surgical Suite (OT / OR)</h1>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Real-time Theater Scheduling, WHO Surgical Safety Checklists, and Post-Anesthesia Care (PACU)
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">All Suites Active:</span>
          <span className="px-3 py-1 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold text-xs rounded-xl border border-emerald-200 dark:border-emerald-800">
            4 of 4 Theaters Running
          </span>
        </div>
      </div>

      {/* Quick Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block">Today&apos;s Surgeries</span>
          <span className="text-2xl font-black text-slate-900 dark:text-slate-100 mt-1 block">8 Scheduled</span>
          <span className="text-[11px] text-indigo-600 dark:text-indigo-400 font-semibold">2 Completed, 2 Active</span>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block">PACU Recovery Beds</span>
          <span className="text-2xl font-black text-purple-600 dark:text-purple-400 mt-1 block">3 of 8 Occupied</span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">Mean Aldrete: 8.8 / 10</span>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block">Sterile Supply Pack</span>
          <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1 block">100% Ready</span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">Autoclave Cycle Pass</span>
        </div>
        <div className="p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block">Surgical Turnaround</span>
          <span className="text-2xl font-black text-blue-600 dark:text-blue-400 mt-1 block">18 mins</span>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">Room Sanitize & Prep</span>
        </div>
      </div>

      {/* Main Suite Matrix */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left: Theater Rooms Grid */}
        <div className="lg:col-span-8 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {theaters.map((ot) => (
              <div
                key={ot.id}
                onClick={() => setSelectedOtId(ot.id)}
                className={`p-5 rounded-2xl border transition-all cursor-pointer space-y-3 ${
                  selectedOtId === ot.id
                    ? 'bg-indigo-50/40 dark:bg-indigo-950/20 border-indigo-300 dark:border-indigo-700 ring-2 ring-indigo-500/20'
                    : 'bg-white dark:bg-slate-900 border-slate-200/90 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 shadow-xs'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-xs font-black text-slate-900 dark:text-slate-100 block">{ot.room}</span>
                    <span className="text-[11px] font-mono text-indigo-700 dark:text-indigo-300 font-bold">{ot.cptCode}</span>
                  </div>
                  <div>{getStatusBadge(ot.status)}</div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-850 p-3 rounded-xl border border-slate-100 dark:border-slate-800 space-y-1 text-xs">
                  <p className="font-bold text-slate-900 dark:text-slate-100">{ot.procedureName}</p>
                  <p className="text-slate-600 dark:text-slate-400">
                    Patient: <strong className="text-slate-900 dark:text-slate-200">{ot.patientName}</strong> ({ot.age}y, {ot.gender}) • <span className="font-mono">{ot.patientMrn}</span>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800">
                  <div>
                    <span className="text-slate-400 dark:text-slate-500 block">Surgeon</span>
                    <strong className="text-slate-800 dark:text-slate-200">{ot.leadSurgeon}</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 dark:text-slate-500 block">Anesthesia</span>
                    <strong className="text-slate-800 dark:text-slate-200">{ot.anesthesiologist}</strong>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <Clock className="w-3 h-3 text-slate-400 dark:text-slate-500" /> Start: {ot.startTime} ({ot.durationMinutes}m)
                  </span>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-slate-400 dark:text-slate-500">WHO:</span>
                    <span className={`w-2 h-2 rounded-full ${ot.whoChecklist.signIn ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                    <span className={`w-2 h-2 rounded-full ${ot.whoChecklist.timeOut ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                    <span className={`w-2 h-2 rounded-full ${ot.whoChecklist.signOut ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right: WHO Safety Checklist & PACU Score for Selected Room */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4 text-xs transition-colors">
            <div className="border-b border-slate-100 dark:border-slate-800/80 pb-3">
              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">Selected Suite</span>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{activeOt.room}</h3>
              <p className="text-slate-500 dark:text-slate-400 mt-0.5">{activeOt.procedureName}</p>
            </div>

            {/* WHO Surgical Safety Checklist */}
            <div className="space-y-2.5">
              <h4 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5 text-xs">
                <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                WHO Surgical Safety Checklist
              </h4>

              <div
                onClick={() => handleToggleChecklist(activeOt.id, 'signIn')}
                className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                  activeOt.whoChecklist.signIn
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                    : 'bg-slate-50 dark:bg-slate-850 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                <div>
                  <span className="font-bold block">1. Sign In (Before Induction)</span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">Site marked, anesthesia check, pulse oximeter on</span>
                </div>
                <CheckSquare className={`w-5 h-5 ${activeOt.whoChecklist.signIn ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-300 dark:text-slate-600'}`} />
              </div>

              <div
                onClick={() => handleToggleChecklist(activeOt.id, 'timeOut')}
                className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                  activeOt.whoChecklist.timeOut
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                    : 'bg-slate-50 dark:bg-slate-850 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                <div>
                  <span className="font-bold block">2. Time Out (Before Skin Incision)</span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">Team introductions, patient confirmed, imaging displayed</span>
                </div>
                <CheckSquare className={`w-5 h-5 ${activeOt.whoChecklist.timeOut ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-300 dark:text-slate-600'}`} />
              </div>

              <div
                onClick={() => handleToggleChecklist(activeOt.id, 'signOut')}
                className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                  activeOt.whoChecklist.signOut
                    ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                    : 'bg-slate-50 dark:bg-slate-850 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                <div>
                  <span className="font-bold block">3. Sign Out (Before Patient Leaves OT)</span>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">Instrument/sponge count correct, specimen labeled</span>
                </div>
                <CheckSquare className={`w-5 h-5 ${activeOt.whoChecklist.signOut ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-300 dark:text-slate-600'}`} />
              </div>
            </div>

            {/* PACU Aldrete Recovery Meter */}
            <div className="p-3 bg-slate-50 dark:bg-slate-850 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 dark:text-slate-100">Post-Anesthesia Aldrete Score</span>
                <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800 font-bold rounded text-[10px]">
                  {activeOt.pacuAldreteScore ? `${activeOt.pacuAldreteScore} / 10` : 'Pending PACU'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Measures motor activity, respiration, circulation, consciousness, and O2 saturation. Score &ge;9 required for ward transfer.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
