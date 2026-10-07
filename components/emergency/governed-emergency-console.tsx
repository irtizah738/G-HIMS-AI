'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
} from 'lucide-react';
import { executeActiveTenantCommand } from '@/lib/api/command-client';
import {
  hydrateEdgeSnapshot,
  loadLocalEdgeSnapshot,
} from '@/lib/offline/hydration';

interface EmergencyEncounterProjection {
  id: string;
  encounterId: string;
  patientId: string;
  encounterType: string;
  status: string;
  currentStage: string;
  clinicalState: string;
  departmentId: string;
  chiefComplaint: string;
  priority: string;
  assignedProviderId?: string;
  startedAt?: number;
  createdAt?: number;
}

interface PatientProjection {
  id: string;
  fullName: string;
  mrn: string;
  status?: string;
}

type ProjectionSource = 'LOCAL_EDGE' | 'SERVER';

function normalizeEncounter(row: Record<string, unknown>): EmergencyEncounterProjection {
  return {
    id: String(row.id || row.encounterId || ''),
    encounterId: String(row.encounterId || row.id || ''),
    patientId: String(row.patientId || ''),
    encounterType: String(row.encounterType || row.type || '').toUpperCase(),
    status: String(row.status || ''),
    currentStage: String(row.currentStage || row.currentStageId || ''),
    clinicalState: String(row.clinicalState || row.currentStage || row.currentStageId || ''),
    departmentId: String(row.departmentId || row.department || ''),
    chiefComplaint: String(row.chiefComplaint || ''),
    priority: String(row.priority || 'ROUTINE').toUpperCase(),
    assignedProviderId: row.assignedProviderId
      ? String(row.assignedProviderId)
      : row.assignedDoctor
        ? String(row.assignedDoctor)
        : undefined,
    startedAt: Number(row.startedAt || row.createdAt || 0) || undefined,
    createdAt: Number(row.createdAt || row.startedAt || 0) || undefined,
  };
}

function normalizePatient(row: Record<string, unknown>): PatientProjection {
  return {
    id: String(row.id || row.patientId || ''),
    fullName: String(row.fullName || ''),
    mrn: String(row.mrn || ''),
    status: row.status ? String(row.status) : undefined,
  };
}

function priorityClass(priority: string): string {
  if (priority === 'STAT' || priority === 'EMERGENCY') {
    return 'border-rose-300 bg-rose-50 text-rose-800';
  }
  if (priority === 'URGENT') {
    return 'border-orange-300 bg-orange-50 text-orange-800';
  }
  return 'border-slate-200 bg-slate-50 text-slate-700';
}

/**
 * DRP-S Emergency staging surface.
 *
 * It intentionally does not reproduce the old synthetic ED engine. Every row is
 * hydrated from the authenticated tenant projection and every mutation crosses
 * the authoritative command boundary.
 */
export function GovernedEmergencyConsole() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = String(params?.tenantId || '').trim().toLowerCase();

  const [encounters, setEncounters] = useState<EmergencyEncounterProjection[]>([]);
  const [patients, setPatients] = useState<PatientProjection[]>([]);
  const [source, setSource] = useState<ProjectionSource>('LOCAL_EDGE');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  const [patientId, setPatientId] = useState('');
  const [chiefComplaint, setChiefComplaint] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [priority, setPriority] = useState<'STAT' | 'URGENT' | 'ROUTINE'>('URGENT');
  const [creating, setCreating] = useState(false);

  const [selectedEncounterId, setSelectedEncounterId] = useState('');
  const [heartRate, setHeartRate] = useState<number | ''>('');
  const [bloodPressure, setBloodPressure] = useState('');
  const [temperature, setTemperature] = useState<number | ''>('');
  const [respiratoryRate, setRespiratoryRate] = useState<number | ''>('');
  const [oxygenSaturation, setOxygenSaturation] = useState<number | ''>('');
  const [recordingVitals, setRecordingVitals] = useState(false);

  const applySnapshot = useCallback(
    (snapshot: Awaited<ReturnType<typeof loadLocalEdgeSnapshot>>) => {
      const allEncounters = (snapshot.collections.encounters || [])
        .map((row) => normalizeEncounter(row))
        .filter(
          (encounter) =>
            encounter.encounterType === 'EMERGENCY' &&
            !['COMPLETED', 'DISCHARGED', 'TRANSFERRED', 'CANCELLED'].includes(
              encounter.status.toUpperCase()
            )
        )
        .sort(
          (a, b) =>
            Number(b.startedAt || b.createdAt || 0) -
            Number(a.startedAt || a.createdAt || 0)
        );

      const activePatients = (snapshot.collections.patients || [])
        .map((row) => normalizePatient(row))
        .filter(
          (patient) =>
            patient.id &&
            !['MERGED', 'DECEASED', 'INACTIVE'].includes(
              String(patient.status || 'ACTIVE').toUpperCase()
            )
        )
        .sort((a, b) => a.fullName.localeCompare(b.fullName));

      setEncounters(allEncounters);
      setPatients(activePatients);
    },
    []
  );

  const refresh = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setMessage('');

    try {
      const local = await loadLocalEdgeSnapshot(tenantId, 'CLINICAL');
      applySnapshot(local);
      setSource('LOCAL_EDGE');

      const server = await hydrateEdgeSnapshot(tenantId, { surface: 'CLINICAL' });
      applySnapshot(server);
      setSource(server.source === 'SERVER' ? 'SERVER' : 'LOCAL_EDGE');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Emergency projection could not be refreshed.'
      );
    } finally {
      setLoading(false);
    }
  }, [applySnapshot, tenantId]);

  useEffect(() => {
    void refresh();

    const onSync = (event: Event) => {
      const detail = (event as CustomEvent<{ tenantId?: string }>).detail;
      if (
        String(detail?.tenantId || '').trim().toLowerCase() === tenantId
      ) {
        void refresh();
      }
    };

    window.addEventListener('ghims:edge-sync-complete', onSync);
    return () => window.removeEventListener('ghims:edge-sync-complete', onSync);
  }, [refresh, tenantId]);

  const patientsById = useMemo(
    () => Object.fromEntries(patients.map((patient) => [patient.id, patient])),
    [patients]
  );

  const selectedEncounter = encounters.find(
    (encounter) => encounter.encounterId === selectedEncounterId
  );

  const createEmergencyEncounter = async (event: FormEvent) => {
    event.preventDefault();

    if (
      !patientId ||
      !chiefComplaint.trim() ||
      !departmentId.trim() ||
      creating
    ) {
      setMessage(
        'Select an authoritative patient and provide the emergency department/service and chief complaint.'
      );
      return;
    }

    try {
      setCreating(true);
      setMessage('');
      const result = await executeActiveTenantCommand(
        'CreateEncounterCommand',
        {
          patientId,
          encounterType: 'EMERGENCY',
          chiefComplaint: chiefComplaint.trim(),
          departmentId: departmentId.trim(),
          priority,
        },
        {
          offlineQueue: {
            enabled: true,
            collection: 'encounters',
            resourceId: `local-emergency-${crypto.randomUUID()}`,
            action: 'CREATE',
            optimisticCache: false,
          },
        }
      );

      if (!result.success) {
        throw new Error(result.error?.message || 'Emergency encounter was rejected.');
      }

      setChiefComplaint('');
      setMessage(
        result.queuedOffline
          ? 'Emergency encounter intent is encrypted in the offline outbox. It is not shown as authoritative until server replay succeeds.'
          : 'Emergency encounter created through the authoritative command boundary.'
      );
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Emergency encounter could not be created.'
      );
    } finally {
      setCreating(false);
    }
  };

  const recordVitals = async (event: FormEvent) => {
    event.preventDefault();

    if (!selectedEncounter) {
      setMessage('Select an emergency encounter before recording vitals.');
      return;
    }

    if (
      typeof heartRate !== 'number' ||
      !bloodPressure.trim() ||
      typeof temperature !== 'number' ||
      typeof respiratoryRate !== 'number' ||
      typeof oxygenSaturation !== 'number'
    ) {
      setMessage(
        'Complete HR, BP, temperature, respiratory rate and SpO₂. G-HIMS will not infer missing vital signs.'
      );
      return;
    }

    try {
      setRecordingVitals(true);
      setMessage('');
      const result = await executeActiveTenantCommand(
        'RecordVitalsCommand',
        {
          patientId: selectedEncounter.patientId,
          encounterId: selectedEncounter.encounterId,
          heartRate,
          bloodPressure: bloodPressure.trim(),
          temperature,
          respiratoryRate,
          oxygenSaturation,
          measuredAt: Date.now(),
        },
        {
          offlineQueue: {
            enabled: true,
            collection: 'vitals',
            resourceId: `local-vitals-${crypto.randomUUID()}`,
            action: 'CREATE',
            optimisticCache: false,
          },
        }
      );

      if (!result.success) {
        throw new Error(result.error?.message || 'Vitals command was rejected.');
      }

      setHeartRate('');
      setBloodPressure('');
      setTemperature('');
      setRespiratoryRate('');
      setOxygenSaturation('');
      setMessage(
        result.queuedOffline
          ? 'Vitals are encrypted in the offline outbox and remain pending authoritative replay.'
          : 'Vitals recorded through the authoritative clinical command boundary.'
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Vitals could not be recorded.'
      );
    } finally {
      setRecordingVitals(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-rose-600" />
              <h1 className="text-lg font-black">Emergency Clinical Operations</h1>
            </div>
            <p className="mt-2 max-w-4xl text-sm text-slate-600 dark:text-slate-400">
              Authenticated emergency encounters only. No synthetic patients, ESI
              classifications, ambulance telemetry, diagnoses or treatment plans are
              generated by this staging surface.
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 font-semibold text-emerald-800">
                <ShieldCheck className="h-3.5 w-3.5" />
                CommandBus mutations
              </span>
              <span className="rounded-full border border-slate-200 px-2 py-1 font-semibold dark:border-slate-700">
                Projection: {source}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50 dark:border-slate-700"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {message ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {message}
          </div>
        ) : null}
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <form
          onSubmit={createEmergencyEncounter}
          className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-800 dark:bg-slate-900"
        >
          <div>
            <h2 className="font-black">Open emergency encounter</h2>
            <p className="mt-1 text-xs text-slate-500">
              Existing authoritative patient identities only. New identities must be
              registered through MPI first.
            </p>
          </div>

          <select
            value={patientId}
            onChange={(event) => setPatientId(event.target.value)}
            required
            className="w-full rounded-xl border border-slate-300 p-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="">Select patient</option>
            {patients.map((patient) => (
              <option key={patient.id} value={patient.id}>
                {patient.fullName || 'Unnamed patient'} · {patient.mrn || patient.id}
              </option>
            ))}
          </select>

          <input
            value={departmentId}
            onChange={(event) => setDepartmentId(event.target.value)}
            required
            placeholder="Emergency department/service ID"
            className="w-full rounded-xl border border-slate-300 p-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          />

          <textarea
            value={chiefComplaint}
            onChange={(event) => setChiefComplaint(event.target.value)}
            required
            rows={3}
            placeholder="Clinician-entered chief complaint"
            className="w-full rounded-xl border border-slate-300 p-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          />

          <select
            value={priority}
            onChange={(event) =>
              setPriority(event.target.value as 'STAT' | 'URGENT' | 'ROUTINE')
            }
            className="w-full rounded-xl border border-slate-300 p-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="STAT">STAT</option>
            <option value="URGENT">Urgent</option>
            <option value="ROUTINE">Routine</option>
          </select>

          <button
            type="submit"
            disabled={creating}
            className="rounded-xl bg-rose-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create governed ED encounter'}
          </button>
        </form>

        <form
          onSubmit={recordVitals}
          className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 dark:border-slate-800 dark:bg-slate-900"
        >
          <div>
            <h2 className="font-black">Record emergency vitals</h2>
            <p className="mt-1 text-xs text-slate-500">
              Vitals are appended through RecordVitalsCommand and may queue securely
              offline. No NEWS2/ESI value is fabricated here.
            </p>
          </div>

          <select
            value={selectedEncounterId}
            onChange={(event) => setSelectedEncounterId(event.target.value)}
            required
            className="w-full rounded-xl border border-slate-300 p-2 text-sm dark:border-slate-700 dark:bg-slate-950"
          >
            <option value="">Select emergency encounter</option>
            {encounters.map((encounter) => {
              const patient = patientsById[encounter.patientId];
              return (
                <option key={encounter.encounterId} value={encounter.encounterId}>
                  {patient?.fullName || encounter.patientId} · {encounter.encounterId}
                </option>
              );
            })}
          </select>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <input
              type="number"
              value={heartRate}
              onChange={(event) =>
                setHeartRate(event.target.value === '' ? '' : Number(event.target.value))
              }
              placeholder="HR"
              className="rounded-xl border border-slate-300 p-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            <input
              value={bloodPressure}
              onChange={(event) => setBloodPressure(event.target.value)}
              placeholder="BP 120/80"
              className="rounded-xl border border-slate-300 p-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            <input
              type="number"
              step="0.1"
              value={temperature}
              onChange={(event) =>
                setTemperature(event.target.value === '' ? '' : Number(event.target.value))
              }
              placeholder="Temp °C"
              className="rounded-xl border border-slate-300 p-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            <input
              type="number"
              value={respiratoryRate}
              onChange={(event) =>
                setRespiratoryRate(
                  event.target.value === '' ? '' : Number(event.target.value)
                )
              }
              placeholder="RR"
              className="rounded-xl border border-slate-300 p-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            <input
              type="number"
              value={oxygenSaturation}
              onChange={(event) =>
                setOxygenSaturation(
                  event.target.value === '' ? '' : Number(event.target.value)
                )
              }
              placeholder="SpO₂"
              className="rounded-xl border border-slate-300 p-2 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <button
            type="submit"
            disabled={recordingVitals}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {recordingVitals ? 'Recording…' : 'Record governed vitals'}
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <h2 className="font-black">Active emergency encounters</h2>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {encounters.map((encounter) => {
            const patient = patientsById[encounter.patientId];
            return (
              <div
                key={encounter.encounterId}
                className="grid gap-3 px-5 py-4 lg:grid-cols-[1.1fr_1fr_1fr_auto] lg:items-center"
              >
                <div>
                  <div className="font-black">
                    {patient?.fullName || encounter.patientId}
                  </div>
                  <div className="text-xs text-slate-500">
                    {patient?.mrn || 'MRN unavailable'} · {encounter.encounterId}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-semibold">
                    {encounter.chiefComplaint || 'Chief complaint not projected'}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">
                    {encounter.departmentId || 'Department not projected'}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className={`rounded-full border px-2 py-1 text-xs font-bold ${priorityClass(encounter.priority)}`}>
                    {encounter.priority}
                  </span>
                  <span className="rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold">
                    {encounter.clinicalState || encounter.currentStage || 'STATE UNKNOWN'}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Link
                    href={`/${tenantId}/patients/${encounter.patientId}/360`}
                    className="inline-flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-2 text-xs font-bold text-white"
                  >
                    <Stethoscope className="h-3.5 w-3.5" />
                    Patient 360
                  </Link>
                </div>
              </div>
            );
          })}

          {!loading && encounters.length === 0 ? (
            <div className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500">
              <AlertTriangle className="h-4 w-4" />
              No active authoritative emergency encounters are available.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
