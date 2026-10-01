'use client';
import { useState } from 'react';
import { Lock, Plus, X, AlertTriangle } from 'lucide-react';
import { BOARD_TYPES, JEDEC_BOARDS, ORIENTATIONS, boardEffectiveK, type Jedec } from '@ats/shared';
import { useProject } from '@/store/project';
import { Card, Check, Field, FieldError, NumInput, Select, SubHead, Tabs } from '@/components/ui';
import { BoardDrawing } from '@/components/viz/PackageViews';

type Tab = 'j51_2a' | 'j51_6' | 'j51_7' | 'j51_9' | 'j51_8' | 'custom';
const TABS: { id: Tab; label: string }[] = [
  { id: 'j51_2a', label: 'JESD51-2A' }, { id: 'j51_6', label: 'JESD51-6' }, { id: 'j51_7', label: 'JESD51-7 (1s0p)' },
  { id: 'j51_9', label: 'JESD51-9 (2s2p)' }, { id: 'j51_8', label: 'JESD51-8' }, { id: 'custom', label: 'Custom' },
];
const PRIMARY: Partial<Record<Tab, Jedec['standard']>> = { j51_2a: 'JESD51-2A', j51_6: 'JESD51-6', j51_8: 'JESD51-8', custom: 'CUSTOM_JC' };

/** JESD51-7/-9 template board size depends on package size (≤27 mm vs larger). */
export function templateBoard(pkgLen: number) {
  return pkgLen > 27 ? { length: 101.6, width: 114.3, thickness: 1.6 } : { length: 114.3, width: 76.2, thickness: 1.6 };
}

export function JedecPanel({ full = false }: { full?: boolean }) {
  const doc = useProject((s) => s.doc)!;
  const update = useProject((s) => s.update);
  const [tab, setTab] = useState<Tab>('j51_2a');
  const j = doc.jedec;
  const locked = j.useStandardBC && !j.expertOverride && j.boardType !== 'custom';
  const caption = `${tab === 'j51_6' ? 'JESD51-6: Moving Air' : tab === 'j51_8' ? 'JESD51-8: Ring cold plate' : tab === 'custom' ? 'Custom: cold plate on case' : 'JESD51-2A: Still Air'}, ${doc.package.orientation}`;

  const setBoard = (t: (typeof BOARD_TYPES)[number]) => update((d) => {
    d.jedec.boardType = t;
    if (t !== 'custom' && !d.jedec.expertOverride) d.jedec.board = templateBoard(d.package.body.length);
  });

  const enableRow = (key: keyof Jedec['tests'], label: string) => (
    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
      <Check checked={j.tests[key].enabled} onChange={(v) => update((d) => { d.jedec.tests[key].enabled = v; })} label={<b className="font-medium">{label}</b>} />
      {PRIMARY[tab] && (
        <label className="flex items-center gap-1.5 text-[11.5px] text-slate-600">
          <input type="radio" className="accent-brand-600" checked={j.standard === PRIMARY[tab]} onChange={() => update((d) => { d.jedec.standard = PRIMARY[tab]!; d.jedec.tests[key].enabled = true; if (PRIMARY[tab] === 'JESD51-6' && !(d.simulation.airVelocity > 0)) d.simulation.airVelocity = d.jedec.tests.j51_6.velocities[0] ?? 1; if (PRIMARY[tab] === 'JESD51-2A') d.simulation.airVelocity = 0; })} />
          Primary standard
        </label>
      )}
    </div>
  );

  return (
    <Card title="JEDEC Thermal Test Setup">
      <Tabs tabs={TABS} value={tab} onChange={(t) => { setTab(t); if (t === 'j51_7') setBoard('1s0p'); if (t === 'j51_9') setBoard('2s2p'); }} className="mb-3" />
      <div className={full ? 'grid gap-5 lg:grid-cols-[1fr_340px]' : 'grid grid-cols-[1fr_300px] gap-4'}>
        <div>
          {tab === 'j51_2a' && enableRow('j51_2a', 'Enable JESD51-2A (Theta-JA, Still Air)')}
          {tab === 'j51_6' && (
            <>
              {enableRow('j51_6', 'Enable JESD51-6 (Theta-JA, Moving Air)')}
              <Field label="Air velocities" unit="m/s" path="jedec.tests.j51_6.velocities">
                <div className="flex flex-wrap items-center gap-1">
                  {j.tests.j51_6.velocities.map((v, i) => (
                    <span key={i} className="flex items-center gap-1 rounded bg-brand-50 pl-1">
                      <NumInput className="w-14" value={v} onChange={(x) => update((d) => { d.jedec.tests.j51_6.velocities[i] = x ?? 0; })} />
                      <button onClick={() => update((d) => { d.jedec.tests.j51_6.velocities.splice(i, 1); })}><X className="h-3 w-3 text-slate-500" /></button>
                    </span>
                  ))}
                  <button className="btn btn-ghost h-7 px-2" onClick={() => update((d) => { const v = d.jedec.tests.j51_6.velocities; v.push((v[v.length - 1] ?? 0) + 1); })}><Plus className="h-3.5 w-3.5" /></button>
                </div>
              </Field>
              <Field label="Flow direction" className="mt-1.5"><Select value={j.tests.j51_6.flowDirection} options={['+X', '-X', '+Y', '-Y'] as const} onChange={(v) => update((d) => { d.jedec.tests.j51_6.flowDirection = v; })} /></Field>
              <Field label="Operating air velocity" unit="m/s" path="simulation.airVelocity" className="mt-1.5"><NumInput path="simulation.airVelocity" value={doc.simulation.airVelocity} onChange={(v) => update((d) => { d.simulation.airVelocity = v ?? 0; })} /></Field>
            </>
          )}
          {(tab === 'j51_7' || tab === 'j51_9') && <BoardStack type={tab === 'j51_7' ? '1s0p' : '2s2p'} />}
          {tab === 'j51_8' && (
            <>
              {enableRow('j51_8', 'Enable JESD51-8 (Theta-JB)')}
              <p className="mb-2 text-[11.5px] text-slate-600">Ring cold plate clamps the board 5 mm outside the package; other surfaces adiabatic. Tb is read on the board top surface 1 mm from the package edge at the centre of the long side. {j.boardType !== '2s2p' && <span className="text-amber-700">JESD51-8 specifies a 2s2p board.</span>}</p>
            </>
          )}
          {tab === 'custom' && (
            <>
              {enableRow('custom_case', 'Enable custom Theta-JC estimate (cold plate)')}
              <div className="mb-2 flex items-start gap-1.5 rounded bg-amber-50 p-2 text-[11.5px] text-amber-800"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />JEDEC has no steady-state Theta-JC specification; results are labelled as simulation estimates (VAL-007).</div>
              <Field label="Cold plate temperature" unit="°C"><NumInput value={j.tests.custom_case.coldPlateTemp} onChange={(v) => update((d) => { d.jedec.tests.custom_case.coldPlateTemp = v ?? 25; })} /></Field>
              <Field label="Contact h" unit="W/m²K" className="mt-1.5"><NumInput value={j.tests.custom_case.contactH} onChange={(v) => update((d) => { d.jedec.tests.custom_case.contactH = v ?? 10000; })} /></Field>
            </>
          )}

          <div className="mt-2 space-y-1.5">
            <Field label="Board Type"><Select value={j.boardType} options={BOARD_TYPES.map((b) => ({ value: b, label: b === 'custom' ? 'Custom board' : b === '1s0p' ? '1s0p (Single-layer)' : '2s2p (Multi-layer)' }))} onChange={setBoard} /></Field>
            <div className="grid grid-cols-[minmax(110px,42%)_1fr] gap-2">
              <label className="label pt-1.5">Board Size (mm) {locked && <Lock className="inline h-3 w-3 text-slate-400" />}</label>
              <div className="space-y-1">
                {(['length', 'width', 'thickness'] as const).map((k) => (
                  <div key={k} className="grid grid-cols-[62px_1fr] items-center gap-2">
                    <span className="label capitalize">{k}</span>
                    <NumInput value={j.board[k]} disabled={locked} path="jedec.board" onChange={(v) => update((d) => { d.jedec.board[k] = v ?? 0; })} />
                  </div>
                ))}
                <FieldError path="jedec.board" />
              </div>
            </div>
            {j.boardType === 'custom' && (
              <>
                <Field label="Board k in-plane" unit="W/m-K"><NumInput value={j.boardK.kIn} onChange={(v) => update((d) => { d.jedec.boardK.kIn = v ?? 0.3; })} /></Field>
                <Field label="Board k through" unit="W/m-K"><NumInput value={j.boardK.kThrough} onChange={(v) => update((d) => { d.jedec.boardK.kThrough = v ?? 0.3; })} /></Field>
              </>
            )}
            <div className="pt-1 text-[12px] font-medium text-slate-700">Ambient Conditions</div>
            <Field label="Ambient Temp" unit="°C" path="simulation.ambientTemp"><NumInput path="simulation.ambientTemp" value={doc.simulation.ambientTemp} onChange={(v) => update((d) => { d.simulation.ambientTemp = v ?? 25; })} /></Field>
            <Field label="Orientation"><Select value={doc.package.orientation} options={ORIENTATIONS} onChange={(v) => update((d) => { d.package.orientation = v; })} /></Field>
            <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1">
              <Check checked={j.useStandardBC} onChange={(v) => update((d) => { d.jedec.useStandardBC = v; })} label="Use Standard JEDEC Boundary Conditions" />
              <Check checked={j.expertOverride} onChange={(v) => update((d) => { d.jedec.expertOverride = v; })} label="Expert override (edit template)" />
            </div>
            {!locked && j.boardType !== 'custom' && <button className="btn btn-secondary h-7" onClick={() => update((d) => { d.jedec.board = templateBoard(d.package.body.length); })}>Restore JEDEC template size</button>}
          </div>
        </div>
        <div className="flex flex-col items-center justify-center rounded border border-slate-200 p-3">
          <BoardDrawing doc={doc} width={full ? 320 : 280} />
          <div className="mt-2 text-[12px] text-slate-600">{caption}</div>
        </div>
      </div>
    </Card>
  );
}

function BoardStack({ type }: { type: '1s0p' | '2s2p' }) {
  const doc = useProject((s) => s.doc)!;
  const b = JEDEC_BOARDS[type];
  const k = boardEffectiveK(type, doc.jedec.board.thickness);
  return (
    <div className="mb-2">
      <SubHead>{b.label} — layer stack</SubHead>
      <table className="tbl">
        <thead><tr><th>Layer</th><th>Thickness (mm)</th><th>k (W/m-K)</th><th>Coverage</th></tr></thead>
        <tbody>{b.layers.map((l, i) => <tr key={i}><td>{l.name}</td><td>{l.thickness}</td><td>{l.k}</td><td>{Math.round(l.coverage * 100)}%</td></tr>)}</tbody>
      </table>
      <p className="mt-1 text-[11.5px] text-slate-600">Effective board conductivity: k_in = <b>{k.kIn.toFixed(2)}</b>, k_z = <b>{k.kThrough.toFixed(3)}</b> W/m-K. {doc.jedec.boardType === type ? 'Active board template.' : ''}</p>
    </div>
  );
}
