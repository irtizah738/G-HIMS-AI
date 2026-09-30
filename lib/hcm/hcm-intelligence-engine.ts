import { createHash } from 'node:crypto';
import type { HcmWorkforceIntelligenceSnapshot } from '@/types/hcm-enterprise';

export function stableHcmFingerprint(value:unknown):string{
  const stable=(input:unknown):unknown=>{
    if(Array.isArray(input)) return input.map(stable);
    if(input&&typeof input==='object'){
      return Object.fromEntries(
        Object.entries(input as Record<string,unknown>)
          .sort(([a],[b])=>a.localeCompare(b))
          .map(([k,v])=>[k,stable(v)])
      );
    }
    return input;
  };
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

export function buildWorkforceAlerts(
  metrics:HcmWorkforceIntelligenceSnapshot['metrics']
):HcmWorkforceIntelligenceSnapshot['alerts']{
  const alerts:HcmWorkforceIntelligenceSnapshot['alerts']=[];
  if(metrics.credentialRiskCount>0) alerts.push({
    code:'CREDENTIAL_RISK',severity:'CRITICAL',value:metrics.credentialRiskCount,
    explanation:'Active clinical employees have mandatory credentials that are invalid or approaching expiry.'
  });
  if(metrics.openAttendanceCount>0) alerts.push({
    code:'OPEN_ATTENDANCE',severity:'WARNING',value:metrics.openAttendanceCount,
    explanation:'Attendance records remain open and require clock-out or governed correction.'
  });
  if(metrics.overtimeHours30d>80) alerts.push({
    code:'OVERTIME_RISK',severity:'WARNING',value:metrics.overtimeHours30d,
    explanation:'Aggregate overtime over the lookback window exceeds the workforce review threshold.'
  });
  if(Math.abs(metrics.payrollVarianceMinorUnits)>0) alerts.push({
    code:'PAYROLL_VARIANCE',severity:'WARNING',value:metrics.payrollVarianceMinorUnits,
    explanation:'Latest posted payroll gross differs from the preceding posted payroll period.'
  });
  if(metrics.fatigueRiskCount>0) alerts.push({
    code:'FATIGUE_RISK',severity:'CRITICAL',value:metrics.fatigueRiskCount,
    explanation:'Roster assignments contain fatigue, overlap, or insufficient-rest flags.'
  });
  if(metrics.understaffedShiftCount>0) alerts.push({
    code:'STAFFING_GAP',severity:'CRITICAL',value:metrics.understaffedShiftCount,
    explanation:'Roster assignments contain governed coverage or staffing-gap flags.'
  });
  return alerts;
}
