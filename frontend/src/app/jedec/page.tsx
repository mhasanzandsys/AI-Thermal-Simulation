'use client';
import { useEffect, useState } from 'react';
import { JedecPanel } from '@/components/panels/JedecPanel';
import { Card, Badge } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';
import { api, type JedecTemplate } from '@/lib/api';
import { useProject } from '@/store/project';

export default function JedecPage() {
  const [tpl, setTpl] = useState<JedecTemplate[]>([]);
  const doc = useProject((s) => s.doc)!;
  useEffect(() => { api.jedecTemplates().then(setTpl).catch(() => undefined); }, []);
  const enabled: Record<string, boolean> = { 'jedec.j51_2a': doc.jedec.tests.j51_2a.enabled, 'jedec.j51_6': doc.jedec.tests.j51_6.enabled, 'jedec.j51_8': doc.jedec.tests.j51_8.enabled, 'jedec.custom_case': doc.jedec.tests.custom_case.enabled, 'jedec.j51_7': doc.jedec.boardType === '1s0p', 'jedec.j51_9': doc.jedec.boardType === '2s2p' };
  return (
    <div className="mx-auto max-w-[1400px] space-y-3 p-4">
      <PageHeader title="JEDEC Thermal Characterization" subtitle="Select JESD51 test methods, board type, ambient, orientation and airflow." />
      <JedecPanel full />
      <Card title="JEDEC test templates">
        <table className="tbl">
          <thead><tr><th>Standard</th><th>Metric / Purpose</th><th>Board / Environment</th><th>Primary inputs</th><th>Expected outputs</th><th>Notes</th><th>Active</th></tr></thead>
          <tbody>{tpl.map((t) => <tr key={t.id}><td className="font-medium">{t.standard}</td><td>{t.title}</td><td>{t.environment}</td><td>{t.inputs.join('; ')}</td><td>{t.outputs.join('; ')}</td><td className="text-slate-600">{t.notes}</td><td>{enabled[t.id] ? <Badge kind="ok">Yes</Badge> : <Badge>No</Badge>}</td></tr>)}</tbody>
        </table>
      </Card>
    </div>
  );
}
