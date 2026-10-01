'use client';
import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Download, FolderOpen, Plus, Trash2, Upload, Sparkles } from 'lucide-react';
import { useProject } from '@/store/project';
import { api, API_URL } from '@/lib/api';
import { Card, Badge } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';

export default function ProjectsPage() {
  const { projects, projectId, refreshProjects, loadProject, createProject, notify } = useProject();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { void refreshProjects(); }, [refreshProjects]);
  const open = async (id: string) => { await loadProject(id); router.push('/'); };
  return (
    <div className="mx-auto max-w-[1200px] space-y-3 p-4">
      <PageHeader title="Projects" subtitle="Create, open, duplicate, import and export thermal studies." actions={<>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={async (e) => {
          const f = e.target.files?.[0]; if (!f) return;
          try { const doc = await api.importProject(JSON.parse(await f.text())); await refreshProjects(); await loadProject(doc.project.id); notify('success', `Imported ${doc.project.name}`); }
          catch (err) { notify('error', (err as Error).message); }
          e.target.value = '';
        }} />
        <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}><Upload className="h-3.5 w-3.5" />Import JSON</button>
        <button className="btn btn-secondary" onClick={() => void createProject('demo')}><Sparkles className="h-3.5 w-3.5" />New from demo</button>
        <button className="btn btn-primary" onClick={async () => { await createProject('blank', 'New Thermal Study'); router.push('/project'); }}><Plus className="h-3.5 w-3.5" />New project</button>
      </>} />
      <Card>
        <table className="tbl">
          <thead><tr><th>ID</th><th>Name</th><th>Device</th><th>Customer</th><th>Package</th><th>Updated</th><th className="w-40" /></tr></thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id} className={p.id === projectId ? 'bg-brand-50' : ''}>
                <td className="font-mono text-[11.5px]">{p.id}</td>
                <td className="font-medium">{p.name} {p.id === projectId && <Badge kind="info">open</Badge>}</td>
                <td>{p.deviceId}</td><td>{p.customer}</td><td>{p.packageType}</td><td>{new Date(p.updatedAt).toLocaleString()}</td>
                <td className="whitespace-nowrap text-right">
                  <button className="btn btn-ghost h-7 px-1.5" title="Open" onClick={() => void open(p.id)}><FolderOpen className="h-3.5 w-3.5" /></button>
                  <button className="btn btn-ghost h-7 px-1.5" title="Duplicate" onClick={async () => { const d = await api.duplicateProject(p.id); await refreshProjects(); notify('success', `Created ${d.project.name}`); }}><Copy className="h-3.5 w-3.5" /></button>
                  <a className="btn btn-ghost h-7 px-1.5" title="Export JSON" href={`${API_URL}/projects/${p.id}/export`}><Download className="h-3.5 w-3.5" /></a>
                  <button className="btn btn-ghost h-7 px-1.5" title="Delete" disabled={projects.length <= 1} onClick={async () => {
                    if (!confirm(`Delete ${p.name}? This removes its runs and results.`)) return;
                    await api.deleteProject(p.id); await refreshProjects();
                    if (p.id === projectId) { const rest = (await api.listProjects()); if (rest[0]) await loadProject(rest[0].id); }
                  }}><Trash2 className="h-3.5 w-3.5 text-slate-400 hover:text-red-500" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
