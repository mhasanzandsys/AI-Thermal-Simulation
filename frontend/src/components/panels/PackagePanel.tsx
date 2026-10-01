'use client';
import { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Upload, FileCheck2, X } from 'lucide-react';
import clsx from 'clsx';
import { ORIENTATIONS, PACKAGE_FEATURES, PACKAGE_TYPES, SUBSTRATE_TYPES, defaultDie } from '@ats/shared';
import { useProject } from '@/store/project';
import { api, API_URL } from '@/lib/api';
import { Card, Check, Field, FieldError, NumInput, Select, SubHead, Tabs, TextInput, Toggle } from '@/components/ui';
import { BoardDrawing, PackageCrossSection, PackageIso, PackageTopView } from '@/components/viz/PackageViews';
import { BomEditor } from './BomEditor';
import { applyMaterial } from '@/lib/materials';

type Tab = 'overview' | 'bom' | 'substrate' | 'die' | 'spreader' | 'tim' | 'model';

export function MaterialPicker({ bomKey, categories, className }: { bomKey: string; categories?: string[]; className?: string }) {
  const doc = useProject((s) => s.doc)!;
  const mats = useProject((s) => s.materials);
  const update = useProject((s) => s.update);
  const row = doc.bom.find((b) => b.key === bomKey);
  const list = mats.filter((m) => !categories || categories.includes(m.category));
  const current = list.find((m) => m.name === row?.material)?.id ?? 'custom';
  return (
    <Select className={className} value={current} options={[{ value: 'custom', label: row?.material ? `${row.material} (custom)` : 'Custom' }, ...list.map((m) => ({ value: m.id, label: `${m.name}  (k=${m.kThrough})` }))]}
      onChange={(id) => { const m = mats.find((x) => x.id === id); if (m) update((d) => applyMaterial(d, bomKey, m)); }} />
  );
}

export function PackagePanel({ full = false, initialTab = 'overview' }: { full?: boolean; initialTab?: Tab }) {
  const doc = useProject((s) => s.doc)!;
  const update = useProject((s) => s.update);
  const [tab, setTab] = useState<Tab>(initialTab);
  const f = PACKAGE_FEATURES[doc.package.type] ?? PACKAGE_FEATURES.Custom;
  const tabs: { id: Tab; label: string; disabled?: boolean; hint?: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'bom', label: 'BOM' },
    { id: 'substrate', label: 'Substrate', disabled: !f.substrate && !f.balls, hint: f.substrate ? undefined : `${doc.package.type} has no substrate` },
    { id: 'die', label: 'Die' },
    { id: 'spreader', label: 'Heat Spreader', disabled: !f.lid, hint: f.lid ? undefined : `${doc.package.type} has no lid` },
    { id: 'tim', label: 'Lid / TIM' },
    { id: 'model', label: 'Package Model' },
  ];
  useEffect(() => { if (tabs.find((t) => t.id === tab)?.disabled) setTab('overview'); }, [doc.package.type]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card title="Package Definition">
      <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-3" />
      {tab === 'overview' && <Overview full={full} />}
      {tab === 'bom' && <BomEditor compact={!full} />}
      {tab === 'substrate' && <SubstrateTab />}
      {tab === 'die' && <DieTab />}
      {tab === 'spreader' && <SpreaderTab />}
      {tab === 'tim' && <TimTab />}
      {tab === 'model' && <ModelTab />}
    </Card>
  );
}

function Overview({ full }: { full: boolean }) {
  const doc = useProject((s) => s.doc)!;
  const update = useProject((s) => s.update);
  const p = doc.package;
  const [view, setView] = useState<'top' | 'side' | '3d' | 'bottom'>('top');
  return (
    <div className={clsx('grid gap-4', full ? 'lg:grid-cols-[230px_1fr_280px]' : 'grid-cols-[170px_1fr_215px]')}>
      <div className="space-y-1.5">
        <div className="label">Package Type</div>
        <Select path="package.type" value={p.type} options={PACKAGE_TYPES} onChange={(v) => update((d) => {
          d.package.type = v;
          const nf = PACKAGE_FEATURES[v];
          if (!nf.lid) d.package.lid.enabled = false;
          if (nf.mold && !nf.lid) d.package.mold.enabled = true;
          if (!nf.multiDie && d.package.dies.length > 1) d.package.dies = d.package.dies.slice(0, 1);
        })} />
        <div className="label pt-1">Package Size (mm)</div>
        <Field label="Length" path="package.body.length"><NumInput path="package.body.length" value={p.body.length} onChange={(v) => update((d) => { d.package.body.length = v ?? 0; })} /></Field>
        <Field label="Width" path="package.body.width"><NumInput path="package.body.width" value={p.body.width} onChange={(v) => update((d) => { d.package.body.width = v ?? 0; })} /></Field>
        <Field label="Height" path="package.body.height"><NumInput path="package.body.height" value={p.body.height} onChange={(v) => update((d) => { d.package.body.height = v ?? 0; })} /></Field>
        <FieldError path="package.body" />
        <Field label="Technology Node" unit="nm" className="pt-2"><TextInput value={p.node} onChange={(v) => update((d) => { d.package.node = v; })} /></Field>
        <Field label="Total Power" unit="W" path="package.power.total">
          <NumInput path="package.power.total" value={p.power.total} onChange={(v) => update((d) => {
            d.package.power.total = v ?? 0;
            if (d.package.dies.length === 1 && !d.package.dies[0].powerMap) d.package.dies[0].power = v ?? 0;
          })} />
        </Field>
        {full && <Field label="Orientation"><Select value={p.orientation} options={ORIENTATIONS} onChange={(v) => update((d) => { d.package.orientation = v; })} /></Field>}
        {full && <Check checked={p.power.overrideDies} onChange={(v) => update((d) => { d.package.power.overrideDies = v; })} label="Total power overrides die powers" />}
      </div>
      <div className="flex items-center justify-center rounded border border-slate-100 bg-slate-50/50 p-2"><PackageCrossSection doc={doc} /></div>
      <div>
        <div className="mb-1 text-[12px] font-medium text-slate-700">Package Image / Drawing</div>
        <div className="flex gap-2">
          <div className="flex flex-1 items-center justify-center rounded border border-slate-100 p-1" style={{ minHeight: 140 }}>
            {view === 'top' && <PackageTopView doc={doc} size={full ? 170 : 120} />}
            {view === 'bottom' && <PackageTopView doc={doc} size={full ? 170 : 120} bottom />}
            {view === 'side' && <PackageCrossSection doc={doc} width={220} height={120} labels={false} />}
            {view === '3d' && <PackageIso doc={doc} width={full ? 220 : 150} />}
          </div>
          <div className="flex flex-col gap-1.5">
            {(['top', 'side', '3d', 'bottom'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={clsx('btn h-7 w-14 px-1 text-[11.5px]', view === v ? 'btn-primary' : 'btn-secondary')}>{v === '3d' ? '3D' : `${v[0].toUpperCase()}${v.slice(1)}`}</button>
            ))}
          </div>
        </div>
        <div className="mt-2 text-[12px] text-slate-700">Upload Drawing (DXF/STEP)</div>
        <FileSlot kind="drawing" accept=".dxf,.dwg,.pdf,.step,.stp" />
      </div>
    </div>
  );
}

export function FileSlot({ kind, accept }: { kind: 'drawing' | 'model3d'; accept: string }) {
  const doc = useProject((s) => s.doc)!;
  const update = useProject((s) => s.update);
  const notify = useProject((s) => s.notify);
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const cur = doc.package.files?.[kind];
  return (
    <div className="mt-1 flex items-center gap-2 rounded border border-slate-300 p-1">
      <input ref={ref} type="file" accept={accept} className="hidden" onChange={async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        setBusy(true);
        try { const r = await api.upload(file, kind); update((d) => { d.package.files = { ...(d.package.files ?? {}), [kind]: r.file }; }); notify('success', `Uploaded ${file.name}`); }
        catch (err) { notify('error', (err as Error).message); }
        finally { setBusy(false); e.target.value = ''; }
      }} />
      <button className="btn btn-secondary h-6 px-2 text-[11.5px]" onClick={() => ref.current?.click()} disabled={busy}><Upload className="h-3 w-3" />{busy ? 'Uploading…' : 'Choose File'}</button>
      {cur ? (
        <span className="flex min-w-0 items-center gap-1 text-[11.5px] text-slate-700"><FileCheck2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" /><a className="truncate hover:underline" href={api.fileUrl(cur.id)}>{cur.name}</a>
          <button title="Remove" onClick={() => update((d) => { d.package.files = { ...(d.package.files ?? {}), [kind]: null }; })}><X className="h-3 w-3 text-slate-400" /></button></span>
      ) : <span className="text-[11.5px] text-slate-500">No file chosen</span>}
    </div>
  );
}

function SubstrateTab() {
  const doc = useProject((s) => s.doc)!;
  const update = useProject((s) => s.update);
  const p = doc.package, s = p.substrate;
  const f = PACKAGE_FEATURES[p.type];
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-1.5">
        <SubHead>Substrate {!f.substrate && <span className="text-[11px] font-normal text-slate-500">(not used for {p.type})</span>}</SubHead>
        <Field label="Substrate Type"><Select value={s.type} options={SUBSTRATE_TYPES} onChange={(v) => update((d) => { d.package.substrate.type = v; })} /></Field>
        <Field label="Layers" path="package.substrate.layers"><NumInput value={s.layers} onChange={(v) => update((d) => { d.package.substrate.layers = Math.max(1, Math.round(v ?? 1)); })} /></Field>
        <Field label="Thickness" unit="mm" path="package.substrate.thickness"><NumInput path="package.substrate.thickness" value={s.thickness} onChange={(v) => update((d) => { d.package.substrate.thickness = v ?? 0; })} /></Field>
        <Field label="In-plane k" unit="W/m-K" path="package.substrate.kIn"><NumInput path="package.substrate.kIn" value={s.kIn} onChange={(v) => update((d) => { d.package.substrate.kIn = v ?? 0; })} /></Field>
        <Field label="Through-plane k" unit="W/m-K" path="package.substrate.kThrough"><NumInput path="package.substrate.kThrough" value={s.kThrough} onChange={(v) => update((d) => { d.package.substrate.kThrough = v ?? 0; })} /></Field>
        <Field label="CTE" unit="ppm/°C"><NumInput value={s.cte} onChange={(v) => update((d) => { d.package.substrate.cte = v ?? 0; })} /></Field>
        <Check checked={s.thermalVias} onChange={(v) => update((d) => { d.package.substrate.thermalVias = v; })} label="Thermal via field under die(s)" />
        <EffectiveK />
      </div>
      <div className="space-y-1.5">
        <SubHead>Solder Balls / Interconnect <span className="text-[11px] font-normal text-slate-500">— {f.interconnect}</span></SubHead>
        <Field label="Ball Count" path="package.balls.count"><NumInput path="package.balls.count" value={p.balls.count} disabled={!f.balls} onChange={(v) => update((d) => { d.package.balls.count = Math.max(0, Math.round(v ?? 0)); })} /></Field>
        <Field label="Ball Pitch" unit="mm"><NumInput value={p.balls.pitch} disabled={!f.balls} onChange={(v) => update((d) => { d.package.balls.pitch = v ?? 0; })} /></Field>
        <Field label="Ball Diameter" unit="mm"><NumInput value={p.balls.diameter} disabled={!f.balls} onChange={(v) => update((d) => { d.package.balls.diameter = v ?? 0; })} /></Field>
        <Field label="Standoff Height" unit="mm"><NumInput value={p.balls.height} disabled={!f.balls} onChange={(v) => update((d) => { d.package.balls.height = v ?? 0; })} /></Field>
        <Field label="Material"><MaterialPicker bomKey="bom.balls" categories={['Interconnect', 'Metal']} /></Field>
        <div className="flex justify-center pt-2"><PackageTopView doc={doc} size={150} bottom /></div>
      </div>
    </div>
  );
}

function EffectiveK() {
  const doc = useProject((s) => s.doc)!;
  const bu = doc.bom.find((b) => b.key === 'bom.substrate.buildUp'), cu = doc.bom.find((b) => b.key === 'bom.substrate.copper');
  if (!bu?.kIn || !cu?.kIn) return null;
  // rule of mixtures estimate using ~35 µm Cu per layer at 60 % coverage
  const t = doc.package.substrate.thickness, n = doc.package.substrate.layers;
  const tc = Math.min(t * 0.6, n * 0.035 * 0.6), td = t - tc;
  const kin = (cu.kIn * tc + bu.kIn * td) / t, kz = t / (tc / (cu.kThrough ?? 400) + td / (bu.kThrough ?? 0.6));
  return <p className="text-[11px] text-slate-500">Estimate from BOM layer mix: k_in ≈ {kin.toFixed(1)}, k_z ≈ {kz.toFixed(2)} W/m-K (excl. vias).</p>;
}

function DieTab() {
  const doc = useProject((s) => s.doc)!;
  const update = useProject((s) => s.update);
  const notify = useProject((s) => s.notify);
  const p = doc.package;
  const f = PACKAGE_FEATURES[p.type];
  const total = p.dies.reduce((s, d) => s + d.power, 0);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <Field label="Die Count" path="package.dies" className="w-56"><NumInput value={p.dies.length} disabled={!f.multiDie} onChange={(v) => update((d) => {
          const n = Math.max(1, Math.min(16, Math.round(v ?? 1)));
          while (d.package.dies.length < n) d.package.dies.push(defaultDie(d.package.dies.length, { length: 4, width: 4, power: 1, x: 0, y: 0 }));
          d.package.dies.length = n;
        })} /></Field>
        <span className="text-[12px] text-slate-600">Σ die power = <b>{total.toFixed(3)} W</b>{!p.power.overrideDies && Math.abs(total - p.power.total) > 1e-6 && <span className="text-amber-600"> (total power field: {p.power.total} W)</span>}</span>
        <Check checked={p.customStacking} onChange={(v) => update((d) => { d.package.customStacking = v; })} label="Custom stacking (skip envelope check)" />
        {f.multiDie && <button className="btn btn-secondary h-7" onClick={() => update((d) => { d.package.dies.push(defaultDie(d.package.dies.length, { length: 4, width: 4, power: 1 })); })}><Plus className="h-3.5 w-3.5" />Add die</button>}
      </div>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th>Name</th><th>Die X (mm)</th><th>Die Y (mm)</th><th>Thickness (mm)</th><th>Power (W)</th><th>Offset x</th><th>Offset y</th><th>Power map</th><th /></tr></thead>
          <tbody>
            {p.dies.map((d, i) => (
              <tr key={d.id}>
                <td className="min-w-28"><TextInput value={d.name} onChange={(v) => update((x) => { x.package.dies[i].name = v; })} /></td>
                <td><NumInput value={d.length} path={`package.dies.${i}`} onChange={(v) => update((x) => { x.package.dies[i].length = v ?? 0; })} /></td>
                <td><NumInput value={d.width} onChange={(v) => update((x) => { x.package.dies[i].width = v ?? 0; })} /></td>
                <td><NumInput value={d.thickness} onChange={(v) => update((x) => { x.package.dies[i].thickness = v ?? 0; })} /></td>
                <td><NumInput value={d.power} onChange={(v) => update((x) => { x.package.dies[i].power = v ?? 0; if (x.package.dies.length === 1) x.package.power.total = v ?? 0; })} /></td>
                <td><NumInput value={d.x} onChange={(v) => update((x) => { x.package.dies[i].x = v ?? 0; })} /></td>
                <td><NumInput value={d.y} onChange={(v) => update((x) => { x.package.dies[i].y = v ?? 0; })} /></td>
                <td className="min-w-44">
                  <div className="flex items-center gap-1">
                    <label className="btn btn-secondary h-6 cursor-pointer px-2 text-[11px]"><Upload className="h-3 w-3" />{d.powerMap ? `${d.powerMap.nx}×${d.powerMap.ny}` : 'CSV/JSON'}
                      <input type="file" accept=".csv,.json,.txt" className="hidden" onChange={async (e) => {
                        const file = e.target.files?.[0]; if (!file) return;
                        try {
                          const r = await api.upload(file, 'powerMap');
                          if (!r.parsed || r.parsed.errors.length) throw new Error(r.parsed?.errors.join('; ') || 'Could not parse power map');
                          update((x) => { x.package.dies[i].powerMap = { file: r.file, nx: r.parsed!.nx, ny: r.parsed!.ny, values: r.parsed!.values }; });
                          notify('success', `Power map ${r.parsed.nx}×${r.parsed.ny} loaded`);
                        } catch (err) { notify('error', (err as Error).message); }
                        e.target.value = '';
                      }} />
                    </label>
                    {d.powerMap && <><PowerMapThumb values={d.powerMap.values} /><button title="Use uniform power" onClick={() => update((x) => { x.package.dies[i].powerMap = null; })}><X className="h-3.5 w-3.5 text-slate-400" /></button></>}
                  </div>
                </td>
                <td>{p.dies.length > 1 && <button onClick={() => update((x) => { x.package.dies.splice(i, 1); })}><Trash2 className="h-3.5 w-3.5 text-slate-400 hover:text-red-500" /></button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {p.dies.map((_, i) => <FieldError key={i} path={`package.dies.${i}`} />)}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5"><SubHead>Die material</SubHead><Field label="Material"><MaterialPicker bomKey="bom.die" categories={['Semiconductor']} /></Field>
          <p className="text-[11px] text-slate-500">Power map: rows top→bottom, columns left→right; values are relative weights normalised to die power. Active layer: {f.flipChip ? 'bottom (flip-chip)' : 'top (wire-bond)'}.</p></div>
        <div className="flex justify-center"><PackageTopView doc={doc} size={170} /></div>
      </div>
    </div>
  );
}

function PowerMapThumb({ values }: { values: number[][] }) {
  const max = Math.max(...values.flat(), 1e-12);
  const n = values[0]?.length ?? 1;
  return (
    <div className="grid h-6 w-6 overflow-hidden rounded-sm border border-slate-300" style={{ gridTemplateColumns: `repeat(${n}, 1fr)` }}>
      {values.flat().map((v, k) => <div key={k} style={{ background: `hsl(${240 - (v / max) * 240} 85% 50%)` }} />)}
    </div>
  );
}

function SpreaderTab() {
  const doc = useProject((s) => s.doc)!;
  const update = useProject((s) => s.update);
  const l = doc.package.lid;
  return (
    <div className="grid gap-6 md:grid-cols-[1fr_220px]">
      <div className="space-y-1.5">
        <Field label="Lid Present"><Toggle checked={l.enabled} onChange={(v) => update((d) => { d.package.lid.enabled = v; if (v) d.package.mold.enabled = false; })} /></Field>
        <Field label="Lid X" unit="mm" path="package.lid"><NumInput value={l.length} disabled={!l.enabled} onChange={(v) => update((d) => { d.package.lid.length = v ?? 0; })} /></Field>
        <Field label="Lid Y" unit="mm"><NumInput value={l.width} disabled={!l.enabled} onChange={(v) => update((d) => { d.package.lid.width = v ?? 0; })} /></Field>
        <Field label="Lid Z (thickness)" unit="mm"><NumInput value={l.thickness} disabled={!l.enabled} onChange={(v) => update((d) => { d.package.lid.thickness = v ?? 0; })} /></Field>
        <Field label="Lid Material"><MaterialPicker bomKey="bom.lid" categories={['Metal']} /></Field>
        <button className="btn btn-secondary h-7" disabled={!l.enabled} onClick={() => update((d) => { d.package.lid.length = d.package.body.length - 1; d.package.lid.width = d.package.body.width - 1; })}>Fit lid to body (−1 mm)</button>
      </div>
      <PackageIso doc={doc} width={220} highlight="lid" />
    </div>
  );
}

function TimTab() {
  const doc = useProject((s) => s.doc)!;
  const update = useProject((s) => s.update);
  const p = doc.package;
  const f = PACKAGE_FEATURES[p.type];
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <div className="space-y-1.5">
        <SubHead>TIM1 {!(p.lid.enabled && f.lid) && <span className="text-[11px] font-normal text-slate-500">(only used with a lid)</span>}</SubHead>
        <Field label="TIM Thickness" unit="mm" path="package.tim"><NumInput value={p.tim.thickness} onChange={(v) => update((d) => { d.package.tim.thickness = v ?? 0; })} /></Field>
        <Field label="TIM Conductivity" unit="W/m-K"><NumInput value={p.tim.k} onChange={(v) => update((d) => { d.package.tim.k = v ?? 0; const r = d.bom.find((b) => b.key === 'bom.tim1'); if (r) { r.kIn = v; r.kThrough = v; } })} /></Field>
        <Field label="TIM Material"><MaterialPicker bomKey="bom.tim1" categories={['TIM', 'Interface']} /></Field>
        <p className="text-[11px] text-slate-500">R_TIM ≈ {(p.tim.thickness / 1000 / Math.max(1e-9, p.tim.k) / Math.max(1e-12, p.dies.reduce((s, d) => s + d.length * d.width, 0) * 1e-6)).toFixed(3)} °C/W over die area.</p>
      </div>
      <div className="space-y-1.5">
        <SubHead>Underfill & Mold</SubHead>
        <Field label="Underfill Enabled"><Toggle checked={p.underfill.enabled} disabled={!f.flipChip} onChange={(v) => update((d) => { d.package.underfill.enabled = v; })} /></Field>
        <Field label="Bump standoff" unit="mm"><NumInput value={p.underfill.standoff} onChange={(v) => update((d) => { d.package.underfill.standoff = v ?? 0; })} /></Field>
        <Field label="Underfill Material"><MaterialPicker bomKey="bom.underfill" categories={['Underfill']} /></Field>
        <Field label="Mold Compound"><Toggle checked={p.mold.enabled} disabled={!f.mold} onChange={(v) => update((d) => { d.package.mold.enabled = v; if (v) d.package.lid.enabled = false; const r = d.bom.find((b) => b.key === 'bom.mold'); if (r) r.included = v; })} /></Field>
        <Field label="Mold Material"><MaterialPicker bomKey="bom.mold" categories={['Mold']} /></Field>
      </div>
    </div>
  );
}

function ModelTab() {
  const doc = useProject((s) => s.doc)!;
  const [model, setModel] = useState<{ blocks: { name: string; role: string; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; kx: number; kz: number }[]; warnings: string[]; massGrams: number } | null>(null);
  useEffect(() => {
    const t = setTimeout(() => { fetch(`${API_URL}/projects/${doc.project.id}/model`).then((r) => r.json()).then(setModel).catch(() => setModel(null)); }, 900);
    return () => clearTimeout(t);
  }, [doc]);
  const seen = new Set<string>();
  const blocks = (model?.blocks ?? []).filter((b) => { const k = `${b.name}${b.z0}${b.x0}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return (
    <div className="space-y-3">
      <div className="grid gap-4 md:grid-cols-2">
        <div><div className="label mb-1">3D Model (STEP / Parasolid / STL)</div><FileSlot kind="model3d" accept=".step,.stp,.x_t,.x_b,.stl" /></div>
        <div><div className="label mb-1">Package Drawing (DXF / DWG / PDF / STEP)</div><FileSlot kind="drawing" accept=".dxf,.dwg,.pdf,.step,.stp" /></div>
      </div>
      <p className="text-[11.5px] text-slate-500">CAD files are stored with the project and passed to external solvers (geometry.cad_file). The built-in solver uses the parametric block model below, generated from the package definition.</p>
      <div className="flex items-center justify-between"><SubHead>Generated solver model ({blocks.length} blocks{model ? `, package mass ≈ ${model.massGrams.toFixed(2)} g` : ''})</SubHead></div>
      <div className="max-h-72 overflow-auto rounded border border-slate-200">
        <table className="tbl">
          <thead><tr><th>Block</th><th>Role</th><th>X (mm)</th><th>Y (mm)</th><th>Z (mm)</th><th>k_xy</th><th>k_z</th></tr></thead>
          <tbody>{blocks.map((b, i) => <tr key={i}><td>{b.name}</td><td>{b.role}</td><td>{b.x0.toFixed(2)} … {b.x1.toFixed(2)}</td><td>{b.y0.toFixed(2)} … {b.y1.toFixed(2)}</td><td>{b.z0.toFixed(3)} … {b.z1.toFixed(3)}</td><td>{+b.kx.toFixed(3)}</td><td>{+b.kz.toFixed(3)}</td></tr>)}</tbody>
        </table>
      </div>
      {model?.warnings?.map((w) => <p key={w} className="text-[11.5px] text-amber-700">⚠ {w}</p>)}
    </div>
  );
}

export { BoardDrawing };
