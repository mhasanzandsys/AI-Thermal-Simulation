'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, XCircle } from 'lucide-react';
import { API_URL, api } from '@/lib/api';
import { Card } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';
import { SolverPanel } from '@/components/panels/SolverPanel';

export default function SettingsPage() {
  const [health, setHealth] = useState<boolean | null>(null);
  useEffect(() => { api.health().then(() => setHealth(true)).catch(() => setHealth(false)); }, []);
  return (
    <div className="mx-auto max-w-[1100px] space-y-3 p-4">
      <PageHeader title="Settings" />
      <Card title="Backend connection">
        <div className="flex items-center gap-2 text-[12.5px]">{health ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-500" />}API: <code className="rounded bg-slate-100 px-1">{API_URL}</code> {health == null ? 'checking…' : health ? 'reachable' : 'unreachable'}</div>
        <p className="mt-1 text-[11.5px] text-slate-500">Change with <code>NEXT_PUBLIC_API_URL</code> in <code>frontend/.env.local</code>. Database and uploads live in <code>backend/data</code> (override with <code>DATA_DIR</code>).</p>
      </Card>
      <SolverPanel full />
      <Card title="Units & conventions">
        <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] text-slate-700">
          <li>Lengths in mm, power in W, temperatures in °C, conductivity in W/m-K, thermal resistance in °C/W.</li>
          <li>Coordinates: origin at the board top surface, package centred at (0, 0); power-map row 0 is the top (max-y) edge.</li>
          <li>Material library presets are editable on the <Link className="text-brand-600 hover:underline" href="/materials">Materials</Link> page.</li>
        </ul>
      </Card>
    </div>
  );
}
