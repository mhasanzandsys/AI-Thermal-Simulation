/** In-process job queue with SSE fan-out (spec: RunMonitor — POST /run; GET /run/:id; SSE). */
import type { Response } from 'express';
import { uid, type JobInfo, type ProjectDoc } from '@ats/shared';
import { adapters } from './adapters';
import { jobs as jobsDb, results as resultsDb, projects } from './db';

interface LiveJob {
  info: JobInfo;
  logs: string[];
  residuals: { iteration: number; residual: number }[];
  cancelled: boolean;
  listeners: Set<Response>;
  doc: ProjectDoc;
  fallback: boolean;
}

const live = new Map<string, LiveJob>();
const queue: string[] = [];
let running: string | null = null;

export const isBusy = () => running !== null;

function emit(j: LiveJob, event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of j.listeners) res.write(payload);
}

function log(j: LiveJob, msg: string) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  j.logs.push(line);
  emit(j, 'log', line);
}

export function submitJob(doc: ProjectDoc, opts: { fallbackToBuiltin?: boolean } = {}): JobInfo {
  const id = 'JOB-' + uid().toUpperCase();
  const info: JobInfo = { id, projectId: doc.project.id, status: 'queued', progress: 0, stage: 'Queued', createdAt: new Date().toISOString(), finishedAt: null, error: null, solver: doc.solver.type };
  const j: LiveJob = { info, logs: [], residuals: [], cancelled: false, listeners: new Set(), doc, fallback: opts.fallbackToBuiltin ?? true };
  live.set(id, j);
  jobsDb.insert(info);
  queue.push(id);
  log(j, `Job ${id} queued (${adapters[doc.solver.type].label}).`);
  void pump();
  return info;
}

async function pump() {
  if (running || !queue.length) return;
  const id = queue.shift()!;
  const j = live.get(id);
  if (!j) return pump();
  running = id;
  j.info.status = 'running';
  j.info.stage = 'Starting';
  emit(j, 'status', j.info);
  jobsDb.update(j.info);
  let lastEmit = 0;
  const hooks = {
    progress: (p: number, stage: string) => {
      j.info.progress = Math.max(j.info.progress, Math.min(100, Math.round(p * 10) / 10));
      if (stage !== j.info.stage) { j.info.stage = stage; log(j, `Stage: ${stage}`); }
      const now = Date.now();
      if (now - lastEmit > 200) { lastEmit = now; emit(j, 'status', j.info); }
    },
    log: (m: string) => log(j, m),
    residual: (iteration: number, residual: number) => {
      const pt = { iteration: j.residuals.length ? Math.max(iteration, j.residuals[j.residuals.length - 1].iteration + 1) : iteration, residual };
      j.residuals.push(pt);
      emit(j, 'residual', pt);
    },
    isCancelled: () => j.cancelled,
  };
  try {
    let adapter = adapters[j.doc.solver.type];
    if (adapter.type !== 'builtin') {
      const st = await adapter.status(j.doc.solver, false);
      if (!st.connected && j.fallback) {
        log(j, `${adapter.label} not available (${st.message}). Exporting deck and falling back to built-in solver.`);
        try { adapter.exportDeck(j.doc); } catch { /* ignore */ }
        adapter = adapters.builtin;
      }
    }
    const res = await adapter.run(j.doc, id, hooks);
    resultsDb.save(res);
    // remember last job id on the project (solver.jobId is a read-only, system generated field)
    const p = projects.get(j.doc.project.id);
    if (p) { p.solver.jobId = id; projects.save(p); }
    j.info.status = 'completed';
    j.info.progress = 100;
    j.info.stage = 'Completed';
    log(j, `Completed in ${(res.elapsedMs / 1000).toFixed(1)} s — Tj,max = ${res.tjMax} °C, θJA = ${res.thetaJA} °C/W.`);
  } catch (e) {
    const err = e as Error;
    j.info.status = j.cancelled ? 'cancelled' : 'failed';
    j.info.error = err.message;
    j.info.stage = j.cancelled ? 'Cancelled' : 'Failed';
    log(j, `${j.cancelled ? 'Cancelled' : 'ERROR'}: ${err.message}`);
  } finally {
    j.info.finishedAt = new Date().toISOString();
    jobsDb.update(j.info, j.logs);
    emit(j, 'status', j.info);
    emit(j, 'done', j.info);
    for (const res of j.listeners) res.end();
    j.listeners.clear();
    running = null;
    setTimeout(() => live.delete(id), 10 * 60 * 1000);
    void pump();
  }
}

export function getJob(id: string) {
  const j = live.get(id);
  if (j) return { ...j.info, logs: j.logs, residuals: j.residuals };
  const d = jobsDb.get(id);
  return d ? { ...d, residuals: [] } : null;
}

export function cancelJob(id: string) {
  const j = live.get(id);
  if (!j) return false;
  j.cancelled = true;
  const qi = queue.indexOf(id);
  if (qi >= 0) {
    queue.splice(qi, 1);
    j.info.status = 'cancelled'; j.info.stage = 'Cancelled'; j.info.finishedAt = new Date().toISOString();
    jobsDb.update(j.info, j.logs);
    emit(j, 'done', j.info);
  }
  return true;
}

export function subscribe(id: string, res: Response) {
  const j = live.get(id);
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  if (!j) {
    const d = jobsDb.get(id);
    res.write(`event: status\ndata: ${JSON.stringify(d)}\n\n`);
    res.write(`event: done\ndata: ${JSON.stringify(d)}\n\n`);
    return res.end();
  }
  res.write(`event: snapshot\ndata: ${JSON.stringify({ info: j.info, logs: j.logs, residuals: j.residuals })}\n\n`);
  if (['completed', 'failed', 'cancelled'].includes(j.info.status)) { res.write(`event: done\ndata: ${JSON.stringify(j.info)}\n\n`); return res.end(); }
  j.listeners.add(res);
  const ka = setInterval(() => res.write(': keep-alive\n\n'), 15000);
  res.on('close', () => { clearInterval(ka); j.listeners.delete(res); });
}
