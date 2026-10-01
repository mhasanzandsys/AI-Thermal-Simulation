'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  Cpu, Home, FolderKanban, Package, Layers, LayoutGrid, SlidersHorizontal, LineChart, Bot, FileText, Settings, HelpCircle, UserCircle2,
  Activity, Zap, CheckCircle2, Loader2, AlertCircle, CloudOff, FolderOpen,
} from 'lucide-react';
import { WORKFLOW_STEPS } from '@ats/shared';
import { useProject } from '@/store/project';
import { API_URL } from '@/lib/api';

const NAV = [
  { href: '/', label: 'Dashboard', icon: Home },
  { href: '/project', label: 'Project', icon: FolderKanban },
  { href: '/package', label: 'Package', icon: Package },
  { href: '/materials', label: 'Materials', icon: Layers },
  { href: '/jedec', label: 'JEDEC Setup', icon: LayoutGrid },
  { href: '/simulation', label: 'Simulation', icon: SlidersHorizontal },
  { href: '/leakage', label: 'Leakage', icon: Zap },
  { href: '/run', label: 'Run Monitor', icon: Activity },
  { href: '/results', label: 'Results', icon: LineChart },
  { href: '/ai', label: 'AI Assistant', icon: Bot },
  { href: '/reports', label: 'Reports', icon: FileText },
];

function useStepState() {
  const issues = useProject((s) => s.issues);
  const results = useProject((s) => s.results);
  const job = useProject((s) => s.job);
  const err = (prefixes: string[]) => issues.some((i) => i.severity === 'Error' && prefixes.some((p) => i.path.startsWith(p)));
  return [
    !err(['package', 'bom', 'project']),
    !err(['jedec']),
    !err(['simulation', 'solver', 'ai', 'leakage']),
    !!results || job?.info.status === 'completed',
    !!results,
  ];
}

export default function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const { init, ready, backendDown, doc, projects, projectId, loadProject, saveState, saveError, toast, job } = useProject();
  const steps = useStepState();
  useEffect(() => { void init(); }, [init]);
  const activeStep = WORKFLOW_STEPS.findIndex((s) => path.startsWith(s.href));
  const running = job && (job.info.status === 'running' || job.info.status === 'queued');

  return (
    <div className="flex h-screen flex-col">
      <header className="flex h-14 shrink-0 items-center gap-4 bg-navy-900 px-4 text-white">
        <Link href="/" className="flex items-center gap-3">
          <Cpu className="h-8 w-8 text-white" strokeWidth={1.4} />
          <div className="leading-tight">
            <div className="text-[19px] font-semibold tracking-tight">AI Thermal Simulator</div>
            <div className="text-[11.5px] text-slate-300">Semiconductor Package Thermal Analysis (JEDEC Compliant)</div>
          </div>
        </Link>
        <nav className="mx-auto hidden items-center gap-2 xl:flex">
          {WORKFLOW_STEPS.map((s, i) => (
            <Link key={s.step} href={s.href} className={clsx('flex items-center gap-2 rounded-full py-1 pl-1 pr-4 text-[12px] transition-colors', activeStep === i ? 'bg-brand-600/25 ring-1 ring-brand-500' : 'hover:bg-white/10')}>
              <span className={clsx('flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold', steps[i] && activeStep !== i ? 'bg-emerald-500' : 'bg-brand-600')}>
                {steps[i] && activeStep !== i ? <CheckCircle2 className="h-4 w-4" /> : s.step}
              </span>
              {s.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-4 text-[12.5px] xl:ml-0">
          <SaveBadge state={saveState} error={saveError} />
          {running && <Link href="/run" className="flex items-center gap-1.5 rounded bg-brand-600 px-2 py-1 text-[11.5px]"><Loader2 className="h-3.5 w-3.5 animate-spin" />{Math.round(job!.info.progress)}%</Link>}
          <Link href="/settings" className="flex items-center gap-1.5 text-slate-200 hover:text-white"><Settings className="h-4 w-4" />Settings</Link>
          <Link href="/help" className="flex items-center gap-1.5 text-slate-200 hover:text-white"><HelpCircle className="h-4 w-4" />Help</Link>
          <UserCircle2 className="h-7 w-7 text-sky-200" strokeWidth={1.4} />
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[180px] shrink-0 flex-col bg-navy-900 pb-3 text-[12.5px] text-slate-200">
          <div className="border-b border-white/10 px-3 py-2">
            <div className="mb-1 flex items-center justify-between text-[10.5px] uppercase tracking-wider text-slate-400">Project <Link href="/projects" className="normal-case tracking-normal text-sky-300 hover:underline"><FolderOpen className="inline h-3 w-3" /> manage</Link></div>
            <select value={projectId ?? ''} onChange={(e) => void loadProject(e.target.value)} className="w-full truncate rounded bg-navy-800 px-1.5 py-1 text-[12px] text-white outline-none">
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <nav className="mt-2 flex flex-col gap-0.5 px-2">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = href === '/' ? path === '/' : path === href || path.startsWith(href + '/');
              return (
                <Link key={href} href={href} className={clsx('flex items-center gap-3 rounded-md px-3 py-2 transition-colors', active ? 'bg-brand-600 text-white' : 'hover:bg-white/10')}>
                  <Icon className="h-4 w-4" strokeWidth={1.7} />{label}
                </Link>
              );
            })}
          </nav>
          <div className="mt-auto px-3 text-[10.5px] text-slate-400">{doc ? `${doc.project.id} · Rev ${doc.project.revision}` : ''}</div>
        </aside>
        <main className="min-w-0 flex-1 overflow-auto">
          {backendDown ? (
            <div className="m-8 card p-6">
              <div className="flex items-center gap-2 text-lg font-semibold text-red-600"><CloudOff className="h-5 w-5" /> Cannot reach the backend API</div>
              <p className="mt-2 text-slate-600">The front end expects the Express API at <code className="rounded bg-slate-100 px-1">{API_URL}</code>.</p>
              <p className="mt-1 text-slate-600">Start it with <code className="rounded bg-slate-100 px-1">npm run dev</code> from the repository root (runs API + web), then reload.</p>
              <button className="btn btn-primary mt-4" onClick={() => location.reload()}>Retry</button>
            </div>
          ) : !ready || !doc ? (
            <div className="flex h-full items-center justify-center text-slate-500"><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading project…</div>
          ) : children}
        </main>
      </div>
      {toast && (
        <div className={clsx('fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-md px-4 py-2 text-[12.5px] text-white shadow-lg', toast.kind === 'error' ? 'bg-red-600' : toast.kind === 'success' ? 'bg-emerald-600' : 'bg-navy-800')}>
          {toast.kind === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{toast.text}
        </div>
      )}
    </div>
  );
}

function SaveBadge({ state, error }: { state: string; error: string | null }) {
  if (state === 'saving' || state === 'dirty') return <span className="flex items-center gap-1 text-[11.5px] text-slate-300"><Loader2 className="h-3.5 w-3.5 animate-spin" />Saving…</span>;
  if (state === 'saved') return <span className="flex items-center gap-1 text-[11.5px] text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />Saved</span>;
  if (state === 'error') return <span className="flex items-center gap-1 text-[11.5px] text-red-300" title={error ?? ''}><AlertCircle className="h-3.5 w-3.5" />Save failed</span>;
  return null;
}
