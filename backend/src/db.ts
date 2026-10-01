import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { MATERIAL_LIBRARY, demoProject, type Material, type ProjectDoc, type ThermalResults, type JobInfo } from '@ats/shared';

export const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'data'));
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const JOB_DIR = path.join(DATA_DIR, 'jobs');
for (const d of [DATA_DIR, UPLOAD_DIR, JOB_DIR]) fs.mkdirSync(d, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'thermal.db'));
db.pragma('journal_mode = WAL');
db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, doc TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL, progress REAL NOT NULL,
  stage TEXT, solver TEXT, created_at TEXT NOT NULL, finished_at TEXT, error TEXT, logs TEXT
);
CREATE TABLE IF NOT EXISTS results (job_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, name TEXT NOT NULL, mime TEXT, size INTEGER, path TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);

// ---------------------------------------------------------------- projects
export function nextProjectId(): string {
  const row = db.prepare(`SELECT id FROM projects WHERE id LIKE 'PRJ-%' ORDER BY id DESC LIMIT 1`).get() as { id: string } | undefined;
  const n = row ? parseInt(row.id.slice(4), 10) + 1 : 123;
  return `PRJ-${String(n).padStart(6, '0')}`;
}

export const projects = {
  list(): { id: string; name: string; deviceId: string; customer: string; updatedAt: string; createdAt: string; packageType: string }[] {
    const rows = db.prepare('SELECT id, name, doc, created_at, updated_at FROM projects ORDER BY updated_at DESC').all() as { id: string; name: string; doc: string; created_at: string; updated_at: string }[];
    return rows.map((r) => { const d = JSON.parse(r.doc) as ProjectDoc; return { id: r.id, name: r.name, deviceId: d.project.deviceId, customer: d.project.customer, packageType: d.package.type, createdAt: r.created_at, updatedAt: r.updated_at }; });
  },
  get(id: string): ProjectDoc | null {
    const r = db.prepare('SELECT doc FROM projects WHERE id = ?').get(id) as { doc: string } | undefined;
    return r ? (JSON.parse(r.doc) as ProjectDoc) : null;
  },
  nameTaken(name: string, exceptId?: string) {
    const r = db.prepare('SELECT id FROM projects WHERE lower(name) = lower(?) AND id != ?').get(name, exceptId ?? '') as { id: string } | undefined;
    return !!r;
  },
  save(doc: ProjectDoc): ProjectDoc {
    const now = new Date().toISOString();
    const exists = db.prepare('SELECT created_at FROM projects WHERE id = ?').get(doc.project.id) as { created_at: string } | undefined;
    doc.updatedAt = now;
    doc.createdAt = exists?.created_at ?? doc.createdAt ?? now;
    db.prepare(`INSERT INTO projects (id, name, doc, created_at, updated_at) VALUES (@id, @name, @doc, @c, @u)
      ON CONFLICT(id) DO UPDATE SET name=@name, doc=@doc, updated_at=@u`).run({ id: doc.project.id, name: doc.project.name, doc: JSON.stringify(doc), c: doc.createdAt, u: now });
    return doc;
  },
  remove(id: string) {
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    db.prepare('DELETE FROM results WHERE project_id = ?').run(id);
    db.prepare('DELETE FROM jobs WHERE project_id = ?').run(id);
  },
};

// ---------------------------------------------------------------- materials
export const materials = {
  list(): Material[] {
    return (db.prepare('SELECT data FROM materials').all() as { data: string }[]).map((r) => JSON.parse(r.data) as Material)
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  },
  upsert(m: Material) { db.prepare('INSERT INTO materials (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data').run(m.id, JSON.stringify(m)); },
  remove(id: string) { db.prepare('DELETE FROM materials WHERE id = ?').run(id); },
};

// ---------------------------------------------------------------- jobs / results
export const jobs = {
  insert(j: JobInfo) {
    db.prepare('INSERT INTO jobs (id, project_id, status, progress, stage, solver, created_at, finished_at, error, logs) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(j.id, j.projectId, j.status, j.progress, j.stage, j.solver, j.createdAt, j.finishedAt, j.error, '[]');
  },
  update(j: JobInfo, logs?: string[]) {
    db.prepare('UPDATE jobs SET status=?, progress=?, stage=?, finished_at=?, error=?, logs=COALESCE(?, logs) WHERE id=?')
      .run(j.status, j.progress, j.stage, j.finishedAt, j.error, logs ? JSON.stringify(logs) : null, j.id);
  },
  get(id: string): (JobInfo & { logs: string[] }) | null {
    const r = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!r) return null;
    return { id: r.id as string, projectId: r.project_id as string, status: r.status as JobInfo['status'], progress: r.progress as number, stage: (r.stage as string) ?? '', createdAt: r.created_at as string, finishedAt: (r.finished_at as string) ?? null, error: (r.error as string) ?? null, solver: (r.solver as string) ?? '', logs: JSON.parse((r.logs as string) || '[]') };
  },
  listForProject(projectId: string): JobInfo[] {
    return (db.prepare('SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC LIMIT 50').all(projectId) as Record<string, unknown>[])
      .map((r) => ({ id: r.id as string, projectId: r.project_id as string, status: r.status as JobInfo['status'], progress: r.progress as number, stage: (r.stage as string) ?? '', createdAt: r.created_at as string, finishedAt: (r.finished_at as string) ?? null, error: (r.error as string) ?? null, solver: (r.solver as string) ?? '' }));
  },
  failInterrupted() {
    db.prepare(`UPDATE jobs SET status='failed', error='Server restarted while job was running' WHERE status IN ('queued','running')`).run();
  },
};

export const results = {
  save(r: ThermalResults) {
    db.prepare('INSERT INTO results (job_id, project_id, data, created_at) VALUES (?,?,?,?) ON CONFLICT(job_id) DO UPDATE SET data=excluded.data')
      .run(r.jobId, r.projectId, JSON.stringify(r), r.createdAt);
  },
  get(jobId: string): ThermalResults | null {
    const r = db.prepare('SELECT data FROM results WHERE job_id = ?').get(jobId) as { data: string } | undefined;
    return r ? (JSON.parse(r.data) as ThermalResults) : null;
  },
  latestForProject(projectId: string): ThermalResults | null {
    const r = db.prepare('SELECT data FROM results WHERE project_id = ? ORDER BY created_at DESC LIMIT 1').get(projectId) as { data: string } | undefined;
    return r ? (JSON.parse(r.data) as ThermalResults) : null;
  },
};

export const files = {
  insert(f: { id: string; name: string; mime: string; size: number; path: string }) {
    db.prepare('INSERT INTO files (id, name, mime, size, path, created_at) VALUES (?,?,?,?,?,?)').run(f.id, f.name, f.mime, f.size, f.path, new Date().toISOString());
  },
  get(id: string) { return db.prepare('SELECT * FROM files WHERE id = ?').get(id) as { id: string; name: string; mime: string; size: number; path: string } | undefined; },
};

export const settings = {
  get<T>(key: string, fallback: T): T {
    const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return r ? (JSON.parse(r.value) as T) : fallback;
  },
  set(key: string, value: unknown) { db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, JSON.stringify(value)); },
};

// ---------------------------------------------------------------- seed
export function seed() {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM materials').get() as { n: number }).n;
  if (count === 0) for (const m of MATERIAL_LIBRARY) materials.upsert(m);
  const pc = (db.prepare('SELECT COUNT(*) AS n FROM projects').get() as { n: number }).n;
  if (pc === 0) {
    const d = demoProject();
    d.project.id = nextProjectId();
    projects.save(d);
  }
  jobs.failInterrupted();
}
