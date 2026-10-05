'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  Pill,
  ShieldCheck,
  AlertTriangle,
  Barcode,
  CheckCircle2,
  Calendar,
  Layers,
  Plus,
  Trash2,
  FileText,
  Clock,
  Sparkles,
} from 'lucide-react';
import {
  ComprehensiveOpdEncounter,
  PharmacyPrescriptionItem,
} from '@/types/opd-domain';
import { AuthClient } from '@/lib/auth/auth-client';
import type { MedicationSafetyCandidateEvaluation } from '@/types/medication-safety';

interface OpdPharmacyPrescriptionsProps {
  encounter: ComprehensiveOpdEncounter;
  prescriptions: PharmacyPrescriptionItem[];
  canPrescribe?: boolean;
  canDispense?: boolean;
  onAddPrescription: (
    item: PharmacyPrescriptionItem,
    safety?: {
      safetyAcknowledgementFindingIds?: string[];
      safetyOverrideReason?: string;
    }
  ) => Promise<void> | void;
  onDispensePrescription: (prescriptionId: string, dispensedBy: string) => void;
}

const DEMO_FORMULARY = [
  { code: 'RX-FUROS-40', drugName: 'Furosemide', formulation: 'Tablet', strength: '40 mg', defaultRoute: 'Oral', defaultFreq: 'OD (Once Daily Morning)', defaultDays: 14, unitCost: 15, stock: 450, batch: 'BTH-2026-088', expiry: '2027-11-30' },
  { code: 'RX-LISIN-10', drugName: 'Lisinopril', formulation: 'Tablet', strength: '10 mg', defaultRoute: 'Oral', defaultFreq: 'OD (Once Daily)', defaultDays: 30, unitCost: 22, stock: 320, batch: 'BTH-2026-142', expiry: '2028-04-15' },
  { code: 'RX-METFOR-500', drugName: 'Metformin HCl', formulation: 'Tablet', strength: '500 mg', defaultRoute: 'Oral', defaultFreq: 'BD (Twice Daily with meals)', defaultDays: 30, unitCost: 12, stock: 800, batch: 'BTH-2026-009', expiry: '2027-09-20' },
  { code: 'RX-AMOX-500', drugName: 'Amoxicillin', formulation: 'Capsule', strength: '500 mg', defaultRoute: 'Oral', defaultFreq: 'TDS (Three Times Daily)', defaultDays: 7, unitCost: 25, stock: 210, batch: 'BTH-2026-991', expiry: '2027-05-10' },
  { code: 'RX-PARAC-500', drugName: 'Paracetamol', formulation: 'Tablet', strength: '500 mg', defaultRoute: 'Oral', defaultFreq: 'PRN (As needed for pain/fever)', defaultDays: 5, unitCost: 5, stock: 1200, batch: 'BTH-2026-301', expiry: '2028-10-01' },
  { code: 'RX-ATORV-20', drugName: 'Atorvastatin', formulation: 'Tablet', strength: '20 mg', defaultRoute: 'Oral', defaultFreq: 'HS (At Bedtime)', defaultDays: 30, unitCost: 35, stock: 540, batch: 'BTH-2026-512', expiry: '2028-02-18' },
];


interface FormularyDrug {
  code: string;
  itemId?: string;
  drugName: string;
  genericName?: string;
  formulation: string;
  strength: string;
  defaultRoute: string;
  defaultFreq: string;
  defaultDays: number;
  unitCost: number;
  stock: number;
  nextFefoBatch?: {
    batchNumber: string;
    expiryDate: string;
    available: number;
    locationId: string;
    locationName: string;
  } | null;
}

const IS_DEMO_RUNTIME = process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE === 'DEMO';

export function OpdPharmacyPrescriptions({
  encounter,
  prescriptions,
  canPrescribe = false,
  canDispense = false,
  onAddPrescription,
  onDispensePrescription,
}: OpdPharmacyPrescriptionsProps) {
  const [formulary, setFormulary] = useState<FormularyDrug[]>(() =>
    IS_DEMO_RUNTIME ? DEMO_FORMULARY : []
  );
  const [formularyError, setFormularyError] = useState<string | null>(null);
  const [selectedFormularyCode, setSelectedFormularyCode] = useState<string>(() =>
    IS_DEMO_RUNTIME ? DEMO_FORMULARY[0].code : ''
  );
  const [dosage, setDosage] = useState<string>('40 mg');
  const [route, setRoute] = useState<string>('Oral');
  const [frequency, setFrequency] = useState<string>('OD (Once Daily Morning)');
  const [durationDays, setDurationDays] = useState<number>(14);
  const [quantity, setQuantity] = useState<number>(14);
  const [specialInstructions, setSpecialInstructions] = useState<string>('Take with a full glass of water in the morning.');
  const [allowGeneric, setAllowGeneric] = useState<boolean>(true);

  // State for prescription submission error
  const [prescriptionError, setPrescriptionError] = useState<string | null>(null);
  const [pendingSafetyReview, setPendingSafetyReview] = useState<{
    prescription: PharmacyPrescriptionItem;
    evaluation: MedicationSafetyCandidateEvaluation;
  } | null>(null);
  const [safetyOverrideReason, setSafetyOverrideReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [dispenseModalItem, setDispenseModalItem] = useState<PharmacyPrescriptionItem | null>(null);
  const [pharmacistName, setPharmacistName] = useState<string>('Pharm. Tariq Bilal (R.Ph)');

  useEffect(() => {
    if (IS_DEMO_RUNTIME) return;

    let cancelled = false;
    void (async () => {
      try {
        const tenantId = await AuthClient.getActiveTenantId();
        const response = await AuthClient.authorizedFetch(
          `/api/pharmacy/formulary?tenantId=${encodeURIComponent(tenantId)}`,
          { method: 'GET' },
          tenantId
        );
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.message || payload?.error || 'Authoritative formulary unavailable.');
        }

        const mapped: FormularyDrug[] = (payload.medications || []).map((item: any) => ({
          code: String(item.itemCode),
          itemId: String(item.itemId),
          drugName: String(item.drugName),
          genericName: item.genericName ? String(item.genericName) : undefined,
          formulation: String(item.unitOfMeasure || 'Unit'),
          strength: '',
          defaultRoute: 'Oral',
          defaultFreq: 'As directed',
          defaultDays: 1,
          unitCost: Number(item.sellingPrice || 0),
          stock: Number(item.totalAvailable || 0),
          nextFefoBatch: item.nextFefoBatch || null,
        }));

        if (cancelled) return;
        setFormulary(mapped);
        setFormularyError(null);
        if (mapped[0]) {
          setSelectedFormularyCode(mapped[0].code);
          setRoute(mapped[0].defaultRoute);
          setFrequency(mapped[0].defaultFreq);
          setDurationDays(mapped[0].defaultDays);
          setQuantity(mapped[0].defaultDays);
        }
      } catch (error) {
        if (cancelled) return;
        setFormulary([]);
        setFormularyError(
          error instanceof Error ? error.message : 'Authoritative formulary unavailable.'
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectedDrug = useMemo(
    () => formulary.find((item) => item.code === selectedFormularyCode) || formulary[0],
    [formulary, selectedFormularyCode]
  );

  const handleFormularyChange = (code: string) => {
    setSelectedFormularyCode(code);
    const drug = formulary.find((item) => item.code === code);
    if (drug) {
      setDosage(drug.strength);
      setRoute(drug.defaultRoute);
      setFrequency(drug.defaultFreq);
      setDurationDays(drug.defaultDays);
      setQuantity(drug.defaultDays);
    }
  };

  const handleCreatePrescription = async (e: React.FormEvent) => {
    e.preventDefault();
    setPrescriptionError(null);

    setPendingSafetyReview(null);
    setSafetyOverrideReason('');

    if (!selectedDrug) {
      alert('No authoritative formulary medication is available.');
      return;
    }

    const newPrescription: PharmacyPrescriptionItem = {
      id: `rx-${Date.now()}`,
      medicationCode: selectedDrug.code,
      drugName: selectedDrug.drugName,
      formulation: selectedDrug.formulation,
      dosage,
      route,
      frequency,
      durationDays,
      quantity,
      unitPriceMinorUnits: selectedDrug.unitCost * 100,
      totalAmountMinorUnits: selectedDrug.unitCost * quantity * 100,
      specialInstructions,
      substitutionAllowed: allowGeneric,
      status: 'PRESCRIBED',
      prescribedAt: Date.now(),
      prescribedBy: 'Authenticated Clinician',
    };

    if (!canPrescribe) {
      setPrescriptionError('The authenticated user is not authorized to prescribe medication.');
      return;
    }

    setIsSubmitting(true);
    try {
      const tenantId = await AuthClient.getActiveTenantId();
      const response = await AuthClient.authorizedFetch(
        `/api/clinical/medication-safety/precheck?tenantId=${encodeURIComponent(tenantId)}`,
        {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            patientId: encounter.patientId,
            encounterId: encounter.id,
            drugCode: selectedDrug.code,
            drugName: selectedDrug.drugName,
          }),
        },
        tenantId
      );
      const payload = await response.json();
      if (!response.ok || !payload?.success || !payload?.evaluation) {
        throw new Error(
          payload?.error?.message ||
            payload?.error ||
            'Authoritative medication-safety precheck failed.'
        );
      }

      const evaluation =
        payload.evaluation as MedicationSafetyCandidateEvaluation;
      if (evaluation.findings.length > 0) {
        setPendingSafetyReview({
          prescription: newPrescription,
          evaluation,
        });
        return;
      }

      await onAddPrescription(newPrescription, {
        safetyAcknowledgementFindingIds: [],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Prescription authorization failed.';
      setPrescriptionError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const confirmSafetyReview = async () => {
    if (!pendingSafetyReview) return;
    const requiresOverride =
      pendingSafetyReview.evaluation.blockingFindingIds.length > 0;
    if (requiresOverride && safetyOverrideReason.trim().length < 10) {
      setPrescriptionError(
        'A clinical override reason of at least 10 characters is required for the critical medication-safety finding.'
      );
      return;
    }

    setIsSubmitting(true);
    setPrescriptionError(null);
    try {
      await onAddPrescription(pendingSafetyReview.prescription, {
        safetyAcknowledgementFindingIds:
          pendingSafetyReview.evaluation.acknowledgementFindingIds,
        safetyOverrideReason: requiresOverride
          ? safetyOverrideReason.trim()
          : undefined,
      });
      setPendingSafetyReview(null);
      setSafetyOverrideReason('');
    } catch (err) {
      setPrescriptionError(
        err instanceof Error
          ? err.message
          : 'Medication-safety acknowledgement failed.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Formulary & e-Prescription Bar */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Pill className="w-5 h-5 text-emerald-600" />
            Outpatient e-Prescribing & Pharmacy FEFO Dispensing Station
          </h2>
          <p className="text-xs text-slate-500">
            Real-time drug-allergy cross-checking, First-Expired First-Out (FEFO) batch allocation, and patient counseling audit.
          </p>
        </div>

        {pendingSafetyReview && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div className="min-w-0 flex-1">
                <strong className="block font-bold">
                  CI-9 medication safety review required
                </strong>
                <p className="mt-1">
                  These findings were derived from authoritative Patient 360 evidence. Review each item before prescribing.
                </p>
                <div className="mt-3 space-y-2">
                  {pendingSafetyReview.evaluation.findings.map((finding) => (
                    <div
                      key={finding.findingId}
                      className={
                        finding.requiresOverride
                          ? 'rounded-lg border border-rose-300 bg-rose-50 p-3 text-rose-900'
                          : 'rounded-lg border border-amber-200 bg-white/70 p-3 text-slate-800'
                      }
                    >
                      <div className="font-bold">{finding.title}</div>
                      <div className="mt-1">{finding.description}</div>
                      <div className="mt-1 font-mono text-[10px] opacity-70">
                        {finding.ruleId} · {finding.findingId}
                      </div>
                    </div>
                  ))}
                </div>

                {pendingSafetyReview.evaluation.blockingFindingIds.length > 0 && (
                  <div className="mt-3">
                    <label className="block text-[11px] font-bold">
                      Clinical override reason *
                    </label>
                    <textarea
                      value={safetyOverrideReason}
                      onChange={(event) =>
                        setSafetyOverrideReason(event.target.value)
                      }
                      rows={3}
                      className="mt-1 w-full rounded-lg border border-rose-300 bg-white px-3 py-2 text-xs text-slate-900"
                      placeholder="Document why prescribing remains clinically necessary despite the critical finding."
                    />
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void confirmSafetyReview()}
                    className="rounded-lg bg-amber-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {isSubmitting
                      ? 'Recording…'
                      : pendingSafetyReview.evaluation.blockingFindingIds.length > 0
                        ? 'Acknowledge, override & prescribe'
                        : 'Acknowledge findings & prescribe'}
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => {
                      setPendingSafetyReview(null);
                      setSafetyOverrideReason('');
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700"
                  >
                    Cancel prescription
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {prescriptionError && (
          <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0" />
              <div>
                <strong className="block font-bold">Clinical Prescribing Exception:</strong>
                <span>{prescriptionError}</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPrescriptionError(null)}
              className="text-xs text-rose-600 dark:text-rose-400 hover:underline cursor-pointer font-semibold"
            >
              Dismiss
            </button>
          </div>
        )}

        {!IS_DEMO_RUNTIME && formularyError && (
          <div className="p-3 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/40 text-xs text-amber-800 dark:text-amber-200">
            {formularyError}
          </div>
        )}
        {!IS_DEMO_RUNTIME && formulary.length === 0 && !formularyError && (
          <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 dark:bg-slate-800 text-xs text-slate-500">
            No active stocked medications are available from the authoritative formulary.
          </div>
        )}

        <form onSubmit={handleCreatePrescription} className="space-y-4 pt-2">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Hospital Formulary Medication *
              </label>
              <select
                value={selectedFormularyCode}
                onChange={(e) => handleFormularyChange(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
              >
                {formulary.map((drug) => (
                  <option key={drug.code} value={drug.code}>
                    {drug.drugName} {drug.strength} ({drug.formulation}) — Available: {drug.stock} units
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Frequency & Timing
              </label>
              <input
                type="text"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Duration (Days) & Quantity
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={durationDays}
                  onChange={(e) => {
                    const d = Number(e.target.value);
                    setDurationDays(d);
                    setQuantity(d);
                  }}
                  className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold"
                />
                <input
                  type="number"
                  value={quantity}
                  onChange={(e) => setQuantity(Number(e.target.value))}
                  className="w-16 px-2 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold text-center"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-semibold mb-1 text-slate-700 dark:text-slate-300">
                Pharmacist Patient Counseling & Special Instructions
              </label>
              <input
                type="text"
                value={specialInstructions}
                onChange={(e) => setSpecialInstructions(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>

            <div className="flex items-center gap-3 pt-4">
              <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
                <input
                  type="checkbox"
                  checked={allowGeneric}
                  onChange={(e) => setAllowGeneric(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded"
                />
                <span>Allow Generic Substitution</span>
              </label>
            </div>
          </div>

          <div className="flex justify-between items-center pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="text-xs text-slate-500 font-mono">
              {selectedDrug?.nextFefoBatch
                ? <>Inventory preview: next FEFO batch <strong>{selectedDrug.nextFefoBatch.batchNumber}</strong> (Exp: {selectedDrug.nextFefoBatch.expiryDate}). Allocation is revalidated atomically at dispense.</>
                : 'FEFO allocation is resolved server-side at dispense time.'}
            </div>
            <button
              type="submit"
              disabled={!selectedDrug || isSubmitting}
              className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Plus className="w-4 h-4" />
              {isSubmitting ? 'Authorizing...' : 'Authorize e-Prescription (e-Rx)'}
            </button>
          </div>
        </form>
      </div>

      {/* Active Prescriptions & Dispensing Log */}
      <div className="p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center justify-between">
          <span>Outpatient Prescription Items ({prescriptions.length})</span>
          <span className="text-xs font-normal text-slate-400">
            Total Medication Cost: PKR {(prescriptions.reduce((acc, p) => acc + (p.totalAmountMinorUnits || 0), 0) / 100).toLocaleString()}
          </span>
        </h3>

        {prescriptions.length === 0 ? (
          <div className="py-10 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
            <Pill className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <p className="text-xs font-bold text-slate-500">No medications prescribed for this outpatient encounter.</p>
          </div>
        ) : (
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="p-3">Medication</th>
                  <th className="p-3">Dosage & Route</th>
                  <th className="p-3">Frequency & Duration</th>
                  <th className="p-3">FEFO Batch & Bin</th>
                  <th className="p-3">Status</th>
                  <th className="p-3 text-right">Pharmacy Dispensing</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {prescriptions.map((rx) => (
                  <tr key={rx.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                    <td className="p-3">
                      <p className="font-bold text-slate-900 dark:text-slate-100">{rx.drugName}</p>
                      <p className="text-[10px] text-slate-400">{rx.formulation} • Qty: {rx.quantity}</p>
                    </td>
                    <td className="p-3">
                      <p className="font-semibold">{rx.dosage}</p>
                      <p className="text-[10px] text-slate-400">{rx.route}</p>
                    </td>
                    <td className="p-3">
                      <p className="font-medium text-slate-800 dark:text-slate-200">{rx.frequency}</p>
                      <p className="text-[10px] text-slate-400">{rx.durationDays} Days Course</p>
                    </td>
                    <td className="p-3 font-mono text-[11px]">
                      {rx.batchAllocation ? (
                        <div>
                          <p className="font-bold text-emerald-600">{rx.batchAllocation.batchNumber}</p>
                          <p className="text-[10px] text-slate-400">Exp: {rx.batchAllocation.expiryDate}</p>
                        </div>
                      ) : (
                        <span className="text-slate-400">Pending Allocation</span>
                      )}
                    </td>
                    <td className="p-3">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          rx.status === 'DISPENSED'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        }`}
                      >
                        {rx.status}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      {rx.status !== 'DISPENSED' && canDispense ? (
                        <button
                          onClick={() => setDispenseModalItem(rx)}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold cursor-pointer"
                        >
                          Dispense & Label
                        </button>
                      ) : (
                        <div className="text-[10px] text-slate-400 font-mono">
                          Dispensed by {rx.dispensedBy?.split(' ')[0]}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dispensing Modal */}
      {dispenseModalItem && canDispense && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              Pharmacist Double-Check & Dispensing Verification
            </h3>
            <p className="text-xs text-slate-500">
              Verify FEFO batch allocation, print barcode drug label, and provide mandatory verbal counseling.
            </p>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs space-y-1.5">
              <p>
                <strong>Medication:</strong> {dispenseModalItem.drugName} {dispenseModalItem.dosage} ({dispenseModalItem.formulation})
              </p>
              <p>
                <strong>Sig / Direction:</strong> {dispenseModalItem.frequency} x {dispenseModalItem.durationDays} days
              </p>
              <p>
                <strong>FEFO:</strong> Authoritative batch allocation will be selected and revalidated by the server when you confirm dispensing.
              </p>
              <p>
                <strong>Counseling:</strong> {dispenseModalItem.specialInstructions}
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1">Dispensing Licensed Pharmacist</label>
              <input
                type="text"
                value={pharmacistName}
                onChange={(e) => setPharmacistName(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setDispenseModalItem(null)}
                className="px-4 py-2 rounded-xl text-xs font-bold border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                Back
              </button>
              <button
                onClick={() => {
                  onDispensePrescription(dispenseModalItem.id, pharmacistName);
                  setDispenseModalItem(null);
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold cursor-pointer"
              >
                Confirm Dispensing & Post Charges
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
