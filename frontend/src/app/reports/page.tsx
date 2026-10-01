'use client';
import { useEffect, useState } from 'react';
import type { JobInfo } from '@ats/shared';
import { useProject } from '@/store/project';
import { api } from '@/lib/api';
import { Card, Empty } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';
import { RecommendationList, ReportOptions } from '@/components/panels/ReportsPanel';

export default function ReportsPage() {
  const { doc, results, loadResults } = useProject();
  const [runs, setRuns] = useState<JobInfo[]>([]);
  useEffect(() => { api.runs(doc!.project.id).then((r) => setRuns(r.filter((x) => x.status === 'completed'))).catch(() => undefined); }, [doc]);
  return (
    <div className="mx-auto max-w-[1300px] space-y-3 p-4">
      <PageHeader title="Report Builder" subtitle="Generate PDF / XLSX / JSON / CSV reports including JEDEC setup, model, assumptions and recommendations." />
      <div className="grid gap-3 lg:grid-cols-[1fr_1fr]">
        <Card title="Report configuration">
          <div className="mb-3">
            <label className="label">Results set</label>
            {runs.length ? (
              <select className="input mt-1" value={results?.jobId ?? ''} onChange={(e) => void loadResults(e.target.value)}>
                {runs.map((r) => <option key={r.id} value={r.id}>{r.id} — {new Date(r.createdAt).toLocaleString()}</option>)}
              </select>
            ) : <p className="text-[12px] text-slate-500">No completed runs yet.</p>}
          </div>
          <ReportOptions />
        </Card>
        <Card title="Report preview">
          {!results ? <Empty>Run a simulation to preview the report contents.</Empty> : (
            <div className="space-y-2 text-[12.5px]">
              <div className="rounded bg-navy-900 p-3 text-white"><div className="text-[15px] font-semibold">{doc!.project.name}</div><div className="text-slate-300">{doc!.project.deviceId} · Rev {doc!.project.revision} · {doc!.project.classification}</div></div>
              <ul className="list-disc space-y-0.5 pl-5">
                <li>Executive summary — Tj,max {results.tjMax} °C, θJA {results.thetaJA} °C/W</li>
                {doc!.reports.sections.packageBom && <li>Package definition &amp; BOM ({doc!.bom.filter((b) => b.included).length} items)</li>}
                {doc!.reports.sections.jedecSetup && <li>JEDEC setup — {doc!.jedec.standard}, {doc!.jedec.boardType} board</li>}
                {doc!.reports.sections.cfdModel && <li>CFD model &amp; mesh — {results.mesh.cells.toLocaleString()} cells, {results.warnings.length} warnings</li>}
                {doc!.reports.sections.thermalPlots && <li>Thermal plots — die &amp; package maps, {results.hotspots.length} hotspots{results.leakage ? ', leakage analysis' : ''}</li>}
                {doc!.reports.sections.aiRecommendations && <li>AI recommendations ({results.aiRecommendations.length})</li>}
                {doc!.reports.sections.compliance && <li>Compliance summary ({results.jedecCompliance.length} rows)</li>}
              </ul>
              <div className="border-t border-slate-100 pt-2"><RecommendationList /></div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
