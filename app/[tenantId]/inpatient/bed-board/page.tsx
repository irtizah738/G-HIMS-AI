'use client';

import { BedOccupancyView } from '@/components/views/bed-occupancy-view';

export default function InpatientBedBoardPage() {
  return (
    <main className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 sm:p-6">
      <BedOccupancyView />
    </main>
  );
}
