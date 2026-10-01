'use client';
import { ProjectInfoPanel } from '@/components/panels/ProjectInfoPanel';
import { Card, IssueList } from '@/components/ui';
import { useProject } from '@/store/project';
import { PageHeader } from '@/components/PageHeader';

export default function ProjectPage() {
  const issues = useProject((s) => s.issues);
  const doc = useProject((s) => s.doc)!;
  return (
    <div className="mx-auto max-w-5xl space-y-3 p-4">
      <PageHeader title="Project Information" subtitle="Create/open project, device metadata, customer, revision, ownership, dates." />
      <div className="grid gap-3 md:grid-cols-[1.4fr_1fr]">
        <ProjectInfoPanel full />
        <Card title="Project status">
          <dl className="grid grid-cols-2 gap-y-1 text-[12px]">
            <dt className="text-slate-500">Created</dt><dd>{doc.createdAt ? new Date(doc.createdAt).toLocaleString() : '—'}</dd>
            <dt className="text-slate-500">Last saved</dt><dd>{doc.updatedAt ? new Date(doc.updatedAt).toLocaleString() : '—'}</dd>
            <dt className="text-slate-500">Package</dt><dd>{doc.package.type}, {doc.package.body.length}×{doc.package.body.width} mm</dd>
            <dt className="text-slate-500">Last job</dt><dd>{doc.solver.jobId || '—'}</dd>
          </dl>
          <div className="mt-3 border-t border-slate-100 pt-2"><div className="mb-1 text-[12px] font-semibold">Validation</div><IssueList issues={issues} compact /></div>
        </Card>
      </div>
    </div>
  );
}
