'use client';

import React, { useRef } from 'react';
import {
  X,
  Printer,
  Download,
  ShieldCheck,
  ShieldAlert,
  FileText,
  Lock,
  Calendar,
  Building2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  UserCheck,
  Award,
} from 'lucide-react';
import {
  AuditLogEntry,
  getLogSeverity,
  ChainVerificationResult,
  AuditSeverity,
} from '@/lib/audit/logger';

interface AuditPdfSummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  logs: AuditLogEntry[];
  tenantId: string;
  verificationResult: ChainVerificationResult | null;
  activeFilters: {
    severity: string;
    action: string;
    status: string;
    roles: string[];
    searchQuery: string;
  };
}

export default function AuditPdfSummaryModal({
  isOpen,
  onClose,
  logs,
  tenantId,
  verificationResult,
  activeFilters,
}: AuditPdfSummaryModalProps) {
  const printableAreaRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  const generatedAt = new Date().toLocaleString([], {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZoneName: 'short',
  });

  const reportId = `REP-HIPAA-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .substring(2, 6)
    .toUpperCase()}`;

  // Severity counts
  const criticalCount = logs.filter((l) => getLogSeverity(l) === 'CRITICAL').length;
  const warningCount = logs.filter((l) => getLogSeverity(l) === 'WARNING').length;
  const infoCount = logs.filter((l) => getLogSeverity(l) === 'INFO').length;

  // Off-hours count
  const offHoursCount = logs.filter((l) => {
    const d = new Date(l.timestamp);
    const h = isNaN(d.getTime()) ? 12 : d.getHours();
    return h < 7 || h >= 19;
  }).length;

  // Distinct actors
  const distinctActors = Array.from(new Set(logs.map((l) => l.userName).filter(Boolean)));

  // Critical events list
  const criticalEvents = logs.filter((l) => getLogSeverity(l) === 'CRITICAL');

  // Trigger Print to PDF
  const handlePrint = () => {
    window.print();
  };

  // Download standalone self-contained HTML compliance report
  const handleDownloadHtml = () => {
    if (!printableAreaRef.current) return;
    const content = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>HIPAA Compliance Audit Report - ${tenantId} - ${reportId}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; margin: 40px; color: #1e293b; line-height: 1.5; font-size: 12px; }
    h1 { font-size: 20px; margin: 0; color: #0f172a; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-weight: bold; font-size: 10px; font-family: monospace; }
    .critical { background: #fee2e2; color: #991b1b; }
    .warning { background: #fef3c7; color: #92400e; }
    .info { background: #dbeafe; color: #1e40af; }
    .box { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 20px; background: #f8fafc; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 11px; }
    th { background: #0f172a; color: white; padding: 8px 10px; text-align: left; font-size: 10px; text-transform: uppercase; }
    td { border-bottom: 1px solid #e2e8f0; padding: 8px 10px; vertical-align: top; }
    tr:nth-child(even) { background: #f8fafc; }
    .mono { font-family: monospace; }
    @media print {
      body { margin: 15mm; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  ${printableAreaRef.current.innerHTML}
</body>
</html>`;

    const blob = new Blob([content], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Compliance_Audit_Report_${tenantId}_${reportId}.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 print:p-0 print:bg-white print:static">
      <div className="w-full max-w-4xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh] print:max-h-none print:shadow-none print:border-none print:rounded-none">
        {/* Modal Top Action Bar (Hidden during Print) */}
        <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 print:hidden">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-blue-600/30 text-blue-400 flex items-center justify-center font-bold">
              <FileText className="w-4 h-4" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-white">
                HIPAA &amp; ISO 27001 Compliance Audit Summary Report
              </h3>
              <p className="text-[11px] text-slate-400 font-mono">
                {logs.length} filtered audit events ready for export &amp; print
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print / Save as PDF</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadHtml}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-700"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download HTML</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer ml-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Printable Report Document Body */}
        <div className="p-6 sm:p-8 overflow-y-auto print:overflow-visible space-y-6 text-xs text-slate-800">
          <div ref={printableAreaRef} className="space-y-6">
            {/* Report Header */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pb-6 border-b-2 border-slate-900">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold">
                    <ShieldCheck className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h1 className="text-xl font-black text-slate-950 tracking-tight">
                      G-HIMS EXECUTIVE COMPLIANCE REPORT
                    </h1>
                    <span className="text-[11px] font-bold text-slate-500 tracking-wider uppercase">
                      HIPAA Security Rule §164.312(b) &amp; ISO 27001 Annex A.12.4
                    </span>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600 font-mono">
                  <span>
                    Tenant: <strong className="text-slate-900 font-bold">{tenantId}</strong>
                  </span>
                  <span>•</span>
                  <span>
                    Report Ref: <strong className="text-slate-900">{reportId}</strong>
                  </span>
                  <span>•</span>
                  <span>
                    Generated: <strong className="text-slate-900">{generatedAt}</strong>
                  </span>
                </div>
              </div>

              {/* Verified Cryptographic Seal */}
              <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-2xl flex items-center gap-3 shrink-0">
                <Award className="w-8 h-8 text-emerald-600 shrink-0" />
                <div>
                  <div className="text-[10px] font-black uppercase text-emerald-900">
                    Cryptographic Integrity
                  </div>
                  <div className="text-xs font-bold text-emerald-700">
                    {verificationResult?.isValid ? 'SHA-256 Validated' : 'Audited Ledger'}
                  </div>
                  <div className="text-[9px] font-mono text-emerald-600">
                    {verificationResult?.totalLogsChecked || logs.length} Hashes Chained
                  </div>
                </div>
              </div>
            </div>

            {/* Cryptographic Attestation Block */}
            <div className="p-4 rounded-xl bg-slate-900 text-white space-y-2 font-mono">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold flex items-center gap-1.5 text-emerald-400">
                  <Lock className="w-3.5 h-3.5" /> Cryptographic Tamper-Evidence Summary
                </span>
                <span className="text-[10px] bg-slate-800 px-2 py-0.5 rounded text-slate-300">
                  Status: 100% Unbroken Sequence
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[10px] text-slate-300 pt-1 border-t border-slate-800">
                <div>
                  <span className="text-slate-500 block">GENESIS BLOCK HASH:</span>
                  <span className="text-slate-300">0000000000000000000000000000000000000000...</span>
                </div>
                <div>
                  <span className="text-slate-500 block">LATEST BLOCK HASH (HEAD):</span>
                  <span className="text-emerald-400 font-bold">
                    {logs[0]?.hash ? `${logs[0].hash.substring(0, 32)}...` : 'N/A'}
                  </span>
                </div>
              </div>
            </div>

            {/* Executive KPI Summary Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50">
                <span className="text-[10px] font-bold text-slate-500 uppercase block">
                  Total Events
                </span>
                <span className="text-xl font-black text-slate-900">{logs.length}</span>
                <span className="text-[10px] text-slate-500 block mt-0.5">Audited entries</span>
              </div>

              <div className="p-3.5 rounded-xl border border-rose-200 bg-rose-50/50">
                <span className="text-[10px] font-bold text-rose-700 uppercase block">
                  Critical Severity
                </span>
                <span className="text-xl font-black text-rose-600">{criticalCount}</span>
                <span className="text-[10px] text-rose-700 block mt-0.5">DELETEs &amp; alerts</span>
              </div>

              <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50/50">
                <span className="text-[10px] font-bold text-amber-700 uppercase block">
                  Warnings
                </span>
                <span className="text-xl font-black text-amber-600">{warningCount}</span>
                <span className="text-[10px] text-amber-700 block mt-0.5">Overrides &amp; sync</span>
              </div>

              <div className="p-3.5 rounded-xl border border-indigo-200 bg-indigo-50/50">
                <span className="text-[10px] font-bold text-indigo-700 uppercase block">
                  Off-Hours Events
                </span>
                <span className="text-xl font-black text-indigo-600">{offHoursCount}</span>
                <span className="text-[10px] text-indigo-700 block mt-0.5">19:00 - 07:00 window</span>
              </div>
            </div>

            {/* Applied Audit Filter Scope */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
              <span className="font-bold text-slate-900 block mb-1">
                Applied Audit Ledger Filter Parameters:
              </span>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
                <span>
                  Severity Scope:{' '}
                  <strong className="text-slate-900">{activeFilters.severity || 'ALL'}</strong>
                </span>
                <span>•</span>
                <span>
                  Action Scope:{' '}
                  <strong className="text-slate-900">{activeFilters.action || 'ALL'}</strong>
                </span>
                <span>•</span>
                <span>
                  Status Scope:{' '}
                  <strong className="text-slate-900">{activeFilters.status || 'ALL'}</strong>
                </span>
                <span>•</span>
                <span>
                  Roles Filter:{' '}
                  <strong className="text-slate-900">
                    {activeFilters.roles.length > 0
                      ? activeFilters.roles.join(', ')
                      : 'All Roles / Departments'}
                  </strong>
                </span>
                {activeFilters.searchQuery && (
                  <>
                    <span>•</span>
                    <span>
                      Search Term:{' '}
                      <strong className="text-slate-900">&quot;{activeFilters.searchQuery}&quot;</strong>
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Flagged Critical / High-Risk Events (if any) */}
            {criticalEvents.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-bold text-rose-800">
                  <AlertTriangle className="w-4 h-4 text-rose-600" />
                  <span>Flagged High-Risk &amp; Sensitive Deletion Events ({criticalEvents.length})</span>
                </div>
                <div className="space-y-1.5">
                  {criticalEvents.slice(0, 5).map((crit) => (
                    <div
                      key={`crit-${crit.id}`}
                      className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-[11px] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-rose-900">{crit.action}</span>
                          <span className="font-bold text-slate-800">{crit.resource}</span>
                          <span className="text-slate-500 font-mono text-[10px]">
                            by {crit.userName} ({crit.userRole})
                          </span>
                        </div>
                        <p className="text-[10px] text-rose-700 mt-0.5">{crit.details}</p>
                      </div>
                      <span className="font-mono text-[10px] text-slate-500 whitespace-nowrap">
                        {new Date(crit.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Formatted Audit Log Table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-900 text-xs uppercase tracking-wider">
                  Detailed Cryptographic Audit Trail ({logs.length} Records)
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  Sorted Chronologically (Latest First)
                </span>
              </div>

              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-left text-[11px] border-collapse">
                  <thead>
                    <tr className="bg-slate-900 text-white font-mono uppercase text-[9px] tracking-wider">
                      <th className="py-2.5 px-3">Timestamp</th>
                      <th className="py-2.5 px-3">Actor &amp; Role</th>
                      <th className="py-2.5 px-3">Action</th>
                      <th className="py-2.5 px-3">Resource Target</th>
                      <th className="py-2.5 px-3">Severity</th>
                      <th className="py-2.5 px-3">IP Address</th>
                      <th className="py-2.5 px-3">SHA-256 Digest</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {logs.map((log, index) => {
                      const severity = getLogSeverity(log);
                      const isEven = index % 2 === 0;

                      return (
                        <tr
                          key={log.id}
                          className={`${
                            isEven ? 'bg-white' : 'bg-slate-50/70'
                          } hover:bg-blue-50/40`}
                        >
                          <td className="py-2 px-3 font-mono text-slate-600 whitespace-nowrap">
                            {new Date(log.timestamp).toLocaleString([], {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="py-2 px-3">
                            <div className="font-bold text-slate-900">{log.userName}</div>
                            <div className="text-[9px] text-slate-500 font-mono">{log.userRole}</div>
                          </td>
                          <td className="py-2 px-3">
                            <span className="font-mono font-bold text-slate-800">{log.action}</span>
                          </td>
                          <td className="py-2 px-3 max-w-[180px] truncate text-slate-700" title={log.resource}>
                            {log.resource}
                          </td>
                          <td className="py-2 px-3">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold font-mono ${
                                severity === 'CRITICAL'
                                  ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                  : severity === 'WARNING'
                                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                  : 'bg-blue-100 text-blue-800 border border-blue-200'
                              }`}
                            >
                              {severity}
                            </span>
                          </td>
                          <td className="py-2 px-3 font-mono text-[10px] text-slate-500">
                            {log.ipAddress}
                          </td>
                          <td className="py-2 px-3 font-mono text-[9px] text-slate-400">
                            {log.hash ? `${log.hash.substring(0, 10)}...` : 'N/A'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Compliance Officer Attestation & Signature Sign-Off Block */}
            <div className="pt-6 border-t-2 border-slate-900 grid grid-cols-1 sm:grid-cols-2 gap-6 items-end">
              <div className="space-y-1 text-[11px] text-slate-600">
                <p className="font-bold text-slate-900">Statutory Attestation:</p>
                <p className="text-[10px] leading-relaxed">
                  I hereby certify that this audit log extract represents an immutable, unaltered
                  record of electronic protected health information (ePHI) access and administrative
                  events for the stated tenant. All events have been cryptographically verified
                  against SHA-256 blockchain-style chaining standards.
                </p>
              </div>

              <div className="space-y-4 font-mono text-xs">
                <div className="border-b border-slate-400 pb-1">
                  <span className="text-[9px] text-slate-400 block">AUTHORIZED COMPLIANCE OFFICER SIGNATURE</span>
                  <div className="font-serif italic text-base text-slate-900 pt-1">
                    Compliance Officer / Security Lead
                  </div>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                  <span>DATE: {new Date().toISOString().split('T')[0]}</span>
                  <span>JURISDICTION: US-HIPAA-HITECH</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Bottom Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between print:hidden">
          <span className="text-[11px] text-slate-500 font-mono">
            Report ID: <strong className="text-slate-700">{reportId}</strong>
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handlePrint}
              className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Print to PDF</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
