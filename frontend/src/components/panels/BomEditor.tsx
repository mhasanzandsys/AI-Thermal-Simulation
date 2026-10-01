'use client';
import { Plus, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { activeBomKeys, uid, type BomItem } from '@ats/shared';
import { useProject } from '@/store/project';
import { NumInput, TextInput } from '@/components/ui';
import { applyMaterial } from '@/lib/materials';

const NUM: { key: keyof BomItem; label: string }[] = [
  { key: 'thickness', label: 'Thickness (mm)' },
  { key: 'kIn', label: 'k In-plane (W/m-K)' },
  { key: 'kThrough', label: 'k Through (W/m-K)' },
  { key: 'cte', label: 'CTE (ppm/°C)' },
  { key: 'cp', label: 'Specific Heat (J/kg-K)' },
  { key: 'density', label: 'Density (kg/m³)' },
];

export function BomEditor({ compact = false }: { compact?: boolean }) {
  const doc = useProject((s) => s.doc)!;
  const mats = useProject((s) => s.materials);
  const update = useProject((s) => s.update);
  const active = new Set(activeBomKeys(doc));
  const transient = doc.simulation.type === 'transient';
  return (
    <div>
      <div className={clsx('overflow-auto rounded border border-slate-200', compact && 'max-h-64')}>
        <table className="tbl min-w-[980px]">
          <thead>
            <tr>
              <th className="w-8" title="Included in model">Use</th><th>Category</th><th>Component</th><th>Material</th>{!compact && <th>Supplier / Grade</th>}
              {NUM.map((n) => <th key={n.key} className="w-24">{n.label}</th>)}{!compact && <th>Notes</th>}<th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {doc.bom.map((b, i) => {
              const used = active.has(b.key);
              const missingK = used && (!b.kIn || !b.kThrough);
              const missingT = used && transient && (!b.cp || !b.density);
              return (
                <tr key={b.id} className={clsx(!used && 'opacity-60')}>
                  <td><input type="checkbox" className="accent-brand-600" checked={b.included} onChange={(e) => update((d) => { d.bom[i].included = e.target.checked; })} title={used ? 'Used by the current package configuration' : 'Not used by the current package configuration'} /></td>
                  <td className="text-slate-600">{b.category}</td>
                  <td className="font-medium">{b.component}<div className="font-mono text-[10px] text-slate-400">{b.key}</div></td>
                  <td className="min-w-40">
                    <input list="mat-lib" className="input" value={b.material} onChange={(e) => {
                      const name = e.target.value;
                      const m = mats.find((x) => x.name === name);
                      update((d) => { if (m) applyMaterial(d, b.key, m); else d.bom[i].material = name; });
                    }} />
                  </td>
                  {!compact && <td><TextInput value={b.supplier} onChange={(v) => update((d) => { d.bom[i].supplier = v; })} /></td>}
                  {NUM.map((n) => (
                    <td key={n.key}>
                      <NumInput allowNull value={b[n.key] as number | null} className={clsx(((n.key === 'kIn' || n.key === 'kThrough') && missingK) || ((n.key === 'cp' || n.key === 'density') && missingT) ? '[&_input]:border-red-400 [&_input]:bg-red-50' : '')}
                        onChange={(v) => update((d) => { (d.bom[i] as Record<string, unknown>)[n.key] = v; if (b.key === 'bom.tim1' && n.key === 'kThrough' && v) d.package.tim.k = v; })} />
                    </td>
                  ))}
                  {!compact && <td className="min-w-40"><TextInput value={b.notes} onChange={(v) => update((d) => { d.bom[i].notes = v; })} /></td>}
                  <td>{b.key.startsWith('bom.custom') && <button onClick={() => update((d) => { d.bom.splice(i, 1); })}><Trash2 className="h-3.5 w-3.5 text-slate-400 hover:text-red-500" /></button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <datalist id="mat-lib">{mats.map((m) => <option key={m.id} value={m.name}>{m.category}</option>)}</datalist>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <p className="text-[11px] text-slate-500">Red cells are required by VAL-010 for the current configuration{transient ? ' (transient needs density and Cp)' : ''}. Pick a library material to fill properties.</p>
        {!compact && <button className="btn btn-secondary h-7" onClick={() => update((d) => { d.bom.push({ id: uid('bom-'), category: 'Custom', component: 'New component', key: `bom.custom.${uid()}`, material: '', supplier: '', thickness: null, kIn: null, kThrough: null, cte: null, cp: null, density: null, notes: '', optional: true, included: true }); })}><Plus className="h-3.5 w-3.5" />Add row</button>}
      </div>
    </div>
  );
}
