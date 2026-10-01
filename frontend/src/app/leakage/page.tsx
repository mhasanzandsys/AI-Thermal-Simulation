'use client';
import { LeakagePanel } from '@/components/panels/LeakagePanel';
import { PageHeader } from '@/components/PageHeader';

export default function LeakagePage() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-3 p-4">
      <PageHeader title="Leakage / Thermal Runaway" subtitle="Import PTPX leakage-vs-temperature data and evaluate dI_leak/dT ≥ 1/(V × Theta-JA)." />
      <LeakagePanel full />
    </div>
  );
}
