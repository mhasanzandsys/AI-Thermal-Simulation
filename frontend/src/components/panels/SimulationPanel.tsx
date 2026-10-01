'use client';
import { useRouter } from 'next/navigation';
import { Play, Loader2, Plus, Trash2 } from 'lucide-react';
import { AI_OBJECTIVES, AI_OBJECTIVE_LABELS, MESH_DENSITIES, MESH_MODES, REFINEMENT_AREAS, SIMULATION_TYPES, SIMULATION_TYPE_LABELS, SWEEP_PARAMETERS } from '@ats/shared';
import { useProject } from '@/store/project';
import { Card, Check, Field, IssueList, NumInput, Radio, Select, SubHead } from '@/components/ui';

const MESH_LABEL = { automatic: 'Automatic', ai_optimized: 'Automatic (AI Optimized)', manual: 'Manual' } as const;
const DENS_LABEL = { coarse: 'Coarse (~10k)', medium: 'Medium (~30k)', fine: 'Fine (~90k)' } as const;
const SWEEP_LABEL = { power: 'Total power (W)', airVelocity: 'Air velocity (m/s)', timK: 'TIM k (W/m-K)', ambientTemp: 'Ambient (°C)', lidThickness: 'Lid thickness (mm)' } as const;

export function RunButton({ className }: { className?: string }) {
  const start = useProject((s) => s.startRun);
  const job = useProject((s) => s.job);
  const issues = useProject((s) => s.issues);
  const router = useRouter();
  const running = job && (job.info.status === 'running' || job.info.status === 'queued');
  const errors = issues.filter((i) => i.severity === 'Error');
  return (
    <button className={`btn btn-primary ${className ?? ''}`} disabled={!!running || errors.length > 0} title={errors.length ? `${errors.length} validation error(s): ${errors[0].message}` : 'Run AI pre-analysis + CFD'}
      onClick={async () => { await start(); router.push('/run'); }}>
      {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-white" />}
      {running ? `Running… ${Math.round(job!.info.progress)}%` : 'Run AI + CFD Simulation'}
    </button>
  );
}

export function SimulationPanel({ full = false }: { full?: boolean }) {
  const doc = useProject((s) => s.doc)!;
  const update = useProject((s) => s.update);
  const issues = useProject((s) => s.issues);
  const runError = useProject((s) => s.runError);
  const sim = doc.simulation, ai = doc.ai;
  const main = (
    <div className={full ? 'grid gap-4 md:grid-cols-2' : 'space-y-2'}>
      <div className="space-y-2">
        <div className="rounded border border-slate-200 p-2">
          <SubHead>Simulation Type</SubHead>
          <Radio name="simtype" value={sim.type} onChange={(v) => update((d) => { d.simulation.type = v; if (v === 'optimization') d.ai.optimization = true; })}
            options={SIMULATION_TYPES.map((t) => ({ value: t, label: SIMULATION_TYPE_LABELS[t] }))} />
        </div>
        <div className="rounded border border-slate-200 p-2">
          <SubHead>Mesh & Model</SubHead>
          <div className="space-y-1.5">
            <Field label="Mesh Type"><Select value={sim.mesh.mode} options={MESH_MODES.map((m) => ({ value: m, label: MESH_LABEL[m] }))} onChange={(v) => update((d) => { d.simulation.mesh.mode = v; })} /></Field>
            <Field label="Target Elements"><Select value={sim.mesh.density} options={MESH_DENSITIES.map((m) => ({ value: m, label: DENS_LABEL[m] }))} onChange={(v) => update((d) => { d.simulation.mesh.density = v; })} /></Field>
            {sim.mesh.mode === 'manual' && <Field label="Target Element Size" unit="mm"><NumInput allowNull value={sim.mesh.target} onChange={(v) => update((d) => { d.simulation.mesh.target = v && v > 0 ? v : null; })} placeholder="auto" /></Field>}
            <Check checked={sim.includeDetailedGeometry} onChange={(v) => update((d) => { d.simulation.includeDetailedGeometry = v; })} label="Include Detailed Geometry (Die, Substrate, TIM, etc.)" />
            <Check checked={sim.useSymmetry} onChange={(v) => update((d) => { d.simulation.useSymmetry = v; })} label="Use Symmetry" />
            {full && <Check checked={sim.includeRadiation} onChange={(v) => update((d) => { d.simulation.includeRadiation = v; })} label="Include surface radiation" />}
          </div>
          {full && sim.mesh.mode === 'manual' && (
            <div className="mt-2">
              <div className="mb-1 flex items-center justify-between"><span className="label font-medium">Local Refinement</span>
                <button className="btn btn-ghost h-6 px-1.5" onClick={() => update((d) => { d.simulation.mesh.refinement.push({ area: 'die', size: 0.25 }); })}><Plus className="h-3.5 w-3.5" /></button></div>
              {sim.mesh.refinement.map((r, i) => (
                <div key={i} className="mb-1 grid grid-cols-[1fr_90px_24px] gap-1.5">
                  <Select value={r.area} options={REFINEMENT_AREAS} onChange={(v) => update((d) => { d.simulation.mesh.refinement[i].area = v; })} />
                  <NumInput value={r.size} suffix="mm" onChange={(v) => update((d) => { d.simulation.mesh.refinement[i].size = v && v > 0 ? v : 0.1; })} />
                  <button onClick={() => update((d) => { d.simulation.mesh.refinement.splice(i, 1); })}><Trash2 className="h-3.5 w-3.5 text-slate-400" /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="space-y-2">
        {full && (
          <div className="rounded border border-slate-200 p-2 space-y-1.5">
            <SubHead>Analysis & Convergence</SubHead>
            <Field label="Ambient Temperature" unit="°C" path="simulation.ambientTemp"><NumInput path="simulation.ambientTemp" value={sim.ambientTemp} onChange={(v) => update((d) => { d.simulation.ambientTemp = v ?? 25; })} /></Field>
            <Field label="Air Velocity" unit="m/s" path="simulation.airVelocity"><NumInput path="simulation.airVelocity" value={sim.airVelocity} onChange={(v) => update((d) => { d.simulation.airVelocity = v ?? 0; })} /></Field>
            <Field label="Energy Residual" path="simulation.convergence.energy"><NumInput path="simulation.convergence.energy" value={sim.convergence.energy} onChange={(v) => update((d) => { d.simulation.convergence.energy = v ?? 1e-6; })} /></Field>
            <Field label="Max Iterations" path="simulation.convergence.maxIter"><NumInput path="simulation.convergence.maxIter" value={sim.convergence.maxIter} onChange={(v) => update((d) => { d.simulation.convergence.maxIter = Math.round(v ?? 1000); })} /></Field>
            {sim.type === 'transient' && (<>
              <Field label="Duration" unit="s"><NumInput value={sim.transient.duration} onChange={(v) => update((d) => { d.simulation.transient.duration = v ?? 60; })} /></Field>
              <Field label="Time step" unit="s"><NumInput value={sim.transient.timeStep} onChange={(v) => update((d) => { d.simulation.transient.timeStep = v ?? 1; })} /></Field>
              <p className="text-[11px] text-slate-500">Implicit Euler; max 400 steps. Power step applied at t = 0 from ambient.</p>
            </>)}
            {sim.type === 'parametric_sweep' && (<>
              <Field label="Sweep parameter"><Select value={sim.sweep.parameter} options={SWEEP_PARAMETERS.map((p) => ({ value: p, label: SWEEP_LABEL[p] }))} onChange={(v) => update((d) => { d.simulation.sweep.parameter = v; })} /></Field>
              <Field label="Start / End"><div className="grid grid-cols-2 gap-1.5"><NumInput value={sim.sweep.start} onChange={(v) => update((d) => { d.simulation.sweep.start = v ?? 0; })} /><NumInput value={sim.sweep.end} onChange={(v) => update((d) => { d.simulation.sweep.end = v ?? 0; })} /></div></Field>
              <Field label="Points"><NumInput value={sim.sweep.steps} onChange={(v) => update((d) => { d.simulation.sweep.steps = Math.max(2, Math.min(25, Math.round(v ?? 5))); })} /></Field>
            </>)}
          </div>
        )}
        <div className="rounded border border-slate-200 p-2">
          <SubHead>AI Options</SubHead>
          <div className="space-y-1">
            <Check checked={ai.preAnalysis} onChange={(v) => update((d) => { d.ai.preAnalysis = v; })} label="Predict Thermal Performance (AI Pre-analysis)" />
            <Check checked={ai.recommendImprovements} onChange={(v) => update((d) => { d.ai.recommendImprovements = v; })} label="Recommend Design Improvements" />
            <Check checked={ai.predictHotspots} onChange={(v) => update((d) => { d.ai.predictHotspots = v; })} label="Predict Hotspots" />
            {full && <Check checked={ai.optimization} onChange={(v) => update((d) => { d.ai.optimization = v; })} label="AI Design Optimization (varies TIM / lid / vias / balls)" />}
            {full && (ai.optimization || sim.type === 'optimization') && <Field label="Optimization Objective" path="ai.objective"><Select value={ai.objective} options={AI_OBJECTIVES.map((o) => ({ value: o, label: AI_OBJECTIVE_LABELS[o] }))} onChange={(v) => update((d) => { d.ai.objective = v; })} /></Field>}
          </div>
          {!full && <div className="mt-2 flex justify-end"><RunButton className="h-7" /></div>}
        </div>
      </div>
    </div>
  );
  return (
    <Card title="AI & Simulation Settings">
      {main}
      {full && (
        <div className="mt-4 grid gap-4 md:grid-cols-[1fr_auto]">
          <div className="rounded border border-slate-200 p-2">
            <SubHead>Pre-run validation</SubHead>
            <IssueList issues={issues.filter((i) => i.severity !== 'Info')} />
            {runError?.details && <div className="mt-2 border-t border-slate-100 pt-2"><IssueList issues={runError.details} /></div>}
          </div>
          <div className="flex items-end"><RunButton /></div>
        </div>
      )}
    </Card>
  );
}
