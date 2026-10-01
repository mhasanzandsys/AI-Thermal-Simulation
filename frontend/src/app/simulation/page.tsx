'use client';
import { SolverPanel } from '@/components/panels/SolverPanel';
import { SimulationPanel } from '@/components/panels/SimulationPanel';
import { PageHeader } from '@/components/PageHeader';

export default function SimulationPage() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-3 p-4">
      <PageHeader title="Simulation Setup" subtitle="Select CFD tool, mesh, convergence criteria, steady/transient mode and AI optimization." />
      <SolverPanel full />
      <SimulationPanel full />
    </div>
  );
}
