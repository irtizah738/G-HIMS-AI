'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileSignature,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
  Signal,
  SignalLow,
  Video,
} from 'lucide-react';
import { useHospital } from '@/lib/context/hospital-context';
import { executeActiveTenantCommand } from '@/lib/api/command-client';
import type { TelehealthSession, TelehealthSoapNote } from '@/lib/types/ghims';
import { TelehealthCallPanel } from '@/components/telehealth/TelehealthCallPanel';

type ConnectivityMode = 'VIDEO' | 'AUDIO_ONLY' | 'TEXT_ONLY' | 'PAUSED_OFFLINE';

function modeLabel(mode?: ConnectivityMode): string {
  switch (mode) {
    case 'AUDIO_ONLY':
      return 'Audio only';
    case 'TEXT_ONLY':
      return 'Text fallback';
    case 'PAUSED_OFFLINE':
      return 'Paused / offline';
    case 'VIDEO':
    default:
      return 'Video';
  }
}

export function TelehealthView() {
  const {
    telehealthSessions,
    patients,
    createTelehealthSession,
    completeTelehealthSession,
    networkMode,
  } = useHospital();

  const [sessions, setSessions] = useState<TelehealthSession[]>(telehealthSessions);
  const [selectedId, setSelectedId] = useState(telehealthSessions[0]?.id || '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const [patientId, setPatientId] = useState(patients[0]?.id || '');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [visitType, setVisitType] = useState<TelehealthSession['type']>('Telehealth Consultation');

  const [subjective, setSubjective] = useState('');
  const [objective, setObjective] = useState('');
  const [assessment, setAssessment] = useState('');
  const [plan, setPlan] = useState('');

  useEffect(() => {
    setSessions(telehealthSessions);
    if (!selectedId && telehealthSessions[0]?.id) {
      setSelectedId(telehealthSessions[0].id);
    }
  }, [telehealthSessions, selectedId]);

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId) || sessions[0] || null,
    [sessions, selectedId]
  );

  useEffect(() => {
    setSubjective(selected?.soapNote?.subjective || '');
    setObjective(selected?.soapNote?.objective || '');
    setAssessment(selected?.soapNote?.assessment || '');
    setPlan(selected?.soapNote?.plan || '');
  }, [selected?.id, selected?.soapNote]);

  const replaceSession = (next: TelehealthSession) => {
    setSessions((current) =>
      current.some((session) => session.id === next.id)
        ? current.map((session) => (session.id === next.id ? next : session))
        : [next, ...current]
    );
    setSelectedId(next.id);
  };

  const run = async (work: () => Promise<TelehealthSession>, success: string) => {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const next = await work();
      replaceSession(next);
      setMessage(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Telehealth command failed.');
    } finally {
      setBusy(false);
    }
  };

  const schedule = async (event: FormEvent) => {
    event.preventDefault();
    if (!patientId || !chiefComplaint.trim()) {
      setError('Select an authoritative patient and enter the clinical reason for the virtual visit.');
      return;
    }

    await run(
      () =>
        createTelehealthSession({
          patientId,
          type: visitType,
          chiefComplaint: chiefComplaint.trim(),
        }),
      'Telehealth encounter scheduled through the authoritative command boundary.'
    );
    setChiefComplaint('');
  };

  const changeMode = async (targetMode: ConnectivityMode, reason: string) => {
    if (!selected) return;
    await run(async () => {
      const result = await executeActiveTenantCommand<TelehealthSession>(
        'TransitionTelehealthConnectivityCommand',
        {
          sessionId: selected.id,
          targetMode,
          reason,
        }
      );
      if (!result.success || !result.data) {
        throw new Error(result.error?.message || 'Connectivity transition was rejected.');
      }
      return result.data;
    }, `Telehealth connectivity changed to ${modeLabel(targetMode)}.`);
  };

  const resume = async () => {
    if (!selected) return;
    await run(async () => {
      const result = await executeActiveTenantCommand<TelehealthSession>(
        'ResumeTelehealthSessionCommand',
        {
          sessionId: selected.id,
          expectedUpdatedAt: selected.updatedAt,
        }
      );
      if (!result.success || !result.data) {
        throw new Error(result.error?.message || 'Telehealth session recovery was rejected.');
      }
      return result.data;
    }, 'Interrupted telehealth session recovered from the last authoritative state.');
  };

  const signAndComplete = async () => {
    if (!selected) return;
    const note: Partial<TelehealthSoapNote> = {
      subjective: subjective.trim(),
      objective: objective.trim(),
      assessment: assessment.trim(),
      plan: plan.trim(),
    };

    if (!note.subjective || !note.assessment || !note.plan) {
      setError('Subjective, assessment and plan are required before signing the telehealth encounter.');
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');
    try {
      await completeTelehealthSession(selected.id, note, []);
      setMessage('Clinical note signed and telehealth encounter completed.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Telehealth signing failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5 pb-10">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Video className="h-5 w-5 text-teal-600" />
              <h1 className="text-lg font-bold">Governed Telehealth</h1>
            </div>
            <p className="mt-1 max-w-3xl text-xs text-slate-500">
              G-HIMS governs encounter continuity, browser WebRTC media, low-bandwidth fallback, recovery and clinical signing.
              Patient media is peer-to-peer; signaling remains server-governed and external prescribing is not implied.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs">
            {networkMode === 'offline' ? (
              <SignalLow className="h-4 w-4 text-amber-600" />
            ) : (
              <Signal className="h-4 w-4 text-emerald-600" />
            )}
            {networkMode}
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          <CheckCircle2 className="mr-2 inline h-4 w-4" />
          {message}
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h2 className="text-sm font-bold">Schedule virtual encounter</h2>
        <form onSubmit={schedule} className="mt-3 grid gap-3 md:grid-cols-3">
          <select
            value={patientId}
            onChange={(event) => setPatientId(event.target.value)}
            className="rounded-xl border bg-transparent p-2 text-sm"
          >
            <option value="">Select patient</option>
            {patients.map((patient) => (
              <option key={patient.id} value={patient.id}>
                {patient.fullName} — {patient.mrn}
              </option>
            ))}
          </select>
          <select
            value={visitType}
            onChange={(event) => setVisitType(event.target.value as TelehealthSession['type'])}
            className="rounded-xl border bg-transparent p-2 text-sm"
          >
            <option>Telehealth Consultation</option>
            <option>Remote Post-Op Follow-up</option>
            <option>RPM Chronic Care Review</option>
            <option>Urgent Tele-Triage</option>
          </select>
          <input
            value={chiefComplaint}
            onChange={(event) => setChiefComplaint(event.target.value)}
            placeholder="Clinical reason"
            className="rounded-xl border bg-transparent p-2 text-sm"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-xl bg-teal-600 px-4 py-2 text-xs font-bold text-white md:col-span-3 md:w-fit"
          >
            Schedule telehealth encounter
          </button>
        </form>
      </section>

      <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
        <section className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <h2 className="mb-3 text-sm font-bold">Sessions</h2>
          {sessions.length === 0 ? (
            <p className="rounded-xl border border-dashed p-5 text-center text-xs text-slate-500">
              No authoritative telehealth sessions are available.
            </p>
          ) : (
            <div className="space-y-2">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => setSelectedId(session.id)}
                  className={`w-full rounded-xl border p-3 text-left text-xs ${
                    selected?.id === session.id
                      ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30'
                      : 'border-slate-200 dark:border-slate-800'
                  }`}
                >
                  <div className="font-bold">{session.patientName}</div>
                  <div className="mt-1 text-slate-500">{session.chiefComplaint}</div>
                  <div className="mt-2 flex items-center justify-between">
                    <span>{session.status}</span>
                    <span>{modeLabel(session.connectionMode)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
          {!selected ? (
            <p className="text-sm text-slate-500">Select a telehealth session.</p>
          ) : (
            <div className="space-y-5">
              <div>
                <h2 className="font-bold">{selected.patientName}</h2>
                <p className="text-xs text-slate-500">
                  {selected.patientMrn} · {selected.status} · {modeLabel(selected.connectionMode)}
                </p>
              </div>

              {!['COMPLETED', 'CANCELLED'].includes(selected.status) && (
                <TelehealthCallPanel
                  key={`media:${selected.id}:${selected.roomToken}`}
                  session={selected}
                  tenantId={selected.tenantId || 'central-metro-hospital'}
                  disabled={busy || networkMode === 'offline'}
                  onConnected={async () => {
                    if (selected.connectionMode !== 'VIDEO' || selected.status !== 'IN_CONSULTATION') {
                      await changeMode('VIDEO', 'Patient and clinician WebRTC media connection established.');
                    }
                  }}
                />
              )}

              {!['COMPLETED', 'CANCELLED'].includes(selected.status) && (
                <div className="rounded-xl border p-4">
                  <div className="mb-3 flex items-center gap-2 text-xs font-bold">
                    <PhoneCall className="h-4 w-4" />
                    Connectivity resilience
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button disabled={busy} onClick={() => void changeMode('VIDEO', 'Clinician joined or restored video consultation.')} className="rounded-lg border px-3 py-2 text-xs">
                      Video
                    </button>
                    <button disabled={busy} onClick={() => void changeMode('AUDIO_ONLY', 'Bandwidth degraded; continuing clinically by audio.')} className="rounded-lg border px-3 py-2 text-xs">
                      Audio fallback
                    </button>
                    <button disabled={busy} onClick={() => void changeMode('TEXT_ONLY', 'Bandwidth insufficient for media; continuing with text fallback.')} className="rounded-lg border px-3 py-2 text-xs">
                      Text fallback
                    </button>
                    <button disabled={busy} onClick={() => void changeMode('PAUSED_OFFLINE', 'Connectivity lost; encounter paused without fabricating continuity.')} className="rounded-lg border px-3 py-2 text-xs">
                      Pause offline
                    </button>
                    {selected.recoveryState === 'INTERRUPTED' && (
                      <button disabled={busy} onClick={() => void resume()} className="rounded-lg bg-teal-600 px-3 py-2 text-xs font-bold text-white">
                        <RefreshCw className="mr-1 inline h-3.5 w-3.5" />
                        Resume from authoritative state
                      </button>
                    )}
                  </div>
                </div>
              )}

              {selected.status !== 'COMPLETED' && (
                <div className="space-y-3 rounded-xl border p-4">
                  <div className="flex items-center gap-2 text-xs font-bold">
                    <FileSignature className="h-4 w-4" />
                    Clinician-authored final note
                  </div>
                  <textarea value={subjective} onChange={(event) => setSubjective(event.target.value)} placeholder="Subjective" className="min-h-20 w-full rounded-xl border bg-transparent p-2 text-sm" />
                  <textarea value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="Objective" className="min-h-20 w-full rounded-xl border bg-transparent p-2 text-sm" />
                  <textarea value={assessment} onChange={(event) => setAssessment(event.target.value)} placeholder="Assessment" className="min-h-20 w-full rounded-xl border bg-transparent p-2 text-sm" />
                  <textarea value={plan} onChange={(event) => setPlan(event.target.value)} placeholder="Plan" className="min-h-20 w-full rounded-xl border bg-transparent p-2 text-sm" />
                  <button disabled={busy} onClick={() => void signAndComplete()} className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white">
                    Sign note & complete encounter
                  </button>
                </div>
              )}

              <div className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-[11px] text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                Low-bandwidth transitions and recovery are audited server-side. Clinical completion requires signed encounter evidence; this surface does not fabricate prescriptions, biometric telemetry, or certification claims.
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
