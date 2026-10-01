'use client';
import { PackagePanel } from '@/components/panels/PackagePanel';
import { PageHeader } from '@/components/PageHeader';

export default function PackagePage() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-3 p-4">
      <PageHeader title="Package Definition" subtitle="Geometry, package type, dimensions, drawing/model import, dies & power maps, substrate, lid / TIM, interconnect." />
      <PackagePanel full />
    </div>
  );
}
