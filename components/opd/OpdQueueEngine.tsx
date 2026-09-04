'use client';

import React, { useState } from 'react';
import {
  Clock,
  Volume2,
  ArrowRightLeft,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  UserCheck,
  Building,
  RefreshCw,
  Flame,
  ArrowRight,
} from 'lucide-react';
import { QueueEntry, QueueStatus } from '@/types/opd-domain';

interface OpdQueueEngineProps {
  queue: QueueEntry[];
  onCallToken: (tokenNumber: string, room: string) => void;
  onStartService: (tokenId: string) => void;
  onCompleteService: (tokenId: string) => void;
  onSkipToken: (tokenId: string) => void;
  onTransferQueue: (tokenId: string, targetDept: string, targetDoctor?: string, targetRoom?: string) => void;
  onOverridePriority: (tokenId: string, newPriority: any, reason: string) => void;
  onSelectQueueItem: (encounterId: string) => void;
}

export function OpdQueueEngine({
  queue,
  onCallToken,
  onStartService,
  onCompleteService,
  onSkipToken,
  onTransferQueue,
  onOverridePriority,
  onSelectQueueItem,
}: OpdQueueEngineProps) {
  const [selectedDeptFilter, setSelectedDeptFilter] = useState<string>('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('ACTIVE');
  const [transferModalToken, setTransferModalToken] = useState<QueueEntry | null>(null);
  const [targetDept, setTargetDept] = useState<string>('Cardiology');
  const [targetRoom, setTargetRoom] = useState<string>('Consultation Room 104');
  const [priorityModalToken, setPriorityModalToken] = useState<QueueEntry | null>(null);
  const [newPriority, setNewPriority] = useState<any>('RED_IMMEDIATE');
  const [priorityReason, setPriorityReason] = useState<string>('Acute chest discomfort with diaphoresis (NEWS2 >= 7)');

  const filteredQueue = queue.filter((q) => {
    const matchesDept = selectedDeptFilter === 'ALL' || q.department === selectedDeptFilter;
    const matchesStatus =
      selectedStatusFilter === 'ALL'
        ? true
        : selectedStatusFilter === 'ACTIVE'
        ? q.status === 'WAITING' || q.status === 'CALLED' || q.status === 'IN_SERVICE'
        : q.status === selectedStatusFilter;
    return matchesDept && matchesStatus;
  });

  const waitingCount = queue.filter((q) => q.status === 'WAITING').length;
  const inServiceCount = queue.filter((q) => q.status === 'IN_SERVICE').length;
  const calledCount = queue.filter((q) => q.status === 'CALLED').length;

  return (
    <div className="space-y-6">
      {/* Metrics Row */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500">Waiting in Lobby</span>
          <p className="text-2xl font-black text-amber-600 mt-1">{waitingCount}</p>
        </div>
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500">Currently Called</span>
          <p className="text-2xl font-black text-blue-600 mt-1">{calledCount}</p>
        </div>
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500">In Service (Bay/Room)</span>
          <p className="text-2xl font-black text-emerald-600 mt-1">{inServiceCount}</p>
        </div>
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-500">Est. Average Dwell</span>
          <p className="text-2xl font-black text-slate-900 dark:text-slate-100 mt-1">12.8 min</p>
        </div>
      </div>

      {/* Main Queue Dashboard */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Clock className="w-5 h-5 text-blue-600" />
              Multi-Department Real-Time Queue & Token Dispatcher
            </h2>
            <p className="text-xs text-slate-500">
              Real-time patient calling, room assignment, department transfer, and clinical priority override.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={selectedDeptFilter}
              onChange={(e) => setSelectedDeptFilter(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold"
            >
              <option value="ALL">All Departments</option>
              <option value="Cardiology">Cardiology</option>
              <option value="General Medicine">General Medicine</option>
              <option value="Pediatrics">Pediatrics</option>
              <option value="Orthopedics">Orthopedics</option>
              <option value="Obstetrics & Gynecology">Obstetrics & Gynecology</option>
            </select>

            <select
              value={selectedStatusFilter}
              onChange={(e) => setSelectedStatusFilter(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold"
            >
              <option value="ACTIVE">Active Queue (Waiting/Called)</option>
              <option value="ALL">All States</option>
              <option value="WAITING">Waiting Only</option>
              <option value="IN_SERVICE">In Service</option>
              <option value="COMPLETED">Completed</option>
            </select>
          </div>
        </div>

        {filteredQueue.length === 0 ? (
          <div className="py-12 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
            <Clock className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-500">No active queue entries for selected filters.</p>
          </div>
        ) : (
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-3">Token #</th>
                  <th className="p-3">Priority / Triage</th>
                  <th className="p-3">Patient Name</th>
                  <th className="p-3">MRN</th>
                  <th className="p-3">Dept & Attending</th>
                  <th className="p-3">Room / Bay</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Queue Operations</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredQueue.map((q) => (
                  <tr key={q.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="p-3 font-mono font-black text-blue-600 text-sm">
                      {q.tokenNumber}
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => {
                          setPriorityModalToken(q);
                          setNewPriority(q.triagePriority);
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-extrabold cursor-pointer transition-all flex items-center gap-1 ${
                          q.triagePriority === 'RED_IMMEDIATE'
                            ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                            : q.triagePriority === 'ORANGE_VERY_URGENT'
                            ? 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300'
                            : q.triagePriority === 'YELLOW_URGENT'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        }`}
                        title="Click to override clinical priority"
                      >
                        {q.triagePriority === 'RED_IMMEDIATE' && <Flame className="w-3 h-3 text-red-600" />}
                        {q.triagePriority.replace(/_/g, ' ')}
                      </button>
                    </td>
                    <td className="p-3 font-bold text-slate-900 dark:text-slate-100">{q.patientName}</td>
                    <td className="p-3 font-mono text-slate-500">{q.mrn}</td>
                    <td className="p-3">
                      <p className="font-semibold text-slate-800 dark:text-slate-200">{q.department}</p>
                      <p className="text-[10px] text-slate-400">{q.assignedDoctorName || 'Triage Officer'}</p>
                    </td>
                    <td className="p-3 font-mono font-semibold text-slate-700 dark:text-slate-300">
                      {q.assignedRoomOrBay}
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          q.status === 'CALLED'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 animate-pulse'
                            : q.status === 'IN_SERVICE'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {q.status}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {q.status === 'WAITING' && (
                          <button
                            onClick={() => onCallToken(q.tokenNumber, q.assignedRoomOrBay)}
                            className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <Volume2 className="w-3 h-3" />
                            Call Token
                          </button>
                        )}
                        {q.status === 'CALLED' && (
                          <button
                            onClick={() => {
                              onStartService(q.id);
                              onSelectQueueItem(q.encounterId);
                            }}
                            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer"
                          >
                            <UserCheck className="w-3 h-3" />
                            Admit to Bay
                          </button>
                        )}
                        <button
                          onClick={() => {
                            setTransferModalToken(q);
                            setTargetDept(q.department);
                          }}
                          className="px-2 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-[10px] font-bold cursor-pointer"
                          title="Transfer to another department or doctor"
                        >
                          <ArrowRightLeft className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Transfer Queue Modal */}
      {transferModalToken && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-blue-600" />
              Transfer Token {transferModalToken.tokenNumber} ({transferModalToken.patientName})
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1">Target Department</label>
                <select
                  value={targetDept}
                  onChange={(e) => setTargetDept(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-semibold"
                >
                  <option value="Cardiology">Cardiology</option>
                  <option value="General Medicine">General Medicine</option>
                  <option value="Pediatrics">Pediatrics</option>
                  <option value="Orthopedics">Orthopedics</option>
                  <option value="Obstetrics & Gynecology">Obstetrics & Gynecology</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Target Room / Clinic Bay</label>
                <input
                  type="text"
                  value={targetRoom}
                  onChange={(e) => setTargetRoom(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setTransferModalToken(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onTransferQueue(transferModalToken.id, targetDept, undefined, targetRoom);
                  setTransferModalToken(null);
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Execute Transfer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Priority Override Modal */}
      {priorityModalToken && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5 text-amber-600" />
              Clinical Priority Escalation / Override
            </h3>
            <p className="text-xs text-slate-500">
              Escalate queue priority for patient safety. Requires clinical justification recorded in immutable audit logs.
            </p>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold mb-1">New Triage Priority</label>
                <select
                  value={newPriority}
                  onChange={(e) => setNewPriority(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
                >
                  <option value="RED_IMMEDIATE">RED (Immediate Resuscitation Track)</option>
                  <option value="ORANGE_VERY_URGENT">ORANGE (Very Urgent / Emergent)</option>
                  <option value="YELLOW_URGENT">YELLOW (Urgent Clinical Evaluation)</option>
                  <option value="GREEN_STANDARD">GREEN (Standard Queue)</option>
                  <option value="BLUE_NON_URGENT">BLUE (Non-Urgent Routine)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold mb-1">Mandatory Clinical Justification *</label>
                <textarea
                  rows={2}
                  value={priorityReason}
                  onChange={(e) => setPriorityReason(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setPriorityModalToken(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                disabled={!priorityReason.trim()}
                onClick={() => {
                  onOverridePriority(priorityModalToken.id, newPriority, priorityReason);
                  setPriorityModalToken(null);
                }}
                className={`px-4 py-2 rounded-xl text-xs font-bold cursor-pointer ${
                  !priorityReason.trim()
                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                    : 'bg-amber-600 hover:bg-amber-700 text-white'
                }`}
              >
                Commit Priority Override
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
