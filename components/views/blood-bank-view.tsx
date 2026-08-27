'use client';

import React, { useState } from 'react';
import { useHospital } from '@/lib/context/hospital-context';
import {
  Droplet,
  Heart,
  ShieldCheck,
  AlertTriangle,
  Users,
  Clock,
  Plus,
  CheckCircle2,
  Activity,
  Search,
  Filter,
} from 'lucide-react';

interface BloodUnit {
  id: string;
  bloodGroup: 'O+' | 'O-' | 'A+' | 'A-' | 'B+' | 'B-' | 'AB+' | 'AB-';
  component: 'PRBC' | 'FFP' | 'Platelets' | 'Cryoprecipitate';
  unitsAvailable: number;
  reserveThreshold: number;
  status: 'optimal' | 'low' | 'critical';
}

interface CrossmatchRequest {
  id: string;
  patientName: string;
  mrn: string;
  ward: string;
  bloodGroup: string;
  requiredUnits: number;
  component: string;
  crossmatchStatus: 'compatible' | 'in_progress' | 'issued' | 'transfusing';
  urgency: 'stat' | 'urgent' | 'routine';
  orderedBy: string;
}

export function BloodBankView() {
  const [inventory, setInventory] = useState<BloodUnit[]>([
    { id: 'b-01', bloodGroup: 'O-', component: 'PRBC', unitsAvailable: 6, reserveThreshold: 10, status: 'low' },
    { id: 'b-02', bloodGroup: 'O+', component: 'PRBC', unitsAvailable: 34, reserveThreshold: 20, status: 'optimal' },
    { id: 'b-03', bloodGroup: 'A+', component: 'PRBC', unitsAvailable: 28, reserveThreshold: 15, status: 'optimal' },
    { id: 'b-04', bloodGroup: 'A-', component: 'PRBC', unitsAvailable: 8, reserveThreshold: 8, status: 'optimal' },
    { id: 'b-05', bloodGroup: 'B+', component: 'PRBC', unitsAvailable: 22, reserveThreshold: 15, status: 'optimal' },
    { id: 'b-06', bloodGroup: 'B-', component: 'PRBC', unitsAvailable: 4, reserveThreshold: 6, status: 'low' },
    { id: 'b-07', bloodGroup: 'AB+', component: 'PRBC', unitsAvailable: 12, reserveThreshold: 8, status: 'optimal' },
    { id: 'b-08', bloodGroup: 'AB-', component: 'PRBC', unitsAvailable: 2, reserveThreshold: 4, status: 'critical' },
  ]);

  const [requests, setRequests] = useState<CrossmatchRequest[]>([
    {
      id: 'req-801',
      patientName: 'Elena Rostova',
      mrn: 'GH-2026-9812',
      ward: 'ICU (Bed ICU-01)',
      bloodGroup: 'O+',
      requiredUnits: 2,
      component: 'PRBC (Packed Red Cells)',
      crossmatchStatus: 'transfusing',
      urgency: 'stat',
      orderedBy: 'Dr. Sarah Jenkins',
    },
    {
      id: 'req-802',
      patientName: 'Zubair Ahmed',
      mrn: 'GH-2026-3108',
      ward: 'OT Suite 4 (Trauma)',
      bloodGroup: 'B+',
      requiredUnits: 4,
      component: 'PRBC + 2 Units FFP',
      crossmatchStatus: 'compatible',
      urgency: 'stat',
      orderedBy: 'Dr. Sarah Jenkins',
    },
    {
      id: 'req-803',
      patientName: 'Eleanor Vance',
      mrn: 'GH-2026-3391',
      ward: 'OT Suite 2 (Ortho)',
      bloodGroup: 'A+',
      requiredUnits: 2,
      component: 'PRBC',
      crossmatchStatus: 'issued',
      urgency: 'urgent',
      orderedBy: 'Dr. Kamran Baig',
    },
  ]);

  const handleIssueBlood = (reqId: string) => {
    setRequests((prev) =>
      prev.map((r) => {
        if (r.id === reqId) {
          return { ...r, crossmatchStatus: 'issued' };
        }
        return r;
      })
    );
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center font-bold">
              <Droplet className="w-4 h-4" />
            </span>
            <h1 className="text-lg font-bold text-slate-900">Blood Bank & Transfusion Medicine</h1>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            ABO/Rh Inventory, Real-Time Crossmatching Ledger & Emergency Uncrossed Release Protocols
          </p>
        </div>

        <button
          onClick={() => alert('Emergency uncrossed O-Negative blood release protocol initialized. Dispatching 2 units to Trauma Bay.')}
          className="px-3.5 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer"
        >
          <AlertTriangle className="w-4 h-4 text-amber-300" />
          Stat Emergency O-Negative Release
        </button>
      </div>

      {/* ABO Inventory Grid */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Droplet className="w-4 h-4 text-rose-600" />
              ABO/Rh Blood Inventory Levels (PRBC Packed Cells)
            </h2>
            <p className="text-xs text-slate-500">Stored at 2°C–6°C in monitored cold-chain storage</p>
          </div>
          <span className="text-xs font-bold text-slate-700 bg-slate-100 px-2.5 py-1 rounded-lg">
            116 Total PRBC Units
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {inventory.map((unit) => (
            <div
              key={unit.id}
              className={`p-3.5 rounded-xl border flex flex-col items-center justify-center text-center space-y-1.5 ${
                unit.status === 'critical'
                  ? 'bg-rose-50 border-rose-300 text-rose-900 ring-2 ring-rose-500/20'
                  : unit.status === 'low'
                  ? 'bg-amber-50 border-amber-300 text-amber-900'
                  : 'bg-slate-50 border-slate-200 text-slate-900'
              }`}
            >
              <span className="text-base font-black tracking-tight">{unit.bloodGroup}</span>
              <span className="text-2xl font-black">{unit.unitsAvailable}</span>
              <span className="text-[10px] text-slate-500 uppercase font-semibold">Units</span>
              <span
                className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${
                  unit.status === 'critical'
                    ? 'bg-rose-600 text-white'
                    : unit.status === 'low'
                    ? 'bg-amber-500 text-white'
                    : 'bg-emerald-100 text-emerald-800'
                }`}
              >
                {unit.status}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Crossmatch & Transfusion Requests */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              Active Crossmatch & Transfusion Ledger
            </h3>
            <p className="text-xs text-slate-500">Includes major and minor compatibility testing validation</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                <th className="p-3 font-bold">Patient & MRN</th>
                <th className="p-3 font-bold">Location</th>
                <th className="p-3 font-bold">Blood Group</th>
                <th className="p-3 font-bold">Product & Quantity</th>
                <th className="p-3 font-bold">Urgency</th>
                <th className="p-3 font-bold">Crossmatch Status</th>
                <th className="p-3 font-bold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {requests.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/60">
                  <td className="p-3">
                    <span className="font-bold text-slate-900 block">{r.patientName}</span>
                    <span className="font-mono text-[11px] text-slate-500">{r.mrn}</span>
                  </td>
                  <td className="p-3 font-medium text-slate-700">{r.ward}</td>
                  <td className="p-3">
                    <span className="px-2 py-0.5 bg-rose-100 text-rose-800 font-extrabold rounded text-[11px]">
                      {r.bloodGroup}
                    </span>
                  </td>
                  <td className="p-3 text-slate-800 font-medium">
                    {r.requiredUnits} Units • {r.component}
                  </td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-black uppercase ${
                        r.urgency === 'stat'
                          ? 'bg-rose-600 text-white animate-pulse'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {r.urgency}
                    </span>
                  </td>
                  <td className="p-3">
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        r.crossmatchStatus === 'transfusing'
                          ? 'bg-purple-100 text-purple-800'
                          : r.crossmatchStatus === 'compatible'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-blue-100 text-blue-800'
                      }`}
                    >
                      {r.crossmatchStatus.toUpperCase()}
                    </span>
                  </td>
                  <td className="p-3 text-right">
                    {r.crossmatchStatus === 'compatible' ? (
                      <button
                        onClick={() => handleIssueBlood(r.id)}
                        className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold cursor-pointer"
                      >
                        Issue Unit
                      </button>
                    ) : (
                      <span className="text-[11px] text-slate-400 font-medium">Checked Out</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
