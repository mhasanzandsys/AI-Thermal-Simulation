'use client';
import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import { validateProject, type JobInfo, type Material, type ProjectDoc, type ThermalResults, type ValidationIssue } from '@ats/shared';
import { api, ApiError, type JobDetail, type ProjectSummary, type SolverStatus } from '@/lib/api';

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

interface LiveJob {
  info: JobInfo;
  logs: string[];
  residuals: { iteration: number; residual: number }[];
}

interface State {
  ready: boolean;
  backendDown: boolean;
  projects: ProjectSummary[];
  projectId: string | null;
  doc: ProjectDoc | null;
  issues: ValidationIssue[];
  saveState: SaveState;
  saveError: string | null;
  results: ThermalResults | null;
  job: LiveJob | null;
  runError: { message: string; details?: ValidationIssue[] } | null;
  materials: Material[];
  solverStatus: SolverStatus | null;
  toast: { kind: 'info' | 'error' | 'success'; text: string } | null;

  init: () => Promise<void>;
  refreshProjects: () => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  createProject: (template: 'blank' | 'demo', name?: string) => Promise<void>;
  update: (recipe: (d: Draft<ProjectDoc>) => void) => void;
  saveNow: () => Promise<void>;
  startRun: (fallback?: boolean) => Promise<void>;
  attachJob: (jobId: string) => void;
  cancelRun: () => Promise<void>;
  loadResults: (jobId?: string) => Promise<void>;
  loadMaterials: () => Promise<void>;
  refreshSolverStatus: () => Promise<void>;
  notify: (kind: 'info' | 'error' | 'success', text: string) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let es: EventSource | null = null;
const LS_KEY = 'ats.projectId';

const computeIssues = (doc: ProjectDoc, results: ThermalResults | null) => validateProject(doc, { resultThetaJA: results?.thetaJA ?? null });

export const useProject = create<State>((set, get) => ({
  ready: false,
  backendDown: false,
  projects: [],
  projectId: null,
  doc: null,
  issues: [],
  saveState: 'idle',
  saveError: null,
  results: null,
  job: null,
  runError: null,
  materials: [],
  solverStatus: null,
  toast: null,

  async init() {
    if (get().ready) return;
    try {
      const list = await api.listProjects();
      set({ projects: list, backendDown: false });
      const stored = typeof window !== 'undefined' ? localStorage.getItem(LS_KEY) : null;
      const id = list.find((p) => p.id === stored)?.id ?? list[0]?.id;
      if (id) await get().loadProject(id);
      else await get().createProject('demo');
      void get().loadMaterials();
    } catch (e) {
      console.error(e);
      set({ backendDown: true });
    } finally {
      set({ ready: true });
    }
  },

  async refreshProjects() { set({ projects: await api.listProjects() }); },

  async loadProject(id) {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; await get().saveNow(); }
    es?.close(); es = null;
    const doc = await api.getProject(id);
    let results: ThermalResults | null = null;
    try { results = await api.latestResults(id); } catch { /* none */ }
    localStorage.setItem(LS_KEY, id);
    set({ projectId: id, doc, results, issues: computeIssues(doc, results), saveState: 'idle', saveError: null, job: null, runError: null });
    // re-attach to an active job
    try {
      const runs = await api.runs(id);
      const active = runs.find((r) => r.status === 'running' || r.status === 'queued');
      if (active) get().attachJob(active.id);
    } catch { /* ignore */ }
    void get().refreshSolverStatus();
  },

  async createProject(template, name) {
    const doc = await api.createProject({ template, name });
    await get().refreshProjects();
    await get().loadProject(doc.project.id);
    get().notify('success', `Created ${doc.project.name}`);
  },

  update(recipe) {
    const cur = get().doc;
    if (!cur) return;
    const next = produce(cur, recipe);
    set({ doc: next, issues: computeIssues(next, get().results), saveState: 'dirty' });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; void get().saveNow(); }, 700);
  },

  async saveNow() {
    const doc = get().doc;
    if (!doc) return;
    set({ saveState: 'saving' });
    try {
      const r = await api.saveProject(doc);
      // keep local edits made while saving; only take server timestamps
      set((s) => ({ saveState: s.doc === doc ? 'saved' : 'dirty', saveError: null, doc: s.doc === doc ? { ...doc, updatedAt: r.project.updatedAt, createdAt: r.project.createdAt } : s.doc }));
      const p = get().projects;
      if (!p.find((x) => x.id === doc.project.id && x.name === doc.project.name)) void get().refreshProjects();
    } catch (e) {
      set({ saveState: 'error', saveError: (e as Error).message });
    }
  },

  async startRun(fallback = true) {
    const { doc } = get();
    if (!doc) return;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    await get().saveNow();
    set({ runError: null });
    try {
      const job = await api.run(doc.project.id, fallback);
      get().attachJob(job.id);
    } catch (e) {
      const err = e as ApiError;
      set({ runError: { message: err.message, details: Array.isArray(err.details) ? (err.details as ValidationIssue[]) : undefined } });
      get().notify('error', err.message);
    }
  },

  attachJob(jobId) {
    es?.close();
    set({ job: { info: { id: jobId, projectId: get().projectId ?? '', status: 'queued', progress: 0, stage: 'Connecting', createdAt: new Date().toISOString(), finishedAt: null, error: null, solver: '' }, logs: [], residuals: [] } });
    const src = new EventSource(api.eventsUrl(jobId));
    es = src;
    src.addEventListener('snapshot', (ev) => {
      const d = JSON.parse((ev as MessageEvent).data) as { info: JobInfo; logs: string[]; residuals: { iteration: number; residual: number }[] };
      set({ job: { info: d.info, logs: d.logs, residuals: d.residuals } });
    });
    src.addEventListener('status', (ev) => {
      const info = JSON.parse((ev as MessageEvent).data) as JobInfo | null;
      if (!info) return;
      set((s) => ({ job: s.job ? { ...s.job, info } : { info, logs: [], residuals: [] } }));
    });
    src.addEventListener('log', (ev) => {
      const line = JSON.parse((ev as MessageEvent).data) as string;
      set((s) => (s.job ? { job: { ...s.job, logs: [...s.job.logs, line] } } : {}));
    });
    src.addEventListener('residual', (ev) => {
      const pt = JSON.parse((ev as MessageEvent).data) as { iteration: number; residual: number };
      set((s) => (s.job ? { job: { ...s.job, residuals: [...s.job.residuals, pt] } } : {}));
    });
    src.addEventListener('done', async (ev) => {
      src.close();
      if (es === src) es = null;
      const info = JSON.parse((ev as MessageEvent).data) as JobInfo | null;
      if (!info) return;
      if (info.status === 'completed') {
        await get().loadResults(info.id);
        get().update((d) => { d.solver.jobId = info.id; });
        get().notify('success', 'Simulation completed');
      } else if (info.status === 'failed') {
        set({ runError: { message: info.error ?? 'Job failed' } });
        get().notify('error', info.error ?? 'Job failed');
      }
      // pull persisted logs if the stream ended before we got them
      try { const d: JobDetail = await api.job(info.id); set((s) => ({ job: { info: d, logs: d.logs?.length ? d.logs : s.job?.logs ?? [], residuals: s.job?.residuals ?? [] } })); } catch { /* */ }
    });
    src.onerror = () => { /* browser auto-reconnects; 'done' closes */ };
  },

  async cancelRun() {
    const j = get().job;
    if (j) await api.cancel(j.info.id).catch(() => undefined);
  },

  async loadResults(jobId) {
    const pid = get().projectId;
    if (!pid) return;
    try {
      const r = jobId ? await api.results(jobId) : await api.latestResults(pid);
      set((s) => ({ results: r, issues: s.doc ? computeIssues(s.doc, r) : s.issues }));
    } catch { /* none */ }
  },

  async loadMaterials() { try { set({ materials: await api.materials() }); } catch { /* */ } },

  async refreshSolverStatus() {
    const { doc } = get();
    if (!doc) return;
    try { set({ solverStatus: await api.solverConnect(doc.solver) }); } catch { set({ solverStatus: null }); }
  },

  notify(kind, text) {
    set({ toast: { kind, text } });
    setTimeout(() => { if (get().toast?.text === text) set({ toast: null }); }, 3500);
  },
}));

/** Field-level error/warning message for a state-key path. */
export function useIssue(path: string): ValidationIssue | undefined {
  return useProject((s) => s.issues.find((i) => i.path === path && i.severity !== 'Info'));
}
