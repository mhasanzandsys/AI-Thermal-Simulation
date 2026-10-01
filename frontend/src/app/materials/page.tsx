'use client';
import Link from 'next/link';
import { BomEditor } from '@/components/panels/BomEditor';
import { MaterialLibraryEditor, MaterialPropertiesPanel } from '@/components/panels/MaterialsPanel';
import { Card } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';

export default function MaterialsPage() {
  return (
    <div className="mx-auto max-w-[1500px] space-y-3 p-4">
      <PageHeader title="Materials" subtitle="Assign materials to package components and maintain the material library." actions={<Link className="btn btn-secondary" href="/package/bom">Open BOM full screen</Link>} />
      <div className="grid gap-3 xl:grid-cols-[1fr_1.4fr]">
        <MaterialPropertiesPanel />
        <Card title="Package BOM"><BomEditor compact /></Card>
      </div>
      <MaterialLibraryEditor />
    </div>
  );
}
