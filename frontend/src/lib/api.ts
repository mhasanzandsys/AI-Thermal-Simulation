import type { JobInfo, LeakageResult, Material, PreAnalysis, ProjectDoc, ThermalResults, ValidationIssue, Solver, Leakage, ReportConfig } from '@ats/shared';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(API_URL + path, {
    ...init,
    headers: init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json', ...(init.headers ?? {}) } : init.headers,
  });
  if (!res.ok) {
    let body: { error?: string; details?: unknown } = {};
    try { body = await res.json(); } catch { /* not json */ }
    throw new ApiError(res.status, body.error ?? `${res.status} ${res.statusText}`, body.details);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface ProjectSummary { id: string; name: string; deviceId: string; customer: string; packageType: string; updatedAt: string; createdAt: string }
export interface SolverStatus { type: Solver['type']; label: string; connected: boolean; licenseStatus: 'Available' | 'Busy' | 'Missing'; version: string; message: string; checks: { label: string; ok: boolean }[] }
export interface JobDetail extends JobInfo { logs: string[]; residuals: { iteration: number; residual: number }[] }
export interface JedecTemplate { id: string; standard: string; title: string; metric: string; environment: string; inputs: string[]; outputs: string[]; notes: string }

export const api = {
  health: () => req<{ ok: boolean; busy: boolean }>('/health'),
  listProjects: () => req<ProjectSummary[]>('/projects'),
  createProject: (body: { name?: string; template?: 'blank' | 'demo' }) => req<ProjectDoc>('/projects', { method: 'POST', body: JSON.stringify(body) }),
  importProject: (doc: unknown) => req<ProjectDoc>('/projects/import', { method: 'POST', body: JSON.stringify(doc) }),
  getProject: (id: string) => req<ProjectDoc>(`/projects/${id}`),
  saveProject: (doc: ProjectDoc) => req<{ project: ProjectDoc; issues: ValidationIssue[] }>(`/projects/${doc.project.id}`, { method: 'PUT', body: JSON.stringify(doc) }),
  deleteProject: (id: string) => req<void>(`/projects/${id}`, { method: 'DELETE' }),
  duplicateProject: (id: string) => req<ProjectDoc>(`/projects/${id}/duplicate`, { method: 'POST' }),
  runs: (id: string) => req<JobInfo[]>(`/projects/${id}/runs`),
  latestResults: (id: string) => req<ThermalResults>(`/projects/${id}/results/latest`),
  results: (jobId: string) => req<ThermalResults>(`/results/${jobId}`),
  materials: () => req<Material[]>('/materials'),
  saveMaterial: (m: Partial<Material>) => (m.id ? req<Material>(`/materials/${m.id}`, { method: 'PUT', body: JSON.stringify(m) }) : req<Material>('/materials', { method: 'POST', body: JSON.stringify(m) })),
  deleteMaterial: (id: string) => req<void>(`/materials/${id}`, { method: 'DELETE' }),
  jedecTemplates: () => req<JedecTemplate[]>('/jedec/templates'),
  solverStatus: (projectId?: string) => req<SolverStatus>(`/solver/status${projectId ? `?projectId=${projectId}` : ''}`),
  solverConnect: (cfg: Solver) => req<SolverStatus>('/solver/connect', { method: 'POST', body: JSON.stringify(cfg) }),
  deckUrl: (projectId: string, type?: string) => `${API_URL}/solver/deck/${projectId}${type ? `?type=${type}` : ''}`,
  leakage: (body: { leakage: Leakage; thetaJA: number; ambient: number; tjOperating?: number | null }) => req<LeakageResult>('/analysis/leakage', { method: 'POST', body: JSON.stringify(body) }),
  importLeakage: (file: File) => { const f = new FormData(); f.append('file', file); return req<{ temperature: number[]; current: number[]; errors: string[] }>('/analysis/leakage/import', { method: 'POST', body: f }); },
  preAnalysis: (projectId: string) => req<PreAnalysis>('/ai/pre-analysis', { method: 'POST', body: JSON.stringify({ projectId }) }),
  upload: (file: File, kind: 'drawing' | 'model3d' | 'powerMap') => {
    const f = new FormData(); f.append('kind', kind); f.append('file', file);
    return req<{ file: { id: string; name: string; size: number; mime: string }; parsed?: { values: number[][]; nx: number; ny: number; errors: string[] } }>('/files', { method: 'POST', body: f });
  },
  fileUrl: (id: string) => `${API_URL}/files/${id}`,
  run: (projectId: string, fallbackToBuiltin = true) => req<JobInfo>('/run', { method: 'POST', body: JSON.stringify({ projectId, fallbackToBuiltin }) }),
  job: (id: string) => req<JobDetail>(`/run/${id}`),
  cancel: (id: string) => req<{ ok: boolean }>(`/run/${id}/cancel`, { method: 'POST' }),
  eventsUrl: (id: string) => `${API_URL}/run/${id}/events`,
  async report(projectId: string, jobId: string | undefined, format: ReportConfig['format'], sections: ReportConfig['sections']) {
    const res = await fetch(`${API_URL}/reports`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId, jobId, format, sections }) });
    if (!res.ok) { let e = 'Report failed'; try { e = (await res.json()).error; } catch { /* */ } throw new ApiError(res.status, e); }
    const cd = res.headers.get('Content-Disposition') ?? '';
    const name = /filename="([^"]+)"/.exec(cd)?.[1] ?? `report.${format.toLowerCase()}`;
    const blob = await res.blob();
    downloadBlob(blob, name);
    return name;
  },
};

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
