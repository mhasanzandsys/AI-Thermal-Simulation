/**
 * Simulation jobs (spec: RunMonitor — POST /run; GET /run/:id; SSE).
 *
 * Two ways to run a job:
 *  - streamJob(): runs the job inside the HTTP request and streams progress as Server-Sent Events.
 *    This is what the web app uses; it works on serverless hosts (Vercel) where work started after
 *    the response is sent may be frozen.
 *  - submitJob(): classic background queue (returns 202 immediately) — fine on a long-running server.
 *
 * Job state is mirrored to the database (throttled) so GET /run/:id, the events endpoint and cancel
 * work even when the request lands on a different server/function instance.
 */
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
let running = 0;

export const isBusy = () => running > 0;

const sse = (res: Response, event: string, data: unknown) => { try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* client gone */ } };
function emit(j: LiveJob, event: string, data: unknown) { for (const res of j.listeners) sse(res, event, data); }
function log(j: LiveJob, msg: string) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  j.logs.push(line);
  emit(j, 'log', line);
}

export function sseHeaders(res: Response) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders?.();
  res.write(': connected\n\n');
}

async function createJob(doc: ProjectDoc, fallback: boolean): Promise<LiveJob> {
  const id = 'JOB-' + uid().toUpperCase();
  const info: JobInfo = { id, projectId: doc.project.id, status: 'queued', progress: 0, stage: 'Queued', createdAt: new Date().toISOString(), finishedAt: null, error: null, solver: doc.solver.type };
  const j: LiveJob = { info, logs: [], residuals: [], cancelled: false, listeners: new Set(), doc, fallback };
  live.set(id, j);
  await jobsDb.insert(info);
  log(j, `Job ${id} created (${adapters[doc.solver.type].label}).`);
  return j;
}

/** Run a job to completion; progress goes to listeners and (throttled) to the DB. */
async function execute(j: LiveJob) {
  running++;
  j.info.status = 'running';
  j.info.stage = 'Starting';
  emit(j, 'status', j.info);
  await jobsDb.update(j.info);
  let lastEmit = 0, lastFlush = Date.now(), flushing = false;
  const flush = () => {
    if (flushing) return;
    flushing = true;
    lastFlush = Date.now();
    void Promise.all([jobsDb.update(j.info, j.logs), jobsDb.cancelRequested(j.info.id)])
      .then(([, c]) => { if (c) j.cancelled = true; })
      .catch(() => undefined)
      .finally(() => { flushing = false; });
  };
  const hooks = {
    progress: (p: number, stage: string) => {
      j.info.progress = Math.max(j.info.progress, Math.min(100, Math.round(p * 10) / 10));
      if (stage !== j.info.stage) { j.info.stage = stage; log(j, `Stage: ${stage}`); }
      const now = Date.now();
      if (now - lastEmit > 200) { lastEmit = now; emit(j, 'status', j.info); }
      if (now - lastFlush > 1500) flush();
    },
    log: (m: string) => log(j, m),
    residual: (iteration: number, residual: number) => {
      const prev = j.residuals[j.residuals.length - 1];
      const pt = { iteration: prev ? Math.max(iteration, prev.iteration + 1) : iteration, residual };
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
        log(j, `${adapter.label} not available (${st.message}). Falling back to the built-in solver.`);
        adapter = adapters.builtin;
      }
    }
    const res = await adapter.run(j.doc, j.info.id, hooks);
    await resultsDb.save(res);
    const p = await projects.get(j.doc.project.id);
    if (p) { p.solver.jobId = j.info.id; await projects.save(p); }
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
    running--;
    j.info.finishedAt = new Date().toISOString();
    await jobsDb.update(j.info, j.logs).catch(() => undefined);
    emit(j, 'status', j.info);
    emit(j, 'done', j.info);
    for (const res of j.listeners) { try { res.end(); } catch { /* */ } }
    j.listeners.clear();
    setTimeout(() => live.delete(j.info.id), 10 * 60 * 1000).unref?.();
  }
}

/** Run inside the request, streaming SSE back on the same response (serverless-friendly). */
export async function streamJob(doc: ProjectDoc, res: Response, opts: { fallbackToBuiltin?: boolean } = {}) {
  sseHeaders(res);
  const j = await createJob(doc, opts.fallbackToBuiltin ?? true);
  j.listeners.add(res);
  sse(res, 'snapshot', { info: j.info, logs: j.logs, residuals: j.residuals });
  const ka = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch { /* */ } }, 10000);
  res.on('close', () => { j.listeners.delete(res); });
  try { await execute(j); } finally { clearInterval(ka); }
}

/** Background queue (long-running server only). */
export async function submitJob(doc: ProjectDoc, opts: { fallbackToBuiltin?: boolean } = {}): Promise<JobInfo> {
  const j = await createJob(doc, opts.fallbackToBuiltin ?? true);
  queue.push(j.info.id);
  void pump();
  return j.info;
}
async function pump() {
  if (running > 0 || !queue.length) return;
  const j = live.get(queue.shift()!);
  if (j) await execute(j);
  void pump();
}

export async function getJob(id: string) {
  const j = live.get(id);
  if (j) return { ...j.info, logs: j.logs, residuals: j.residuals };
  const d = await jobsDb.get(id);
  return d ? { ...d, residuals: [] } : null;
}

export async function cancelJob(id: string) {
  const j = live.get(id);
  await jobsDb.requestCancel(id); // reaches the worker even on another instance
  if (!j) return !!(await jobsDb.get(id));
  j.cancelled = true;
  const qi = queue.indexOf(id);
  if (qi >= 0) {
    queue.splice(qi, 1);
    j.info.status = 'cancelled'; j.info.stage = 'Cancelled'; j.info.finishedAt = new Date().toISOString();
    await jobsDb.update(j.info, j.logs);
    emit(j, 'done', j.info);
  }
  return true;
}

const FINISHED = ['completed', 'failed', 'cancelled'];

/** SSE subscription; follows the job through the DB when it runs on another instance. */
export async function subscribe(id: string, res: Response) {
  sseHeaders(res);
  const j = live.get(id);
  if (j) {
    sse(res, 'snapshot', { info: j.info, logs: j.logs, residuals: j.residuals });
    if (FINISHED.includes(j.info.status)) { sse(res, 'done', j.info); return res.end(); }
    j.listeners.add(res);
    const ka = setInterval(() => { try { res.write(': keep-alive\n\n'); } catch { /* */ } }, 15000);
    res.on('close', () => { clearInterval(ka); j.listeners.delete(res); });
    return;
  }
  let d = await jobsDb.get(id);
  if (!d) { sse(res, 'done', null); return res.end(); }
  sse(res, 'snapshot', { info: d, logs: d.logs, residuals: [] });
  let sent = d.logs.length, closed = false;
  res.on('close', () => { closed = true; });
  const started = Date.now();
  while (!closed && !FINISHED.includes(d.status) && Date.now() - started < 280_000) {
    await new Promise((r) => setTimeout(r, 1500));
    const n = await jobsDb.get(id);
    if (!n) break;
    d = n;
    for (const line of d.logs.slice(sent)) sse(res, 'log', line);
    sent = d.logs.length;
    sse(res, 'status', d);
    if (d.heartbeat && Date.now() - Date.parse(d.heartbeat) > 120_000) { await jobsDb.failStale(); }
  }
  if (FINISHED.includes(d.status)) sse(res, 'done', d);
  res.end();
}
