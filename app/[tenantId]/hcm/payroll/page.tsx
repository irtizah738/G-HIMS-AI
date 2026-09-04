'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import {
  Banknote,
  DollarSign,
  Clock,
  Play,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Receipt,
  Users,
  Search,
  Filter,
  RefreshCw,
  X,
  Layers,
  ArrowUpRight,
  ShieldCheck,
  Building2,
  Calendar,
  Sparkles,
  Printer,
} from 'lucide-react';
import {
  PayrollPeriod,
  Payslip,
  StaffMember,
  RosterShift,
} from '@/types/hcm';
import {
  subscribeToPayrollPeriods,
  subscribeToPayslips,
  subscribeToStaffMembers,
  subscribeToRosterShifts,
  generatePayrollRun,
} from '@/lib/firebase/services/hcm';
import { StatutoryTaxComplianceReportModal } from '@/components/hcm/StatutoryTaxComplianceReportModal';
import { OvertimeBudgetVarianceChart } from '@/components/hcm/OvertimeBudgetVarianceChart';

export default function HealthcarePayrollPage() {
  const params = useParams();
  const tenantId = (params?.tenantId as string) || 'metro-health';

  const [periods, setPeriods] = useState<PayrollPeriod[]>([]);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [shifts, setShifts] = useState<RosterShift[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters & State
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPayslip, setSelectedPayslip] = useState<Payslip | null>(null);
  const [showTaxComplianceModal, setShowTaxComplianceModal] = useState(false);
  const [showOvertimeAnalytics, setShowOvertimeAnalytics] = useState(true);

  // Run Payroll Modal
  const [showRunModal, setShowRunModal] = useState(false);
  const [periodName, setPeriodName] = useState(() => {
    const d = new Date();
    return `Bi-Weekly Payroll ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}B`;
  });

  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d.toISOString().split('T')[0];
  });

  const [endDate, setEndDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [processingPayroll, setProcessingPayroll] = useState(false);
  const [payrollError, setPayrollError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    const unsubPeriods = subscribeToPayrollPeriods(tenantId, setPeriods);
    const unsubPayslips = subscribeToPayslips(tenantId, (data) => {
      setPayslips(data);
      setLoading(false);
    });
    const unsubStaff = subscribeToStaffMembers(tenantId, setStaff);
    const unsubShifts = subscribeToRosterShifts(tenantId, setShifts);

    return () => {
      unsubPeriods();
      unsubPayslips();
      unsubStaff();
      unsubShifts();
    };
  }, [tenantId]);

  // Aggregate stats across all periods
  const aggregates = useMemo(() => {
    let totalGross = 0;
    let totalNet = 0;
    let totalOvertimePay = 0;
    let totalHours = 0;
    let totalTaxDeductions = 0;
    let totalSocialSecurity = 0;
    let totalMedicare = 0;

    payslips.forEach((p) => {
      const gross = Number(p.grossPay) || 0;
      totalGross += gross;
      totalNet += Number(p.netPay) || 0;
      totalOvertimePay += Number(p.overtimePay) || 0;
      totalHours += (Number(p.regularHours) || 0) + (Number(p.overtimeHours) || 0);

      const taxD =
        Number(p.taxDeduction ?? p.statutoryDeductions?.taxWithholding) ||
        Math.round(gross * 0.145 * 100) / 100;
      const ss =
        Number(p.statutoryDeductions?.socialSecurity) ||
        Math.round(gross * 0.062 * 100) / 100;
      const med =
        Number(p.statutoryDeductions?.medicare) ||
        Math.round(gross * 0.0145 * 100) / 100;

      totalTaxDeductions += taxD;
      totalSocialSecurity += ss;
      totalMedicare += med;
    });

    const totalStatutoryWithholdings =
      Math.round((totalTaxDeductions + totalSocialSecurity + totalMedicare) * 100) / 100;

    return {
      totalGross: Math.round(totalGross * 100) / 100,
      totalNet: Math.round(totalNet * 100) / 100,
      totalOvertimePay: Math.round(totalOvertimePay * 100) / 100,
      totalHours: Math.round(totalHours),
      totalTaxDeductions: Math.round(totalTaxDeductions * 100) / 100,
      totalSocialSecurity: Math.round(totalSocialSecurity * 100) / 100,
      totalMedicare: Math.round(totalMedicare * 100) / 100,
      totalStatutoryWithholdings,
      totalRuns: periods.length,
    };
  }, [payslips, periods]);

  // Filtered payslips
  const filteredPayslips = useMemo(() => {
    return payslips.filter((p) => {
      const matchPeriod = selectedPeriodId === 'all' || p.payrollPeriodId === selectedPeriodId || p.periodId === selectedPeriodId;
      const dept = p.departmentName || p.department || '';
      const matchSearch =
        (p.staffName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.payslipNumber || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        dept.toLowerCase().includes(searchTerm.toLowerCase());

      return matchPeriod && matchSearch;
    });
  }, [payslips, selectedPeriodId, searchTerm]);

  // Handle Run Payroll
  const handleExecutePayroll = async (e: React.FormEvent) => {
    e.preventDefault();
    setPayrollError(null);
    setSuccessMessage(null);
    setProcessingPayroll(true);

    try {
      const newPeriodId = await generatePayrollRun(
        tenantId,
        {
          periodName,
          startDate,
          endDate,
          paymentDate,
        },
        'Hospital Payroll Director / HR Finance Controller'
      );

      setShowRunModal(false);
      setSelectedPeriodId(newPeriodId);
      setSuccessMessage(
        `Payroll Batch successfully finalized! Payslips calculated and GL Journal Entry posted automatically.`
      );
    } catch (err: any) {
      setPayrollError(err.message || 'Failed to process healthcare payroll run.');
    } finally {
      setProcessingPayroll(false);
    }
  };

  return (
    <div className="space-y-6 pb-12" id="healthcare-payroll-view">
      {/* Header Banner */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-50 text-indigo-700 rounded-lg border border-indigo-100">
              <Banknote className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                Healthcare Payroll & Overtime Processing Terminal
              </h1>
              <p className="text-sm text-slate-500">
                Automated clinical wage calculations, FLSA overtime tiering & double-entry General Ledger settlement
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            id="open-tax-compliance-modal-btn"
            onClick={() => setShowTaxComplianceModal(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="h-4 w-4 text-blue-600" />
            <span>Statutory Tax Compliance</span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">
              IRS 941 & SUTA
            </span>
          </button>

          <button
            id="toggle-overtime-trends-btn"
            onClick={() => setShowOvertimeAnalytics((prev) => !prev)}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs font-semibold rounded-lg shadow-xs transition-colors cursor-pointer ${
              showOvertimeAnalytics
                ? 'bg-amber-100 text-amber-900 border border-amber-300'
                : 'bg-white hover:bg-slate-50 text-slate-700 border border-slate-200'
            }`}
          >
            <TrendingUp className="h-4 w-4 text-amber-600" />
            <span>{showOvertimeAnalytics ? 'Hide Overtime Trends' : 'Overtime Budget Trends'}</span>
          </button>

          <button
            id="open-run-payroll-modal-btn"
            onClick={() => {
              setPayrollError(null);
              setShowRunModal(true);
            }}
            className="flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-xs transition-colors cursor-pointer"
          >
            <Play className="h-4 w-4 fill-current" />
            Run Payroll Batch
          </button>
        </div>
      </div>

      {/* Success alert message */}
      {successMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-sm font-medium flex items-center justify-between shadow-2xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-700 hover:text-emerald-900 p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Financial KPIs - 5 Column Responsive Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        {/* Total Gross Payroll */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span>Gross Wages</span>
            <DollarSign className="h-4 w-4 text-emerald-500" />
          </div>
          <div className="text-xl font-bold text-slate-900 font-mono">
            ${aggregates.totalGross.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Total clinical & admin compensation</div>
        </div>

        {/* Total Net Payout */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span>Net Disbursed</span>
            <Receipt className="h-4 w-4 text-indigo-500" />
          </div>
          <div className="text-xl font-bold text-indigo-700 font-mono">
            ${aggregates.totalNet.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Post statutory withholdings</div>
        </div>

        {/* Overtime & Shift Differentials */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span>Overtime Pay</span>
            <TrendingUp className="h-4 w-4 text-amber-500" />
          </div>
          <div className="text-xl font-bold text-amber-600 font-mono">
            ${aggregates.totalOvertimePay.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">Differential & 1.5x/2.0x rates</div>
        </div>

        {/* Statutory Tax & Deductions */}
        <div
          onClick={() => setShowTaxComplianceModal(true)}
          className="bg-white hover:bg-blue-50/40 p-4 rounded-xl border border-slate-200 hover:border-blue-300 shadow-xs transition-colors cursor-pointer group"
        >
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span className="group-hover:text-blue-600">Statutory Taxes</span>
            <FileSpreadsheet className="h-4 w-4 text-blue-500" />
          </div>
          <div className="text-xl font-bold text-blue-700 font-mono">
            ${aggregates.totalStatutoryWithholdings.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </div>
          <div className="text-[11px] text-blue-600 font-medium mt-1 flex items-center gap-1">
            <span>IRS 941 & SUTA Filing</span>
            <ArrowUpRight className="w-3 h-3" />
          </div>
        </div>

        {/* Total Processed Shifts / Batches */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
            <span>Settlement Runs</span>
            <ShieldCheck className="h-4 w-4 text-purple-500" />
          </div>
          <div className="text-xl font-bold text-purple-700 font-mono">
            {aggregates.totalRuns}{' '}
            <span className="text-xs font-normal text-slate-500">Cycles final</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-1">GL double-entry balanced</div>
        </div>
      </div>

      {/* Overtime Pay Trends & Clinical Unit Variances */}
      {showOvertimeAnalytics && (
        <div className="transition-all">
          <OvertimeBudgetVarianceChart
            onNotifyLead={(msg) => setSuccessMessage(msg)}
          />
        </div>
      )}

      {/* Historical Payroll Batches Ribbon */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-indigo-600" />
            Payroll Periods & General Ledger Postings
          </h2>
          <span className="text-xs text-slate-500">{periods.length} Settlement Cycles</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {periods.map((period) => (
            <div
              key={period.id}
              id={`period-card-${period.id}`}
              onClick={() => setSelectedPeriodId(period.id)}
              className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                selectedPeriodId === period.id
                  ? 'bg-indigo-50/70 border-indigo-300 ring-2 ring-indigo-500/20'
                  : 'bg-slate-50 hover:bg-slate-100/80 border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs text-slate-900">{period.periodName}</span>
                <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                  {period.status}
                </span>
              </div>

              <div className="text-[11px] font-mono text-slate-500 mt-1">
                {period.startDate} to {period.endDate}
              </div>

              <div className="flex items-center justify-between text-xs mt-2 pt-2 border-t border-slate-200">
                <span className="text-slate-500 font-medium">Gross Total:</span>
                <span className="font-mono font-bold text-slate-900">
                  ${(period.totalGrossPay ?? period.totalGross ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
              </div>

              {period.journalEntryId && (
                <div className="text-[10px] font-mono text-indigo-600 flex items-center gap-1 mt-1">
                  <ShieldCheck className="h-3 w-3" />
                  <span>GL Batch: {period.journalEntryId.substring(0, 16)}...</span>
                </div>
              )}
            </div>
          ))}

          {periods.length === 0 && (
            <div className="col-span-3 py-6 text-center text-slate-400 text-xs">
              No historical payroll runs generated yet. Click &quot;Run Payroll Batch&quot; to execute your first hospital pay cycle.
            </div>
          )}
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <select
            id="filter-period-select"
            value={selectedPeriodId}
            onChange={(e) => setSelectedPeriodId(e.target.value)}
            className="px-3 py-2 text-xs font-semibold bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
          >
            <option value="all">All Pay Periods</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.periodName} ({p.startDate} - {p.endDate})
              </option>
            ))}
          </select>
        </div>

        <div className="relative w-full md:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            id="search-payslips-input"
            type="text"
            placeholder="Search payslip #, staff name, dept..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          />
        </div>
      </div>

      {/* Payslips Registry Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse" id="payslips-table">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                <th className="py-3.5 px-4">Payslip #</th>
                <th className="py-3.5 px-4">Staff Member</th>
                <th className="py-3.5 px-4">Department</th>
                <th className="py-3.5 px-4 text-right">Regular Hrs</th>
                <th className="py-3.5 px-4 text-right">Overtime Hrs</th>
                <th className="py-3.5 px-4 text-right">Gross Pay</th>
                <th className="py-3.5 px-4 text-right">Deductions</th>
                <th className="py-3.5 px-4 text-right">Net Payout</th>
                <th className="py-3.5 px-4 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {loading ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-400">
                    <RefreshCw className="h-6 w-6 animate-spin mx-auto mb-2 text-indigo-500" />
                    Loading Clinical Payroll Registry...
                  </td>
                </tr>
              ) : filteredPayslips.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-12 text-center text-slate-500">
                    No payslips found matching your filters.
                  </td>
                </tr>
              ) : (
                filteredPayslips.map((slip) => {
                  return (
                    <tr
                      key={slip.id}
                      id={`payslip-row-${slip.id}`}
                      onClick={() => setSelectedPayslip(slip)}
                      className="hover:bg-slate-50/70 transition-colors group cursor-pointer"
                    >
                      <td className="py-3.5 px-4 font-mono text-xs font-bold text-indigo-700">
                        {slip.payslipNumber}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">
                          {slip.staffName}
                        </div>
                        <div className="text-xs text-slate-400 font-mono">
                          ${slip.hourlyRate}/hr base
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-600 text-xs">
                        {slip.departmentName || slip.department}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-xs font-medium text-slate-800">
                        {slip.regularHours}h
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-xs font-medium text-amber-600">
                        {slip.overtimeHours > 0 ? `${slip.overtimeHours}h` : '—'}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-xs font-bold text-slate-900">
                        ${slip.grossPay.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-xs text-rose-600">
                        -${(slip.totalDeductions ?? slip.statutoryDeductions?.totalDeductions ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono text-xs font-bold text-emerald-700">
                        ${(slip.netPay ?? slip.netPayAmount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td className="py-3.5 px-4 text-center">
                        <button
                          id={`view-payslip-btn-${slip.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPayslip(slip);
                          }}
                          className="px-2.5 py-1 text-xs font-medium text-indigo-700 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 rounded transition-colors"
                        >
                          View Slip
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Payslip Details Modal */}
      {selectedPayslip && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4"
          id="payslip-modal"
        >
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-5 bg-slate-900 text-white">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-500/20 text-indigo-300 rounded-lg">
                  <Receipt className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-xs font-mono uppercase tracking-wider text-indigo-300">
                    Official Earnings Statement
                  </div>
                  <h2 className="text-lg font-bold">{selectedPayslip.payslipNumber}</h2>
                </div>
              </div>
              <button
                id="close-payslip-modal-btn"
                onClick={() => setSelectedPayslip(null)}
                className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-sm">
              <div className="flex justify-between items-center pb-3 border-b border-slate-200">
                <div>
                  <div className="text-xs text-slate-400 font-semibold uppercase">Employee</div>
                  <div className="font-bold text-slate-900 text-base">
                    {selectedPayslip.staffName}
                  </div>
                  <div className="text-xs text-slate-500">{selectedPayslip.departmentName || selectedPayslip.department}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-400 font-semibold uppercase">Base Pay Rate</div>
                  <div className="font-mono font-bold text-slate-900">
                    ${selectedPayslip.hourlyRate}.00 / hr
                  </div>
                </div>
              </div>

              {/* Earnings Breakdown */}
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Earnings Breakdown
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-600">
                      Regular Hours ({selectedPayslip.regularHours} hrs @ ${selectedPayslip.hourlyRate}/hr):
                    </span>
                    <span className="font-mono font-semibold text-slate-800">
                      ${(selectedPayslip.regularPay ?? selectedPayslip.basePay ?? 0).toFixed(2)}
                    </span>
                  </div>
                  {selectedPayslip.overtimeHours > 0 && (
                    <div className="flex justify-between text-amber-700">
                      <span>
                        Overtime Hours ({selectedPayslip.overtimeHours} hrs @ 1.5x rate):
                      </span>
                      <span className="font-mono font-bold">
                        +${(selectedPayslip.overtimePay || 0).toFixed(2)}
                      </span>
                    </div>
                  )}
                  {(selectedPayslip.shiftDifferentials || 0) > 0 && (
                    <div className="flex justify-between text-purple-700">
                      <span>Night / Weekend Differentials:</span>
                      <span className="font-mono font-bold">
                        +${(selectedPayslip.shiftDifferentials || 0).toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-slate-200 pt-2 font-bold text-slate-900">
                    <span>Total Gross Earnings:</span>
                    <span className="font-mono text-sm">${(selectedPayslip.grossPay || 0).toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Deductions Breakdown */}
              <div>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Statutory Deductions & Withholdings
                </div>
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-2 text-xs">
                  <div className="flex justify-between text-slate-600">
                    <span>Federal / State Income Tax Withholding:</span>
                    <span className="font-mono text-rose-600">
                      -${(selectedPayslip.taxDeduction ?? selectedPayslip.statutoryDeductions?.taxWithholding ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-600">
                    <span>FICA Social Security & Medicare (7.65%):</span>
                    <span className="font-mono text-rose-600">
                      -${((selectedPayslip.statutoryDeductions?.socialSecurity || 0) + (selectedPayslip.statutoryDeductions?.medicare || 0)).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-2 font-bold text-slate-900">
                    <span>Total Deductions:</span>
                    <span className="font-mono text-rose-600">
                      -${(selectedPayslip.totalDeductions ?? selectedPayslip.statutoryDeductions?.totalDeductions ?? 0).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Net Pay Box */}
              <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
                    Net Take-Home Pay
                  </div>
                  <div className="text-xs text-emerald-600">Direct Deposit / GL Verified</div>
                </div>
                <div className="text-2xl font-bold font-mono text-emerald-700">
                  ${(selectedPayslip.netPay ?? selectedPayslip.netPayAmount ?? 0).toFixed(2)}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between p-4 bg-slate-50 border-t border-slate-200">
              <button
                type="button"
                onClick={() => window.print()}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
              >
                <Printer className="h-4 w-4" />
                Print Payslip
              </button>
              <button
                type="button"
                onClick={() => setSelectedPayslip(null)}
                className="px-4 py-2 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-xs"
              >
                Close Statement
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Run Payroll Batch Modal */}
      {showRunModal && (
        <div
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center z-50 p-4"
          id="run-payroll-modal"
        >
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between p-5 border-b border-slate-200">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-indigo-50 text-indigo-700 rounded-lg">
                  <Play className="h-5 w-5 fill-current" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Execute Clinical Payroll Run</h2>
                  <p className="text-xs text-slate-500">
                    Processes logged shifts and synchronizes General Ledger labor expenses
                  </p>
                </div>
              </div>
              <button
                id="close-run-payroll-btn"
                onClick={() => setShowRunModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleExecutePayroll} className="p-5 space-y-4">
              {payrollError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-xs font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {payrollError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Payroll Run / Batch Name *
                </label>
                <input
                  id="modal-payroll-name-input"
                  type="text"
                  required
                  value={periodName}
                  onChange={(e) => setPeriodName(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Cycle Start Date *
                  </label>
                  <input
                    id="modal-payroll-start-date-input"
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Cycle End Date *
                  </label>
                  <input
                    id="modal-payroll-end-date-input"
                    type="date"
                    required
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Disbursement / Payment Date *
                </label>
                <input
                  id="modal-payroll-pay-date-input"
                  type="date"
                  required
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono bg-slate-50 border border-slate-200 rounded-lg"
                />
              </div>

              <div className="bg-indigo-50 border border-indigo-200 p-3.5 rounded-xl space-y-1.5 text-xs text-indigo-900">
                <div className="font-bold flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-indigo-600" />
                  ERP General Ledger Integration
                </div>
                <p className="text-indigo-700 leading-relaxed">
                  Finalizing this payroll batch will automatically generate itemized Payslips for all active
                  staff and record a double-entry Journal Entry crediting Cash & Withholdings and debiting
                  Account 5000 (Clinical Labor Expense).
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowRunModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  id="submit-run-payroll-btn"
                  disabled={processingPayroll}
                  className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg shadow-xs"
                >
                  {processingPayroll ? 'Calculating & Posting...' : 'Finalize & Post to GL'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Statutory Tax & Deduction Compliance Report Modal */}
      <StatutoryTaxComplianceReportModal
        isOpen={showTaxComplianceModal}
        onClose={() => setShowTaxComplianceModal(false)}
        periods={periods}
        payslips={payslips}
        tenantId={tenantId}
      />
    </div>
  );
}
