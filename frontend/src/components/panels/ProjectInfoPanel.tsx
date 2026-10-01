'use client';
import Link from 'next/link';
import { Fragment } from 'react';
import { ArrowRight, Cpu, FileText, BarChart3, Waves, Bot } from 'lucide-react';
import { CLASSIFICATIONS } from '@ats/shared';
import { useProject } from '@/store/project';
import { Card, Field, Select, TextArea, TextInput } from '@/components/ui';

export function ProjectInfoPanel({ full = false }: { full?: boolean }) {
  const doc = useProject((s) => s.doc)!;
  const update = useProject((s) => s.update);
  const p = doc.project;
  return (
    <Card title="Project Information">
      <div className="space-y-1.5">
        <Field label="Project Name" path="project.name"><TextInput path="project.name" value={p.name} onChange={(v) => update((d) => { d.project.name = v; })} /></Field>
        <Field label="Description" path="project.description">
          {full ? <TextArea path="project.description" value={p.description} onChange={(v) => update((d) => { d.project.description = v; })} /> : <TextInput path="project.description" value={p.description} onChange={(v) => update((d) => { d.project.description = v; })} />}
        </Field>
        <Field label="Customer" path="project.customer"><TextInput path="project.customer" value={p.customer} onChange={(v) => update((d) => { d.project.customer = v; })} /></Field>
        <Field label="Device" path="project.deviceId" hint="Device / Part Number"><TextInput path="project.deviceId" value={p.deviceId} onChange={(v) => update((d) => { d.project.deviceId = v; })} /></Field>
        <div className="grid grid-cols-[minmax(110px,42%)_1fr] gap-2">
          <label className="label pt-1.5">Revision</label>
          <div className="grid grid-cols-[52px_auto_1fr] items-center gap-2">
            <TextInput path="project.revision" value={p.revision} onChange={(v) => update((d) => { d.project.revision = v; })} />
            <span className="label">Date</span>
            <TextInput type="date" path="project.date" value={p.date} onChange={(v) => update((d) => { d.project.date = v; })} />
          </div>
        </div>
        {full && (
          <>
            <Field label="Drafter / Owner" path="project.owner"><TextInput path="project.owner" value={p.owner} onChange={(v) => update((d) => { d.project.owner = v; })} /></Field>
            <Field label="Confidentiality" path="project.classification"><Select path="project.classification" value={p.classification} options={CLASSIFICATIONS} onChange={(v) => update((d) => { d.project.classification = v; })} /></Field>
            <Field label="Project ID"><TextInput value={p.id} onChange={() => undefined} disabled /></Field>
          </>
        )}
      </div>
    </Card>
  );
}

const FLOW = [
  { icon: Cpu, label: 'Package\nDefinition', href: '/package' },
  { icon: FileText, label: 'JEDEC Test\nSetup', href: '/jedec' },
  { icon: Bot, label: 'AI Model\nSetup', href: '/ai' },
  { icon: Waves, label: 'CFD\nSimulation', href: '/simulation' },
  { icon: BarChart3, label: 'Results &\nReport', href: '/results' },
];

export function WorkflowPanel() {
  return (
    <Card title="Workflow">
      {/* container query: icons, labels and arrows scale with the card width so nothing overflows */}
      <div className="@container h-full min-w-0 rounded border border-slate-200 px-2 py-3">
        <div className="grid h-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center">
          {FLOW.map(({ icon: Icon, label, href }, i) => (
            <Fragment key={href}>
              <Link href={href} className="group flex min-w-0 flex-col items-center gap-1 px-0.5 text-center">
                <Icon className="h-6 w-6 shrink-0 text-navy-900 transition-colors group-hover:text-brand-600 @[380px]:h-8 @[380px]:w-8 @[480px]:h-10 @[480px]:w-10" strokeWidth={1.3} />
                <span className="w-full whitespace-pre-line text-[9.5px] leading-tight text-slate-700 @[380px]:text-[11px] @[480px]:text-[11.5px]">{label}</span>
              </Link>
              {i < FLOW.length - 1 && <ArrowRight className="h-3 w-3 shrink-0 text-slate-400 @[380px]:h-4 @[380px]:w-4 @[480px]:h-5 @[480px]:w-5" />}
            </Fragment>
          ))}
        </div>
      </div>
    </Card>
  );
}
