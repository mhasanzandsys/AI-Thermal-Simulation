'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Square, CheckCircle2, XCircle, Loader2, Clock } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { JobInfo } from '@ats/shared';
import { useProject } from '@/store/project';
import { api } from '@/lib/api';
import { Badge, Card, Empty, IssueList } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';
import { RunButton } from '@/components/panels/SimulationPanel';

const statusBadge = (s: string) => <Badge kind={s === 'completed' ? 'ok' : s === 'failed' ? 'error' : s === 'cancelled' ? 'neutral' : 'info'}>{s}</Badge>;

export default function RunPage() {
  const { job, cancelRun, doc, loadResults, runError, results } = useProject();
  const [history, setHistory] = useState<JobInfo[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const running = job && (job.info.status === 'running' || job.info.status === 'queued');
  useEffect(() => { if (doc) api.runs(doc.project.id).then(setHistory).catch(() => undefined); }, [doc?.project.id, job?.info.status]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [job?.logs.length]);
  const residuals = (job?.residuals ?? []).filter((r) => r.residual > 0).map((r, i) => ({ i, residual: r.residual }));
  return (
    <div className="mx-auto max-w-[1400px] space-y-3 p-4">
      <PageHeader title="Run Monitor" subtitle="Job progress, solver logs and convergence (live via Server-Sent Events)." actions={<RunButton />} />
      {runError && <Card title="Run blocked"><p className="mb-2 text-[12.5px] text-red-600">{runError.message}</p>{runError.details && <IssueList issues={runError.details} />}</Card>}
      {!job ? <Card><Empty>No active job. Start a run with “Run AI + CFD Simulation”.</Empty></Card> : (
        <>
          <Card title={<span className="flex items-center gap-2">Job {job.info.id} {statusBadge(job.info.status)}</span>} actions={running ? <button className="btn btn-danger h-7" onClick={() => void cancelRun()}><Square className="h-3.5 w-3.5" />Cancel</button> : job.info.status === 'completed' ? <Link className="btn btn-primary h-7" href="/results">View results</Link> : undefined}>
            <div className="mb-1 flex justify-between text-[12px] text-slate-600"><span className="flex items-center gap-1.5">{running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : job.info.status === 'completed' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" /> : <XCircle className="h-3.5 w-3.5 text-red-500" />}{job.info.stage}</span><span>{Math.round(job.info.progress)}%</span></div>
            <div className="h-2.5 overflow-hidden rounded bg-slate-100"><div className="h-full rounded bg-brand-600 transition-all" style={{ width: `${job.info.progress}%` }} /></div>
            {job.info.error && <p className="mt-2 text-[12px] text-red-600">{job.info.error}</p>}
          </Card>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card title="Solver log">
              <div ref={logRef} className="h-80 overflow-auto rounded bg-navy-950 p-2 font-mono text-[11.5px] leading-relaxed text-slate-200">
                {job.logs.map((l, i) => <div key={i} className={l.includes('ERROR') ? 'text-red-300' : l.includes('Stage:') ? 'text-sky-300' : ''}>{l}</div>)}
              </div>
            </Card>
            <Card title="Convergence (energy residual)">
              {residuals.length > 1 ? (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={residuals} margin={{ left: 8, right: 12, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="i" fontSize={11} label={{ value: 'Solver update', position: 'insideBottom', offset: -2, fontSize: 11 }} />
                    <YAxis scale="log" domain={['auto', 'auto']} fontSize={11} tickFormatter={(v) => Number(v).toExponential(0)} allowDataOverflow />
                    <Tooltip formatter={(v) => Number(v).toExponential(3)} />
                    <Line type="linear" dataKey="residual" stroke="#1f6feb" dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : results && job.info.status === 'completed' ? (
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={results.convergence} margin={{ left: 8, right: 12, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="iteration" fontSize={11} />
                    <YAxis scale="log" domain={['auto', 'auto']} fontSize={11} tickFormatter={(v) => Number(v).toExponential(0)} allowDataOverflow />
                    <Tooltip formatter={(v) => Number(v).toExponential(3)} />
                    <Line type="linear" dataKey="residual" stroke="#1f6feb" dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              ) : <Empty>Residual history appears while the solver iterates.</Empty>}
            </Card>
          </div>
        </>
      )}
      <Card title="Run history">
        {!history.length ? <Empty>No runs yet.</Empty> : (
          <table className="tbl">
            <thead><tr><th>Job</th><th>Status</th><th>Solver</th><th>Started</th><th>Finished</th><th>Error</th><th /></tr></thead>
            <tbody>{history.map((h) => (
              <tr key={h.id}><td className="font-mono text-[11.5px]">{h.id}</td><td>{statusBadge(h.status)}</td><td>{h.solver}</td><td><Clock className="mr-1 inline h-3 w-3 text-slate-400" />{new Date(h.createdAt).toLocaleString()}</td><td>{h.finishedAt ? new Date(h.finishedAt).toLocaleTimeString() : '—'}</td><td className="max-w-80 truncate text-red-600" title={h.error ?? ''}>{h.error}</td>
                <td>{h.status === 'completed' && <Link href="/results" className="text-brand-600 hover:underline" onClick={() => void loadResults(h.id)}>{results?.jobId === h.id ? 'Loaded' : 'Load results'}</Link>}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
