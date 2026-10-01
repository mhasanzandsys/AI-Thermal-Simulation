'use client';
import { useState } from 'react';
import { Bot, Loader2, Sparkles, Wand2 } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { PreAnalysis } from '@ats/shared';
import { useProject } from '@/store/project';
import { api } from '@/lib/api';
import { Card, Check, Empty, Field, Kpi, Select } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';
import { RecommendationList } from '@/components/panels/ReportsPanel';
import { RunButton } from '@/components/panels/SimulationPanel';
import { AI_OBJECTIVES, AI_OBJECTIVE_LABELS } from '@ats/shared';

export default function AiPage() {
  const { doc, results, update, saveNow, notify } = useProject();
  const [pre, setPre] = useState<PreAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const runPre = async () => { setBusy(true); try { await saveNow(); setPre(await api.preAnalysis(doc!.project.id)); } catch (e) { notify('error', (e as Error).message); } finally { setBusy(false); } };
  const shown = pre ?? results?.preAnalysis ?? null;
  const opt = results?.optimization;
  const best = opt?.candidates[opt.candidates.length - 1];
  const applyOptimum = () => {
    if (!best) return;
    update((d) => {
      for (const [k, v] of Object.entries(best.params)) {
        if (k.startsWith('TIM k')) { d.package.tim.k = v; const r = d.bom.find((b) => b.key === 'bom.tim1'); if (r) { r.kIn = v; r.kThrough = v; } }
        if (k.startsWith('Lid thickness')) d.package.lid.thickness = v;
        if (k.startsWith('Thermal vias')) d.package.substrate.thermalVias = v >= 0.5;
        if (k.startsWith('Ball count')) d.package.balls.count = Math.round(d.package.balls.count * v);
      }
    });
    notify('success', 'Applied optimum design parameters — re-run to verify on the full mesh');
  };
  return (
    <div className="mx-auto max-w-[1400px] space-y-3 p-4">
      <PageHeader title="AI Assistant" subtitle="Physics-informed pre-analysis, surrogate-based design optimization and sensitivity-driven recommendations (runs locally, no external AI service)." actions={<RunButton />} />
      <div className="grid gap-3 xl:grid-cols-[1.2fr_1fr]">
        <Card title={<span className="flex items-center gap-2"><Bot className="h-4 w-4" />AI pre-analysis</span>} actions={<button className="btn btn-secondary h-7" onClick={runPre} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}Predict now</button>}>
          {!shown ? <Empty>Predict Tj, θJA, dominant heat path and hotspots in milliseconds before running CFD.</Empty> : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-2">
                <Kpi label="Predicted Tj" value={shown.estimatedTj.toFixed(1)} unit="°C" sub={results ? `CFD: ${results.tjMax.toFixed(1)} °C` : undefined} />
                <Kpi label="Predicted θJA" value={shown.estimatedThetaJA.toFixed(2)} unit="°C/W" sub={results ? `CFD: ${results.thetaJA.toFixed(2)}` : undefined} />
                <Kpi label="Predicted hotspot" value={`(${shown.predictedHotspot.x}, ${shown.predictedHotspot.y})`} unit="mm" sub={shown.predictedHotspot.die} />
              </div>
              <div className="text-[12px] text-slate-700"><b>Dominant path:</b> {shown.dominantPath}</div>
              <div>
                <div className="mb-1 text-[12px] font-medium text-slate-700">Thermal resistance network (°C/W, log scale)</div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={shown.resistanceNetwork} layout="vertical" margin={{ left: 20, right: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                    <XAxis type="number" scale="log" domain={[0.01, 'auto']} fontSize={11} allowDataOverflow />
                    <YAxis type="category" dataKey="name" width={150} fontSize={11} />
                    <Tooltip formatter={(v) => `${v} °C/W`} />
                    <Bar dataKey="r" fill="#1f6feb" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid gap-3 md:grid-cols-2 text-[12px]">
                <div><b>Mesh recommendation</b><div>~{shown.meshRecommendation.cells.toLocaleString()} cells, {shown.meshRecommendation.density}</div><ul className="list-disc pl-5 text-slate-600">{shown.meshRecommendation.refinements.map((x) => <li key={x}>{x}</li>)}</ul></div>
                <div><b>Notes</b><ul className="list-disc pl-5 text-slate-600">{shown.notes.map((x) => <li key={x}>{x}</li>)}</ul></div>
              </div>
            </div>
          )}
        </Card>
        <Card title="Design recommendations"><RecommendationList max={10} detailed /></Card>
      </div>
      <Card title={<span className="flex items-center gap-2"><Wand2 className="h-4 w-4" />AI design optimization</span>} actions={best ? <button className="btn btn-primary h-7" onClick={applyOptimum}>Apply optimum to design</button> : undefined}>
        <div className="mb-3 flex flex-wrap items-center gap-4">
          <Check checked={doc!.ai.optimization} onChange={(v) => update((d) => { d.ai.optimization = v; })} label="Run optimization with next simulation" />
          <Field label="Objective" className="w-80"><Select value={doc!.ai.objective} options={AI_OBJECTIVES.map((o) => ({ value: o, label: AI_OBJECTIVE_LABELS[o] }))} onChange={(v) => update((d) => { d.ai.objective = v; })} /></Field>
        </div>
        {!opt ? <Empty>Enable optimization and run a simulation. The engine samples TIM conductivity, lid thickness, thermal vias and ball count (Latin hypercube), fits a quadratic surrogate, then verifies the predicted optimum with a solve.</Empty> : (
          <>
            <p className="mb-2 text-[12.5px]">Objective <b>{opt.objective}</b>: baseline <b>{opt.baseline}</b> → optimum <b>{opt.best}</b></p>
            <div className="max-h-80 overflow-auto rounded border border-slate-200">
              <table className="tbl">
                <thead><tr><th>Candidate</th>{Object.keys(opt.candidates[0].params).map((k) => <th key={k}>{k}</th>)}<th>Tj (°C)</th><th>θJA (°C/W)</th><th>Mass (g)</th></tr></thead>
                <tbody>{opt.candidates.map((c) => <tr key={c.label} className={c.label.startsWith('Surrogate') ? 'bg-emerald-50 font-medium' : c.label === 'Baseline' ? 'bg-slate-50' : ''}><td>{c.label}</td>{Object.values(c.params).map((v, i) => <td key={i}>{v}</td>)}<td>{c.tj}</td><td>{c.thetaJA}</td><td>{c.mass}</td></tr>)}</tbody>
              </table>
            </div>
            <p className="mt-1 text-[11px] text-slate-500">Candidates are evaluated on a coarse surrogate mesh; absolute values differ slightly from the full-mesh result.</p>
          </>
        )}
      </Card>
    </div>
  );
}
