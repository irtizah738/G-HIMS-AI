'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertTriangle,
  Barcode,
  Eye,
  LockKeyhole,
  Plus,
  ShieldCheck,
  UnlockKeyhole,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {
  ComprehensiveOpdEncounter,
  DiagnosticCategory,
  DiagnosticOrderItem,
} from '@/types/opd-domain';

const IS_DEMO_RUNTIME =
  process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE === 'DEMO';

interface OpdDiagnosticOrdersPacsProps {
  encounter: ComprehensiveOpdEncounter;
  orders: DiagnosticOrderItem[];
  onAddOrder: (order: DiagnosticOrderItem) => void | Promise<void>;
  onAdvanceOrderWorklist: (
    orderId: string,
    targetStatus: 'SPECIMEN_COLLECTED' | 'IN_PROCESSING'
  ) => void | Promise<void>;
}

interface DiagnosticCatalogChoice {
  code: string;
  name: string;
  category: DiagnosticCategory;
  consentNeeded?: boolean;
}

/**
 * Selection metadata only.
 *
 * This list is not a pricing or execution authority. The server resolves the
 * selected code against tenant billingServiceCatalog and owns description,
 * price, specimen identity, consent policy, invoice, AR, GL and worklist state.
 */
const CATALOG_ITEMS: DiagnosticCatalogChoice[] = [
  {
    code: 'LAB-CBC-01',
    name: 'Complete Blood Count (CBC) with Differential',
    category: 'LABORATORY',
  },
  {
    code: 'LAB-RFT-02',
    name: 'Renal Function Test',
    category: 'LABORATORY',
  },
  {
    code: 'LAB-BNP-03',
    name: 'Serum NT-proBNP Quantitative',
    category: 'LABORATORY',
  },
  {
    code: 'LAB-HBA1C-04',
    name: 'Glycated Hemoglobin (HbA1c)',
    category: 'LABORATORY',
  },
  {
    code: 'RAD-CXR-01',
    name: 'Chest X-Ray',
    category: 'RADIOLOGY',
  },
  {
    code: 'RAD-ECHO-02',
    name: 'Transthoracic Echocardiogram',
    category: 'RADIOLOGY',
  },
  {
    code: 'RAD-USG-03',
    name: 'Abdominal & Pelvic Ultrasound',
    category: 'RADIOLOGY',
  },
  {
    code: 'PROC-ECG-01',
    name: '12-Lead Diagnostic ECG',
    category: 'PROCEDURE',
  },
  {
    code: 'PROC-NEB-02',
    name: 'Therapeutic Nebulization Session',
    category: 'PROCEDURE',
  },
  {
    code: 'PROC-DRS-03',
    name: 'Minor Wound Debridement & Dressing',
    category: 'PROCEDURE',
    consentNeeded: true,
  },
];

function orderType(order: DiagnosticOrderItem): 'LAB' | 'RADIOLOGY' | 'PROCEDURE' {
  const type = String(order.type || order.category || '').toUpperCase();
  if (type === 'RADIOLOGY') return 'RADIOLOGY';
  if (type === 'PROCEDURE') return 'PROCEDURE';
  return 'LAB';
}

function revenueStatusLabel(order: DiagnosticOrderItem): string {
  if (order.revenueLockStatus === 'UNLOCKED_STAT_OVERRIDE') {
    return 'STAT emergency override';
  }
  if (order.revenueLockStatus === 'PAID_SETTLED') {
    return 'Payment cleared';
  }
  return 'Payment required';
}

export function OpdDiagnosticOrdersPacs({
  encounter,
  orders,
  onAddOrder,
  onAdvanceOrderWorklist,
}: OpdDiagnosticOrdersPacsProps) {
  const [selectedCatalogCode, setSelectedCatalogCode] = useState(
    CATALOG_ITEMS[0].code
  );
  const [urgency, setUrgency] = useState<
    'ROUTINE' | 'URGENT' | 'STAT_EMERGENCY'
  >('ROUTINE');
  const [clinicalReason, setClinicalReason] = useState(
    IS_DEMO_RUNTIME
      ? 'Evaluation of exertional dyspnea in the current encounter.'
      : ''
  );
  const [statOverrideReason, setStatOverrideReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [activeDicomViewerOrder, setActiveDicomViewerOrder] =
    useState<DiagnosticOrderItem | null>(null);

  const [zoomLevel, setZoomLevel] = useState(100);
  const [invert, setInvert] = useState(false);

  const selectedItem =
    CATALOG_ITEMS.find((item) => item.code === selectedCatalogCode) ||
    CATALOG_ITEMS[0];

  const handleCreateOrder = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!clinicalReason.trim()) {
      throw new Error(
        'CLINICAL_INDICATION_REQUIRED: document the indication before ordering.'
      );
    }
    if (selectedItem.consentNeeded) {
      throw new Error(
        'PROCEDURE_SPECIFIC_CONSENT_REQUIRED: this service must use the governed procedure-consent workflow.'
      );
    }
    if (
      urgency === 'STAT_EMERGENCY' &&
      statOverrideReason.trim().length < 10
    ) {
      throw new Error(
        'STAT_OVERRIDE_REASON_REQUIRED: document the emergency reason for bypassing the payment execution lock.'
      );
    }

    const intent: DiagnosticOrderItem = {
      id: `intent-${crypto.randomUUID()}`,
      type:
        selectedItem.category === 'RADIOLOGY'
          ? 'RADIOLOGY'
          : selectedItem.category === 'PROCEDURE'
            ? 'PROCEDURE'
            : 'LABORATORY',
      category: selectedItem.category,
      testCode: selectedItem.code,
      testName: selectedItem.name,
      urgency,
      clinicalIndication: clinicalReason.trim(),
      reasonForOrder: clinicalReason.trim(),
      ...(urgency === 'STAT_EMERGENCY'
        ? { statOverrideReason: statOverrideReason.trim() }
        : {}),
      orderedAt: Date.now(),
    };

    setSubmitting(true);
    try {
      await onAddOrder(intent);
      setStatOverrideReason('');
    } finally {
      setSubmitting(false);
    }
  };

  const authoritativeTotalMinorUnits = orders.reduce(
    (sum, order) =>
      sum +
      (Number.isSafeInteger(order.costAmountMinorUnits)
        ? Number(order.costAmountMinorUnits)
        : 0),
    0
  );

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div>
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-slate-100">
            <Activity className="h-5 w-5 text-purple-600" />
            Diagnostics, LIS / RIS and Procedures
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Clinical intent is entered here. Price, specimen identity, payment
            clearance and execution state are server-authoritative.
          </p>
        </div>

        <form
          onSubmit={(event) => void handleCreateOrder(event)}
          className="grid grid-cols-1 gap-3 pt-2 sm:grid-cols-4"
        >
          <div className="sm:col-span-2">
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Investigation / procedure
            </label>
            <select
              value={selectedCatalogCode}
              onChange={(event) => setSelectedCatalogCode(event.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-800"
            >
              {CATALOG_ITEMS.map((item) => (
                <option
                  key={item.code}
                  value={item.code}
                  disabled={item.consentNeeded}
                >
                  {item.name}
                  {item.consentNeeded
                    ? ' — procedure consent workflow required'
                    : ''}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[10px] text-slate-400">
              Charge amount is resolved from the tenant billing catalogue after
              submission.
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Priority
            </label>
            <select
              value={urgency}
              onChange={(event) =>
                setUrgency(
                  event.target.value as
                    | 'ROUTINE'
                    | 'URGENT'
                    | 'STAT_EMERGENCY'
                )
              }
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold dark:border-slate-700 dark:bg-slate-800"
            >
              <option value="ROUTINE">Routine</option>
              <option value="URGENT">Urgent</option>
              <option value="STAT_EMERGENCY">
                STAT emergency — audited override
              </option>
            </select>
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={submitting || selectedItem.consentNeeded}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-purple-600 py-2 text-xs font-bold text-white shadow-xs hover:bg-purple-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
              {submitting ? 'Submitting…' : 'Dispatch order'}
            </button>
          </div>

          <div className="sm:col-span-4">
            <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Clinical indication
            </label>
            <textarea
              required
              value={clinicalReason}
              onChange={(event) => setClinicalReason(event.target.value)}
              rows={2}
              maxLength={4000}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"
              placeholder="Document the clinical question or indication."
            />
          </div>

          {urgency === 'STAT_EMERGENCY' && (
            <div className="sm:col-span-4">
              <label className="mb-1 block text-xs font-semibold text-rose-700">
                Emergency payment-lock override reason
              </label>
              <textarea
                required
                minLength={10}
                maxLength={4000}
                value={statOverrideReason}
                onChange={(event) =>
                  setStatOverrideReason(event.target.value)
                }
                rows={2}
                className="w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-900"
                placeholder="Document why immediate execution is clinically required before payment."
              />
            </div>
          )}
        </form>
      </div>

      <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Diagnostic worklist ({orders.length})
          </h3>
          <span className="text-xs font-normal text-slate-400">
            Authoritative ordered amount: PKR{' '}
            {(authoritativeTotalMinorUnits / 100).toLocaleString()}
          </span>
        </div>

        {orders.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-200 py-10 text-center dark:border-slate-800">
            <Activity className="mx-auto mb-2 h-8 w-8 text-slate-400" />
            <p className="text-xs font-bold text-slate-500">
              No diagnostic orders for this encounter.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-400">
                <tr>
                  <th className="p-3">Service</th>
                  <th className="p-3">Specimen / accession</th>
                  <th className="p-3">Priority</th>
                  <th className="p-3">Financial gate</th>
                  <th className="p-3">Worklist</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {orders.map((order) => {
                  const type = orderType(order);
                  const blocked =
                    order.revenueLockStatus ===
                      'PENDING_PAYMENT_CLEARANCE' ||
                    order.worklistStatus === 'BLOCKED_BY_REVENUE_GATE';
                  const ready =
                    order.worklistStatus === 'READY_FOR_EXECUTION';
                  const specimenCollected =
                    order.worklistStatus === 'SPECIMEN_COLLECTED';
                  const processing =
                    order.worklistStatus === 'IN_PROCESSING';
                  const finalized =
                    order.worklistStatus === 'FINALIZED';

                  return (
                    <tr
                      key={order.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                    >
                      <td className="p-3">
                        <p className="font-bold text-slate-900 dark:text-slate-100">
                          {order.testName}
                        </p>
                        <p className="font-mono text-[10px] text-slate-400">
                          {order.testCode}
                        </p>
                        {Number.isSafeInteger(order.costAmountMinorUnits) &&
                          Number(order.costAmountMinorUnits) > 0 && (
                            <p className="mt-1 text-[10px] text-slate-500">
                              {order.currency || 'PKR'}{' '}
                              {(
                                Number(order.costAmountMinorUnits) / 100
                              ).toLocaleString()}
                            </p>
                          )}
                      </td>

                      <td className="p-3">
                        {order.specimenBarcode ? (
                          <div className="flex items-center gap-1.5 font-mono text-[11px] font-bold text-blue-600">
                            <Barcode className="h-3.5 w-3.5" />
                            {order.specimenBarcode}
                          </div>
                        ) : (
                          <span className="text-slate-400">
                            {type === 'LAB'
                              ? 'Server specimen identity pending'
                              : 'Non-specimen service'}
                          </span>
                        )}
                      </td>

                      <td className="p-3">
                        <span
                          className={
                            order.urgency === 'STAT_EMERGENCY'
                              ? 'rounded bg-red-100 px-2 py-0.5 text-[10px] font-extrabold text-red-800'
                              : order.urgency === 'URGENT'
                                ? 'rounded bg-amber-100 px-2 py-0.5 text-[10px] font-extrabold text-amber-800'
                                : 'rounded bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold text-slate-700'
                          }
                        >
                          {order.urgency || 'ROUTINE'}
                        </span>
                      </td>

                      <td className="p-3">
                        <span
                          className={
                            order.revenueLockStatus ===
                            'UNLOCKED_STAT_OVERRIDE'
                              ? 'inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-[10px] font-bold text-rose-800'
                              : blocked
                                ? 'inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-800'
                                : 'inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-bold text-emerald-800'
                          }
                        >
                          {blocked ? (
                            <LockKeyhole className="h-3 w-3" />
                          ) : (
                            <UnlockKeyhole className="h-3 w-3" />
                          )}
                          {revenueStatusLabel(order)}
                        </span>
                        {order.revenueLockStatus ===
                          'UNLOCKED_STAT_OVERRIDE' &&
                          order.statOverrideReason && (
                            <p className="mt-1 max-w-xs text-[10px] text-rose-700">
                              {order.statOverrideReason}
                            </p>
                          )}
                      </td>

                      <td className="p-3">
                        <span className="font-mono text-[10px] font-semibold text-slate-600">
                          {order.worklistStatus || 'UNKNOWN'}
                        </span>
                      </td>

                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {blocked && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700">
                              <AlertTriangle className="h-3.5 w-3.5" />
                              Cashier clearance required
                            </span>
                          )}

                          {!blocked && type === 'LAB' && ready && (
                            <button
                              type="button"
                              onClick={() =>
                                void onAdvanceOrderWorklist(
                                  order.id,
                                  'SPECIMEN_COLLECTED'
                                )
                              }
                              className="rounded-lg bg-blue-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-blue-700"
                            >
                              Collect specimen
                            </button>
                          )}

                          {!blocked &&
                            type === 'LAB' &&
                            specimenCollected && (
                              <button
                                type="button"
                                onClick={() =>
                                  void onAdvanceOrderWorklist(
                                    order.id,
                                    'IN_PROCESSING'
                                  )
                                }
                                className="rounded-lg bg-blue-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-blue-700"
                              >
                                Start processing
                              </button>
                            )}

                          {!blocked &&
                            type !== 'LAB' &&
                            ready && (
                              <button
                                type="button"
                                onClick={() =>
                                  void onAdvanceOrderWorklist(
                                    order.id,
                                    'IN_PROCESSING'
                                  )
                                }
                                className="rounded-lg bg-blue-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-blue-700"
                              >
                                Start service
                              </button>
                            )}

                          {(processing || finalized) && (
                            <Link
                              href={`/${encodeURIComponent(
                                encounter.tenantId
                              )}/diagnostics/results/${encodeURIComponent(
                                order.id
                              )}`}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-bold text-slate-700 hover:bg-slate-50"
                            >
                              <ShieldCheck className="h-3 w-3" />
                              Result evidence
                            </Link>
                          )}

                          {IS_DEMO_RUNTIME &&
                            type === 'RADIOLOGY' &&
                            !blocked && (
                              <button
                                type="button"
                                onClick={() =>
                                  setActiveDicomViewerOrder(order)
                                }
                                className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-[10px] font-bold text-white hover:bg-indigo-700"
                              >
                                <Eye className="h-3 w-3" />
                                Demo DICOM
                              </button>
                            )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {IS_DEMO_RUNTIME && activeDicomViewerOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="w-full max-w-4xl space-y-4 rounded-2xl border border-slate-800 bg-slate-950 p-6 text-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="flex items-center gap-2 text-sm font-bold text-indigo-400">
                  <Eye className="h-4 w-4" />
                  DEMO-only DICOM visualization —{' '}
                  {activeDicomViewerOrder.testName}
                </h3>
                <p className="font-mono text-[11px] text-slate-400">
                  Non-authoritative simulation. No clinical result is created.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() =>
                    setZoomLevel((value) => Math.min(value + 15, 200))
                  }
                  className="rounded-lg bg-slate-800 p-1.5 hover:bg-slate-700"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setZoomLevel((value) => Math.max(value - 15, 50))
                  }
                  className="rounded-lg bg-slate-800 p-1.5 hover:bg-slate-700"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setInvert((value) => !value)}
                  className="rounded-lg bg-slate-800 px-2.5 py-1.5 font-bold hover:bg-slate-700"
                >
                  Invert
                </button>
                <button
                  type="button"
                  onClick={() => setActiveDicomViewerOrder(null)}
                  className="rounded-lg bg-red-600 px-3 py-1.5 font-bold text-white hover:bg-red-700"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="relative flex h-96 items-center justify-center overflow-hidden rounded-xl border border-slate-800 bg-black">
              <div
                className="relative text-center transition-all duration-150"
                style={{
                  transform: `scale(${zoomLevel / 100})`,
                  filter: invert ? 'invert(1)' : undefined,
                }}
              >
                <div className="flex h-80 w-72 flex-col justify-between rounded-xl border border-slate-700/60 bg-gradient-to-b from-slate-900 via-slate-800 to-slate-950 p-4 text-left shadow-inner">
                  <div className="font-mono text-[10px] text-emerald-400">
                    DEMO IMAGE — NOT DIAGNOSTIC EVIDENCE
                  </div>
                  <div className="text-center font-mono text-xs text-slate-500">
                    <p className="font-bold text-slate-400">
                      [ SIMULATED RADIOGRAPH ]
                    </p>
                  </div>
                  <div className="text-right font-mono text-[10px] text-amber-400">
                    DEMO
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
