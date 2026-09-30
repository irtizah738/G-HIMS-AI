'use client';

import { GovernedPayrollConsole } from '@/components/hcm/governed-payroll-console';

export default function HealthcarePayrollPage(){
  return (
    <div className="min-h-screen bg-slate-50 p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <GovernedPayrollConsole />
      </div>
    </div>
  );
}
