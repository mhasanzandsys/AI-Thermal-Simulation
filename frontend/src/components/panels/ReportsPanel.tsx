'use client';
import { useState } from 'react';
import { Lightbulb, Loader2, FileDown } from 'lucide-react';
import clsx from 'clsx';
import { REPORT_FORMATS, type ReportConfig } from '@ats/shared';
import { useProject } from '@/store/project';
import { api } from '@/lib/api';
import { Card, Check, Select, Badge } from '@/components/ui';

const SECTIONS: { key: keyof ReportConfig['sections']; label: string }[] = [
  { key: 'packageBom', label: 'Include Package Details & BOM' },
  { key: 'jedecSetup', label: 'Include JEDEC Test Setup' },
  { key: 'cfdModel', label: 'Include CFD Model & Mesh Info' },
  { key: 'thermalPlots', label: 'Include Thermal Plots' },
  { key: 'aiRecommendations', label: 'Include AI Recommendations' },
  { key: 'compliance', label: 'Include Compliance Summary' },
];
const FMT_LABEL = { PDF: 'PDF (Summary Report)', XLSX: 'Excel (XLSX)', JSON: 'JSON (full data)', CSV: 'CSV (metrics)' } as const;

export function ReportOptions({ compact = false }: { compact?: boolean }) {
  const doc = useProject((s) => s.doc)!;
  const results = useProject((s) => s.results);
  const update = useProject((s) => s.update);
  const notify = useProject((s) => s.notify);
  const [busy, setBusy] = useState(false);
  const rc = doc.reports;
  const gen = async () => {
    setBusy(true);
    try { const name = await api.report(doc.project.id, results?.jobId, rc.format, rc.sections); notify('success', `Downloaded ${name}`); }
    catch (e) { notify('error', (e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <div className={clsx('rounded border border-slate-200 p-2', compact && 'h-full')}>
      <div className="mb-1 text-[12px] font-semibold text-slate-700">Report Options</div>
      <div className="space-y-0.5">{SECTIONS.map((s) => <Check key={s.key} checked={rc.sections[s.key]} onChange={(v) => update((d) => { d.reports.sections[s.key] = v; })} label={s.label} />)}</div>
      <div className="mt-2 text-[12px] text-slate-700">Export Format</div>
      <div className={clsx('mt-1 flex gap-2', compact && 'flex-col')}>
        <Select className="flex-1" value={rc.format} options={REPORT_FORMATS.map((f) => ({ value: f, label: FMT_LABEL[f] }))} onChange={(v) => update((d) => { d.reports.format = v; })} />
        <button className="btn btn-primary" disabled={busy || !results} onClick={gen} title={results ? '' : 'Run a simulation first'}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}Generate Report</button>
      </div>
      {!results && <p className="mt-1 text-[11px] text-slate-500">Run a simulation to enable report generation.</p>}
    </div>
  );
}

export function RecommendationList({ max = 4, detailed = false }: { max?: number; detailed?: boolean }) {
  const results = useProject((s) => s.results);
  const recs = results?.aiRecommendations ?? [];
  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-[12.5px] font-semibold text-slate-700"><Lightbulb className="h-4 w-4" />Recommendations</div>
      {!recs.length ? <p className="text-[12px] text-slate-500">{results ? 'No improvements found by the sensitivity study.' : 'Run a simulation with “Recommend Design Improvements” enabled.'}</p> : (
        <ol className="space-y-2">
          {recs.slice(0, max).map((r) => (
            <li key={r.rank} className="flex gap-2 text-[12px] text-slate-700">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-400 text-[11px]">{r.rank}</span>
              <div>
                <div>{r.title}</div>
                {detailed && <div className="mt-0.5 text-[11.5px] text-slate-500">{r.detail}</div>}
                {detailed && <div className="mt-0.5 flex gap-1"><Badge kind="info">{r.category}</Badge><Badge kind={r.confidence === 'High' ? 'ok' : r.confidence === 'Medium' ? 'warn' : 'neutral'}>{r.confidence} confidence</Badge>{r.deltaTheta != null && <Badge>ΔθJA {r.deltaTheta.toFixed(2)} °C/W</Badge>}</div>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function ReportsPanel() {
  return (
    <Card title="Reports">
      <div className="grid grid-cols-[1fr_1fr] gap-4">
        <ReportOptions compact />
        <RecommendationList />
      </div>
    </Card>
  );
}
