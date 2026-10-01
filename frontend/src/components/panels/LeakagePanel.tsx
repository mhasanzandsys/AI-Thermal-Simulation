'use client';
import { useEffect, useRef, useState } from 'react';
import { Upload, CheckCircle2, AlertTriangle, XCircle, Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts';
import type { LeakageResult } from '@ats/shared';
import { useProject } from '@/store/project';
import { api } from '@/lib/api';
import { Card, Check, Field, FieldError, NumInput, Select, SubHead, Toggle } from '@/components/ui';

const sci = (v: number) => (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e4 ? v.toExponential(1).replace('e', 'E') : v.toPrecision(3));

export function useLeakageAnalysis() {
  const doc = useProject((s) => s.doc)!;
  const results = useProject((s) => s.results);
  const L = doc.leakage;
  const theta = L.thetaJASource === 'manual' ? L.thetaJA : results?.thetaJA ?? null;
  const [res, setRes] = useState<LeakageResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!theta || L.temperature.length < 2 || !(L.voltage > 0)) { setRes(null); setErr(!theta ? 'θJA not available — run a simulation or enter θJA manually.' : 'Provide V and at least two leakage points (VAL-008).'); return; }
    const t = setTimeout(() => {
      api.leakage({ leakage: L, thetaJA: theta, ambient: doc.simulation.ambientTemp, tjOperating: L.thetaJASource === 'results' ? results?.tjMax ?? null : null })
        .then((r) => { setRes(r); setErr(null); }).catch((e) => { setRes(null); setErr((e as Error).message); });
    }, 350);
    return () => clearTimeout(t);
  }, [L, theta, doc.simulation.ambientTemp, results?.tjMax]);
  return { res, err, theta };
}

export function LeakageChart({ res, height = 150 }: { res: LeakageResult; height?: number }) {
  const data = res.curve.map((c) => ({ t: c.t, fit: Math.max(c.fit, 1e-14), measured: c.measured ?? undefined }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ left: 4, right: 10, top: 6, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} fontSize={10.5} label={{ value: 'Temperature (°C)', position: 'insideBottom', offset: -2, fontSize: 11 }} height={32} />
        <YAxis scale="log" domain={['auto', 'auto']} fontSize={10.5} tickFormatter={sci} width={52} label={{ value: 'I_leak (A)', angle: -90, position: 'insideLeft', fontSize: 11 }} allowDataOverflow />
        <Tooltip formatter={(v) => `${Number(v).toExponential(3)} A`} labelFormatter={(l) => `${l} °C`} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="fit" name="Fit" stroke="#1f6feb" dot={false} strokeWidth={2} isAnimationActive={false} />
        <Scatter dataKey="measured" name="PTPX data" fill="#0b2447" />
        <ReferenceLine x={res.tjOperating} stroke="#f08a3c" strokeDasharray="4 3" label={{ value: 'Tj', fontSize: 10, fill: '#c0631f' }} />
        {res.runawayTemp != null && <ReferenceLine x={res.runawayTemp} stroke="#d92d20" strokeDasharray="4 3" label={{ value: 'runaway', fontSize: 10, fill: '#d92d20' }} />}
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function StabilityBox({ res, err }: { res: LeakageResult | null; err: string | null }) {
  const st = res?.status;
  return (
    <div>
      <div className="mb-1 text-[12px] font-semibold text-slate-700">Instability Check (dI<sub>leak</sub>/dT Criterion)</div>
      <div className="mb-2 flex items-center justify-center gap-2 font-serif text-[13px] text-slate-800">
        <span className="flex flex-col items-center leading-none"><span>dI<sub>leak</sub></span><span className="w-full border-t border-slate-700 text-center">dT</span></span>
        <span>{st === 'Unstable' ? '≥' : '<'}</span>
        <span className="flex flex-col items-center leading-none"><span>1</span><span className="border-t border-slate-700 px-1">V · Theta-JA</span></span>
      </div>
      {res ? (
        <div className={clsx('flex gap-2 rounded p-2', st === 'Stable' ? 'bg-emerald-50' : st === 'Marginal' ? 'bg-amber-50' : 'bg-red-50')}>
          {st === 'Stable' ? <CheckCircle2 className="h-7 w-7 shrink-0 text-emerald-600" /> : st === 'Marginal' ? <AlertTriangle className="h-7 w-7 shrink-0 text-amber-500" /> : <XCircle className="h-7 w-7 shrink-0 text-red-600" />}
          <div className="text-[11.5px] text-slate-700">
            <div className={clsx('text-[15px] font-semibold', st === 'Stable' ? 'text-emerald-700' : st === 'Marginal' ? 'text-amber-700' : 'text-red-700')}>{st}</div>
            <div>{st === 'Stable' ? 'Current Design: No thermal runaway risk' : st === 'Marginal' ? 'Low margin to thermal runaway' : 'Thermal runaway predicted'}</div>
            <div>dI<sub>leak</sub>/dT = {res.derivativeAtTj.toExponential(2)} A/°C @ {res.tjOperating} °C</div>
            <div>Threshold = {res.threshold.toExponential(2)} A/°C (θJA {res.thetaJA.toFixed(2)})</div>
          </div>
        </div>
      ) : <p className="rounded bg-slate-50 p-2 text-[11.5px] text-slate-500">{err ?? 'Waiting for data…'}</p>}
    </div>
  );
}

export function LeakagePanel({ full = false }: { full?: boolean }) {
  const doc = useProject((s) => s.doc)!;
  const update = useProject((s) => s.update);
  const notify = useProject((s) => s.notify);
  const L = doc.leakage;
  const { res, err } = useLeakageAnalysis();
  const fileRef = useRef<HTMLInputElement>(null);
  const importFile = async (file: File) => {
    try {
      const r = await api.importLeakage(file);
      if (!r.temperature.length) throw new Error(r.errors.join('; ') || 'No data found');
      update((d) => { d.leakage.temperature = r.temperature; d.leakage.current = r.current; d.leakage.enabled = true; });
      notify(r.errors.length ? 'info' : 'success', `Imported ${r.temperature.length} points${r.errors.length ? ` (${r.errors.length} lines skipped)` : ''}`);
    } catch (e) { notify('error', (e as Error).message); }
  };
  return (
    <Card title="Leakage vs. Temperature Analysis" actions={<Toggle checked={L.enabled} onChange={(v) => update((d) => { d.leakage.enabled = v; })} label="Include in run" />}>
      <div className={clsx('grid gap-4', full ? 'lg:grid-cols-[270px_1fr_300px]' : 'grid-cols-[235px_1fr_235px]')}>
        <div className="space-y-1.5 rounded border border-slate-200 p-2">
          <SubHead>Input from PTPX</SubHead>
          <Field label="Voltage (V)" path="leakage"><NumInput value={L.voltage} onChange={(v) => update((d) => { d.leakage.voltage = v ?? 0; })} /></Field>
          <Field label="Power Range (W)" inline={false}>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1"><NumInput value={L.powerRange.min} onChange={(v) => update((d) => { d.leakage.powerRange.min = v ?? 0; })} /><span className="label">to</span><NumInput value={L.powerRange.max} onChange={(v) => update((d) => { d.leakage.powerRange.max = v ?? 0; })} /></div>
          </Field>
          {full && <Field label="Operating Power (W)"><NumInput value={L.power} onChange={(v) => update((d) => { d.leakage.power = v ?? 0; })} /></Field>}
          {full && <Field label="θJA source"><Select value={L.thetaJASource} options={[{ value: 'results', label: 'From simulation' }, { value: 'manual', label: 'Manual' }]} onChange={(v) => update((d) => { d.leakage.thetaJASource = v; })} /></Field>}
          {full && L.thetaJASource === 'manual' && <Field label="θJA (°C/W)"><NumInput allowNull value={L.thetaJA} onChange={(v) => update((d) => { d.leakage.thetaJA = v; })} /></Field>}
          {full && <Field label="Fit model"><Select value={L.fitModel} options={[{ value: 'exponential', label: 'Exponential a·e^(bT)' }, { value: 'polynomial2', label: 'Quadratic' }]} onChange={(v) => update((d) => { d.leakage.fitModel = v; })} /></Field>}
          <input ref={fileRef} type="file" accept=".csv,.txt,.rpt,.json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFile(f); e.target.value = ''; }} />
          <button className="btn btn-secondary mt-1 w-full border-brand-500 text-brand-600" onClick={() => fileRef.current?.click()}><Upload className="h-3.5 w-3.5" />Import PTPX (I<sub>leak</sub> vs T)</button>
          <FieldError path="leakage.temperature" />
        </div>
        <div>
          <div className="text-center text-[12px] font-semibold text-slate-700">Leakage Current vs. Temperature</div>
          {res ? <LeakageChart res={res} height={full ? 240 : 150} /> : <div className="flex h-36 items-center justify-center text-[12px] text-slate-500">{err}</div>}
          {full && res && <p className="text-[11px] text-slate-600">{res.fit.expression} · R² = {res.fit.r2.toFixed(4)}</p>}
        </div>
        <div className="rounded border border-slate-200 p-2"><StabilityBox res={res} err={err} /></div>
      </div>
      {full && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <div className="mb-1 flex items-center justify-between"><SubHead>Leakage data (PTPX)</SubHead>
              <button className="btn btn-ghost h-6 px-1.5" onClick={() => update((d) => { const t = d.leakage.temperature; t.push((t[t.length - 1] ?? 0) + 25); d.leakage.current.push(d.leakage.current[d.leakage.current.length - 1] ?? 0); })}><Plus className="h-3.5 w-3.5" />Add point</button></div>
            <table className="tbl"><thead><tr><th>#</th><th>Temperature (°C)</th><th>I_leak (A)</th><th /></tr></thead>
              <tbody>{L.temperature.map((t, i) => (
                <tr key={i}><td>{i + 1}</td>
                  <td><NumInput value={t} onChange={(v) => update((d) => { d.leakage.temperature[i] = v ?? 0; })} /></td>
                  <td><NumInput value={L.current[i]} onChange={(v) => update((d) => { d.leakage.current[i] = v ?? 0; })} /></td>
                  <td><button onClick={() => update((d) => { d.leakage.temperature.splice(i, 1); d.leakage.current.splice(i, 1); })}><Trash2 className="h-3.5 w-3.5 text-slate-400" /></button></td></tr>
              ))}</tbody></table>
            <p className="mt-1 text-[11px] text-slate-500">CSV import: two columns (temperature °C, current A); header and # comments allowed.</p>
          </div>
          <div className="space-y-2">
            {res && (<>
              <SubHead>Analysis</SubHead>
              <ul className="list-disc space-y-0.5 pl-5 text-[12px] text-slate-700">{res.messages.map((m) => <li key={m}>{m}</li>)}</ul>
              <SubHead>Electrothermal iteration  Tj = Ta + θJA·(P_dyn + V·I(Tj))</SubHead>
              <div className="max-h-40 overflow-auto"><table className="tbl"><thead><tr><th>Iter</th><th>Tj (°C)</th><th>P (W)</th></tr></thead>
                <tbody>{res.electrothermal.slice(0, 30).map((e) => <tr key={e.iteration}><td>{e.iteration}</td><td>{e.tj}</td><td>{e.power}</td></tr>)}</tbody></table></div>
            </>)}
            <Check checked={L.enabled} onChange={(v) => update((d) => { d.leakage.enabled = v; })} label="Run leakage analysis with every simulation (adds a recommendation if not stable)" />
          </div>
        </div>
      )}
    </Card>
  );
}
