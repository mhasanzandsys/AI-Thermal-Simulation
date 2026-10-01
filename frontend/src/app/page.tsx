'use client';
import { ProjectInfoPanel, WorkflowPanel } from '@/components/panels/ProjectInfoPanel';
import { SolverPanel } from '@/components/panels/SolverPanel';
import { PackagePanel } from '@/components/panels/PackagePanel';
import { JedecPanel } from '@/components/panels/JedecPanel';
import { MaterialPropertiesPanel } from '@/components/panels/MaterialsPanel';
import { SimulationPanel } from '@/components/panels/SimulationPanel';
import { ResultsPanel } from '@/components/panels/ResultsPanel';
import { LeakagePanel } from '@/components/panels/LeakagePanel';
import { ReportsPanel } from '@/components/panels/ReportsPanel';

/** Overview dashboard reproducing the reference GUI mockup. */
export default function Dashboard() {
  return (
    <div className="mx-auto max-w-[1700px] space-y-3 p-3">
      <div className="grid gap-3 xl:grid-cols-[1fr_1.25fr_1.2fr]">
        <ProjectInfoPanel />
        <WorkflowPanel />
        <SolverPanel />
      </div>
      <div className="grid gap-3 xl:grid-cols-[1.12fr_1fr]">
        <PackagePanel />
        <JedecPanel />
      </div>
      <div className="grid gap-3 xl:grid-cols-[1.15fr_0.8fr_1.15fr]">
        <MaterialPropertiesPanel />
        <SimulationPanel />
        <ResultsPanel />
      </div>
      <div className="grid gap-3 xl:grid-cols-[1.25fr_1fr]">
        <LeakagePanel />
        <ReportsPanel />
      </div>
    </div>
  );
}
