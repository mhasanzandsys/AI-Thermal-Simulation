/**
 * Simulation orchestrator for the built-in solver: runs every enabled JEDEC
 * characterization plus the requested analysis type and assembles ThermalResults.
 */
import { SIMULATION_TYPE_LABELS, validateProject, hasBlockingErrors, type ComplianceRow, type ProjectDoc, type ThermalResults } from '@ats/shared';
import { buildModel, type ModelOverrides } from './geometry';
import { buildMesh, type MeshOptions } from './mesh';
import { assemble, solveSteady, solveTransient, type BcMode, type System } from './fvsolver';
import { boardTopTemp, fieldMaps, findHotspots, heatFlow, junction, topSurfaceTemp } from './metrics';
import { optimize, preAnalysis, recommendations } from './ai';
import { analyzeLeakage } from './leakage';

export interface RunHooks {
  progress: (pct: number, stage: string) => void;
  log: (msg: string) => void;
  residual?: (iteration: number, residual: number) => void;
  isCancelled: () => boolean;
}

export function meshOptions(doc: ProjectDoc, hotspot?: { x: number; y: number }): MeshOptions {
  const m = doc.simulation.mesh;
  const pkg = doc.package;
  const dieBoxes = pkg.dies.map((d) => ({ x0: d.x - d.length / 2, x1: d.x + d.length / 2, y0: d.y - d.width / 2, y1: d.y + d.width / 2 }));
  const pkgFine = Math.min(pkg.body.length, pkg.body.width) / 26;
  if (m.mode === 'automatic') return { density: m.density };
  if (m.mode === 'ai_optimized') {
    const refine = dieBoxes.map((b) => ({ ...b, size: pkgFine * 0.6 }));
    if (hotspot) refine.push({ x0: hotspot.x - 1, x1: hotspot.x + 1, y0: hotspot.y - 1, y1: hotspot.y + 1, size: pkgFine * 0.35 });
    return { density: m.density, refine };
  }
  // manual
  const refine: MeshOptions['refine'] = [];
  for (const r of m.refinement) {
    if (r.area === 'die' || r.area === 'tim' || r.area === 'vias') refine.push(...dieBoxes.map((b) => ({ ...b, size: r.size })));
    if (r.area === 'balls') refine.push({ x0: -pkg.body.length / 2, x1: pkg.body.length / 2, y0: -pkg.body.width / 2, y1: pkg.body.width / 2, size: r.size });
    if (r.area === 'hotspots' && hotspot) refine.push({ x0: hotspot.x - 1, x1: hotspot.x + 1, y0: hotspot.y - 1, y1: hotspot.y + 1, size: r.size });
  }
  return { density: m.density, target: m.target, refine };
}

function operatingBc(doc: ProjectDoc, over: { ambient?: number; velocity?: number } = {}): BcMode {
  const ambient = over.ambient ?? doc.simulation.ambientTemp;
  const v = over.velocity ?? doc.simulation.airVelocity;
  const orientation = doc.package.orientation;
  const radiation = doc.simulation.includeRadiation;
  return v > 0 ? { kind: 'forced', ambient, velocity: v, orientation, radiation } : { kind: 'natural', ambient, orientation, radiation };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

export async function runSimulation(doc: ProjectDoc, jobId: string, hooks: RunHooks): Promise<ThermalResults> {
  const t0 = Date.now();
  const warnings: string[] = [];
  const issues = validateProject(doc, { forRun: true });
  if (hasBlockingErrors(issues)) {
    throw new Error('Validation failed: ' + issues.filter((i) => i.severity === 'Error').map((i) => `${i.id} ${i.message}`).join(' | '));
  }
  for (const i of issues.filter((i) => i.severity === 'Warning')) warnings.push(`${i.id}: ${i.message}`);

  const ctl = (stage: string, p0: number, p1: number) => ({
    tol: doc.simulation.convergence.energy,
    maxIter: doc.simulation.convergence.maxIter,
    isCancelled: hooks.isCancelled,
    onProgress: (info: { iteration: number; residual: number }) => {
      hooks.residual?.(info.iteration, info.residual);
      const frac = Math.min(1, Math.max(0, Math.log10(1 / Math.max(info.residual, 1e-12)) / Math.log10(1 / doc.simulation.convergence.energy)));
      hooks.progress(p0 + (p1 - p0) * frac, stage);
    },
  });

  // ---------- 1. AI pre-analysis
  hooks.progress(2, 'AI pre-analysis');
  const pre = preAnalysis(doc, doc.simulation.airVelocity);
  if (doc.ai.preAnalysis) {
    hooks.log(`AI pre-analysis: estimated Tj ≈ ${pre.estimatedTj} °C, θJA ≈ ${pre.estimatedThetaJA} °C/W, dominant path: ${pre.dominantPath}.`);
    hooks.log(`Predicted hotspot at (${pre.predictedHotspot.x}, ${pre.predictedHotspot.y}) mm on ${pre.predictedHotspot.die}.`);
  }

  // ---------- 2. geometry + mesh
  hooks.progress(5, 'Building geometry & mesh');
  const model = buildModel(doc);
  warnings.push(...model.warnings);
  const mopt = meshOptions(doc, doc.ai.predictHotspots ? pre.predictedHotspot : undefined);
  const mesh = buildMesh(model, mopt);
  const sys = assemble(model, mesh);
  hooks.log(`Model: ${model.blocks.length} solid blocks, mesh ${mesh.nx}×${mesh.ny}×${mesh.nz} = ${mesh.cellCount.toLocaleString()} cells (${sys.n.toLocaleString()} solid), ${sys.faces.length.toLocaleString()} boundary faces.`);
  if (doc.simulation.useSymmetry) warnings.push('Symmetry option: built-in solver always solves the full model (exact for asymmetric power maps).');
  const P = model.totalPower;
  if (!(P > 0)) throw new Error('Total dissipated power must be > 0 to compute thermal resistances.');

  // ---------- 3. operating-condition steady solve
  const opBc = operatingBc(doc);
  hooks.log(`Solving operating condition: ${opBc.kind === 'forced' ? `forced convection ${doc.simulation.airVelocity} m/s` : 'natural convection (still air)'}, Ta = ${opBc.ambient} °C, P = ${r3(P)} W.`);
  const op = await solveSteady(sys, opBc, ctl('Steady-state solve (operating point)', 8, 40));
  hooks.log(`Converged=${op.converged} after ${op.outerIterations} outer iterations; energy imbalance ${(op.energyImbalance * 100).toExponential(2)} %.`);
  if (!op.converged) warnings.push('Operating-point solve did not reach the energy residual within max iterations.');
  const jOp = junction(sys, op.T);
  const tcOp = topSurfaceTemp(sys, op.T, 0, 0);
  const longX = model.pkg.L >= model.pkg.W;
  const tbPoint = longX ? [0, model.pkg.W / 2 + 1] : [model.pkg.L / 2 + 1, 0];
  const tbOp = boardTopTemp(sys, op.T, tbPoint[0], tbPoint[1]);
  const convergence = op.history.map((h) => ({ iteration: h.iteration, residual: h.residual }));
  const fields = fieldMaps(sys, op.T);
  const hotspots = findHotspots(fields.dieTop, sys, 5);
  const split = heatFlow(sys, op.T, op.boundaryHeat);

  // ---------- 4. JEDEC characterizations
  const tests = doc.jedec.tests;
  let thetaJAStill: number | null = null;
  const thetaJAMoving: ThermalResults['thetaJAMoving'] = [];
  let thetaJB: number | null = null, thetaJC: number | null = null;
  let tbJB: number | null = null, tcJC: number | null = null;
  const conv: Record<string, boolean> = { op: op.converged };
  let last: Float64Array = op.T;
  if (tests.j51_2a.enabled) {
    if (opBc.kind === 'natural') { thetaJAStill = (jOp.tj - opBc.ambient) / P; conv.j51_2a = op.converged; }
    else {
      hooks.log('JESD51-2A: still-air solve.');
      const r = await solveSteady(sys, operatingBc(doc, { velocity: 0 }), ctl('JESD51-2A still air', 40, 48), last);
      thetaJAStill = (junction(sys, r.T).tj - doc.simulation.ambientTemp) / P; conv.j51_2a = r.converged; last = r.T;
    }
    hooks.log(`JESD51-2A θJA (still air) = ${r2(thetaJAStill!)} °C/W.`);
  }
  if (tests.j51_6.enabled) {
    const vs = [...tests.j51_6.velocities].sort((a, b) => a - b);
    for (const [i, v] of vs.entries()) {
      const r = await solveSteady(sys, operatingBc(doc, { velocity: v }), ctl(`JESD51-6 moving air ${v} m/s`, 48 + (i * 10) / vs.length, 48 + ((i + 1) * 10) / vs.length), last);
      const tj = junction(sys, r.T).tj;
      thetaJAMoving.push({ velocity: v, thetaJA: r3((tj - doc.simulation.ambientTemp) / P), tj: r2(tj) });
      conv[`j51_6_${v}`] = r.converged; last = r.T;
      hooks.log(`JESD51-6 θJA @ ${v} m/s = ${r2((tj - doc.simulation.ambientTemp) / P)} °C/W.`);
    }
  }
  if (tests.j51_8.enabled) {
    const r = await solveSteady(sys, { kind: 'jb_ring', ambient: doc.simulation.ambientTemp, ringGap: 5, h: 5000 }, ctl('JESD51-8 ring cold plate', 58, 64), last);
    const tj = junction(sys, r.T).tj;
    tbJB = boardTopTemp(sys, r.T, tbPoint[0], tbPoint[1]);
    thetaJB = (tj - tbJB) / P; conv.j51_8 = r.converged;
    hooks.log(`JESD51-8 θJB = ${r2(thetaJB)} °C/W (Tb = ${r2(tbJB)} °C at 1 mm from package edge).`);
  }
  if (tests.custom_case.enabled) {
    const r = await solveSteady(sys, { kind: 'jc_cold', ambient: doc.simulation.ambientTemp, plateTemp: tests.custom_case.coldPlateTemp, h: tests.custom_case.contactH }, ctl('Custom θJC cold plate', 64, 70), last);
    const tj = junction(sys, r.T).tj;
    tcJC = topSurfaceTemp(sys, r.T, 0, 0);
    thetaJC = (tj - tcJC) / P; conv.custom_case = r.converged;
    hooks.log(`Custom θJC (estimate, non-JEDEC) = ${r3(thetaJC)} °C/W.`);
  }

  // ---------- 5. analysis-type specific
  let transient: ThermalResults['transient'] = null;
  let sweep: ThermalResults['sweep'] = null;
  let optimization: ThermalResults['optimization'] = null;
  const simType = doc.simulation.type;
  if (simType === 'transient') {
    hooks.progress(70, 'Transient solve');
    const { duration, timeStep } = doc.simulation.transient;
    transient = [];
    const dieU: number[] = [];
    for (let u = 0; u < sys.n; u++) if (model.blocks[mesh.cellBlock[sys.cellOf[u]]].role === 'die') dieU.push(u);
    const steps = Math.min(400, Math.max(1, Math.round(duration / timeStep)));
    const every = Math.max(1, Math.floor(steps / 120));
    let s = 0;
    await solveTransient(sys, opBc, duration, timeStep, { ...ctl('Transient', 70, 80), onProgress: (i) => hooks.progress(70 + (10 * i.iteration) / steps, 'Transient solve') }, (T, t) => {
      if (s++ % every !== 0 && t < duration - 1e-9) return;
      let tj = -Infinity; for (const u of dieU) tj = Math.max(tj, T[u]);
      transient!.push({ t: r3(t), tj: r2(tj), tc: r2(topSurfaceTemp(sys, T, 0, 0)) });
    });
    hooks.log(`Transient: Tj(${duration}s) = ${transient.at(-1)?.tj} °C (steady ${r2(jOp.tj)} °C).`);
  }
  if (simType === 'parametric_sweep') {
    const sw = doc.simulation.sweep;
    const pts: { x: number; tj: number; thetaJA: number }[] = [];
    for (let i = 0; i < sw.steps; i++) {
      const x = sw.start + ((sw.end - sw.start) * i) / (sw.steps - 1);
      hooks.progress(70 + (10 * i) / sw.steps, `Parametric sweep ${sw.parameter} = ${r3(x)}`);
      const ov: ModelOverrides = {};
      let bc = opBc;
      if (sw.parameter === 'power') ov.power = x;
      if (sw.parameter === 'timK') ov.timK = x;
      if (sw.parameter === 'lidThickness') ov.lidThickness = x;
      if (sw.parameter === 'airVelocity') bc = operatingBc(doc, { velocity: x });
      if (sw.parameter === 'ambientTemp') bc = operatingBc(doc, { ambient: x });
      let tj: number, p: number;
      if (Object.keys(ov).length) {
        const m2 = buildModel(doc, ov);
        const s2 = assemble(m2, buildMesh(m2, mopt));
        const r = await solveSteady(s2, bc, { tol: doc.simulation.convergence.energy, maxIter: doc.simulation.convergence.maxIter, isCancelled: hooks.isCancelled });
        tj = junction(s2, r.T).tj; p = m2.totalPower;
      } else {
        const r = await solveSteady(sys, bc, { tol: doc.simulation.convergence.energy, maxIter: doc.simulation.convergence.maxIter, isCancelled: hooks.isCancelled }, op.T);
        tj = junction(sys, r.T).tj; p = P;
      }
      pts.push({ x: r3(x), tj: r2(tj), thetaJA: r3((tj - bc.ambient) / (p || 1e-9)) });
      hooks.log(`Sweep ${sw.parameter}=${r3(x)} → Tj ${r2(tj)} °C.`);
    }
    sweep = { parameter: sw.parameter, points: pts };
  }
  if (simType === 'optimization' || doc.ai.optimization) {
    hooks.log(`AI design optimization (${doc.ai.objective}): Latin-hypercube sampling + quadratic surrogate.`);
    const o = await optimize(doc, opBc, hooks.isCancelled, (i, n) => hooks.progress(80 + (8 * i) / n, `AI optimization ${i}/${n}`));
    if (o) {
      optimization = { objective: o.objective, baseline: o.baseline, best: o.best, candidates: o.candidates };
      hooks.log(`Optimization: ${o.objective} ${o.baseline} → ${o.best} (coarse-mesh surrogate, verified).`);
    } else warnings.push('AI optimization: no free design variables for this package type.');
  }

  // ---------- 6. AI recommendations
  let aiRecommendations: ThermalResults['aiRecommendations'] = [];
  if (doc.ai.recommendImprovements) {
    hooks.log('AI recommendations: running sensitivity study on coarse surrogate mesh.');
    aiRecommendations = await recommendations(doc, opBc, hooks.isCancelled, (i, n) => hooks.progress(88 + (8 * i) / n, `AI sensitivity ${i}/${n}`));
  }

  // ---------- 7. leakage
  let leakage: ThermalResults['leakage'] = null;
  const thetaJA = (jOp.tj - opBc.ambient) / P;
  if (doc.leakage.enabled && doc.leakage.temperature.length >= 2) {
    hooks.progress(97, 'Leakage / thermal-runaway analysis');
    const th = doc.leakage.thetaJASource === 'manual' && doc.leakage.thetaJA ? doc.leakage.thetaJA : thetaJA;
    leakage = analyzeLeakage({ leakage: doc.leakage, thetaJA: th, ambient: opBc.ambient, tjOperating: jOp.tj });
    hooks.log(`Leakage: dI/dT = ${leakage.derivativeAtTj.toExponential(3)} A/°C vs threshold ${leakage.threshold.toExponential(3)} A/°C → ${leakage.status}.`);
    if (leakage.status !== 'Stable') {
      aiRecommendations.push({ rank: aiRecommendations.length + 1, title: `Thermal runaway risk: ${leakage.status}. Reduce θJA or leakage`, detail: `dI/dT at Tj is ${(100 * (1 - leakage.margin)).toFixed(0)} % of 1/(V·θJA). Lower Vdd, use HVT cells in hot blocks, or improve cooling.`, deltaTj: null, deltaTheta: null, category: 'Leakage', confidence: 'High' });
    }
  }

  // ---------- 8. compliance summary
  const solverLabel = 'Built-in 3D FV solver (IC-PCG)';
  const boardStd = !warnings.some((w) => w.startsWith('VAL-005') || w.startsWith('VAL-006'));
  const status = (devs: string[], ok: boolean): ComplianceRow['status'] => (!ok ? 'Fail' : devs.length ? 'Warning' : 'Pass');
  const jedecCompliance: ComplianceRow[] = [];
  const boardRow = doc.jedec.boardType === '1s0p' ? 'JESD51-7 (1s0p)' : doc.jedec.boardType === '2s2p' ? 'JESD51-9 (2s2p)' : 'Custom board';
  const boardDevs: string[] = [];
  if (!boardStd) boardDevs.push('Board dimensions differ from JEDEC template');
  if (doc.jedec.boardType === 'custom') boardDevs.push('Non-JEDEC board');
  if (doc.jedec.expertOverride) boardDevs.push('Expert override enabled');
  jedecCompliance.push({ standard: boardRow, metric: 'Test board', setup: `${doc.jedec.board.length}×${doc.jedec.board.width}×${doc.jedec.board.thickness} mm, k_in=${r2(model.board.kIn)}, k_z=${r3(model.board.kThrough)} W/m-K`, solver: solverLabel, status: status(boardDevs, true), deviations: boardDevs });
  const bcDevs: string[] = [];
  if (!doc.jedec.useStandardBC) bcDevs.push('Standard JEDEC boundary conditions disabled');
  if (!doc.simulation.includeRadiation) bcDevs.push('Radiation excluded');
  if (doc.package.orientation === 'Custom') bcDevs.push('Custom orientation');
  if (tests.j51_2a.enabled) jedecCompliance.push({ standard: 'JESD51-2A', metric: `θJA still air = ${r2(thetaJAStill!)} °C/W`, setup: `Natural convection + radiation, Ta=${doc.simulation.ambientTemp} °C, ${doc.package.orientation}`, solver: solverLabel, status: status([...bcDevs, ...boardDevs], conv.j51_2a ?? true), deviations: [...bcDevs, ...boardDevs] });
  if (tests.j51_6.enabled) jedecCompliance.push({ standard: 'JESD51-6', metric: `θJA moving air @ ${thetaJAMoving.map((m) => m.velocity).join('/')} m/s`, setup: `Forced convection ${tests.j51_6.flowDirection}, flat-plate correlation`, solver: solverLabel, status: status([...bcDevs, ...boardDevs], Object.entries(conv).filter(([k]) => k.startsWith('j51_6')).every(([, v]) => v)), deviations: [...bcDevs, ...boardDevs] });
  if (tests.j51_8.enabled) {
    const d = [...boardDevs];
    if (doc.jedec.boardType !== '2s2p') d.push('JESD51-8 specifies a 2s2p board');
    jedecCompliance.push({ standard: 'JESD51-8', metric: `θJB = ${r2(thetaJB!)} °C/W`, setup: 'Ring cold plate 5 mm from package edge, other surfaces adiabatic; Tb 1 mm from edge', solver: solverLabel, status: status(d, conv.j51_8 ?? true), deviations: d });
  }
  if (tests.custom_case.enabled) jedecCompliance.push({ standard: 'Custom (non-JEDEC)', metric: `θJC estimate = ${r3(thetaJC!)} °C/W`, setup: `Cold plate ${tests.custom_case.coldPlateTemp} °C, h=${tests.custom_case.contactH} W/m²K on case top`, solver: solverLabel, status: conv.custom_case === false ? 'Fail' : 'Warning', deviations: ['Simulation estimate — JEDEC has no steady-state θJC specification (VAL-007)'] });
  if (op.energyImbalance > 0.01) warnings.push(`Energy imbalance ${(op.energyImbalance * 100).toFixed(2)} % exceeds 1 %.`);

  hooks.progress(100, 'Completed');
  return {
    jobId,
    projectId: doc.project.id,
    createdAt: new Date().toISOString(),
    solver: solverLabel,
    simulationType: SIMULATION_TYPE_LABELS[simType],
    standard: doc.jedec.standard,
    ambientTemp: opBc.ambient,
    power: r3(P),
    tjMax: r2(jOp.tj),
    tjLocation: { x: r3(jOp.x), y: r3(jOp.y), z: r3(jOp.z), die: jOp.die },
    tc: r2(tcOp),
    tb: r2(tbOp),
    thetaJA: r3(thetaJA),
    thetaJAStill: thetaJAStill == null ? null : r3(thetaJAStill),
    thetaJAMoving,
    thetaJB: thetaJB == null ? null : r3(thetaJB),
    thetaJC: thetaJC == null ? null : r3(thetaJC),
    psiJT: r3((jOp.tj - tcOp) / P),
    psiJB: r3((jOp.tj - tbOp) / P),
    heatFlowSplit: split,
    hotspots,
    jedecCompliance,
    aiRecommendations,
    preAnalysis: doc.ai.preAnalysis ? pre : null,
    fields,
    convergence,
    transient,
    sweep,
    optimization,
    leakage,
    mesh: { nx: mesh.nx, ny: mesh.ny, nz: mesh.nz, cells: mesh.cellCount },
    warnings,
    elapsedMs: Date.now() - t0,
  };
}

export type { System };
