'use client';

import React from 'react';
import {
  Wifi,
  WifiOff,
  RefreshCw,
  Layers,
  Database,
  UserCheck,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { OpdRole } from '@/types/opd-domain';

interface OpdOfflineSyncManagerProps {
  isOnline: boolean;
  pendingSyncCount: number;
  activeRole: OpdRole;
  onRoleChange: (role: OpdRole) => void;
  onTriggerManualSync: () => void;
  onToggleOnlineStatus: () => void;
}

export function OpdOfflineSyncManager({
  isOnline,
  pendingSyncCount,
  activeRole,
  onRoleChange,
  onTriggerManualSync,
  onToggleOnlineStatus,
}: OpdOfflineSyncManagerProps) {
  return (
    <div className="p-3 bg-slate-900 text-white rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs shadow-md border border-slate-800">
      {/* Network & Outbox Status */}
      <div className="flex items-center gap-3">
        <button
          onClick={onToggleOnlineStatus}
          className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
            isOnline ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-amber-950 text-amber-300 border border-amber-800'
          }`}
          title="Click to simulate offline / online network toggle"
        >
          {isOnline ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              <span>ONLINE (Cloud Firestore Synced)</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-amber-400" />
              <span>OFFLINE (Local IndexedDB Outbox Active)</span>
            </>
          )}
        </button>

        <div className="flex items-center gap-2 text-slate-400">
          <Database className="w-3.5 h-3.5 text-blue-400" />
          <span>Outbox Pending: <strong className="text-white">{pendingSyncCount} mutations</strong></span>
          {pendingSyncCount > 0 && (
            <button
              onClick={onTriggerManualSync}
              className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3 animate-spin" /> Sync Now
            </button>
          )}
        </div>
      </div>

      {/* Role Switcher */}
      <div className="flex items-center gap-2">
        <span className="text-slate-400 font-semibold flex items-center gap-1">
          <UserCheck className="w-3.5 h-3.5 text-indigo-400" />
          Active Workspace Persona:
        </span>
        <select
          value={activeRole}
          onChange={(e) => onRoleChange(e.target.value as OpdRole)}
          className="px-2.5 py-1 rounded-xl bg-slate-800 text-white border border-slate-700 font-bold focus:outline-hidden text-xs"
        >
          <option value="RECEPTIONIST">Front Desk Registrar (Receptionist)</option>
          <option value="TRIAGE_NURSE">Triage & Intake Nurse</option>
          <option value="MEDICAL_OFFICER">General Medical Officer (MO)</option>
          <option value="SPECIALIST_CONSULTANT">Attending Specialist Consultant</option>
          <option value="PHARMACIST">Licensed Clinical Pharmacist</option>
          <option value="BILLING_CASHIER">Billing Officer & Cashier</option>
          <option value="CLINICAL_DIRECTOR">Medical Director / Audit Lead</option>
        </select>
      </div>
    </div>
  );
}
