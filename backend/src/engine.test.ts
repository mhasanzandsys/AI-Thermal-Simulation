import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoProject, defaultProject, validateProject, parseLeakageCsv } from '@ats/shared';
import { buildModel } from './engine/geometry';
import { buildMesh } from './engine/mesh';
import { assemble, solveSteady } from './engine/fvsolver';
import { junction } from './engine/metrics';
import { analyzeLeakage } from './engine/leakage';
import { runSimulation } from './engine/run';

const natural = { kind: 'natural' as const, ambient: 25, orientation: 'Horizontal' as const, radiation: true };

test('energy balance: heat out equals power in', async () => {
  const m = buildModel(demoProject());
  const sys = assemble(m, buildMesh(m, { density: 'coarse' }));
  const r = await solveSteady(sys, natural, { tol: 1e-8, maxIter: 3000 });
  assert.ok(r.converged);
  assert.ok(r.energyImbalance < 1e-4, `imbalance ${r.energyImbalance}`);
});

test('Tj scales linearly with power for a fixed h (cold plate)', async () => {
  const doc = demoProject();
  const bc = { kind: 'jc_cold' as const, ambient: 25, plateTemp: 25, h: 10000 };
  const tj = async (p: number) => { const m = buildModel(doc, { power: p }); const s = assemble(m, buildMesh(m, { density: 'coarse' })); const r = await solveSteady(s, bc, { tol: 1e-9, maxIter: 4000 }); return junction(s, r.T).tj - 25; };
  const a = await tj(1), b = await tj(2);
  assert.ok(Math.abs(b / a - 2) < 1e-3, `ratio ${b / a}`);
});

test('physics trends: airflow, 2s2p board and better TIM lower Tj', async () => {
  const doc = demoProject();
  const ev = async (ov = {}, bc: typeof natural | { kind: 'forced'; ambient: number; velocity: number; orientation: 'Horizontal'; radiation: boolean } = natural) => {
    const m = buildModel(doc, ov); const s = assemble(m, buildMesh(m, { density: 'coarse' }));
    const r = await solveSteady(s, bc, { tol: 1e-6, maxIter: 2000 }); return junction(s, r.T).tj;
  };
  const base = await ev();
  assert.ok((await ev({}, { kind: 'forced', ambient: 25, velocity: 2, orientation: 'Horizontal', radiation: true })) < base);
  assert.ok((await ev({ boardType: '2s2p' })) < base);
  assert.ok((await ev({ timK: 40 })) < base);
  assert.ok(base > 40 && base < 250, `base Tj ${base}`);
});

test('validation rules VAL-001/003/004/009', () => {
  const d = defaultProject();
  d.package.body.length = 0;
  d.package.tim.thickness = 0;
  d.jedec.tests.j51_6 = { enabled: true, velocities: [0], flowDirection: '+X' };
  d.leakage = { ...d.leakage, enabled: true, temperature: [50, 25], current: [1, 2] };
  const ids = new Set(validateProject(d).map((i) => i.id));
  for (const id of ['VAL-001', 'VAL-003', 'VAL-004', 'VAL-009']) assert.ok(ids.has(id), id);
});

test('leakage criterion and CSV import', () => {
  const p = parseLeakageCsv('T,I\n25,0.05\n50,0.12\n75,0.29\n100,0.7\n125,1.66\n');
  assert.equal(p.temperature.length, 5);
  const L = { ...demoProject().leakage, temperature: p.temperature, current: p.current };
  const stable = analyzeLeakage({ leakage: L, thetaJA: 20, ambient: 25 });
  assert.equal(stable.status, 'Stable');
  const unstable = analyzeLeakage({ leakage: L, thetaJA: 200, ambient: 25 });
  assert.equal(unstable.status, 'Unstable');
});

test('full run pipeline produces JEDEC metrics', async () => {
  const doc = demoProject(); doc.project.id = 'T1'; doc.ai.recommendImprovements = false; doc.simulation.mesh.density = 'coarse';
  const r = await runSimulation(doc, 'job', { progress: () => {}, log: () => {}, isCancelled: () => false });
  assert.ok(r.thetaJAStill! > 0 && r.thetaJB! > 0 && r.thetaJC! > 0);
  assert.equal(r.thetaJAMoving.length, 3);
  assert.ok(r.thetaJAMoving[2].thetaJA < r.thetaJAStill!);
  assert.ok(r.leakage);
});
