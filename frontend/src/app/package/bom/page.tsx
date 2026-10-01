'use client';
import { BomEditor } from '@/components/panels/BomEditor';
import { Card } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';

export default function BomPage() {
  return (
    <div className="mx-auto max-w-[1500px] space-y-3 p-4">
      <PageHeader title="Package BOM & Materials" subtitle="Hierarchical package stack-up with thermal properties (spec sheet: BOM & Materials)." />
      <Card title="Bill of Materials"><BomEditor /></Card>
    </div>
  );
}
