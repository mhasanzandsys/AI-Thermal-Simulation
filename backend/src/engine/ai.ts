/**
 * Built-in "AI" layer (no external services):
 *  - Pre-analysis: physics-informed thermal-resistance network that predicts Tj / Theta-JA,
 *    dominant heat path, likely hotspot and mesh needs before the CFD solve.
 *  - Recommendations: automated sensitivity study on a coarse surrogate mesh.
 *  - Optimization: Latin-hypercube sampling + quadratic response-surface surrogate,
 *    optimum verified with a full solve.
 */
import { PACKAGE_FEATURES, AI_OBJECTIVE_LABELS, type PreAnalysis, type ProjectDoc, type Recommendation } from '@ats/shared';
import { buildModel, type ModelOverrides } from './geometry';
import { buildMesh } from './mesh';
import { assemble, solveSteady, type BcMode } from './fvsolver';
import { junction } from './metrics';
import { solveLinear } from './leakage';

export function preAnalysis(doc: ProjectDoc, velocity: number): PreAnalysis {
  const pkg = doc.package;
  const feat = PACKAGE_FEATURES[pkg.type] ?? PACKAGE_FEATURES.Custom;
  const model = buildModel(doc);
  const P = model.totalPower || 1e-9;
  const Ta = doc.simulation.ambientTemp;
  const mm2 = 1e-6, mm = 1e-3;
  const Adie = pkg.dies.reduce((s, d) => s + d.length * d.width, 0) * mm2;
  const Apkg = pkg.body.length * pkg.body.width * mm2;
  const die = pkg.dies[0];
  const kSi = doc.bom.find((b) => b.key === 'bom.die')?.kThrough || 130;
  const hNat = 9 + 5.5; // natural convection + radiation at ~40 K rise
  const hForced = velocity > 0 ? 0.664 * Math.sqrt((velocity * doc.jedec.board.length * mm) / 1.6e-5) * Math.cbrt(0.71) * 0.0262 / (doc.jedec.board.length * mm) : 0;
  const h = Math.cbrt(hNat ** 3 + hForced ** 3) + (velocity > 0 ? 5.5 : 0);
  const net: { name: string; r: number }[] = [];
  // top path
  const rDie = (die.thickness * mm) / (kSi * Adie);
  let rTop: number;
  if (model.pkg.hasLid) {
    const rTim = (pkg.tim.thickness * mm) / (pkg.tim.k * Adie);
    const kl = doc.bom.find((b) => b.key === 'bom.lid')?.kThrough || 400;
    const Alid = pkg.lid.length * pkg.lid.width * mm2;
    const rSpread = (1 / (kl * Math.sqrt(Math.PI * Adie))) * Math.pow(1 - Math.sqrt(Adie / Alid), 1.5) + (pkg.lid.thickness * mm) / (kl * Alid);
    const rConvTop = 1 / (h * Alid);
    net.push({ name: 'Die conduction', r: rDie }, { name: 'TIM1', r: rTim }, { name: 'Lid spreading', r: rSpread }, { name: 'Top convection', r: rConvTop });
    rTop = rDie + rTim + rSpread + rConvTop;
  } else if (model.pkg.hasMold) {
    const km = doc.bom.find((b) => b.key === 'bom.mold')?.kThrough || 0.8;
    const cap = Math.max(0.05, model.pkg.zTop - model.pkg.zDieTop) * mm;
    const rMold = cap / (km * Adie * 2);
    const rConvTop = 1 / (h * Apkg);
    net.push({ name: 'Die conduction', r: rDie }, { name: 'Mold cap', r: rMold }, { name: 'Top convection', r: rConvTop });
    rTop = rDie + rMold + rConvTop;
  } else {
    const rConvTop = 1 / (h * Adie);
    net.push({ name: 'Bare-die convection', r: rConvTop });
    rTop = rConvTop;
  }
  // bottom path
  let rBot = 0;
  if (feat.substrate) {
    const rAttach = (pkg.underfill.standoff * mm) / ((feat.flipChip ? 0.12 * 50 + 0.7 : 2.5) * Adie);
    const spread = Math.sqrt(Adie / mm2) + 2 * pkg.substrate.thickness * Math.sqrt(pkg.substrate.kIn / pkg.substrate.kThrough);
    const aSub = Math.min(Apkg, spread * spread * mm2);
    const rSub = (pkg.substrate.thickness * mm) / (pkg.substrate.kThrough * (pkg.substrate.thermalVias ? 6 : 1) * Math.sqrt(Adie * aSub));
    net.push({ name: feat.flipChip ? 'Bumps + underfill' : 'Die attach', r: rAttach }, { name: 'Substrate', r: rSub });
    rBot += rAttach + rSub;
  }
  const ib = model.blocks.find((b) => b.role === 'interconnect');
  if (ib) { const rBall = ((ib.z1 - ib.z0) * mm) / (ib.kz * Apkg); net.push({ name: 'Interconnect', r: rBall }); rBot += rBall; }
  const bk = model.board;
  const mFin = Math.sqrt((2 * h) / (bk.kIn * bk.t * mm));
  const rPkg = Math.sqrt(Apkg / Math.PI);
  const rEff = Math.min(Math.sqrt((bk.L * bk.W * mm2) / Math.PI), rPkg + 1 / mFin);
  const rBoard = 1 / (h * 2 * Math.PI * rEff * rEff) + 1 / (4 * bk.kIn * bk.t * mm) * 0.15;
  net.push({ name: 'Board spreading + convection', r: rBoard });
  rBot += rBoard;
  const rTot = (rTop * rBot) / (rTop + rBot);
  const tj = Ta + P * rTot;
  const topShare = rBot / (rTop + rBot);

  // predicted hotspot: max power density
  let best = { x: 0, y: 0, die: die.name, q: -1 };
  pkg.dies.forEach((d, i) => {
    const pd = model.dies[i]?.power ?? d.power;
    const map = d.powerMap?.values?.length ? d.powerMap.values : [[1]];
    const ny = map.length, nx = map[0].length;
    const tot = map.flat().reduce((s, v) => s + v, 0) || 1;
    map.forEach((row, j) => row.forEach((w, ii) => {
      const q = (pd * w) / tot / ((d.length / nx) * (d.width / ny));
      if (q > best.q) best = { x: d.x - d.length / 2 + (ii + 0.5) * (d.length / nx), y: d.y + d.width / 2 - (j + 0.5) * (d.width / ny), die: d.name, q };
    }));
  });
  const refinements = ['die (≥3 z-cells)', 'TIM / bump layers'];
  if (pkg.dies.some((d) => d.powerMap)) refinements.push('hotspot region (power-map peaks)');
  if (feat.balls) refinements.push('solder-ball layer (effective medium)');
  const dens = doc.simulation.mesh.density;
  const cells = Math.round((dens === 'fine' ? 90000 : dens === 'coarse' ? 9000 : 30000) * Math.max(1, pkg.dies.length * 0.6));
  const notes: string[] = [];
  notes.push(`Heat leaves mainly through the ${topShare > 0.5 ? 'top (lid/case → air)' : 'bottom (substrate → board)'} path (${Math.round((topShare > 0.5 ? topShare : 1 - topShare) * 100)} %).`);
  if (tj > 125) notes.push(`Predicted Tj ${tj.toFixed(0)} °C exceeds 125 °C — expect a design change to be needed.`);
  if (pkg.dies.some((d) => d.powerMap)) notes.push('Non-uniform power map detected: local hotspot refinement enabled.');
  if (velocity === 0 && P > 10) notes.push('High power in still air — JESD51-6 moving-air results will be more representative of the application.');
  return {
    estimatedTj: +tj.toFixed(2),
    estimatedThetaJA: +rTot.toFixed(3),
    predictedHotspot: { x: +best.x.toFixed(2), y: +best.y.toFixed(2), die: best.die },
    dominantPath: topShare > 0.5 ? 'Top (junction → case → ambient)' : 'Bottom (junction → board → ambient)',
    resistanceNetwork: net.map((n) => ({ name: n.name, r: +n.r.toFixed(3) })),
    meshRecommendation: { cells, density: doc.simulation.mesh.mode === 'ai_optimized' ? 'medium + local refinement' : dens, refinements },
    notes,
  };
}

/** Coarse-mesh evaluation used by sensitivity and optimization studies. */
export async function quickEval(doc: ProjectDoc, ov: ModelOverrides, bc: BcMode, isCancelled?: () => boolean) {
  const model = buildModel(doc, ov);
  const mesh = buildMesh(model, { density: 'coarse' });
  const sys = assemble(model, mesh);
  const r = await solveSteady(sys, bc, { tol: 1e-5, maxIter: 800, isCancelled });
  const j = junction(sys, r.T);
  const P = model.totalPower || 1e-9;
  return { tj: j.tj, thetaJA: (j.tj - bc.ambient) / P, mass: model.massGrams };
}

export async function recommendations(doc: ProjectDoc, bc: BcMode, isCancelled?: () => boolean, onStep?: (i: number, n: number) => void): Promise<Recommendation[]> {
  const pkg = doc.package;
  const feat = PACKAGE_FEATURES[pkg.type] ?? PACKAGE_FEATURES.Custom;
  const hasLid = pkg.lid.enabled && feat.lid;
  type Cand = { ov: ModelOverrides; bc?: BcMode; title: (d: number) => string; detail: string; category: Recommendation['category'] };
  const cands: Cand[] = [];
  if (hasLid) {
    const t = +(pkg.lid.thickness * 1.5).toFixed(2);
    cands.push({ ov: { lidThickness: t }, title: (d) => `Increase heat spreader thickness to ${t} mm to reduce Tj by ~${Math.abs(d).toFixed(1)} °C`, detail: `Lid ${pkg.lid.thickness} → ${t} mm improves lateral spreading above the die.`, category: 'Lid' });
    const k = pkg.tim.k < 5 ? 5 : Math.min(80, pkg.tim.k * 2);
    cands.push({ ov: { timK: k }, title: (d) => `Consider higher conductivity TIM (≥ ${k} W/m-K): ΔTj ≈ ${d.toFixed(1)} °C`, detail: `TIM1 k ${pkg.tim.k} → ${k} W/m-K (e.g. ${k >= 30 ? 'indium / metallic TIM' : 'high-k gel or PCM'}).`, category: 'TIM' });
  } else if (feat.lid) {
    cands.push({ ov: { lidEnabled: true }, title: (d) => `Add a copper heat spreader / lid: ΔTj ≈ ${d.toFixed(1)} °C`, detail: 'A lid with TIM1 spreads heat over the full package top.', category: 'Lid' });
  }
  if (feat.substrate && !pkg.substrate.thermalVias) {
    cands.push({ ov: { thermalVias: true }, title: (d) => `Add thermal vias under the die to improve Theta-JB (ΔTj ≈ ${d.toFixed(1)} °C)`, detail: 'Stacked Cu via field under the die footprint raises substrate through-plane conductivity.', category: 'Substrate' });
  }
  if (feat.balls && pkg.balls.count > 0) {
    cands.push({ ov: { ballCountScale: 1.3 }, title: (d) => `Add ~30 % more thermal balls (centre array): ΔTj ≈ ${d.toFixed(1)} °C`, detail: 'Additional ground/thermal balls under the die increase package-to-board conductance.', category: 'Geometry' });
  }
  if (pkg.dies.some((d) => d.powerMap && d.powerMap.values.flat().some((v, _, a) => v !== a[0]))) {
    cands.push({ ov: { uniformPower: true }, title: (d) => `Optimize power distribution to reduce hotspot by ${Math.abs(d).toFixed(1)} °C`, detail: 'Spreading high-density blocks across the die (floor-planning) flattens the junction map.', category: 'Power' });
  }
  if (doc.jedec.boardType === '1s0p') {
    cands.push({ ov: { boardType: '2s2p' }, title: (d) => `On a 2s2p (JESD51-9) board Tj changes by ${d.toFixed(1)} °C`, detail: 'Application boards with internal planes behave closer to 2s2p; report both for datasheets.', category: 'Board' });
  }
  if (bc.kind === 'natural') {
    cands.push({ ov: {}, bc: { kind: 'forced', ambient: bc.ambient, velocity: 1, orientation: bc.orientation, radiation: bc.radiation }, title: (d) => `Provide 1 m/s airflow (JESD51-6): ΔTj ≈ ${d.toFixed(1)} °C`, detail: 'Even modest system airflow strongly reduces Theta-JA.', category: 'Airflow' });
  }
  const n = cands.length + 1;
  const base = await quickEval(doc, {}, bc, isCancelled);
  onStep?.(1, n);
  const out: (Recommendation & { _d: number })[] = [];
  for (const [i, c] of cands.entries()) {
    const r = await quickEval(doc, c.ov, c.bc ?? bc, isCancelled);
    onStep?.(i + 2, n);
    const d = r.tj - base.tj;
    if (d < -0.05) {
      const ad = Math.abs(d);
      out.push({ rank: 0, title: c.title(d), detail: c.detail, deltaTj: +d.toFixed(2), deltaTheta: +(r.thetaJA - base.thetaJA).toFixed(3), category: c.category, confidence: ad > 2 ? 'High' : ad > 0.5 ? 'Medium' : 'Low', _d: d });
    }
  }
  out.sort((a, b) => a._d - b._d);
  return out.map(({ _d, ...r }, i) => ({ ...r, rank: i + 1 }));
}

interface Var { key: 'timK' | 'lidThickness' | 'thermalVias' | 'ballCountScale'; lo: number; hi: number; log?: boolean; discrete?: boolean; label: string }

export async function optimize(doc: ProjectDoc, bc: BcMode, isCancelled?: () => boolean, onStep?: (i: number, n: number) => void) {
  const pkg = doc.package;
  const feat = PACKAGE_FEATURES[pkg.type] ?? PACKAGE_FEATURES.Custom;
  const vars: Var[] = [];
  if (pkg.lid.enabled && feat.lid) {
    vars.push({ key: 'timK', lo: Math.max(0.5, pkg.tim.k * 0.5), hi: Math.max(40, pkg.tim.k * 8), log: true, label: 'TIM k (W/m-K)' });
    vars.push({ key: 'lidThickness', lo: Math.max(0.2, pkg.lid.thickness * 0.5), hi: Math.max(2, pkg.lid.thickness * 2.5), label: 'Lid thickness (mm)' });
  }
  if (feat.substrate) vars.push({ key: 'thermalVias', lo: 0, hi: 1, discrete: true, label: 'Thermal vias (0/1)' });
  if (feat.balls && pkg.balls.count > 0) vars.push({ key: 'ballCountScale', lo: 1, hi: 1.5, label: 'Ball count scale' });
  if (!vars.length) return null;

  const toOv = (u: number[]): ModelOverrides => {
    const ov: ModelOverrides = {};
    vars.forEach((v, i) => {
      const val = v.log ? Math.exp(Math.log(v.lo) + u[i] * (Math.log(v.hi) - Math.log(v.lo))) : v.lo + u[i] * (v.hi - v.lo);
      if (v.key === 'thermalVias') ov.thermalVias = u[i] >= 0.5;
      else (ov as Record<string, number>)[v.key] = +val.toFixed(3);
    });
    return ov;
  };
  const params = (ov: ModelOverrides) => {
    const p: Record<string, number> = {};
    for (const v of vars) p[v.label] = v.key === 'thermalVias' ? (ov.thermalVias ? 1 : 0) : ((ov as Record<string, number>)[v.key] ?? 0);
    return p;
  };
  // Latin hypercube
  const nS = Math.min(14, 6 + 2 * vars.length);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const samples: number[][] = Array.from({ length: nS }, () => new Array(vars.length).fill(0));
  vars.forEach((v, d) => {
    const perm = Array.from({ length: nS }, (_, i) => i).sort(() => rnd() - 0.5);
    perm.forEach((p, i) => { samples[i][d] = v.discrete ? (p < nS / 2 ? 0 : 1) : (p + rnd()) / nS; });
  });
  const total = nS + 2;
  const base = await quickEval(doc, {}, bc, isCancelled);
  onStep?.(1, total);
  const evals: { u: number[]; tj: number; thetaJA: number; mass: number; ov: ModelOverrides }[] = [];
  for (const [i, u] of samples.entries()) {
    const ov = toOv(u);
    const r = await quickEval(doc, ov, bc, isCancelled);
    evals.push({ u, ...r, ov });
    onStep?.(i + 2, total);
  }
  // quadratic surrogate (no cross terms): Tj ≈ c0 + Σ ci ui + Σ cii ui²
  const feats = (u: number[]) => [1, ...u, ...u.map((x, i) => (vars[i].discrete ? 0 : x * x))];
  const X = evals.map((e) => feats(e.u));
  const y = evals.map((e) => e.tj);
  const ridge = X[0].length;
  const A = Array.from({ length: ridge }, (_, i) => Array.from({ length: ridge }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0) + (i === j && i > 0 ? 1e-6 : 0)));
  const b = Array.from({ length: ridge }, (_, i) => X.reduce((s, r, k) => s + r[i] * y[k], 0));
  const coef = solveLinear(A, b);
  const predict = (u: number[]) => feats(u).reduce((s, f, i) => s + f * coef[i], 0);
  // search surrogate on a grid
  const levels = vars.map((v) => (v.discrete ? [0, 1] : Array.from({ length: 11 }, (_, i) => i / 10)));
  const grid: number[][] = [[]];
  for (const lv of levels) { const next: number[][] = []; for (const g of grid) for (const l of lv) next.push([...g, l]); grid.splice(0, grid.length, ...next); }
  const massOf = (ov: ModelOverrides) => buildModel(doc, ov).massGrams;
  const masses = grid.map((u) => massOf(toOv(u)));
  const mMin = Math.min(...masses), mMax = Math.max(...masses);
  const tjs = grid.map(predict);
  const tMin = Math.min(...tjs), tMax = Math.max(...tjs);
  const obj = doc.ai.objective;
  let bestI = 0, bestScore = Infinity;
  grid.forEach((_, i) => {
    let s: number;
    if (obj === 'min_mass') s = tjs[i] <= base.tj + 0.5 ? masses[i] : 1e9 + tjs[i];
    else if (obj === 'multi_objective') s = 0.7 * (tjs[i] - tMin) / (tMax - tMin || 1) + 0.3 * (masses[i] - mMin) / (mMax - mMin || 1);
    else s = tjs[i];
    if (s < bestScore) { bestScore = s; bestI = i; }
  });
  const bestOv = toOv(grid[bestI]);
  const verified = await quickEval(doc, bestOv, bc, isCancelled);
  onStep?.(total, total);
  const metric = (e: { tj: number; thetaJA: number; mass: number }) => (obj === 'min_mass' ? e.mass : obj === 'min_theta_ja' ? e.thetaJA : e.tj);
  const candidates = [
    { label: 'Baseline', params: params({ timK: pkg.tim.k, lidThickness: pkg.lid.thickness, thermalVias: pkg.substrate.thermalVias, ballCountScale: 1 }), tj: +base.tj.toFixed(2), thetaJA: +base.thetaJA.toFixed(3), mass: +base.mass.toFixed(3) },
    ...evals.map((e, i) => ({ label: `Sample ${i + 1}`, params: params(e.ov), tj: +e.tj.toFixed(2), thetaJA: +e.thetaJA.toFixed(3), mass: +e.mass.toFixed(3) })),
    { label: 'Surrogate optimum (verified)', params: params(bestOv), tj: +verified.tj.toFixed(2), thetaJA: +verified.thetaJA.toFixed(3), mass: +verified.mass.toFixed(3) },
  ];
  return { objective: AI_OBJECTIVE_LABELS[obj], baseline: +metric(base).toFixed(3), best: +metric(verified).toFixed(3), candidates, bestOverrides: bestOv, base, verified };
}
