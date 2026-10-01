'use client';

import { BedOccupancyView } from '@/components/views/bed-occupancy-view';
import { GovernedBedBoard } from '@/components/inpatient/governed-bed-board';

export default function InpatientBedBoardPage() {
  const isDemoRuntime =
    String(process.env.NEXT_PUBLIC_GHIMS_RUNTIME_MODE || '')
      .trim()
      .toUpperCase() === 'DEMO';

  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
      {isDemoRuntime ? <BedOccupancyView /> : <GovernedBedBoard />}
    </main>
  );
}
