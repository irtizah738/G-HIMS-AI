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
  isSyncing: boolean;
  pendingSyncCount: number;
  conflictsCount: number;
  lastError?: string | null;
  activeRole: OpdRole;
  allowPersonaSwitch?: boolean;
  allowOfflineSimulation?: boolean;
  offlineSimulationActive?: boolean;
  onRoleChange: (role: OpdRole) => void;
  onTriggerManualSync: () => Promise<void> | void;
  onToggleOfflineSimulation: () => Promise<void> | void;
}

export function OpdOfflineSyncManager({
  isOnline,
  isSyncing,
  pendingSyncCount,
  conflictsCount,
  lastError,
  activeRole,
  allowPersonaSwitch = false,
  allowOfflineSimulation = false,
  offlineSimulationActive = false,
  onRoleChange,
  onTriggerManualSync,
  onToggleOfflineSimulation,
}: OpdOfflineSyncManagerProps) {
  return (
    <div className="p-3 bg-slate-900 text-white rounded-2xl flex flex-wrap items-center justify-between gap-3 text-xs shadow-md border border-slate-800">
      {/* Network & Outbox Status */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (allowOfflineSimulation) void onToggleOfflineSimulation();
          }}
          disabled={!allowOfflineSimulation}
          className={`px-3 py-1.5 rounded-xl font-bold flex items-center gap-1.5 transition-all ${
            allowOfflineSimulation ? 'cursor-pointer' : 'cursor-default'
          } ${
            isOnline ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-amber-950 text-amber-300 border border-amber-800'
          }`}
          title={
            allowOfflineSimulation
              ? 'Toggle DEMO offline simulation'
              : 'Connectivity is derived from verified application reachability'
          }
        >
          {isOnline ? (
            <>
              <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              <span>{offlineSimulationActive ? 'ONLINE' : 'ONLINE (Server Reachable)'}</span>
            </>
          ) : (
            <>
              <WifiOff className="w-3.5 h-3.5 text-amber-400" />
              <span>OFFLINE (Encrypted Edge Outbox Active)</span>
            </>
          )}
        </button>

        <div className="flex items-center gap-2 text-slate-400">
          <Database className="w-3.5 h-3.5 text-blue-400" />
          <span>Outbox Pending: <strong className="text-white">{pendingSyncCount} mutations</strong></span>
          {pendingSyncCount > 0 && (
            <button
              type="button"
              onClick={() => void onTriggerManualSync()}
              disabled={!isOnline || isSyncing}
              className="px-2 py-0.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded font-bold flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing…' : 'Sync Now'}
            </button>
          )}
          {conflictsCount > 0 && (
            <span className="text-amber-300 font-semibold">
              {conflictsCount} conflict{conflictsCount === 1 ? '' : 's'} require review
            </span>
          )}
          {lastError && (
            <span className="text-rose-300 font-semibold" title={lastError}>
              Last sync failed
            </span>
          )}
        </div>
      </div>

      {/* Role Switcher */}
      <div className="flex items-center gap-2">
        <span className="text-slate-400 font-semibold flex items-center gap-1">
          <UserCheck className="w-3.5 h-3.5 text-indigo-400" />
          Active Workspace Persona:
        </span>
        {allowPersonaSwitch ? (
          <select
            value={activeRole}
            onChange={(e) => onRoleChange(e.target.value as OpdRole)}
            className="px-2.5 py-1 rounded-xl bg-slate-800 text-white border border-slate-700 font-bold focus:outline-hidden text-xs"
          >
            <option value="RECEPTIONIST">Front Desk Registrar (Receptionist)</option>
            <option value="TRIAGE_NURSE">Triage & Intake Nurse</option>
            <option value="MEDICAL_OFFICER">General Medical Officer (MO)</option>
            <option value="SPECIALIST_CONSULTANT">Attending Specialist Consultant</option>
            <option value="LAB_TECH">Laboratory Technologist</option>
            <option value="PHARMACIST">Licensed Clinical Pharmacist</option>
            <option value="BILLING_CASHIER">Billing Officer & Cashier</option>
            <option value="CLINICAL_DIRECTOR">Medical Director / Audit Lead</option>
          </select>
        ) : (
          <span className="px-2.5 py-1 rounded-xl bg-slate-800 text-indigo-200 border border-slate-700 font-bold text-xs">
            {String(activeRole).replace(/_/g, ' ')}
          </span>
        )}
      </div>
    </div>
  );
}
