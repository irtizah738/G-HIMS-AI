'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  approvePayrollPeriodEdge,
  calculatePayrollEmployeeEdge,
  createPayrollPeriodEdge,
  enrollPayrollEmployeeEdge,
  finalizePayrollPeriodEdge,
  generateHcmIntelligenceEdge,
  hydratePayroll,
  loadLocalPayroll,
  postPayrollPeriodEdge,
  remitPayrollLiabilityEdge,
  settlePayrollPeriodEdge,
} from '@/lib/hcm/hcm-edge-adapter';
import type { PayrollPeriodRecord } from '@/types/hcm-advanced';

type PayrollSnapshot=Awaited<ReturnType<typeof loadLocalPayroll>>;

export function GovernedPayrollConsole(){
  const params=useParams();
  const tenantId=String(params?.tenantId||'').trim();
  const [snapshot,setSnapshot]=useState<PayrollSnapshot|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [message,setMessage]=useState<string|null>(null);
  const [treasuryAccountId,setTreasuryAccountId]=useState('');
  const [settlementReference,setSettlementReference]=useState('');
  const [facilityId,setFacilityId]=useState('');
  const [periodName,setPeriodName]=useState('');
  const [periodNumber,setPeriodNumber]=useState('');
  const [payFrequency,setPayFrequency]=useState<'MONTHLY'|'SEMI_MONTHLY'|'BI_WEEKLY'>('MONTHLY');
  const [startDate,setStartDate]=useState('');
  const [endDate,setEndDate]=useState('');
  const [paymentDate,setPaymentDate]=useState('');
  const [currency,setCurrency]=useState('PKR');

  const apply=(value:PayrollSnapshot)=>setSnapshot(value);
  const refresh=async()=>{
    if(!tenantId){
      setError('TENANT_CONTEXT_REQUIRED: HCM payroll requires an explicit tenant route.');
      setLoading(false);
      return;
    }
    setLoading(true);
    try{
      apply(await loadLocalPayroll(tenantId));
      apply(await hydratePayroll(tenantId));
    }catch(err){
      setError(err instanceof Error?err.message:'Failed to load governed payroll projections.');
    }finally{
      setLoading(false);
    }
  };

  useEffect(()=>{void refresh();},[tenantId]);

  const latestIntel=useMemo(
    ()=>[...(snapshot?.intelligence||[])].sort((a,b)=>b.asOf.localeCompare(a.asOf))[0],
    [snapshot]
  );

  const run=async(key:string,fn:()=>Promise<unknown>,success:string)=>{
    setBusy(key);setError(null);setMessage(null);
    try{
      await fn();
      await refresh();
      setMessage(success);
    }catch(err){
      setError(err instanceof Error?err.message:'HCM payroll operation failed.');
    }finally{
      setBusy(null);
    }
  };

  const createPeriod=async(e:React.FormEvent)=>{
    e.preventDefault();
    await run('create-period',()=>createPayrollPeriodEdge({
      facilityId,periodNumber,periodName,payFrequency,startDate,endDate,paymentDate,
      currency:currency.trim().toUpperCase(),
    }),'Payroll period created.');
  };

  const enrollEligible=async(period:PayrollPeriodRecord)=>{
    if(!snapshot) return;
    await run(`enroll:${period.periodId}`,async()=>{
      const eligible=snapshot.employees.filter(employee=>
        employee.facilityIds.includes(period.facilityId)&&
        ['ACTIVE','ON_LEAVE'].includes(employee.employmentStatus)
      );
      const existing=new Set(
        snapshot.payrollEmployeeSlots
          .filter(slot=>slot.periodId===period.periodId)
          .map(slot=>slot.employeeId)
      );
      const failures:string[]=[];
      for(const employee of eligible.filter(row=>!existing.has(row.employeeId))){
        try{
          await enrollPayrollEmployeeEdge({periodId:period.periodId,employeeId:employee.employeeId});
        }catch(err){
          failures.push(`${employee.employeeNumber}: ${err instanceof Error?err.message:'enrollment failed'}`);
        }
      }
      if(failures.length) throw new Error(
        `Enrollment completed with ${failures.length} failure(s): ${failures.slice(0,3).join(' | ')}`
      );
    },'Eligible employees enrolled.');
  };

  const calculatePending=async(period:PayrollPeriodRecord)=>{
    if(!snapshot) return;
    await run(`calculate:${period.periodId}`,async()=>{
      const pending=snapshot.payrollEmployeeSlots.filter(
        slot=>slot.periodId===period.periodId&&slot.status==='PENDING'
      );
      const failures:string[]=[];
      for(const slot of pending){
        try{
          await calculatePayrollEmployeeEdge({periodId:period.periodId,employeeId:slot.employeeId});
        }catch(err){
          failures.push(`${slot.employeeId}: ${err instanceof Error?err.message:'calculation failed'}`);
        }
      }
      if(failures.length) throw new Error(
        `Calculation completed with ${failures.length} failure(s): ${failures.slice(0,3).join(' | ')}`
      );
    },'Pending payroll employees calculated.');
  };

  const settle=async(period:PayrollPeriodRecord)=>{
    if(!treasuryAccountId.trim()||!settlementReference.trim()){
      setError('Treasury account ID and settlement reference are required.');
      return;
    }
    await run(`settle:${period.periodId}`,()=>settlePayrollPeriodEdge({
      periodId:period.periodId,
      treasuryAccountId:treasuryAccountId.trim(),
      settlementReference:settlementReference.trim(),
      settledAt:new Date().toISOString(),
    }),'Payroll settled through Treasury.');
  };

  const remit=async(liabilityId:string)=>{
    if(!treasuryAccountId.trim()||!settlementReference.trim()){
      setError('Treasury account ID and remittance reference are required.');
      return;
    }
    await run(`remit:${liabilityId}`,()=>remitPayrollLiabilityEdge({
      liabilityId,
      treasuryAccountId:treasuryAccountId.trim(),
      remittanceReference:settlementReference.trim(),
      remittedAt:new Date().toISOString(),
    }),'Payroll statutory liability remitted.');
  };

  if(loading&&!snapshot){
    return <div className="p-6 text-sm text-slate-500">Loading governed HCM payroll…</div>;
  }

  return (
    <div className="space-y-6 pb-12">
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">Governed Payroll & Workforce Finance</h1>
            <p className="text-sm text-slate-500">
              Server-authoritative payroll calculation, maker-checker approval, Finance posting and Treasury settlement.
            </p>
          </div>
          <button
            className="rounded border px-3 py-2 text-sm"
            disabled={!!busy}
            onClick={()=>run('intelligence',()=>generateHcmIntelligenceEdge({
              snapshotId:`hcm_intel_${Date.now()}`,
              asOf:new Date().toISOString(),
              lookbackDays:30,
              facilityId:facilityId||undefined,
            }),'Workforce intelligence refreshed.')}
          >
            Refresh Intelligence
          </button>
        </div>
        {error&&<div className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}
        {message&&<div className="mt-4 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div>}
      </div>

      <form onSubmit={createPeriod} className="grid gap-3 rounded-xl border bg-white p-5 md:grid-cols-4">
        <div className="md:col-span-4 font-semibold">Create Payroll Period</div>
        <input className="rounded border p-2 text-sm" required placeholder="Facility ID" value={facilityId} onChange={e=>setFacilityId(e.target.value)}/>
        <input className="rounded border p-2 text-sm" required placeholder="Period number" value={periodNumber} onChange={e=>setPeriodNumber(e.target.value)}/>
        <input className="rounded border p-2 text-sm" required placeholder="Period name" value={periodName} onChange={e=>setPeriodName(e.target.value)}/>
        <select className="rounded border p-2 text-sm" value={payFrequency} onChange={e=>setPayFrequency(e.target.value as typeof payFrequency)}>
          <option value="MONTHLY">Monthly</option>
          <option value="SEMI_MONTHLY">Semi-monthly</option>
          <option value="BI_WEEKLY">Bi-weekly</option>
        </select>
        <input className="rounded border p-2 text-sm" required type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/>
        <input className="rounded border p-2 text-sm" required type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/>
        <input className="rounded border p-2 text-sm" required type="date" value={paymentDate} onChange={e=>setPaymentDate(e.target.value)}/>
        <input className="rounded border p-2 text-sm" required maxLength={3} placeholder="Currency" value={currency} onChange={e=>setCurrency(e.target.value.toUpperCase())}/>
        <button className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white md:col-span-4" disabled={!!busy}>
          Create Governed Period
        </button>
      </form>

      <div className="grid gap-3 rounded-xl border bg-white p-5 md:grid-cols-2">
        <input className="rounded border p-2 text-sm" placeholder="Treasury account ID" value={treasuryAccountId} onChange={e=>setTreasuryAccountId(e.target.value)}/>
        <input className="rounded border p-2 text-sm" placeholder="Settlement / remittance reference" value={settlementReference} onChange={e=>setSettlementReference(e.target.value)}/>
      </div>

      <div className="rounded-xl border bg-white">
        <div className="border-b p-4 font-semibold">Payroll Periods</div>
        <div className="divide-y">
          {[...(snapshot?.payrollPeriods||[])].sort((a,b)=>b.startDate.localeCompare(a.startDate)).map(period=>{
            const slots=snapshot?.payrollEmployeeSlots.filter(row=>row.periodId===period.periodId)||[];
            const payslips=snapshot?.payrollPayslips.filter(row=>row.periodId===period.periodId)||[];
            return (
              <div key={period.periodId} className="space-y-3 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold">{period.periodName} · {period.status}</div>
                    <div className="text-slate-500">
                      {period.startDate} → {period.endDate} · {period.currency} ·
                      Enrolled {slots.length} · Payslips {payslips.length}
                    </div>
                    <div className="text-slate-500">
                      Gross {(period.totalGrossMinorUnits/100).toLocaleString()} ·
                      Net {(period.totalNetMinorUnits/100).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {period.status==='OPEN'&&<button className="rounded border px-2 py-1" disabled={!!busy} onClick={()=>enrollEligible(period)}>Enroll Eligible</button>}
                    {['OPEN','CALCULATING'].includes(period.status)&&<button className="rounded border px-2 py-1" disabled={!!busy} onClick={()=>calculatePending(period)}>Calculate Pending</button>}
                    {['OPEN','CALCULATING'].includes(period.status)&&<button className="rounded border px-2 py-1" disabled={!!busy} onClick={()=>run(`finalize:${period.periodId}`,()=>finalizePayrollPeriodEdge({periodId:period.periodId}),'Payroll calculations finalized.')}>Finalize</button>}
                    {period.status==='CALCULATED'&&<button className="rounded border px-2 py-1" disabled={!!busy} onClick={()=>run(`approve:${period.periodId}`,()=>approvePayrollPeriodEdge({periodId:period.periodId}),'Payroll approved.')}>Approve</button>}
                    {period.status==='APPROVED'&&<button className="rounded border px-2 py-1" disabled={!!busy} onClick={()=>run(`post:${period.periodId}`,()=>postPayrollPeriodEdge({periodId:period.periodId}),'Payroll posted to Finance.')}>Post to Finance</button>}
                    {period.status==='POSTED'&&<button className="rounded border px-2 py-1" disabled={!!busy} onClick={()=>settle(period)}>Settle</button>}
                  </div>
                </div>
              </div>
            );
          })}
          {!snapshot?.payrollPeriods.length&&<div className="p-4 text-sm text-slate-500">No payroll periods found.</div>}
        </div>
      </div>

      <div className="rounded-xl border bg-white">
        <div className="border-b p-4 font-semibold">Statutory Payroll Liabilities</div>
        <div className="divide-y">
          {(snapshot?.payrollLiabilities||[]).map(row=>(
            <div key={row.liabilityId} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
              <div>
                <div className="font-medium">{row.code} · {row.name}</div>
                <div className="text-slate-500">{row.liabilityAccountCode} · {(row.amountMinorUnits/100).toLocaleString()} {row.currency} · {row.status}</div>
              </div>
              {row.status==='ACCRUED'&&<button className="rounded border px-2 py-1" disabled={!!busy} onClick={()=>remit(row.liabilityId)}>Remit</button>}
            </div>
          ))}
          {!snapshot?.payrollLiabilities.length&&<div className="p-4 text-sm text-slate-500">No statutory liabilities accrued.</div>}
        </div>
      </div>

      {latestIntel&&(
        <div className="rounded-xl border bg-white p-5 text-sm">
          <div className="font-semibold">Latest Workforce Intelligence</div>
          <div className="mt-2 text-slate-600">
            Active {latestIntel.metrics.activeEmployees} · Credential risk {latestIntel.metrics.credentialRiskCount} ·
            Open attendance {latestIntel.metrics.openAttendanceCount} · Overtime {latestIntel.metrics.overtimeHours30d}h ·
            Fatigue risk {latestIntel.metrics.fatigueRiskCount}
          </div>
        </div>
      )}
    </div>
  );
}
