'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  RefreshCw,
  Scissors,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  acceptPacuTransferEdge,
  advanceSurgicalCaseEdge,
  cancelSurgicalCaseEdge,
  completePacuRecoveryEdge,
  hydrateSurgicalProjection,
  loadLocalSurgicalProjection,
  recordSurgicalChecklistEdge,
  scheduleSurgicalCaseEdge,
  transferSurgicalCaseToPacuEdge,
  type GovernedSurgicalCase,
  type SurgicalEdgeProjection,
} from '@/lib/clinical/surgical-edge-adapter';

interface SurgicalOperationsConsoleProps {
  tenantId: string;
  caseId?: string;
  mode?: 'LIST' | 'SCHEDULE' | 'CASE';
}

const empty: SurgicalEdgeProjection = {
  cases: [],
  rooms: [],
  patients: [],
  encounters: [],
  source: 'LOCAL',
};

export function SurgicalOperationsConsole({
  tenantId,
  caseId,
  mode = 'LIST',
}: SurgicalOperationsConsoleProps) {
  const [projection, setProjection] = useState<SurgicalEdgeProjection>(empty);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState(caseId || '');
  const [patientId, setPatientId] = useState('');
  const [encounterId, setEncounterId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [procedureName, setProcedureName] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [urgency, setUrgency] = useState<'elective' | 'urgent' | 'emergency'>('elective');
  const [checklistEvidence, setChecklistEvidence] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [pacuRoomId, setPacuRoomId] = useState('');
  const [pacuHandoffSummary, setPacuHandoffSummary] = useState('');
  const [pacuRecoveryAssessment, setPacuRecoveryAssessment] = useState('');
  const [pacuDisposition, setPacuDisposition] = useState<'WARD' | 'ICU' | 'DISCHARGE'>('WARD');
  const [busy, setBusy] = useState(false);

  const apply = useCallback((next: SurgicalEdgeProjection) => {
    setProjection(next);
    if (!selectedCaseId && next.cases.length > 0) {
      setSelectedCaseId(next.cases[0].id);
    }
  }, [selectedCaseId]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      apply(await loadLocalSurgicalProjection(tenantId));
      const hydrated = await hydrateSurgicalProjection(tenantId);
      apply(hydrated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load perioperative projection.');
    } finally {
      setLoading(false);
    }
  }, [apply, tenantId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!patientId) {
      setEncounterId('');
      return;
    }
    const active = projection.encounters.find(
      (encounter) =>
        encounter.patientId === patientId &&
        ['ACTIVE', 'IN_PROGRESS', 'ADMITTED'].includes(
          String(encounter.status || '').toUpperCase()
        )
    );
    setEncounterId(String(active?.encounterId || active?.id || ''));
  }, [patientId, projection.encounters]);

  const cases = useMemo(
    () =>
      [...projection.cases].sort(
        (a, b) =>
          Date.parse(a.scheduledStartTime || '') -
          Date.parse(b.scheduledStartTime || '')
      ),
    [projection.cases]
  );

  const selectedCase =
    cases.find((candidate) => candidate.id === (caseId || selectedCaseId)) || null;

  const patientName = (id: string) =>
    projection.patients.find((patient) => patient.id === id)?.fullName || id;

  const roomName = (id?: string) =>
    projection.rooms.find((room) => room.roomId === id)?.roomNumber || id || 'Unassigned';

  const checklist = selectedCase?.safetyChecklistEvidence || {};
  const phaseComplete = (phase: 'signIn' | 'timeOut' | 'signOut') =>
    Boolean(checklist[phase]?.completed);

  const run = async (work: () => Promise<unknown>, success: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await work();
      setNotice(success);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Perioperative command failed.');
    } finally {
      setBusy(false);
    }
  };

  const schedule = async () => {
    if (!patientId || !encounterId || !roomId || !procedureName.trim() || !startTime || !endTime) {
      setError('Patient, active encounter, operating room, procedure and schedule window are required.');
      return;
    }
    await run(
      () =>
        scheduleSurgicalCaseEdge({
          patientId,
          encounterId,
          roomId,
          procedureName: procedureName.trim(),
          scheduledStartTime: new Date(startTime).toISOString(),
          scheduledEndTime: new Date(endTime).toISOString(),
          urgency,
        }),
      'Surgical case scheduled through the authoritative perioperative command.'
    );
    setProcedureName('');
  };

  const recordPhase = async (
    phase: 'SIGN_IN' | 'TIME_OUT' | 'SIGN_OUT'
  ) => {
    if (!selectedCase || !checklistEvidence.trim()) {
      setError('Checklist evidence summary is required.');
      return;
    }
    await run(
      () =>
        recordSurgicalChecklistEdge({
          caseId: selectedCase.id,
          phase,
          completed: true,
          evidenceSummary: checklistEvidence.trim(),
        }),
      `${phase.replace('_', ' ')} evidence recorded.`
    );
    setChecklistEvidence('');
  };

  const advance = async (
    targetStatus: 'pre_op' | 'intra_op' | 'post_op_pacu' | 'completed'
  ) => {
    if (!selectedCase) return;
    await run(
      () => advanceSurgicalCaseEdge({ caseId: selectedCase.id, targetStatus }),
      `Case advanced to ${targetStatus}.`
    );
  };

  const transferToPacu = async () => {
    if (!selectedCase || !pacuRoomId || !pacuHandoffSummary.trim()) {
      setError('Recovery room and PACU handoff summary are required.');
      return;
    }
    await run(
      () =>
        transferSurgicalCaseToPacuEdge({
          caseId: selectedCase.id,
          pacuRoomId,
          handoffSummary: pacuHandoffSummary.trim(),
          expectedActions: ['Receive postoperative patient', 'Perform PACU assessment', 'Escalate deterioration immediately'],
        }),
      'Patient transferred to PACU with a pending receiving-clinician handoff.'
    );
    setPacuHandoffSummary('');
  };

  const acceptPacu = async () => {
    if (!selectedCase?.pacuHandoffId) {
      setError('No pending PACU handoff is attached to this case.');
      return;
    }
    await run(
      () =>
        acceptPacuTransferEdge({
          caseId: selectedCase.id,
          handoffId: selectedCase.pacuHandoffId!,
        }),
      'PACU handoff accepted by the authenticated receiving clinician.'
    );
  };

  const completePacu = async () => {
    if (!selectedCase || !pacuRecoveryAssessment.trim()) {
      setError('A PACU recovery assessment is required before completing recovery.');
      return;
    }
    await run(
      () =>
        completePacuRecoveryEdge({
          caseId: selectedCase.id,
          recoveryAssessment: pacuRecoveryAssessment.trim(),
          disposition: pacuDisposition,
        }),
      'PACU recovery completed and recovery-room capacity released.'
    );
    setPacuRecoveryAssessment('');
  };

  const cancel = async () => {
    if (!selectedCase || cancelReason.trim().length < 3) {
      setError('A substantive cancellation reason is required.');
      return;
    }
    await run(
      () => cancelSurgicalCaseEdge({ caseId: selectedCase.id, reason: cancelReason.trim() }),
      'Surgical case cancelled.'
    );
    setCancelReason('');
  };

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Scissors className="h-5 w-5 text-blue-600" />
              <h1 className="text-lg font-bold">Authoritative Surgical Operations</h1>
              <span className="rounded-full border px-2 py-0.5 text-[10px] font-semibold">
                {projection.source}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Scheduling, WHO checklist evidence and case transitions are server-authoritative.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded-xl border px-3 py-2 text-xs font-semibold"
          >
            <RefreshCw className={`mr-1 inline h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertTriangle className="mr-2 inline h-4 w-4" />{error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          <CheckCircle2 className="mr-2 inline h-4 w-4" />{notice}
        </div>
      )}

      {mode === 'SCHEDULE' && (
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          <h2 className="font-bold">Schedule governed case</h2>
          <p className="mb-4 text-xs text-slate-500">
            Patient, encounter and operating-room ownership are revalidated atomically by the server.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <select value={patientId} onChange={(event) => setPatientId(event.target.value)} className="rounded-xl border bg-transparent p-2 text-sm">
              <option value="">Select patient</option>
              {projection.patients.map((patient) => (
                <option key={patient.id} value={patient.id}>{patient.fullName} — {patient.mrn}</option>
              ))}
            </select>
            <input value={encounterId} readOnly placeholder="Active encounter resolved automatically" className="rounded-xl border bg-slate-50 p-2 text-sm dark:bg-slate-800" />
            <select value={roomId} onChange={(event) => setRoomId(event.target.value)} className="rounded-xl border bg-transparent p-2 text-sm">
              <option value="">Select operating room</option>
              {projection.rooms
                .filter((room) => room.roomType === 'operating_room')
                .map((room) => (
                  <option key={room.roomId} value={room.roomId}>{room.roomNumber} — {room.departmentName}</option>
                ))}
            </select>
            <select value={urgency} onChange={(event) => setUrgency(event.target.value as typeof urgency)} className="rounded-xl border bg-transparent p-2 text-sm">
              <option value="elective">Elective</option>
              <option value="urgent">Urgent</option>
              <option value="emergency">Emergency</option>
            </select>
            <input value={procedureName} onChange={(event) => setProcedureName(event.target.value)} placeholder="Procedure" className="rounded-xl border bg-transparent p-2 text-sm md:col-span-2" />
            <input type="datetime-local" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="rounded-xl border bg-transparent p-2 text-sm" />
            <input type="datetime-local" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="rounded-xl border bg-transparent p-2 text-sm" />
          </div>
          <button type="button" onClick={() => void schedule()} disabled={busy} className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-xs font-bold text-white">
            <Calendar className="mr-1 inline h-4 w-4" /> Schedule case
          </button>
        </section>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4">
          <h2 className="mb-3 text-sm font-bold">Surgical cases</h2>
          {cases.length === 0 ? (
            <p className="rounded-xl border border-dashed p-6 text-center text-xs text-slate-500">
              No authoritative surgical cases are available for this scope.
            </p>
          ) : (
            <div className="space-y-2">
              {cases.map((surgicalCase) => (
                <button
                  key={surgicalCase.id}
                  type="button"
                  onClick={() => setSelectedCaseId(surgicalCase.id)}
                  className={`w-full rounded-xl border p-3 text-left text-xs ${
                    selectedCase?.id === surgicalCase.id
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="font-bold">{surgicalCase.procedureName || surgicalCase.surgicalProcedureName || 'Procedure'}</div>
                  <div className="mt-1 text-slate-500">{patientName(surgicalCase.patientId)} · {roomName(surgicalCase.orRoomId)}</div>
                  <div className="mt-1 flex items-center justify-between">
                    <span>{surgicalCase.status || 'scheduled'}</span>
                    <span><Clock className="mr-1 inline h-3 w-3" />{new Date(surgicalCase.scheduledStartTime).toLocaleString()}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
          {!selectedCase ? (
            <p className="text-sm text-slate-500">Select a case to inspect its governed state.</p>
          ) : (
            <div className="space-y-4">
              <div>
                <h2 className="font-bold">{selectedCase.procedureName || selectedCase.surgicalProcedureName}</h2>
                <p className="text-xs text-slate-500">
                  {patientName(selectedCase.patientId)} · {roomName(selectedCase.orRoomId)} · {selectedCase.status}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {([
                  ['SIGN_IN', 'signIn'],
                  ['TIME_OUT', 'timeOut'],
                  ['SIGN_OUT', 'signOut'],
                ] as const).map(([label, key]) => (
                  <div key={label} className="rounded-xl border p-3 text-center text-xs">
                    {phaseComplete(key) ? (
                      <CheckCircle2 className="mx-auto mb-1 h-4 w-4 text-emerald-600" />
                    ) : (
                      <AlertTriangle className="mx-auto mb-1 h-4 w-4 text-amber-600" />
                    )}
                    {label.replace('_', ' ')}
                  </div>
                ))}
              </div>

              <textarea value={checklistEvidence} onChange={(event) => setChecklistEvidence(event.target.value)} placeholder="Checklist evidence summary" className="w-full rounded-xl border bg-transparent p-2 text-sm" />
              <div className="flex flex-wrap gap-2">
                <button onClick={() => void recordPhase('SIGN_IN')} disabled={busy} className="rounded-lg border px-3 py-2 text-xs">Record Sign In</button>
                <button onClick={() => void recordPhase('TIME_OUT')} disabled={busy} className="rounded-lg border px-3 py-2 text-xs">Record Time Out</button>
                <button onClick={() => void recordPhase('SIGN_OUT')} disabled={busy} className="rounded-lg border px-3 py-2 text-xs">Record Sign Out</button>
              </div>

              <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                <div className="mb-2 flex items-center gap-2 text-xs font-bold"><Activity className="h-4 w-4" /> Governed transitions</div>
                <div className="flex flex-wrap gap-2">
                  {selectedCase.status === 'scheduled' && <button onClick={() => void advance('pre_op')} disabled={busy} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white">Start pre-op</button>}
                  {selectedCase.status === 'pre_op' && <button onClick={() => void advance('intra_op')} disabled={busy} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white">Start intra-op</button>}
                </div>

                {selectedCase.status === 'intra_op' && (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <select value={pacuRoomId} onChange={(event) => setPacuRoomId(event.target.value)} className="rounded-lg border bg-transparent p-2 text-xs">
                      <option value="">Select PACU recovery room</option>
                      {projection.rooms.filter((room) => room.roomType === 'recovery').map((room) => (
                        <option key={room.roomId} value={room.roomId}>
                          {room.roomNumber} — {room.currentOccupancy}/{room.capacity}
                        </option>
                      ))}
                    </select>
                    <div className="rounded-lg border bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                      Receiving authority is the selected recovery room's department. An authenticated clinician assigned to that department must accept the handoff.
                    </div>
                    <textarea value={pacuHandoffSummary} onChange={(event) => setPacuHandoffSummary(event.target.value)} placeholder="Postoperative condition, airway/hemodynamic status, risks and immediate PACU priorities" className="rounded-lg border bg-transparent p-2 text-xs md:col-span-2" />
                    <button onClick={() => void transferToPacu()} disabled={busy || !phaseComplete('signOut')} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white md:col-span-2 md:w-fit">
                      Transfer to PACU with handoff
                    </button>
                  </div>
                )}

                {selectedCase.status === 'post_op_pacu' && selectedCase.pacuTransferStatus === 'PENDING_ACCEPTANCE' && (
                  <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    PACU handoff is pending acceptance.
                    <button onClick={() => void acceptPacu()} disabled={busy} className="ml-3 rounded-lg bg-amber-600 px-3 py-2 font-semibold text-white">
                      Accept PACU handoff
                    </button>
                  </div>
                )}

                {selectedCase.status === 'post_op_pacu' && selectedCase.pacuTransferStatus === 'ACCEPTED' && (
                  <div className="mt-3 grid gap-2">
                    <textarea value={pacuRecoveryAssessment} onChange={(event) => setPacuRecoveryAssessment(event.target.value)} placeholder="PACU recovery assessment and readiness for disposition" className="rounded-lg border bg-transparent p-2 text-xs" />
                    <select value={pacuDisposition} onChange={(event) => setPacuDisposition(event.target.value as typeof pacuDisposition)} className="rounded-lg border bg-transparent p-2 text-xs">
                      <option value="WARD">Ward</option>
                      <option value="ICU">ICU</option>
                      <option value="DISCHARGE">Discharge</option>
                    </select>
                    <button onClick={() => void completePacu()} disabled={busy} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white w-fit">
                      Complete PACU recovery
                    </button>
                  </div>
                )}
              </div>

              {!['completed', 'cancelled'].includes(String(selectedCase.status)) && (
                <div className="border-t pt-4">
                  <input value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} placeholder="Cancellation reason" className="w-full rounded-xl border bg-transparent p-2 text-sm" />
                  <button onClick={() => void cancel()} disabled={busy} className="mt-2 rounded-lg border border-rose-300 px-3 py-2 text-xs font-semibold text-rose-700">
                    <XCircle className="mr-1 inline h-4 w-4" /> Cancel case
                  </button>
                </div>
              )}

              <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-[11px] text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                Browser state is a read projection only. Room overlap, encounter ownership, clinical privilege and WHO checklist gates are re-evaluated by the authoritative server transaction.
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
