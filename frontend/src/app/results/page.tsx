'use client';
import { useState } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis, Legend } from 'recharts';
import { useProject } from '@/store/project';
import { Card, Empty, Kpi, Tabs, Badge } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';
import { Heatmap2D, Heatmap3D, SectionMap, Colorbar } from '@/components/viz/Heatmap';
import { AirflowChart, ComplianceTable, HeatFlowChart, Reliability, ResultsTable } from '@/components/panels/ResultsPanel';
import { RunButton } from '@/components/panels/SimulationPanel';
import { LeakageChart, StabilityBox } from '@/components/panels/LeakagePanel';

type MapTab = 'die' | 'pkg' | 'board' | 'section' | '3d';

export default function ResultsPage() {
  const r = useProject((s) => s.results);
  const [map, setMap] = useState<MapTab>('die');
  if (!r) return <div className="mx-auto max-w-5xl p-4"><PageHeader title="Thermal Results" /><Card><Empty>No results for this project yet. <RunButton className="mt-1" /></Empty></Card></div>;
  const m1 = r.thetaJAMoving[0];
  return (
    <div className="mx-auto max-w-[1500px] space-y-3 p-4">
      <PageHeader title="Thermal Results" subtitle={`Job ${r.jobId} · ${r.simulationType} · ${r.solver} · ${r.mesh.nx}×${r.mesh.ny}×${r.mesh.nz} mesh · ${(r.elapsedMs / 1000).toFixed(1)} s`} />
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <Kpi label="Tj max" value={r.tjMax.toFixed(1)} unit="°C" sub={`${r.tjLocation.die} @ (${r.tjLocation.x}, ${r.tjLocation.y})`} />
        <Kpi label="Case temp Tc" value={r.tc.toFixed(1)} unit="°C" />
        <Kpi label="Board temp Tb" value={r.tb.toFixed(1)} unit="°C" />
        <Kpi label="θJA still air" value={r.thetaJAStill?.toFixed(2) ?? '—'} unit="°C/W" sub="JESD51-2A" />
        <Kpi label={`θJA ${m1 ? m1.velocity + ' m/s' : 'moving'}`} value={m1?.thetaJA.toFixed(2) ?? '—'} unit="°C/W" sub="JESD51-6" />
        <Kpi label="θJB" value={r.thetaJB?.toFixed(2) ?? '—'} unit="°C/W" sub="JESD51-8" />
        <Kpi label="θJC (estimate)" value={r.thetaJC?.toFixed(3) ?? '—'} unit="°C/W" sub="custom, non-JEDEC" warn="Not a JEDEC steady-state result" />
        <Kpi label="Power" value={r.power.toFixed(2)} unit="W" sub={`Ta ${r.ambientTemp} °C`} />
      </div>
      <div className="grid gap-3 xl:grid-cols-[1.4fr_1fr]">
        <Card title="Temperature distribution">
          <Tabs tabs={[{ id: 'die', label: 'Die junction' }, { id: 'pkg', label: 'Package top' }, { id: 'board', label: 'Board top' }, { id: 'section', label: 'Cross-section' }, { id: '3d', label: '3D surface' }]} value={map} onChange={setMap} className="mb-3" />
          <div className="flex min-h-[300px] items-center justify-center">
            {map === 'die' && <Heatmap2D field={r.fields.dieTop} hotspots={r.hotspots} height={300} />}
            {map === 'pkg' && <Heatmap2D field={r.fields.packageTop} height={300} />}
            {map === 'board' && <Heatmap2D field={r.fields.boardTop} height={260} />}
            {map === 'section' && <SectionMap field={r.fields.crossSection} width={620} height={240} />}
            {map === '3d' && <div className="flex items-center gap-3"><Colorbar min={r.fields.packageTop.min} max={r.fields.packageTop.max} height={220} /><Heatmap3D field={r.fields.packageTop} width={460} height={300} /></div>}
          </div>
        </Card>
        <div className="space-y-3">
          <Card title="Thermal Results (JEDEC)"><ResultsTable r={r} /></Card>
          <Card title="Heat path split"><HeatFlowChart r={r} /></Card>
        </div>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <Card title="θJA vs airflow (JESD51-6)"><AirflowChart r={r} height={220} /></Card>
        <Card title="JEDEC compliance summary"><ComplianceTable r={r} /></Card>
      </div>
      {(r.transient || r.sweep) && (
        <div className="grid gap-3 xl:grid-cols-2">
          {r.transient && <Card title="Transient response"><ResponsiveContainer width="100%" height={240}><LineChart data={r.transient}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="t" unit=" s" fontSize={11} /><YAxis fontSize={11} unit="°C" domain={['auto', 'auto']} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} /><Line dataKey="tj" name="Tj" stroke="#d92d20" dot={false} /><Line dataKey="tc" name="Tc" stroke="#1f6feb" dot={false} /></LineChart></ResponsiveContainer></Card>}
          {r.sweep && <Card title={`Parametric sweep — ${r.sweep.parameter}`}><ResponsiveContainer width="100%" height={240}><LineChart data={r.sweep.points}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="x" fontSize={11} /><YAxis yAxisId="a" fontSize={11} unit="°C" /><YAxis yAxisId="b" orientation="right" fontSize={11} /><Tooltip /><Legend wrapperStyle={{ fontSize: 11 }} /><Line yAxisId="a" dataKey="tj" name="Tj (°C)" stroke="#d92d20" /><Line yAxisId="b" dataKey="thetaJA" name="θJA (°C/W)" stroke="#1f6feb" /></LineChart></ResponsiveContainer></Card>}
        </div>
      )}
      <div className="grid gap-3 xl:grid-cols-2">
        <Card title="Reliability analysis"><Reliability r={r} /></Card>
        {r.leakage ? <Card title={<span className="flex items-center gap-2">Leakage / thermal runaway <Badge kind={r.leakage.status === 'Stable' ? 'ok' : r.leakage.status === 'Marginal' ? 'warn' : 'error'}>{r.leakage.status}</Badge></span>}><div className="grid gap-3 md:grid-cols-[1fr_240px]"><LeakageChart res={r.leakage} height={220} /><StabilityBox res={r.leakage} err={null} /></div></Card> : <Card title="Leakage / thermal runaway"><Empty>Leakage analysis was not enabled for this run.</Empty></Card>}
      </div>
      <Card title="Convergence history"><ResponsiveContainer width="100%" height={200}><LineChart data={r.convergence}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="iteration" fontSize={11} /><YAxis scale="log" domain={['auto', 'auto']} fontSize={11} tickFormatter={(v) => Number(v).toExponential(0)} allowDataOverflow /><Tooltip formatter={(v) => Number(v).toExponential(3)} /><Line dataKey="residual" stroke="#1f6feb" dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer></Card>
    </div>
  );
}
