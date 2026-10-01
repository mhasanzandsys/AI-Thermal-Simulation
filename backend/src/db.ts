/**
 * Persistence layer (libSQL / SQLite).
 *
 * - Local development: a SQLite file in DATA_DIR (default ./data/thermal.db).
 * - Vercel / serverless: set TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN) to a Turso database so data is
 *   shared by every function instance. Without it the app falls back to /tmp, which works but is
 *   wiped whenever Vercel starts a new instance.
 */
import { createClient, type Client, type InValue } from '@libsql/client';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MATERIAL_LIBRARY, demoProject, type Material, type ProjectDoc, type ThermalResults, type JobInfo } from '@ats/shared';

export const IS_SERVERLESS = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? (IS_SERVERLESS ? path.join(os.tmpdir(), 'ats-data') : path.join(process.cwd(), 'data')));
export const JOB_DIR = path.join(DATA_DIR, 'jobs');
fs.mkdirSync(JOB_DIR, { recursive: true });

const remoteUrl = process.env.TURSO_DATABASE_URL ?? process.env.LIBSQL_URL ?? process.env.DATABASE_URL;
export const DB_KIND: 'remote' | 'file' = remoteUrl && /^(libsql|https?|wss?):/.test(remoteUrl) ? 'remote' : 'file';
export const DB_LOCATION = DB_KIND === 'remote' ? remoteUrl!.replace(/\/\/[^@]*@/, '//') : path.join(DATA_DIR, 'thermal.db');

const client: Client = DB_KIND === 'remote'
  ? createClient({ url: remoteUrl!, authToken: process.env.TURSO_AUTH_TOKEN ?? process.env.LIBSQL_AUTH_TOKEN })
  : createClient({ url: 'file:' + path.join(DATA_DIR, 'thermal.db').replace(/\\/g, '/') });

type Row = Record<string, unknown>;
async function all<T = Row>(sql: string, args: InValue[] = []): Promise<T[]> {
  const r = await client.execute({ sql, args });
  return r.rows as unknown as T[];
}
async function get<T = Row>(sql: string, args: InValue[] = []): Promise<T | undefined> {
  return (await all<T>(sql, args))[0];
}
async function run(sql: string, args: InValue[] = []) { await client.execute({ sql, args }); }

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, doc TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY, data TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL, progress REAL NOT NULL, stage TEXT, solver TEXT, created_at TEXT NOT NULL, finished_at TEXT, error TEXT, logs TEXT, cancel_requested INTEGER DEFAULT 0, heartbeat TEXT)`,
  `CREATE TABLE IF NOT EXISTS results (job_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT, size INTEGER, data BLOB, created_at TEXT NOT NULL)`,
];

// ---------------------------------------------------------------- init (once per process)
let ready: Promise<void> | null = null;
export function initDb() {
  ready ??= (async () => {
    if (DB_KIND === 'file') {
      try { await client.execute('PRAGMA journal_mode = WAL'); } catch { /* ignore */ }
    }
    await client.batch(SCHEMA, 'write');
    // migrate older local databases
    for (const sql of ['ALTER TABLE jobs ADD COLUMN cancel_requested INTEGER DEFAULT 0', 'ALTER TABLE jobs ADD COLUMN heartbeat TEXT', 'ALTER TABLE files ADD COLUMN data BLOB']) {
      try { await client.execute(sql); } catch { /* column exists */ }
    }
    await seed();
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

// ---------------------------------------------------------------- projects
export async function nextProjectId(): Promise<string> {
  const row = await get<{ id: string }>(`SELECT id FROM projects WHERE id LIKE 'PRJ-%' ORDER BY id DESC LIMIT 1`);
  const n = row ? parseInt(row.id.slice(4), 10) + 1 : 123;
  return `PRJ-${String(n).padStart(6, '0')}`;
}

export const projects = {
  async list() {
    const rows = await all<{ id: string; name: string; doc: string; created_at: string; updated_at: string }>('SELECT id, name, doc, created_at, updated_at FROM projects ORDER BY updated_at DESC');
    return rows.map((r) => { const d = JSON.parse(r.doc) as ProjectDoc; return { id: r.id, name: r.name, deviceId: d.project.deviceId, customer: d.project.customer, packageType: d.package.type, createdAt: r.created_at, updatedAt: r.updated_at }; });
  },
  async get(id: string): Promise<ProjectDoc | null> {
    const r = await get<{ doc: string }>('SELECT doc FROM projects WHERE id = ?', [id]);
    return r ? (JSON.parse(r.doc) as ProjectDoc) : null;
  },
  async nameTaken(name: string, exceptId?: string) {
    return !!(await get('SELECT id FROM projects WHERE lower(name) = lower(?) AND id != ?', [name, exceptId ?? '']));
  },
  async save(doc: ProjectDoc): Promise<ProjectDoc> {
    const now = new Date().toISOString();
    const exists = await get<{ created_at: string }>('SELECT created_at FROM projects WHERE id = ?', [doc.project.id]);
    doc.updatedAt = now;
    doc.createdAt = exists?.created_at ?? doc.createdAt ?? now;
    await run(`INSERT INTO projects (id, name, doc, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, doc = excluded.doc, updated_at = excluded.updated_at`,
    [doc.project.id, doc.project.name, JSON.stringify(doc), doc.createdAt, now]);
    return doc;
  },
  async remove(id: string) {
    await client.batch([
      { sql: 'DELETE FROM projects WHERE id = ?', args: [id] },
      { sql: 'DELETE FROM results WHERE project_id = ?', args: [id] },
      { sql: 'DELETE FROM jobs WHERE project_id = ?', args: [id] },
    ], 'write');
  },
};

// ---------------------------------------------------------------- materials
export const materials = {
  async list(): Promise<Material[]> {
    return (await all<{ data: string }>('SELECT data FROM materials')).map((r) => JSON.parse(r.data) as Material)
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  },
  async upsert(m: Material) { await run('INSERT INTO materials (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data', [m.id, JSON.stringify(m)]); },
  async remove(id: string) { await run('DELETE FROM materials WHERE id = ?', [id]); },
};

// ---------------------------------------------------------------- jobs / results
const toJob = (r: Row): JobInfo => ({ id: r.id as string, projectId: r.project_id as string, status: r.status as JobInfo['status'], progress: Number(r.progress), stage: (r.stage as string) ?? '', createdAt: r.created_at as string, finishedAt: (r.finished_at as string) ?? null, error: (r.error as string) ?? null, solver: (r.solver as string) ?? '' });

export const jobs = {
  async insert(j: JobInfo) {
    await run('INSERT INTO jobs (id, project_id, status, progress, stage, solver, created_at, finished_at, error, logs, heartbeat) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [j.id, j.projectId, j.status, j.progress, j.stage, j.solver, j.createdAt, j.finishedAt, j.error, '[]', new Date().toISOString()]);
  },
  async update(j: JobInfo, logs?: string[]) {
    await run('UPDATE jobs SET status=?, progress=?, stage=?, finished_at=?, error=?, logs=COALESCE(?, logs), heartbeat=? WHERE id=?',
      [j.status, j.progress, j.stage, j.finishedAt, j.error, logs ? JSON.stringify(logs) : null, new Date().toISOString(), j.id]);
  },
  async get(id: string): Promise<(JobInfo & { logs: string[]; cancelRequested: boolean; heartbeat: string | null }) | null> {
    const r = await get('SELECT * FROM jobs WHERE id = ?', [id]);
    if (!r) return null;
    return { ...toJob(r), logs: JSON.parse((r.logs as string) || '[]'), cancelRequested: Number(r.cancel_requested) === 1, heartbeat: (r.heartbeat as string) ?? null };
  },
  async requestCancel(id: string) { await run('UPDATE jobs SET cancel_requested = 1 WHERE id = ?', [id]); },
  async cancelRequested(id: string) { const r = await get<{ c: number }>('SELECT cancel_requested AS c FROM jobs WHERE id = ?', [id]); return Number(r?.c) === 1; },
  async listForProject(projectId: string): Promise<JobInfo[]> {
    return (await all('SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 50', [projectId])).map(toJob);
  },
  /** jobs whose worker vanished (server restart / function instance recycled) */
  async failStale() {
    const cutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    await run(`UPDATE jobs SET status='failed', error='Job interrupted (server restarted or function timed out)' WHERE status IN ('queued','running') AND (heartbeat IS NULL OR heartbeat < ?)`, [cutoff]);
  },
};

export const results = {
  async save(r: ThermalResults) {
    await run('INSERT INTO results (job_id, project_id, data, created_at) VALUES (?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET data = excluded.data', [r.jobId, r.projectId, JSON.stringify(r), r.createdAt]);
  },
  async get(jobId: string): Promise<ThermalResults | null> {
    const r = await get<{ data: string }>('SELECT data FROM results WHERE job_id = ?', [jobId]);
    return r ? (JSON.parse(r.data) as ThermalResults) : null;
  },
  async latestForProject(projectId: string): Promise<ThermalResults | null> {
    const r = await get<{ data: string }>('SELECT data FROM results WHERE project_id = ? ORDER BY created_at DESC LIMIT 1', [projectId]);
    return r ? (JSON.parse(r.data) as ThermalResults) : null;
  },
};

/** Uploaded files are stored in the database so they survive serverless instance changes. */
export const files = {
  async insert(f: { id: string; name: string; mime: string; size: number; data: Buffer }) {
    await run('INSERT INTO files (id, name, mime, size, data, created_at) VALUES (?,?,?,?,?,?)', [f.id, f.name, f.mime, f.size, new Uint8Array(f.data), new Date().toISOString()]);
  },
  async get(id: string) {
    const r = await get<{ id: string; name: string; mime: string; size: number; data: ArrayBuffer | Uint8Array | null }>('SELECT * FROM files WHERE id = ?', [id]);
    if (!r) return undefined;
    return { ...r, data: r.data ? Buffer.from(r.data instanceof ArrayBuffer ? new Uint8Array(r.data) : r.data) : null };
  },
};

// ---------------------------------------------------------------- seed
async function seed() {
  const m = await get<{ n: number }>('SELECT COUNT(*) AS n FROM materials');
  if (Number(m?.n) === 0) await client.batch(MATERIAL_LIBRARY.map((x) => ({ sql: 'INSERT OR IGNORE INTO materials (id, data) VALUES (?, ?)', args: [x.id, JSON.stringify(x)] })), 'write');
  const p = await get<{ n: number }>('SELECT COUNT(*) AS n FROM projects');
  if (Number(p?.n) === 0) {
    const d = demoProject();
    d.project.id = await nextProjectId();
    await projects.save(d);
  }
  await jobs.failStale();
}
