'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BedDouble, RefreshCw, ShieldCheck, Wrench } from 'lucide-react';
import {
  hydrateFacilitiesProjection,
  loadLocalFacilitiesProjection,
  updateBedOperationalStatusEdge,
} from '@/lib/facilities/facilities-edge-adapter';
import { loadActiveDeteriorationCensus } from '@/lib/clinical/intelligence/clinical-deterioration-client';
import type { DeteriorationProjection } from '@/types/clinical-deterioration';
import type { Bed, BedStatus } from '@/lib/types/ghims';

type ProjectionSource = 'LOCAL_EDGE' | 'SERVER';

function statusClass(status: BedStatus): string {
  switch (status) {
    case 'available':
      return 'border-emerald-200 bg-emerald-50 text-emerald-800';
    case 'occupied':
      return 'border-rose-200 bg-rose-50 text-rose-800';
    case 'cleaning':
      return 'border-amber-200 bg-amber-50 text-amber-800';
    case 'maintenance':
      return 'border-slate-300 bg-slate-100 text-slate-800';
    case 'reserved':
      return 'border-indigo-200 bg-indigo-50 text-indigo-800';
  }
}

function deteriorationClass(projection?: DeteriorationProjection): string {
  if (!projection) return 'border-slate-200 bg-slate-50 text-slate-600';
  if (projection.state === 'CRITICAL_REVIEW_REQUIRED') {
    return 'border-rose-300 bg-rose-50 text-rose-800';
  }
  if (projection.state === 'ESCALATION_REQUIRED') {
    return 'border-orange-300 bg-orange-50 text-orange-800';
  }
  if (projection.state === 'WATCH') {
    return 'border-amber-300 bg-amber-50 text-amber-800';
  }
  return 'border-emerald-200 bg-emerald-50 text-emerald-800';
}

/**
 * STAGING/PILOT bed operations surface.
 *
 * Authority split:
 * - Facilities owns bed identity and physical readiness.
 * - Clinical Care owns admission, transfer and discharge.
 * - CI-8 owns deterioration/escalation state.
 *
 * This component never derives NEWS2 or deterioration from Bed metadata and
 * never mutates patient occupancy directly.
 */
export function GovernedBedBoard() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = String(params?.tenantId || '').trim().toLowerCase();
  const [beds, setBeds] = useState<Bed[]>([]);
  const [source, setSource] = useState<ProjectionSource>('LOCAL_EDGE');
  const [deteriorationByEncounter, setDeteriorationByEncounter] = useState<
    Record<string, DeteriorationProjection>
  >({});
  const [loading, setLoading] = useState(true);
  const [busyBedId, setBusyBedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string>('');

  const refresh = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    setMessage('');

    try {
      const local = await loadLocalFacilitiesProjection(tenantId);
      setBeds(local.beds || []);
      setSource('LOCAL_EDGE');

      const [server, deterioration] = await Promise.all([
        hydrateFacilitiesProjection(tenantId),
        loadActiveDeteriorationCensus(tenantId),
      ]);

      setBeds(server.beds || []);
      setSource('SERVER');
      setDeteriorationByEncounter(
        Object.fromEntries(
          (deterioration.projections || []).map((item) => [
            item.encounterId,
            item,
          ])
        )
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Authoritative bed projection could not be refreshed.'
      );
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

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

  const summary = useMemo(
    () => ({
      total: beds.length,
      occupied: beds.filter((bed) => bed.status === 'occupied').length,
      available: beds.filter((bed) => bed.status === 'available').length,
      cleaning: beds.filter((bed) => bed.status === 'cleaning').length,
      maintenance: beds.filter((bed) => bed.status === 'maintenance').length,
      escalations: beds.filter((bed) => {
        const encounterId = bed.currentEncounterId;
        const projection = encounterId
          ? deteriorationByEncounter[encounterId]
          : undefined;
        return (
          projection?.state === 'ESCALATION_REQUIRED' ||
          projection?.state === 'CRITICAL_REVIEW_REQUIRED'
        );
      }).length,
    }),
    [beds, deteriorationByEncounter]
  );

  const changeOperationalStatus = async (
    bed: Bed,
    status: Extract<BedStatus, 'available' | 'cleaning' | 'maintenance'>
  ) => {
    if (bed.status === 'occupied' || bed.status === 'reserved') {
      setMessage(
        'Clinical occupancy/holds cannot be changed by the Facilities bed-readiness workflow.'
      );
      return;
    }

    try {
      setBusyBedId(bed.id);
      setMessage('');
      await updateBedOperationalStatusEdge({
        bedId: bed.id,
        status,
        notes: `Bed Board operational readiness transition to ${status}.`,
      });
      await refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Bed readiness update failed.'
      );
    } finally {
      setBusyBedId(null);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <BedDouble className="h-5 w-5 text-blue-600" />
              <h1 className="text-lg font-black">Authoritative Bed & Capacity Board</h1>
            </div>
            <p className="mt-2 max-w-4xl text-sm text-slate-600 dark:text-slate-400">
              Facilities owns physical bed readiness. Admission, transfer and discharge
              remain governed Clinical Care transitions. CI-8 is consumed as an
              authoritative projection; this board never computes deterioration locally.
            </p>
            <p className="mt-2 text-xs font-semibold text-slate-500">
              NEWS2: Not recorded on the Bed Board. Never infer NEWS2 from bed class,
              isolation status, notes, vitalAlert, or other resource metadata.
            </p>
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

        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full border border-slate-200 px-2 py-1 font-semibold dark:border-slate-700">
            Source: {source}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 font-semibold text-emerald-800">
            <ShieldCheck className="h-3.5 w-3.5" />
            Server-authoritative occupancy
          </span>
        </div>

        {message ? (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {message}
          </div>
        ) : null}
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['Total', summary.total],
          ['Occupied', summary.occupied],
          ['Available', summary.available],
          ['Cleaning', summary.cleaning],
          ['Maintenance', summary.maintenance],
          ['CI-8 escalation', summary.escalations],
        ].map(([label, value]) => (
          <div
            key={String(label)}
            className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              {label}
            </div>
            <div className="mt-1 text-2xl font-black">{value}</div>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-200 px-5 py-3 dark:border-slate-800">
          <h2 className="font-black">Bed projection</h2>
          <p className="mt-1 text-xs text-slate-500">
            The Bed Board will not infer escalation from raw bed or NEWS2 metadata.
          </p>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {beds.map((bed) => {
            const encounterId = bed.currentEncounterId;
            const deterioration = encounterId
              ? deteriorationByEncounter[encounterId]
              : undefined;
            const patientId = bed.currentPatientId || bed.patientId;
            const operationalOnly =
              bed.status !== 'occupied' && bed.status !== 'reserved';

            return (
              <div key={bed.id} className="grid gap-3 px-5 py-4 lg:grid-cols-[1.1fr_1fr_1.2fr_1.4fr] lg:items-center">
                <div>
                  <div className="font-black">{bed.bedNumber}</div>
                  <div className="text-xs text-slate-500">
                    {bed.ward} · {bed.room || bed.roomId || 'Room not assigned'}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">
                    {bed.facilityName || bed.facilityId || 'Facility scope unavailable'}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <span className={`rounded-full border px-2 py-1 text-xs font-bold ${statusClass(bed.status)}`}>
                    {bed.status}
                  </span>
                  <span className={`rounded-full border px-2 py-1 text-xs font-bold ${deteriorationClass(deterioration)}`}>
                    CI-8: {deterioration?.state || 'NOT_EVALUATED'}
                  </span>
                </div>

                <div>
                  {patientId ? (
                    <>
                      <div className="text-sm font-semibold">
                        {bed.patientName || patientId}
                      </div>
                      <div className="text-xs text-slate-500">
                        Encounter: {encounterId || 'not projected'}
                      </div>
                      <Link
                        href={`/${tenantId}/patients/${patientId}/360`}
                        className="mt-2 inline-flex text-xs font-bold text-blue-600 hover:underline"
                      >
                        Open Patient 360 / CI review
                      </Link>
                    </>
                  ) : (
                    <div className="text-sm text-slate-500">
                      No active patient occupancy.
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-2 lg:justify-end">
                  {operationalOnly ? (
                    <>
                      {bed.status !== 'available' ? (
                        <button
                          type="button"
                          disabled={busyBedId === bed.id}
                          onClick={() => void changeOperationalStatus(bed, 'available')}
                          className="rounded-lg border border-emerald-300 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 disabled:opacity-50"
                        >
                          Mark available
                        </button>
                      ) : null}
                      {bed.status !== 'cleaning' ? (
                        <button
                          type="button"
                          disabled={busyBedId === bed.id}
                          onClick={() => void changeOperationalStatus(bed, 'cleaning')}
                          className="rounded-lg border border-amber-300 px-2.5 py-1.5 text-xs font-semibold text-amber-800 disabled:opacity-50"
                        >
                          Cleaning
                        </button>
                      ) : null}
                      {bed.status !== 'maintenance' ? (
                        <button
                          type="button"
                          disabled={busyBedId === bed.id}
                          onClick={() => void changeOperationalStatus(bed, 'maintenance')}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50"
                        >
                          <Wrench className="h-3.5 w-3.5" />
                          Maintenance
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <div className="max-w-xs rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                      Clinical occupancy is read-only here. Use the governed patient
                      encounter/care-transition workflow for admission, transfer or discharge.
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {!loading && beds.length === 0 ? (
            <div className="flex items-center gap-2 px-5 py-8 text-sm text-slate-500">
              <AlertTriangle className="h-4 w-4" />
              No authorized bed projection is currently available.
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
