'use client';

import React from 'react';
import { AlertTriangle, Database, RefreshCw, ShieldCheck } from 'lucide-react';
import type { ChainVerificationResult, AuditLogEntry } from '@/lib/audit/logger';

interface CryptographicIntegritySectionProps {
  tenantId: string;
  verificationResult: ChainVerificationResult | null;
  isVerifying: boolean;
  onVerifyChain: () => void;
  logs: AuditLogEntry[];
}

/**
 * Evidence boundary:
 * Durable server-owned audit records exist, but this repository does not currently
 * implement a concurrency-safe cryptographic audit-chain attestation protocol.
 * The UI therefore must not synthesize historical verification metrics.
 */
export default function CryptographicIntegritySection({
  tenantId,
  verificationResult,
  isVerifying,
  onVerifyChain,
  logs,
}: CryptographicIntegritySectionProps) {
  const hashAttestationAvailable =
    logs.length > 0 &&
    logs.every((log) => Boolean(log.hash && log.previousHash && log.authoritative !== false));

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="p-5 border-b border-slate-200 bg-slate-50">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
              {hashAttestationAvailable ? (
                <ShieldCheck className="w-5 h-5" />
              ) : (
                <AlertTriangle className="w-5 h-5" />
              )}
            </span>
            <div>
              <h2 className="text-sm font-bold text-slate-900">Audit Evidence Integrity</h2>
              <p className="text-xs text-slate-600 mt-1 max-w-3xl">
                Records shown here are read from the tenant&apos;s durable server-owned audit store.
                A cryptographic forward-chain attestation is not currently an implemented production
                control, so this screen does not claim historical hash-verification success.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onVerifyChain}
            disabled={isVerifying || !hashAttestationAvailable}
            className="px-3.5 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
            {hashAttestationAvailable ? 'Verify available hashes' : 'Hash attestation unavailable'}
          </button>
        </div>
      </div>

      <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
        <div className="p-3 rounded-xl border border-slate-200 bg-white">
          <span className="text-slate-500 block">Tenant</span>
          <strong className="font-mono text-slate-900 break-all">{tenantId}</strong>
        </div>
        <div className="p-3 rounded-xl border border-slate-200 bg-white">
          <span className="text-slate-500 block">Durable records loaded</span>
          <strong className="text-slate-900">{logs.length}</strong>
        </div>
        <div className="p-3 rounded-xl border border-slate-200 bg-white">
          <span className="text-slate-500 block">Hash-chain status</span>
          <strong className={hashAttestationAvailable ? 'text-emerald-700' : 'text-amber-700'}>
            {hashAttestationAvailable
              ? verificationResult?.isValid
                ? 'VERIFIED FOR LOADED RECORDS'
                : 'CHECK REQUIRED'
              : 'NOT IMPLEMENTED / NOT ATTESTED'}
          </strong>
        </div>
      </div>

      <div className="px-5 pb-5 text-[11px] text-slate-500 flex items-start gap-2">
        <Database className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>
          Regulatory compliance, retention guarantees, SIEM delivery, and tamper-evidence certification
          require deployment-specific controls and external evidence; they are not inferred from this UI.
        </span>
      </div>
    </div>
  );
}
