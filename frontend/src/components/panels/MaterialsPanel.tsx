'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Plus, Save, Trash2 } from 'lucide-react';
import { SUBSTRATE_TYPES, uid, type Material } from '@ats/shared';
import { useProject } from '@/store/project';
import { api } from '@/lib/api';
import { Card, Field, NumInput, Select, Tabs, TextInput, Badge } from '@/components/ui';
import { PackageIso } from '@/components/viz/PackageViews';
import { MaterialPicker } from './PackagePanel';

type Tab = 'die' | 'substrate' | 'spreader' | 'tim' | 'mold' | 'underfill' | 'balls';
const TABS: { id: Tab; label: string; key: string; cats: string[]; iso: string }[] = [
  { id: 'die', label: 'Die', key: 'bom.die', cats: ['Semiconductor'], iso: 'die' },
  { id: 'substrate', label: 'Substrate', key: 'bom.substrate.buildUp', cats: ['Substrate'], iso: 'substrate' },
  { id: 'spreader', label: 'Heat Spreader', key: 'bom.lid', cats: ['Metal'], iso: 'lid' },
  { id: 'tim', label: 'TIM', key: 'bom.tim1', cats: ['TIM', 'Interface'], iso: 'tim' },
  { id: 'mold', label: 'Molding Compound', key: 'bom.mold', cats: ['Mold'], iso: 'mold' },
  { id: 'underfill', label: 'Underfill', key: 'bom.underfill', cats: ['Underfill'], iso: 'die' },
  { id: 'balls', label: 'Solder Ball', key: 'bom.balls', cats: ['Interconnect', 'Metal'], iso: 'balls' },
];

export function MaterialPropertiesPanel() {
  const doc = useProject((s) => s.doc)!;
  const update = useProject((s) => s.update);
  const [tab, setTab] = useState<Tab>('substrate');
  const t = TABS.find((x) => x.id === tab)!;
  const idx = doc.bom.findIndex((b) => b.key === t.key);
  const row = doc.bom[idx];
  const s = doc.package.substrate;
  const setRow = (k: 'kIn' | 'kThrough' | 'cte' | 'cp' | 'density', v: number | null) => update((d) => {
    const r = d.bom.find((b) => b.key === t.key); if (r) r[k] = v;
    if (t.key === 'bom.tim1' && k === 'kThrough' && v) d.package.tim.k = v;
  });
  return (
    <Card title="Material Properties">
      <Tabs tabs={TABS} value={tab} onChange={setTab} className="mb-3" size="sm" />
      <div className="grid grid-cols-[1fr_200px] gap-4">
        <div className="space-y-1.5">
          {tab === 'substrate' ? (
            <>
              <Field label="Substrate Type"><Select value={s.type} options={SUBSTRATE_TYPES} onChange={(v) => update((d) => { d.package.substrate.type = v; })} /></Field>
              <Field label="Layers"><NumInput value={s.layers} onChange={(v) => update((d) => { d.package.substrate.layers = Math.max(1, Math.round(v ?? 1)); })} /></Field>
              <Field label="Thickness (mm)" path="package.substrate.thickness"><NumInput path="package.substrate.thickness" value={s.thickness} onChange={(v) => update((d) => { d.package.substrate.thickness = v ?? 0; })} /></Field>
              <Field label="In-plane Thermal Conductivity (W/m-K)"><NumInput value={s.kIn} onChange={(v) => update((d) => { d.package.substrate.kIn = v ?? 0; })} /></Field>
              <Field label="Through-plane Thermal Conductivity (W/m-K)"><NumInput value={s.kThrough} onChange={(v) => update((d) => { d.package.substrate.kThrough = v ?? 0; })} /></Field>
              <Field label="CTE (ppm/°C)"><NumInput value={s.cte} onChange={(v) => update((d) => { d.package.substrate.cte = v ?? 0; })} /></Field>
            </>
          ) : row ? (
            <>
              {tab === 'die' && <Field label="Thickness (mm)"><NumInput value={doc.package.dies[0].thickness} onChange={(v) => update((d) => { d.package.dies[0].thickness = v ?? 0; })} /></Field>}
              {tab === 'spreader' && <Field label="Thickness (mm)"><NumInput value={doc.package.lid.thickness} onChange={(v) => update((d) => { d.package.lid.thickness = v ?? 0; })} /></Field>}
              {tab === 'tim' && <Field label="Thickness (mm)"><NumInput value={doc.package.tim.thickness} onChange={(v) => update((d) => { d.package.tim.thickness = v ?? 0; })} /></Field>}
              {tab === 'underfill' && <Field label="Standoff (mm)"><NumInput value={doc.package.underfill.standoff} onChange={(v) => update((d) => { d.package.underfill.standoff = v ?? 0; })} /></Field>}
              {tab === 'balls' && <Field label="Ball height (mm)"><NumInput value={doc.package.balls.height} onChange={(v) => update((d) => { d.package.balls.height = v ?? 0; })} /></Field>}
              <Field label="In-plane Thermal Conductivity (W/m-K)" path={`bom.${t.key}`}><NumInput allowNull value={row.kIn} onChange={(v) => setRow('kIn', v)} /></Field>
              <Field label="Through-plane Thermal Conductivity (W/m-K)"><NumInput allowNull value={row.kThrough} onChange={(v) => setRow('kThrough', v)} /></Field>
              <Field label="CTE (ppm/°C)"><NumInput allowNull value={row.cte} onChange={(v) => setRow('cte', v)} /></Field>
              <Field label="Specific Heat (J/kg-K)"><NumInput allowNull value={row.cp} onChange={(v) => setRow('cp', v)} /></Field>
              <Field label="Density (kg/m³)"><NumInput allowNull value={row.density} onChange={(v) => setRow('density', v)} /></Field>
            </>
          ) : <p className="text-slate-500">No BOM row for {t.key}.</p>}
          <Field label={<>Material Library <Link href="/materials" className="text-brand-600 hover:underline">(edit…)</Link></>} className="pt-1">
            <MaterialPicker bomKey={t.key} categories={t.cats} />
          </Field>
        </div>
        <div className="flex items-center justify-center"><PackageIso doc={doc} width={200} highlight={t.iso} /></div>
      </div>
    </Card>
  );
}

export function MaterialLibraryEditor() {
  const mats = useProject((s) => s.materials);
  const load = useProject((s) => s.loadMaterials);
  const notify = useProject((s) => s.notify);
  const [edit, setEdit] = useState<Record<string, Material>>({});
  const [filter, setFilter] = useState('');
  const rows = mats.filter((m) => !filter || `${m.name} ${m.category}`.toLowerCase().includes(filter.toLowerCase()));
  const val = (m: Material) => edit[m.id] ?? m;
  const set = (m: Material, patch: Partial<Material>) => setEdit((e) => ({ ...e, [m.id]: { ...val(m), ...patch } }));
  const save = async (m: Material) => {
    try { await api.saveMaterial(val(m)); setEdit((e) => { const n = { ...e }; delete n[m.id]; return n; }); await load(); notify('success', `Saved ${val(m).name}`); }
    catch (e) { notify('error', (e as Error).message); }
  };
  return (
    <Card title="Material Library" actions={<>
      <input className="input w-48" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <button className="btn btn-primary h-7" onClick={async () => { await api.saveMaterial({ id: undefined, category: 'Custom', name: `Custom material ${uid().slice(0, 4)}`, kIn: 1, kThrough: 1, cte: null, cp: 1000, density: 2000, notes: '', builtin: false } as unknown as Material); await load(); }}><Plus className="h-3.5 w-3.5" />New material</button>
    </>}>
      <div className="overflow-auto rounded border border-slate-200">
        <table className="tbl min-w-[900px]">
          <thead><tr><th>Category</th><th>Material</th><th>k In-plane</th><th>k Through</th><th>CTE</th><th>Specific Heat</th><th>Density</th><th>Notes</th><th /></tr></thead>
          <tbody>
            {rows.map((m) => {
              const v = val(m);
              return (
                <tr key={m.id}>
                  <td className="w-32"><TextInput value={v.category} onChange={(x) => set(m, { category: x })} /></td>
                  <td className="min-w-40"><div className="flex items-center gap-1"><TextInput value={v.name} onChange={(x) => set(m, { name: x })} />{m.builtin && <Badge>preset</Badge>}</div></td>
                  {(['kIn', 'kThrough', 'cte', 'cp', 'density'] as const).map((k) => <td key={k} className="w-24"><NumInput allowNull value={v[k]} onChange={(x) => set(m, { [k]: x } as Partial<Material>)} /></td>)}
                  <td className="min-w-48"><TextInput value={v.notes} onChange={(x) => set(m, { notes: x })} /></td>
                  <td className="whitespace-nowrap">
                    <button className="btn btn-ghost h-7 px-1.5" disabled={!edit[m.id]} onClick={() => save(m)} title="Save"><Save className="h-3.5 w-3.5" /></button>
                    <button className="btn btn-ghost h-7 px-1.5" onClick={async () => { await api.deleteMaterial(m.id); await load(); }} title="Delete"><Trash2 className="h-3.5 w-3.5 text-slate-400 hover:text-red-500" /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">Units: k in W/m-K, CTE in ppm/°C, specific heat in J/kg-K, density in kg/m³. Values are room-temperature placeholders — verify with supplier data.</p>
    </Card>
  );
}
