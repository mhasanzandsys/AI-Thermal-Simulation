/** Post-processing of a solved temperature field into thermal metrics and 2D maps. */
import type { FieldMap, HeatFlowSplit, Hotspot } from '@ats/shared';
import type { System } from './fvsolver';
import type { Role } from './geometry';

export function roleOfUnknown(sys: System) {
  const roles: Role[] = new Array(sys.n);
  for (let u = 0; u < sys.n; u++) roles[u] = sys.model.blocks[sys.mesh.cellBlock[sys.cellOf[u]]].role;
  return roles;
}

const centers = (a: Float64Array) => Array.from({ length: a.length - 1 }, (_, i) => (a[i] + a[i + 1]) / 2);

export function junction(sys: System, T: Float64Array) {
  const { mesh, model } = sys;
  let tj = -Infinity, at = -1;
  for (let u = 0; u < sys.n; u++) {
    const b = model.blocks[mesh.cellBlock[sys.cellOf[u]]];
    if (b.role === 'die' && T[u] > tj) { tj = T[u]; at = u; }
  }
  const c = sys.cellOf[at];
  const i = c % mesh.nx, j = Math.floor(c / mesh.nx) % mesh.ny, k = Math.floor(c / (mesh.nx * mesh.ny));
  const blk = model.blocks[mesh.cellBlock[c]];
  return { tj, x: (mesh.xs[i] + mesh.xs[i + 1]) / 2, y: (mesh.ys[j] + mesh.ys[j + 1]) / 2, z: (mesh.zs[k] + mesh.zs[k + 1]) / 2, die: blk.name };
}

/** temperature of the top-most solid cell in the column containing (x,y) */
export function topSurfaceTemp(sys: System, T: Float64Array, x: number, y: number) {
  const { mesh } = sys;
  const i = locate(mesh.xs, x), j = locate(mesh.ys, y);
  for (let k = mesh.nz - 1; k >= 0; k--) {
    const u = mesh.unk[(k * mesh.ny + j) * mesh.nx + i];
    if (u >= 0) return T[u];
  }
  return NaN;
}

/** board top-surface temperature at (x,y) */
export function boardTopTemp(sys: System, T: Float64Array, x: number, y: number) {
  const { mesh } = sys;
  const i = locate(mesh.xs, x), j = locate(mesh.ys, y);
  let kb = 0;
  for (let k = 0; k < mesh.nz; k++) if (mesh.zs[k + 1] <= 1e-9) kb = k;
  const u = mesh.unk[(kb * mesh.ny + j) * mesh.nx + i];
  return u >= 0 ? T[u] : NaN;
}

function locate(nodes: Float64Array, v: number) {
  let lo = 0, hi = nodes.length - 2;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (nodes[m] <= v) lo = m; else hi = m - 1; }
  return Math.max(0, Math.min(nodes.length - 2, lo));
}

function mkField(label: string, x: number[], y: number[], T: (number | null)[][]): FieldMap {
  let min = Infinity, max = -Infinity;
  for (const r of T) for (const v of r) if (v != null) { min = Math.min(min, v); max = Math.max(max, v); }
  const round = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 1000);
  return { label, x: x.map((v) => +v.toFixed(4)), y: y.map((v) => +v.toFixed(4)), T: T.map((r) => r.map(round)), min, max };
}

export function fieldMaps(sys: System, T: Float64Array) {
  const { mesh, model } = sys;
  const cx = centers(mesh.xs), cy = centers(mesh.ys), cz = centers(mesh.zs);
  const blocks = model.blocks;
  const roleAt = (c: number) => (mesh.cellBlock[c] >= 0 ? blocks[mesh.cellBlock[c]].role : null);
  // die active map
  const dx0 = Math.min(...model.dies.map((d) => d.x0)), dx1 = Math.max(...model.dies.map((d) => d.x1));
  const dy0 = Math.min(...model.dies.map((d) => d.y0)), dy1 = Math.max(...model.dies.map((d) => d.y1));
  const ii = cx.map((v, i) => [v, i] as const).filter(([v]) => v > dx0 && v < dx1).map(([, i]) => i);
  const jj = cy.map((v, j) => [v, j] as const).filter(([v]) => v > dy0 && v < dy1).map(([, j]) => j);
  const dieT = jj.map((j) => ii.map((i) => {
    let m: number | null = null;
    for (let k = 0; k < mesh.nz; k++) {
      const c = (k * mesh.ny + j) * mesh.nx + i;
      if (roleAt(c) === 'die') { const t = T[mesh.unk[c]]; m = m == null ? t : Math.max(m, t); }
    }
    return m;
  }));
  const dieTop = mkField('Die junction (active layer)', ii.map((i) => cx[i]), jj.map((j) => cy[j]), dieT);

  // package top surface
  const pi = cx.map((v, i) => [v, i] as const).filter(([v]) => Math.abs(v) < model.pkg.L / 2).map(([, i]) => i);
  const pj = cy.map((v, j) => [v, j] as const).filter(([v]) => Math.abs(v) < model.pkg.W / 2).map(([, j]) => j);
  const pkgT = pj.map((j) => pi.map((i) => {
    for (let k = mesh.nz - 1; k >= 0; k--) {
      const c = (k * mesh.ny + j) * mesh.nx + i;
      const u = mesh.unk[c];
      if (u >= 0 && cz[k] > 0) return T[u];
    }
    return null;
  }));
  const packageTop = mkField('Package top surface', pi.map((i) => cx[i]), pj.map((j) => cy[j]), pkgT);

  // board top layer
  let kb = 0;
  for (let k = 0; k < mesh.nz; k++) if (mesh.zs[k + 1] <= 1e-9) kb = k;
  const bT = cy.map((_, j) => cx.map((_, i) => { const u = mesh.unk[(kb * mesh.ny + j) * mesh.nx + i]; return u >= 0 ? T[u] : null; }));
  const boardTop = mkField('Board top surface', cx, cy, bT);

  // XZ cross-section through hottest die centre
  const jd = locate(mesh.ys, (model.dies[0].y0 + model.dies[0].y1) / 2);
  const xi = cx.map((v, i) => [v, i] as const).filter(([v]) => Math.abs(v) < model.pkg.L / 2 + 6).map(([, i]) => i);
  const xsT = cz.map((_, k) => xi.map((i) => { const u = mesh.unk[(k * mesh.ny + jd) * mesh.nx + i]; return u >= 0 ? T[u] : null; }));
  const crossSection = mkField('XZ cross-section through die centre', xi.map((i) => cx[i]), cz, xsT);
  return { dieTop, packageTop, boardTop, crossSection };
}

export function findHotspots(field: FieldMap, sys: System, n = 5): Hotspot[] {
  const cand: { x: number; y: number; t: number }[] = [];
  const T = field.T;
  for (let j = 0; j < T.length; j++)
    for (let i = 0; i < T[j].length; i++) {
      const v = T[j][i];
      if (v == null) continue;
      let isMax = true;
      for (let dj = -1; dj <= 1 && isMax; dj++)
        for (let di = -1; di <= 1; di++) {
          if (!di && !dj) continue;
          const w = T[j + dj]?.[i + di];
          if (w != null && w > v) { isMax = false; break; }
        }
      if (isMax) cand.push({ x: field.x[i], y: field.y[j], t: v });
    }
  cand.sort((a, b) => b.t - a.t);
  const picked: typeof cand = [];
  for (const c of cand) {
    if (picked.every((p) => Math.hypot(p.x - c.x, p.y - c.y) > 1.0)) picked.push(c);
    if (picked.length >= n) break;
  }
  return picked.map((p, r) => {
    const die = sys.model.dies.find((d) => p.x >= d.x0 && p.x <= d.x1 && p.y >= d.y0 && p.y <= d.y1);
    const zAct = die ? (die.activeBottom ? die.z0 : die.z1) : 0;
    return { rank: r + 1, x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +zAct.toFixed(3), temp: +p.t.toFixed(2), location: die ? die.name : 'package' };
  });
}

export function heatFlow(sys: System, T: Float64Array, boundaryHeat: Float64Array): HeatFlowSplit {
  const roles = roleOfUnknown(sys);
  let top = 0, sides = 0, board = 0;
  sys.faces.forEach((f, idx) => {
    const qf = boundaryHeat[idx];
    if (f.group === 0) board += qf;
    else if (f.axis === 2 && f.sign === 1) top += qf;
    else sides += qf;
  });
  const flux = (a: (r: Role) => boolean, b: (r: Role) => boolean) => {
    let s = 0;
    const { rowPtr, col, val } = sys;
    for (let u = 0; u < sys.n; u++) {
      if (!a(roles[u])) continue;
      for (let p = rowPtr[u]; p < rowPtr[u + 1]; p++) {
        const v = col[p];
        if (b(roles[v])) s += -val[p] * (T[u] - T[v]);
      }
    }
    return s;
  };
  const total = sys.q.reduce((s, v) => s + v, 0) || 1;
  const intoBoard = flux((r) => r !== 'board', (r) => r === 'board');
  const dieToLid = flux((r) => r === 'die', (r) => r === 'tim' || r === 'lid' || r === 'mold' || r === 'air');
  const dieToSub = flux((r) => r === 'die', (r) => r === 'attach' || r === 'substrate' || r === 'interconnect' || r === 'via');
  const pct = (v: number) => Math.round((v / total) * 1000) / 10;
  return { topConvection: pct(top), packageSides: pct(sides), intoBoard: pct(intoBoard), boardConvection: pct(board), dieToLid: pct(dieToLid), dieToSubstrate: pct(dieToSub) };
}
