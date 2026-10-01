'use client';
import { useEffect, useState } from 'react';
import { Check as CheckIcon, Download, RefreshCw, Circle } from 'lucide-react';
import clsx from 'clsx';
import { GEOMETRY_FORMATS, SOLVER_LABELS, SOLVER_TYPES, type Solver } from '@ats/shared';
import { useProject } from '@/store/project';
import { api } from '@/lib/api';
import { Card, Check, Field, Select, StatusIcon, TextInput, Toggle } from '@/components/ui';

const DEFAULT_ENDPOINTS: Record<Solver['type'], string> = {
  builtin: 'local://builtin',
  icepak: 'C:\\Program Files\\AnsysEM\\v242\\Win64\\ansysedt.exe',
  flotherm: 'C:\\Program Files\\Siemens\\SimcenterFlotherm\\2404\\WinXP\\bin\\flotherm.exe',
  starccm: 'C:\\Program Files\\Siemens\\STAR-CCM+\\star\\bin\\starccm+.exe',
  fluent: 'C:\\Program Files\\ANSYS Inc\\v242\\fluent\\ntbin\\win64\\fluent.exe',
  custom: 'http://localhost:9000/solve',
};

export function SolverPanel({ full = false }: { full?: boolean }) {
  const doc = useProject((s) => s.doc)!;
  const update = useProject((s) => s.update);
  const status = useProject((s) => s.solverStatus);
  const refresh = useProject((s) => s.refreshSolverStatus);
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const sv = doc.solver;
  // refresh connector status when solver config changes
  useEffect(() => { const t = setTimeout(() => void refresh(), 600); return () => clearTimeout(t); }, [sv.type, sv.endpoint, refresh]);

  const pick = (t: Solver['type']) => {
    update((d) => { d.solver.type = t; if (!d.solver.endpoint || Object.values(DEFAULT_ENDPOINTS).includes(d.solver.endpoint)) d.solver.endpoint = DEFAULT_ENDPOINTS[t]; d.solver.licenseStatus = 'Available'; });
    setOpen(false);
  };
  const check = async () => { setChecking(true); await refresh(); setChecking(false); };

  return (
    <Card title="CFD Tool Integration" actions={full ? <button className="btn btn-secondary h-7" onClick={check}><RefreshCw className={clsx('h-3.5 w-3.5', checking && 'animate-spin')} />Test connection</button> : undefined}>
      <div className={clsx('grid gap-3', full ? 'md:grid-cols-[1.3fr_1fr]' : 'grid-cols-[1.4fr_1fr]')}>
        <div className="rounded border border-slate-200 p-2">
          <div className="mb-1 text-[12px] font-medium text-slate-700">Select CFD Tool</div>
          <div className="relative">
            <button className="input flex items-center justify-between" onClick={() => setOpen((o) => !o)}>
              <span className="font-medium">{SOLVER_LABELS[sv.type]}</span>
              <span className="text-[11px] text-brand-600">{sv.type.toUpperCase()}</span>
            </button>
            {open && (
              <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded border border-slate-200 bg-white shadow-lg">
                {SOLVER_TYPES.map((t) => (
                  <li key={t}>
                    <button onClick={() => pick(t)} className={clsx('flex w-full items-center justify-between px-3 py-1.5 text-left text-[12.5px]', t === sv.type ? 'bg-brand-600 text-white' : 'hover:bg-slate-50')}>
                      {SOLVER_LABELS[t]}{t === sv.type && <CheckIcon className="h-3.5 w-3.5" />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="mt-2 space-y-1.5">
            {sv.type !== 'builtin' && <Field label="Executable / API Endpoint" path="solver.endpoint"><TextInput path="solver.endpoint" value={sv.endpoint} onChange={(v) => update((d) => { d.solver.endpoint = v; })} /></Field>}
            {full && (
              <>
                <Field label="Solver Version"><TextInput value={sv.version} onChange={(v) => update((d) => { d.solver.version = v; })} placeholder="e.g. 2024 R2" /></Field>
                <Field label="Geometry Import"><Select value={sv.geometryFormat} options={GEOMETRY_FORMATS} onChange={(v) => update((d) => { d.solver.geometryFormat = v; })} /></Field>
                <Field label="Mesh Export"><Toggle checked={sv.meshExport} onChange={(v) => update((d) => { d.solver.meshExport = v; })} /></Field>
                <Field label="Remote Execution"><Toggle checked={sv.remote.enabled} onChange={(v) => update((d) => { d.solver.remote.enabled = v; })} /></Field>
                {sv.remote.enabled && <Field label="Remote host"><TextInput value={sv.remote.host} onChange={(v) => update((d) => { d.solver.remote.host = v; })} placeholder="hpc-cluster.local" /></Field>}
                <Field label="Queue / Job ID"><TextInput value={sv.jobId || '—'} onChange={() => undefined} disabled /></Field>
                <div className="pt-1">
                  <a className="btn btn-secondary h-7" href={api.deckUrl(doc.project.id, sv.type)} target="_blank" rel="noreferrer"><Download className="h-3.5 w-3.5" />Export solver input deck</a>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="rounded border border-slate-200 p-2">
          <div className="mb-1 text-[12px] font-medium text-slate-700">Integration Status</div>
          <div className={clsx('mb-2 flex items-center gap-1.5 text-[12px]', status?.connected ? 'text-emerald-700' : 'text-red-600')}>
            <Circle className={clsx('h-2.5 w-2.5', status?.connected ? 'fill-emerald-500 text-emerald-500' : 'fill-red-500 text-red-500')} />
            {status ? (status.connected ? status.message : status.message) : 'Checking…'}
          </div>
          <ul className="space-y-1.5">
            {(status?.checks ?? []).map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-[12px] text-slate-700"><StatusIcon ok={c.ok} />{c.label === 'AI Optimization Enabled' ? (doc.ai.optimization ? c.label : 'AI Optimization Available') : c.label}</li>
            ))}
          </ul>
          <div className="mt-2 text-[11px] text-slate-500">License: <b>{status?.licenseStatus ?? '—'}</b></div>
          {status && !status.connected && sv.type !== 'builtin' && <p className="mt-1 text-[11px] text-amber-700">Runs fall back to the built-in solver; the {SOLVER_LABELS[sv.type]} deck is still exported.</p>}
          {full && <Check className="mt-2" checked={doc.ai.preAnalysis} onChange={(v) => update((d) => { d.ai.preAnalysis = v; })} label="AI pre-analysis before solve" />}
        </div>
      </div>
    </Card>
  );
}
