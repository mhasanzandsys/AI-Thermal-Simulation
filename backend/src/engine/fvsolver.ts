/**
 * 3D finite-volume heat-conduction solver with convective / radiative / cold-plate
 * boundary conditions. Linear systems are solved with an IC(0)-preconditioned
 * conjugate-gradient method; non-linear convection/radiation coefficients are
 * handled with Picard (fixed-point) outer iterations.
 */
import type { Model } from './geometry';
import type { Mesh } from './mesh';

export type BcMode =
  | { kind: 'natural'; ambient: number; orientation: 'Horizontal' | 'Vertical' | 'Custom'; radiation: boolean }
  | { kind: 'forced'; ambient: number; velocity: number; orientation: 'Horizontal' | 'Vertical' | 'Custom'; radiation: boolean }
  | { kind: 'jb_ring'; ambient: number; ringGap: number; h: number }
  | { kind: 'jc_cold'; ambient: number; plateTemp: number; h: number };

export interface SolveControl {
  tol: number;
  maxIter: number;
  onProgress?: (info: { outer: number; iteration: number; residual: number; tmax: number }) => void;
  isCancelled?: () => boolean;
}

interface Face { u: number; area: number; halfR: number; axis: 0 | 1 | 2; sign: 1 | -1; group: 0 | 1; eps: number; cx: number; cy: number; cz: number; ztop: number }

export interface System {
  mesh: Mesh;
  model: Model;
  n: number;
  // CSR of off-diagonal conductances (symmetric, both triangles)
  rowPtr: Int32Array; col: Int32Array; val: Float64Array;
  diagCond: Float64Array; // sum of internal conductances per unknown
  cap: Float64Array; // heat capacity J/K
  q: Float64Array; // heat source W
  faces: Face[];
  // per unknown cell indices
  cellOf: Int32Array;
}

const SIGMA = 5.670374e-8;
const yieldTick = () => new Promise<void>((r) => setImmediate(r));

export class CancelledError extends Error { constructor() { super('Job cancelled'); } }

export function assemble(model: Model, mesh: Mesh): System {
  const { nx, ny, nz, xs, ys, zs, cellBlock, unk } = mesh;
  const n = mesh.nUnknowns;
  const blocks = model.blocks;
  const cellOf = new Int32Array(n);
  for (let c = 0; c < mesh.cellCount; c++) if (unk[c] >= 0) cellOf[unk[c]] = c;
  const dx = (i: number) => (xs[i + 1] - xs[i]) * 1e-3;
  const dy = (j: number) => (ys[j + 1] - ys[j]) * 1e-3;
  const dz = (k: number) => (zs[k + 1] - zs[k]) * 1e-3;

  const nbrs: number[][] = Array.from({ length: n }, () => []);
  const nvals: number[][] = Array.from({ length: n }, () => []);
  const diagCond = new Float64Array(n);
  const cap = new Float64Array(n);
  const q = new Float64Array(n);
  const faces: Face[] = [];

  const kOf = (b: number, axis: number) => (axis === 0 ? blocks[b].kx : axis === 1 ? blocks[b].ky : blocks[b].kz);
  const groupOf = (b: number): 0 | 1 => (blocks[b].role === 'board' ? 0 : 1);

  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const c = (k * ny + j) * nx + i;
        const u = unk[c];
        if (u < 0) continue;
        const b = cellBlock[c];
        const hx = dx(i), hy = dy(j), hz = dz(k);
        cap[u] = blocks[b].rho * blocks[b].cp * hx * hy * hz;
        const cxm = (xs[i] + xs[i + 1]) / 2, cym = (ys[j] + ys[j + 1]) / 2, czm = (zs[k] + zs[k + 1]) / 2;
        // six neighbours: only handle + direction for internal pairs, both directions for boundaries
        const dirs: [number, number, number, 0 | 1 | 2, 1 | -1][] = [[1, 0, 0, 0, 1], [-1, 0, 0, 0, -1], [0, 1, 0, 1, 1], [0, -1, 0, 1, -1], [0, 0, 1, 2, 1], [0, 0, -1, 2, -1]];
        for (const [di, dj, dk, axis, sign] of dirs) {
          const ii = i + di, jj = j + dj, kk = k + dk;
          const area = axis === 0 ? hy * hz : axis === 1 ? hx * hz : hx * hy;
          const h1 = axis === 0 ? hx : axis === 1 ? hy : hz;
          const r1 = h1 / 2 / kOf(b, axis);
          const inside = ii >= 0 && ii < nx && jj >= 0 && jj < ny && kk >= 0 && kk < nz;
          const c2 = inside ? (kk * ny + jj) * nx + ii : -1;
          const u2 = c2 >= 0 ? unk[c2] : -1;
          if (u2 >= 0) {
            if (sign < 0) continue; // count each internal face once
            const b2 = cellBlock[c2];
            const h2 = axis === 0 ? dx(ii) : axis === 1 ? dy(jj) : dz(kk);
            const G = area / (r1 + h2 / 2 / kOf(b2, axis));
            nbrs[u].push(u2); nvals[u].push(-G);
            nbrs[u2].push(u); nvals[u2].push(-G);
            diagCond[u] += G; diagCond[u2] += G;
          } else {
            faces.push({ u, area, halfR: r1, axis, sign, group: groupOf(b), eps: blocks[b].emissivity, cx: cxm, cy: cym, cz: czm, ztop: zs[k + 1] });
          }
        }
      }

  // heat sources: distribute die power to active-layer cells (respecting power maps)
  for (const d of model.dies) {
    if (d.power <= 0) continue;
    // active layer: lowest (flip-chip) or highest (wire-bond) z-cell row inside die
    let kAct = -1;
    for (let k = 0; k < nz; k++) {
      const czm = (zs[k] + zs[k + 1]) / 2;
      if (czm > d.z0 && czm < d.z1) { if (d.activeBottom) { kAct = k; break; } kAct = k; }
    }
    if (kAct < 0) continue;
    const cells: { u: number; w: number }[] = [];
    for (let j = 0; j < ny; j++) {
      const cym = (ys[j] + ys[j + 1]) / 2;
      if (cym <= d.y0 || cym >= d.y1) continue;
      for (let i = 0; i < nx; i++) {
        const cxm = (xs[i] + xs[i + 1]) / 2;
        if (cxm <= d.x0 || cxm >= d.x1) continue;
        const c = (kAct * ny + j) * nx + i;
        const u = unk[c];
        const b = cellBlock[c];
        if (u < 0 || blocks[b].role !== 'die' || blocks[b].dieIndex !== d.index) continue;
        let w = (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
        if (d.powerMap) {
          const pm = d.powerMap;
          const py = pm.length, px = pm[0].length;
          const fi = Math.min(px - 1, Math.floor(((cxm - d.x0) / (d.x1 - d.x0)) * px));
          const fj = Math.min(py - 1, Math.floor(((cym - d.y0) / (d.y1 - d.y0)) * py));
          // row 0 of map = top edge (max y)
          w *= pm[py - 1 - fj][fi];
        }
        cells.push({ u, w });
      }
    }
    const wsum = cells.reduce((s, c) => s + c.w, 0);
    if (wsum > 0) for (const c of cells) q[c.u] += (d.power * c.w) / wsum;
  }

  // CSR
  const rowPtr = new Int32Array(n + 1);
  for (let u = 0; u < n; u++) rowPtr[u + 1] = rowPtr[u] + nbrs[u].length;
  const col = new Int32Array(rowPtr[n]);
  const val = new Float64Array(rowPtr[n]);
  for (let u = 0; u < n; u++) {
    const order = nbrs[u].map((c, t) => [c, nvals[u][t]] as const).sort((a, b) => a[0] - b[0]);
    order.forEach(([c, v], t) => { col[rowPtr[u] + t] = c; val[rowPtr[u] + t] = v; });
  }
  return { mesh, model, n, rowPtr, col, val, diagCond, cap, q, faces, cellOf };
}

/** Face heat-transfer coefficient (W/m²K) and sink temperature for the BC mode. */
function faceH(sys: System, f: Face, Ts: number, bc: BcMode): { h: number; Tinf: number } {
  const m = sys.model;
  if (bc.kind === 'jc_cold') {
    const top = f.axis === 2 && f.sign === 1 && f.group === 1 && Math.abs(f.ztop - m.pkg.zTop) < 1e-6;
    return top ? { h: bc.h, Tinf: bc.plateTemp } : { h: 0, Tinf: bc.ambient };
  }
  if (bc.kind === 'jb_ring') {
    const inRing = f.group === 0 && f.axis === 2 && (Math.abs(f.cx) > m.pkg.L / 2 + bc.ringGap || Math.abs(f.cy) > m.pkg.W / 2 + bc.ringGap);
    return inRing ? { h: bc.h, Tinf: bc.ambient } : { h: 0, Tinf: bc.ambient };
  }
  const Ta = bc.ambient;
  const dT = Math.max(0.05, Math.abs(Ts - Ta));
  const up: 0 | 1 | 2 = bc.orientation === 'Vertical' ? 1 : 2; // gravity opposite
  const board = f.group === 0;
  const ext = board ? [m.board.L, m.board.W, m.board.t] : [m.pkg.L, m.pkg.W, Math.max(0.5, m.pkg.zTop)];
  let hn: number;
  if (f.axis === up) {
    const a = up === 2 ? [ext[0], ext[1]] : [ext[0], ext[2]];
    const Lc = Math.max(1e-3, (a[0] * a[1]) / (2 * (a[0] + a[1])) * 1e-3);
    const hotUp = (f.sign === 1) === (Ts >= Ta);
    hn = (hotUp ? 1.32 : 0.59) * Math.pow(dT / Lc, 0.25);
  } else {
    const Lc = Math.max(1e-3, ext[up] * 1e-3);
    hn = 1.42 * Math.pow(dT / Lc, 0.25);
  }
  let h = hn;
  if (bc.kind === 'forced' && bc.velocity > 0) {
    const Lf = (board ? m.board.L : m.pkg.L) * 1e-3;
    const Re = (bc.velocity * Lf) / 1.6e-5;
    const Nu = Re < 5e5 ? 0.664 * Math.sqrt(Re) * Math.cbrt(0.71) : (0.037 * Math.pow(Re, 0.8) - 871) * Math.cbrt(0.71);
    let hf = (Nu * 0.0262) / Lf;
    if (!board) hf *= 1.25; // leading-edge / protrusion enhancement
    h = Math.cbrt(hf ** 3 + hn ** 3);
  }
  if (bc.radiation) {
    const Tk = Ts + 273.15, Tak = Ta + 273.15;
    h += f.eps * SIGMA * (Tk * Tk + Tak * Tak) * (Tk + Tak);
  }
  return { h, Tinf: Ta };
}

export interface SolveResult {
  T: Float64Array;
  history: { iteration: number; residual: number }[];
  outerIterations: number;
  converged: boolean;
  boundaryHeat: Float64Array; // per face heat leaving (W)
  energyImbalance: number;
}

/** IC(0) preconditioner for a 7-point M-matrix: L_ik = A_ik / L_kk, L_ii = sqrt(A_ii - Σ L_ik²). */
function buildIC(sys: System, diag: Float64Array) {
  const { n, rowPtr, col, val } = sys;
  const Ld = new Float64Array(n);
  const Lv = new Float64Array(val.length); // only lower entries used
  for (let i = 0; i < n; i++) {
    let s = diag[i];
    for (let p = rowPtr[i]; p < rowPtr[i + 1]; p++) {
      const k = col[p];
      if (k >= i) break;
      const l = val[p] / Ld[k];
      Lv[p] = l;
      s -= l * l;
    }
    Ld[i] = Math.sqrt(Math.max(s, diag[i] * 1e-3));
  }
  return (r: Float64Array, z: Float64Array) => {
    // forward L y = r
    for (let i = 0; i < n; i++) {
      let s = r[i];
      for (let p = rowPtr[i]; p < rowPtr[i + 1]; p++) {
        const k = col[p];
        if (k >= i) break;
        s -= Lv[p] * z[k];
      }
      z[i] = s / Ld[i];
    }
    // backward L^T z = y
    for (let i = n - 1; i >= 0; i--) {
      z[i] /= Ld[i];
      const zi = z[i];
      for (let p = rowPtr[i]; p < rowPtr[i + 1]; p++) {
        const k = col[p];
        if (k >= i) break;
        z[k] -= Lv[p] * zi;
      }
    }
  };
}

async function pcg(sys: System, diag: Float64Array, b: Float64Array, x: Float64Array, ctl: SolveControl, histOffset: number, history: { iteration: number; residual: number }[], outer: number) {
  const { n, rowPtr, col, val } = sys;
  const M = buildIC(sys, diag);
  const r = new Float64Array(n), z = new Float64Array(n), p = new Float64Array(n), Ap = new Float64Array(n);
  const matvec = (v: Float64Array, out: Float64Array) => {
    for (let i = 0; i < n; i++) {
      let s = diag[i] * v[i];
      for (let q = rowPtr[i]; q < rowPtr[i + 1]; q++) s += val[q] * v[col[q]];
      out[i] = s;
    }
  };
  matvec(x, Ap);
  let bnorm = 0;
  for (let i = 0; i < n; i++) { r[i] = b[i] - Ap[i]; bnorm += b[i] * b[i]; }
  bnorm = Math.sqrt(bnorm) || 1;
  M(r, z);
  p.set(z);
  let rz = 0;
  for (let i = 0; i < n; i++) rz += r[i] * z[i];
  let it = 0, res = 1;
  for (; it < ctl.maxIter; it++) {
    let rr = 0;
    for (let i = 0; i < n; i++) rr += r[i] * r[i];
    res = Math.sqrt(rr) / bnorm;
    if (it % 5 === 0) history.push({ iteration: histOffset + it, residual: res });
    if (res < ctl.tol) break;
    matvec(p, Ap);
    let pAp = 0;
    for (let i = 0; i < n; i++) pAp += p[i] * Ap[i];
    const alpha = rz / pAp;
    for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * Ap[i]; }
    M(r, z);
    let rzNew = 0;
    for (let i = 0; i < n; i++) rzNew += r[i] * z[i];
    const beta = rzNew / rz;
    rz = rzNew;
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i];
    if (it % 40 === 39) {
      if (ctl.isCancelled?.()) throw new CancelledError();
      let tmax = -Infinity; for (let i = 0; i < n; i += 7) tmax = Math.max(tmax, x[i]);
      ctl.onProgress?.({ outer, iteration: histOffset + it, residual: res, tmax });
      await yieldTick();
    }
  }
  history.push({ iteration: histOffset + it, residual: res });
  return { iterations: it, residual: res, converged: res < ctl.tol };
}

function bcCoefficients(sys: System, T: Float64Array, bc: BcMode) {
  const G = new Float64Array(sys.faces.length);
  const Tinf = new Float64Array(sys.faces.length);
  sys.faces.forEach((f, idx) => {
    const { h, Tinf: ti } = faceH(sys, f, T[f.u], bc);
    G[idx] = h > 0 ? f.area / (1 / h + f.halfR) : 0;
    Tinf[idx] = ti;
  });
  return { G, Tinf };
}

export async function solveSteady(sys: System, bc: BcMode, ctl: SolveControl, initial?: Float64Array): Promise<SolveResult> {
  const n = sys.n;
  const T = initial ? Float64Array.from(initial) : new Float64Array(n).fill(bc.ambient + 10);
  const history: { iteration: number; residual: number }[] = [];
  const nonlinear = bc.kind === 'natural' || bc.kind === 'forced';
  const maxOuter = nonlinear ? 14 : 1;
  let converged = false, outer = 0, itTotal = 0;
  let G = new Float64Array(0), Tinf = new Float64Array(0);
  for (outer = 0; outer < maxOuter; outer++) {
    ({ G, Tinf } = bcCoefficients(sys, T, bc));
    const diag = Float64Array.from(sys.diagCond);
    const b = Float64Array.from(sys.q);
    sys.faces.forEach((f, idx) => { diag[f.u] += G[idx]; b[f.u] += G[idx] * Tinf[idx]; });
    // guard: fully adiabatic → anchor (should not happen)
    const Told = Float64Array.from(T);
    const r = await pcg(sys, diag, b, T, ctl, itTotal, history, outer);
    itTotal += r.iterations + 1;
    let dmax = 0;
    for (let i = 0; i < n; i++) dmax = Math.max(dmax, Math.abs(T[i] - Told[i]));
    converged = r.converged;
    if (!nonlinear || dmax < 0.02) break;
  }
  const boundaryHeat = new Float64Array(sys.faces.length);
  let out = 0;
  sys.faces.forEach((f, idx) => { boundaryHeat[idx] = G[idx] * (T[f.u] - Tinf[idx]); out += boundaryHeat[idx]; });
  const qin = sys.q.reduce((s, v) => s + v, 0);
  return { T, history, outerIterations: outer + 1, converged, boundaryHeat, energyImbalance: qin > 0 ? Math.abs(out - qin) / qin : 0 };
}

/** Implicit-Euler transient from uniform ambient. Returns probe history via callback. */
export async function solveTransient(
  sys: System, bc: BcMode, duration: number, dt: number, ctl: SolveControl,
  probe: (T: Float64Array, t: number) => void,
) {
  const n = sys.n;
  const T = new Float64Array(n).fill(bc.ambient);
  const steps = Math.min(400, Math.max(1, Math.round(duration / dt)));
  const step = duration / steps;
  // log-spaced output for nice curves, solve every step
  probe(T, 0);
  const hist: { iteration: number; residual: number }[] = [];
  let G = new Float64Array(0), Tinf = new Float64Array(0);
  for (let s = 1; s <= steps; s++) {
    if (s === 1 || s % 5 === 0) ({ G, Tinf } = bcCoefficients(sys, T, bc));
    const diag = Float64Array.from(sys.diagCond);
    const b = Float64Array.from(sys.q);
    for (let i = 0; i < n; i++) { const c = sys.cap[i] / step; diag[i] += c; b[i] += c * T[i]; }
    sys.faces.forEach((f, idx) => { diag[f.u] += G[idx]; b[f.u] += G[idx] * Tinf[idx]; });
    await pcg(sys, diag, b, T, { ...ctl, maxIter: Math.min(ctl.maxIter, 400), onProgress: undefined }, 0, hist, 0);
    probe(T, s * step);
    if (ctl.isCancelled?.()) throw new CancelledError();
    ctl.onProgress?.({ outer: s, iteration: s, residual: hist[hist.length - 1]?.residual ?? 0, tmax: 0 });
    if (s % 4 === 0) await yieldTick();
  }
  return { steps };
}
