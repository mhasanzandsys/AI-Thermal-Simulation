import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import path from 'node:path';
import { z } from 'zod';
import {
  JEDEC_TEMPLATES, JEDEC_BOARDS, boardEffectiveK, SOLVER_LABELS, SOLVER_TYPES, MaterialSchema, LeakageSchema, SolverSchema,
  ProjectDocSchema, ProjectInfoSchema, PackageSchema, BomItemSchema, JedecSchema, SimulationSchema, AiSchema, ReportConfigSchema,
  defaultProject, demoProject, uid, validateProject, parseLeakageCsv, parsePowerMapCsv, type ProjectDoc,
} from '@ats/shared';
import { projects, materials, jobs as jobsDb, results, files, nextProjectId, DB_KIND, DB_LOCATION, IS_SERVERLESS } from './db';
import { adapters } from './adapters';
import { submitJob, streamJob, getJob, cancelJob, subscribe, isBusy } from './jobs';
import { analyzeLeakage } from './engine/leakage';
import { preAnalysis } from './engine/ai';
import { buildModel } from './engine/geometry';
import { buildCsv, buildJson, buildPdf, buildXlsx } from './reports';

export const api = Router();

class HttpError extends Error { constructor(public status: number, message: string, public details?: unknown) { super(message); } }
const wrap = (fn: (req: Request, res: Response) => unknown) => (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res)).catch(next);
const mustProject = async (id: string) => { const p = await projects.get(id); if (!p) throw new HttpError(404, `Project ${id} not found`); return p; };
const param = (req: Request, k: string) => String(req.params[k]);

// Files are kept in memory and stored in the database (serverless hosts have no persistent disk).
// Vercel limits request bodies to ~4.5 MB, so keep uploads below that when deployed there.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const ALLOWED: Record<string, string[]> = {
  drawing: ['.dxf', '.dwg', '.pdf', '.step', '.stp'],
  model3d: ['.step', '.stp', '.x_t', '.x_b', '.xmt_txt', '.stl'],
  powerMap: ['.csv', '.json', '.txt'],
  ptpx: ['.csv', '.txt', '.rpt', '.json'],
};

// ------------------------------------------------------------------ health
api.get('/health', (_req, res) => { res.json({ ok: true, time: new Date().toISOString(), busy: isBusy(), storage: { kind: DB_KIND, location: DB_LOCATION, persistent: DB_KIND === 'remote' || !IS_SERVERLESS }, serverless: IS_SERVERLESS }); });

// ------------------------------------------------------------------ projects
api.get('/projects', wrap(async (_req, res) => { res.json(await projects.list()); }));

api.post('/projects', wrap(async (req, res) => {
  const body = z.object({ name: z.string().optional(), template: z.enum(['blank', 'demo']).default('blank'), deviceId: z.string().optional(), owner: z.string().optional() }).parse(req.body ?? {});
  const doc = body.template === 'demo' ? demoProject() : defaultProject({ name: body.name, deviceId: body.deviceId, owner: body.owner });
  if (body.name) doc.project.name = body.name;
  let name = doc.project.name, n = 2;
  while (await projects.nameTaken(name)) name = `${doc.project.name} (${n++})`;
  doc.project.name = name;
  doc.project.id = await nextProjectId();
  res.status(201).json(await projects.save(doc));
}));

api.post('/projects/import', wrap(async (req, res) => {
  const parsed = ProjectDocSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Invalid project JSON', parsed.error.issues);
  const doc = parsed.data as ProjectDoc;
  doc.project.id = await nextProjectId();
  let name = doc.project.name, n = 2;
  while (await projects.nameTaken(name)) name = `${doc.project.name} (${n++})`;
  doc.project.name = name;
  doc.solver.jobId = '';
  res.status(201).json(await projects.save(doc));
}));

api.get('/projects/:id', wrap(async (req, res) => { res.json(await mustProject(param(req, 'id'))); }));

api.put('/projects/:id', wrap(async (req, res) => {
  const id = param(req, 'id');
  await mustProject(id);
  const doc = req.body as ProjectDoc;
  if (!doc || typeof doc !== 'object' || !doc.project || !doc.package) throw new HttpError(400, 'Body must be a full project document');
  doc.project.id = id;
  if (doc.project.name && await projects.nameTaken(doc.project.name, id)) throw new HttpError(409, 'Project name must be unique within the workspace');
  const saved = await projects.save(doc);
  res.json({ project: saved, issues: validateProject(saved, { resultThetaJA: (await results.latestForProject(id))?.thetaJA }) });
}));

const SECTIONS: Record<string, z.ZodTypeAny> = {
  project: ProjectInfoSchema, package: PackageSchema, bom: z.array(BomItemSchema), jedec: JedecSchema, setup: JedecSchema,
  solver: SolverSchema, simulation: SimulationSchema, ai: AiSchema, leakage: LeakageSchema, reports: ReportConfigSchema,
};
api.put('/projects/:id/:section', wrap(async (req, res) => {
  const id = param(req, 'id');
  const section = param(req, 'section');
  const schema = SECTIONS[section];
  if (!schema) throw new HttpError(404, `Unknown section ${section}`);
  const doc = await mustProject(id);
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, `Invalid ${section}`, parsed.error.issues);
  const key = (section === 'setup' ? 'jedec' : section) as keyof ProjectDoc;
  (doc as Record<string, unknown>)[key] = parsed.data;
  if (section === 'project') { doc.project.id = id; if (await projects.nameTaken(doc.project.name, id)) throw new HttpError(409, 'Project name must be unique within the workspace'); }
  res.json(await projects.save(doc));
}));

api.delete('/projects/:id', wrap(async (req, res) => { await mustProject(param(req, 'id')); await projects.remove(param(req, 'id')); res.status(204).end(); }));

api.post('/projects/:id/duplicate', wrap(async (req, res) => {
  const doc = structuredClone(await mustProject(param(req, 'id')));
  doc.project.id = await nextProjectId();
  let name = `${doc.project.name} (copy)`, n = 2;
  while (await projects.nameTaken(name)) name = `${doc.project.name} (copy ${n++})`;
  doc.project.name = name;
  doc.solver.jobId = '';
  delete doc.createdAt;
  res.status(201).json(await projects.save(doc));
}));

api.get('/projects/:id/validate', wrap(async (req, res) => {
  const doc = await mustProject(param(req, 'id'));
  res.json(validateProject(doc, { resultThetaJA: (await results.latestForProject(doc.project.id))?.thetaJA }));
}));
api.post('/validate', wrap(async (req, res) => { res.json(validateProject(req.body as ProjectDoc, { resultThetaJA: req.query.thetaJA ? Number(req.query.thetaJA) : null })); }));

api.get('/projects/:id/export', wrap(async (req, res) => {
  const doc = await mustProject(param(req, 'id'));
  res.setHeader('Content-Disposition', `attachment; filename="${doc.project.id}.json"`);
  res.json(doc);
}));
api.get('/projects/:id/runs', wrap(async (req, res) => { await mustProject(param(req, 'id')); res.json(await jobsDb.listForProject(param(req, 'id'))); }));
api.get('/projects/:id/results/latest', wrap(async (req, res) => {
  const r = await results.latestForProject(param(req, 'id'));
  if (!r) throw new HttpError(404, 'No results yet');
  res.json(r);
}));
api.get('/projects/:id/model', wrap(async (req, res) => {
  const m = buildModel(await mustProject(param(req, 'id')));
  res.json({ blocks: m.blocks, pkg: m.pkg, board: m.board, totalPower: m.totalPower, warnings: m.warnings, massGrams: m.massGrams });
}));

// ------------------------------------------------------------------ materials
api.get('/materials', wrap(async (_req, res) => { res.json(await materials.list()); }));
api.post('/materials', wrap(async (req, res) => {
  const m = MaterialSchema.parse({ ...req.body, id: req.body?.id || uid('mat-'), builtin: false });
  await materials.upsert(m);
  res.status(201).json(m);
}));
api.put('/materials', wrap(async (req, res) => {
  const list = z.array(MaterialSchema).parse(req.body);
  for (const m of list) await materials.upsert(m);
  res.json(await materials.list());
}));
api.put('/materials/:id', wrap(async (req, res) => {
  const m = MaterialSchema.parse({ ...req.body, id: param(req, 'id') });
  await materials.upsert(m);
  res.json(m);
}));
api.delete('/materials/:id', wrap(async (req, res) => { await materials.remove(param(req, 'id')); res.status(204).end(); }));

// ------------------------------------------------------------------ JEDEC
api.get('/jedec/templates', (_req, res) => { res.json(JEDEC_TEMPLATES); });
api.get('/jedec/boards', (_req, res) => {
  res.json(Object.entries(JEDEC_BOARDS).map(([id, b]) => ({ id, ...b, effective: boardEffectiveK(id as '1s0p' | '2s2p') })));
});

// ------------------------------------------------------------------ solver
api.get('/solver/adapters', (_req, res) => { res.json(SOLVER_TYPES.map((t) => ({ type: t, label: SOLVER_LABELS[t] }))); });
api.get('/solver/status', wrap(async (req, res) => {
  const pid = req.query.projectId as string | undefined;
  const doc = pid ? await projects.get(pid) : null;
  const cfg = doc?.solver ?? defaultProject().solver;
  res.json(await adapters[cfg.type].status(cfg, isBusy()));
}));
api.post('/solver/connect', wrap(async (req, res) => {
  const cfg = SolverSchema.parse(req.body);
  const st = await adapters[cfg.type].status(cfg, isBusy());
  res.json(st);
}));
api.get('/solver/deck/:projectId', wrap(async (req, res) => {
  const doc = await mustProject(param(req, 'projectId'));
  const type = (req.query.type as string) || doc.solver.type;
  const ad = adapters[type as keyof typeof adapters];
  if (!ad) throw new HttpError(400, 'Unknown solver type');
  const deck = ad.exportDeck(doc);
  res.setHeader('Content-Disposition', `attachment; filename="${deck.filename}"`);
  res.type(deck.filename.endsWith('.xml') ? 'application/xml' : deck.filename.endsWith('.py') ? 'text/x-python' : 'application/json').send(deck.content);
}));

// ------------------------------------------------------------------ analysis / AI
api.post('/analysis/leakage', wrap(async (req, res) => {
  const body = z.object({ leakage: LeakageSchema, thetaJA: z.number().positive('Theta-JA must be > 0'), ambient: z.number().default(25), tjOperating: z.number().nullable().optional() }).parse(req.body);
  const L = body.leakage;
  if (!(L.voltage > 0) || L.temperature.length < 2) throw new HttpError(400, 'VAL-008: Provide V, Theta-JA, and leakage-vs-temperature data.');
  if (L.temperature.length !== L.current.length || L.temperature.some((t, i) => i > 0 && t <= L.temperature[i - 1])) throw new HttpError(400, 'VAL-009: PTPX leakage data is incomplete or inconsistent.');
  res.json(analyzeLeakage({ leakage: L, thetaJA: body.thetaJA, ambient: body.ambient, tjOperating: body.tjOperating ?? null }));
}));
api.post('/analysis/leakage/import', upload.single('file'), wrap(async (req, res) => {
  let text = typeof req.body?.text === 'string' ? req.body.text : '';
  if (req.file) {
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (!ALLOWED.ptpx.includes(ext)) throw new HttpError(400, `Unsupported PTPX file type ${ext}`);
    text = req.file.buffer.toString('utf8');
    if (ext === '.json') {
      const j = JSON.parse(text);
      return res.json({ temperature: j.temperature ?? j.T ?? [], current: j.current ?? j.I ?? [], errors: [] });
    }
  }
  res.json(parseLeakageCsv(text));
}));
api.post('/ai/pre-analysis', wrap(async (req, res) => {
  const doc = req.body?.projectId ? await mustProject(req.body.projectId) : (req.body as ProjectDoc);
  res.json(preAnalysis(doc, doc.simulation.airVelocity));
}));

// ------------------------------------------------------------------ files
api.post('/files', upload.single('file'), wrap(async (req, res) => {
  if (!req.file) throw new HttpError(400, 'No file uploaded');
  const kind = String(req.body?.kind ?? 'drawing');
  const ext = path.extname(req.file.originalname).toLowerCase();
  if (ALLOWED[kind] && !ALLOWED[kind].includes(ext)) {
    throw new HttpError(400, `File type ${ext} not allowed for ${kind}. Allowed: ${ALLOWED[kind].join(', ')}`);
  }
  const ref = { id: uid('f-'), name: req.file.originalname, mime: req.file.mimetype, size: req.file.size, data: req.file.buffer };
  await files.insert(ref);
  let parsed: unknown = undefined;
  if (kind === 'powerMap') {
    const text = req.file.buffer.toString('utf8');
    if (ext === '.json') {
      const j = JSON.parse(text);
      const values: number[][] = Array.isArray(j) ? j : j.values;
      parsed = { values, nx: values?.[0]?.length ?? 0, ny: values?.length ?? 0, errors: Array.isArray(values) ? [] : ['JSON must be a 2D array or {values: [[...]]}'] };
    } else parsed = parsePowerMapCsv(text);
  }
  res.status(201).json({ file: { id: ref.id, name: ref.name, size: ref.size, mime: ref.mime }, parsed });
}));
api.get('/files/:id', wrap(async (req, res) => {
  const f = await files.get(param(req, 'id'));
  if (!f || !f.data) throw new HttpError(404, 'File not found');
  res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(f.name)}"`);
  res.type(f.mime || 'application/octet-stream').send(f.data);
}));

// ------------------------------------------------------------------ run / results
api.post('/run', wrap(async (req, res) => {
  const body = z.object({ projectId: z.string(), fallbackToBuiltin: z.boolean().default(true) }).parse(req.body);
  const doc = await mustProject(body.projectId);
  const issues = validateProject(doc, { forRun: true }).filter((i) => i.severity === 'Error');
  if (issues.length) throw new HttpError(422, 'Validation failed — fix errors before running', issues);
  res.status(202).json(await submitJob(doc, { fallbackToBuiltin: body.fallbackToBuiltin }));
}));
/** Runs the job inside this request and streams progress (SSE) — used by the web app; works on Vercel. */
api.post('/run/stream', wrap(async (req, res) => {
  const body = z.object({ projectId: z.string(), fallbackToBuiltin: z.boolean().default(true) }).parse(req.body);
  const doc = await mustProject(body.projectId);
  const issues = validateProject(doc, { forRun: true }).filter((i) => i.severity === 'Error');
  if (issues.length) throw new HttpError(422, 'Validation failed — fix errors before running', issues);
  await streamJob(doc, res, { fallbackToBuiltin: body.fallbackToBuiltin });
}));
api.get('/run/:id', wrap(async (req, res) => {
  const j = await getJob(param(req, 'id'));
  if (!j) throw new HttpError(404, 'Job not found');
  res.json(j);
}));
api.get('/run/:id/events', wrap(async (req, res) => { await subscribe(param(req, 'id'), res); }));
api.post('/run/:id/cancel', wrap(async (req, res) => {
  if (!await cancelJob(param(req, 'id'))) throw new HttpError(404, 'Job not active');
  res.json({ ok: true });
}));
api.get('/results/:jobId', wrap(async (req, res) => {
  const r = await results.get(param(req, 'jobId'));
  if (!r) throw new HttpError(404, 'Results not found');
  res.json(r);
}));

// ------------------------------------------------------------------ reports
api.post('/reports', wrap(async (req, res) => {
  const body = z.object({ projectId: z.string(), jobId: z.string().optional(), format: z.enum(['PDF', 'XLSX', 'JSON', 'CSV']).optional(), sections: ReportConfigSchema.shape.sections.optional() }).parse(req.body);
  const doc = await mustProject(body.projectId);
  const r = body.jobId ? await results.get(body.jobId) : await results.latestForProject(doc.project.id);
  if (!r) throw new HttpError(404, 'No results available — run a simulation first');
  const fmt = body.format ?? doc.reports.format;
  const sec = body.sections ?? doc.reports.sections;
  const base = `${doc.project.id}_${doc.project.deviceId}_thermal_report`.replace(/[^A-Za-z0-9_.-]/g, '_');
  if (fmt === 'PDF') {
    const buf = await buildPdf(doc, r, sec);
    res.setHeader('Content-Disposition', `attachment; filename="${base}.pdf"`);
    return res.type('application/pdf').send(buf);
  }
  if (fmt === 'XLSX') {
    const buf = await buildXlsx(doc, r, sec);
    res.setHeader('Content-Disposition', `attachment; filename="${base}.xlsx"`);
    return res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(buf);
  }
  if (fmt === 'CSV') {
    res.setHeader('Content-Disposition', `attachment; filename="${base}.csv"`);
    return res.type('text/csv').send(buildCsv(doc, r));
  }
  res.setHeader('Content-Disposition', `attachment; filename="${base}.json"`);
  res.json(buildJson(doc, r, sec));
}));

// ------------------------------------------------------------------ errors
api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) { console.error(err); try { res.end(); } catch { /* */ } return; }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details });
  if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request', details: err.issues });
  console.error(err);
  res.status(500).json({ error: (err as Error)?.message ?? 'Internal error' });
});
