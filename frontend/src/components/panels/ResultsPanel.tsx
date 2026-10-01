'use client';
import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ThermalResults } from '@ats/shared';
import { useProject } from '@/store/project';
import { Badge, Card, Empty, Kpi, Tabs } from '@/components/ui';
import { Colorbar, Heatmap3D } from '@/components/viz/Heatmap';
import { RunButton } from './SimulationPanel';

type Tab = 'temp' | 'metrics' | 'jedec' | 'reliability';

export function ResultsTable({ r }: { r: ThermalResults }) {
  const m1 = r.thetaJAMoving.find((m) => m.velocity === 1) ?? r.thetaJAMoving[0];
  const rows: [string, string, string][] = [
    ['Theta-JA (Still Air)', r.thetaJAStill?.toFixed(1) ?? '—', '°C/W'],
    [`Theta-JA (Moving Air, ${m1?.velocity ?? 1} m/s)`, m1 ? m1.thetaJA.toFixed(1) : '—', '°C/W'],
    ['Theta-JB', r.thetaJB?.toFixed(1) ?? '—', '°C/W'],
    ['Theta-JC (estimated)', r.thetaJC?.toFixed(2) ?? '—', '°C/W'],
    ['Junction Temperature (Tj)', r.tjMax.toFixed(1), '°C'],
    ['Case/Board Temperature (Tb)', r.tb.toFixed(1), '°C'],
  ];
  return (
    <table className="tbl">
      <thead><tr><th>Parameter</th><th className="text-right">Value</th><th>Units</th></tr></thead>
      <tbody>{rows.map(([a, b, c]) => <tr key={a}><td className={a.includes('estimated') ? 'italic' : ''}>{a}</td><td className="text-right font-medium">{b}</td><td>{c}</td></tr>)}</tbody>
    </table>
  );
}

export function HeatFlowChart({ r, height = 170 }: { r: ThermalResults; height?: number }) {
  const h = r.heatFlowSplit;
  const data = [
    { name: 'Package exit', 'Top convection': h.topConvection, 'Package sides': h.packageSides, 'Into board': h.intoBoard },
    { name: 'Die exit', 'Die → lid/top': h.dieToLid, 'Die → substrate': h.dieToSubstrate },
  ];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 10, right: 10 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" domain={[0, 100]} unit="%" fontSize={11} />
        <YAxis type="category" dataKey="name" fontSize={11} width={80} />
        <Tooltip formatter={(v) => `${v}%`} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="Top convection" stackId="a" fill="#1f6feb" />
        <Bar dataKey="Package sides" stackId="a" fill="#7aa7f5" />
        <Bar dataKey="Into board" stackId="a" fill="#2fa84f" />
        <Bar dataKey="Die → lid/top" stackId="a" fill="#f08a3c" />
        <Bar dataKey="Die → substrate" stackId="a" fill="#8c6bd6" />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AirflowChart({ r, height = 170 }: { r: ThermalResults; height?: number }) {
  const data = [...(r.thetaJAStill != null ? [{ velocity: 0, thetaJA: r.thetaJAStill }] : []), ...r.thetaJAMoving];
  if (data.length < 2) return <Empty>Enable JESD51-6 with several airflow points to plot θJA vs airflow.</Empty>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ left: 0, right: 12, top: 6 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="velocity" unit=" m/s" fontSize={11} />
        <YAxis fontSize={11} unit="" label={{ value: 'θJA (°C/W)', angle: -90, position: 'insideLeft', fontSize: 11 }} />
        <Tooltip formatter={(v) => `${Number(v).toFixed(2)} °C/W`} labelFormatter={(l) => `${l} m/s`} />
        <Line type="monotone" dataKey="thetaJA" stroke="#1f6feb" strokeWidth={2} dot />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function ComplianceTable({ r }: { r: ThermalResults }) {
  return (
    <table className="tbl">
      <thead><tr><th>Standard</th><th>Metric</th><th>Setup</th><th>Status</th><th>Deviations</th></tr></thead>
      <tbody>
        {r.jedecCompliance.map((c) => (
          <tr key={c.standard + c.metric}>
            <td className="font-medium">{c.standard}</td><td>{c.metric}</td><td className="text-slate-600">{c.setup}</td>
            <td><Badge kind={c.status === 'Pass' ? 'ok' : c.status === 'Warning' ? 'warn' : 'error'}>{c.status}</Badge></td>
            <td className="text-[11.5px] text-slate-600">{c.deviations.join('; ') || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Reliability({ r }: { r: ThermalResults }) {
  const [limit, setLimit] = useState(125);
  const margin = limit - r.tjMax;
  const pMax = (limit - r.ambientTemp) / r.thetaJA;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <Kpi label="Tj margin to limit" value={margin.toFixed(1)} unit="°C" sub={<span>limit <input className="ml-1 w-12 rounded border border-slate-300 px-1" type="number" value={limit} onChange={(e) => setLimit(Number(e.target.value))} /> °C</span>} warn={margin < 10 ? 'Low margin' : undefined} />
      <Kpi label="Max power at limit (θJA)" value={pMax.toFixed(2)} unit="W" sub={`at Ta = ${r.ambientTemp} °C`} />
      <Kpi label="Thermal runaway" value={r.leakage ? r.leakage.status : 'n/a'} sub={r.leakage ? `dI/dT ${(100 * (1 - r.leakage.margin)).toFixed(0)}% of threshold` : 'Leakage analysis disabled'} warn={r.leakage && r.leakage.status !== 'Stable' ? 'Risk' : undefined} />
      <div className="md:col-span-3">
        <table className="tbl"><thead><tr><th>#</th><th>Hotspot</th><th>x (mm)</th><th>y (mm)</th><th>z (mm)</th><th>T (°C)</th></tr></thead>
          <tbody>{r.hotspots.map((h) => <tr key={h.rank}><td>{h.rank}</td><td>{h.location}</td><td>{h.x}</td><td>{h.y}</td><td>{h.z}</td><td className="font-medium">{h.temp}</td></tr>)}</tbody></table>
      </div>
      {r.warnings.length > 0 && <ul className="md:col-span-3 space-y-0.5 text-[11.5px] text-amber-700">{r.warnings.map((w) => <li key={w} className="flex gap-1"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />{w}</li>)}</ul>}
    </div>
  );
}

export function ResultsPanel() {
  const r = useProject((s) => s.results);
  const [tab, setTab] = useState<Tab>('temp');
  return (
    <Card title="Results & Analysis">
      <Tabs tabs={[{ id: 'temp', label: 'Temperature Distribution' }, { id: 'metrics', label: 'Thermal Metrics' }, { id: 'jedec', label: 'JEDEC Compliance' }, { id: 'reliability', label: 'Reliability Analysis' }]} value={tab} onChange={setTab} className="mb-3" />
      {!r ? (
        <Empty>No results yet. <RunButton className="mt-1 h-7" /></Empty>
      ) : (
        <>
          {tab === 'temp' && (
            <div className="grid grid-cols-[auto_1fr] gap-4">
              <div>
                <div className="mb-1 text-[12px] text-slate-600">Temperature (°C) — package top</div>
                <div className="flex items-center gap-2"><Colorbar min={r.fields.packageTop.min} max={r.fields.packageTop.max} height={150} /><Heatmap3D field={r.fields.packageTop} width={250} height={170} /></div>
              </div>
              <div>
                <div className="mb-1 text-[12px] font-semibold text-slate-700">Thermal Results (JEDEC)</div>
                <ResultsTable r={r} />
              </div>
            </div>
          )}
          {tab === 'metrics' && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="grid grid-cols-2 gap-2">
                <Kpi label="Tj max" value={r.tjMax.toFixed(1)} unit="°C" sub={r.tjLocation.die} />
                <Kpi label="θJA (operating)" value={r.thetaJA.toFixed(2)} unit="°C/W" />
                <Kpi label="Ψ-JT" value={r.psiJT.toFixed(2)} unit="°C/W" />
                <Kpi label="Ψ-JB" value={r.psiJB.toFixed(2)} unit="°C/W" />
              </div>
              <div><div className="text-[12px] font-medium text-slate-700">Heat path split</div><HeatFlowChart r={r} height={150} /></div>
            </div>
          )}
          {tab === 'jedec' && <ComplianceTable r={r} />}
          {tab === 'reliability' && <Reliability r={r} />}
          <p className="mt-2 text-[10.5px] text-slate-400">Job {r.jobId} · {r.solver} · {r.mesh.cells.toLocaleString()} cells · {(r.elapsedMs / 1000).toFixed(1)} s · {new Date(r.createdAt).toLocaleString()}</p>
        </>
      )}
    </Card>
  );
}
