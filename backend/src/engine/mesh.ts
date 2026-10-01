/**
 * Structured, non-uniform Cartesian mesh generation and voxelization of the block model.
 */
import type { Block, Model } from './geometry';

export interface MeshOptions {
  density: 'coarse' | 'medium' | 'fine';
  /** target package element size (mm) — manual mode */
  target?: number | null;
  /** extra local refinement boxes in XY (mm) with max cell size */
  refine?: { x0: number; x1: number; y0: number; y1: number; size: number }[];
  /** refine z-cells inside dies */
  dieZCells?: number;
}

export interface Mesh {
  xs: Float64Array; // node coordinates (nx+1)
  ys: Float64Array;
  zs: Float64Array;
  nx: number; ny: number; nz: number;
  /** block index per cell, -1 = void (ambient) */
  cellBlock: Int32Array;
  /** solid cell -> unknown index, -1 for void */
  unk: Int32Array;
  nUnknowns: number;
  cellCount: number;
}

const DENS = { coarse: { div: 14, board: 7 }, medium: { div: 26, board: 4.5 }, fine: { div: 42, board: 3 } };

function uniqSorted(v: number[], tol = 1e-6) {
  const s = [...v].sort((a, b) => a - b);
  const out: number[] = [];
  for (const x of s) if (!out.length || x - out[out.length - 1] > tol) out.push(x);
  return out;
}

function subdivide(breaks: number[], sizeAt: (mid: number) => number, minCells: (a: number, b: number) => number = () => 1) {
  const nodes: number[] = [breaks[0]];
  for (let i = 0; i < breaks.length - 1; i++) {
    const a = breaks[i], b = breaks[i + 1];
    const h = b - a;
    const n = Math.max(minCells(a, b), Math.ceil(h / sizeAt((a + b) / 2) - 1e-9));
    for (let k = 1; k <= n; k++) nodes.push(a + (h * k) / n);
  }
  return Float64Array.from(nodes);
}

export function buildMesh(model: Model, opt: MeshOptions): Mesh {
  const d = DENS[opt.density] ?? DENS.medium;
  const { L, W } = model.pkg;
  const fine = opt.target && opt.target > 0 ? opt.target : Math.min(L, W) / d.div;
  const boardMax = Math.max(d.board, fine * 2);
  const refine = opt.refine ?? [];
  const sizeXY = (axis: 'x' | 'y') => (m: number) => {
    const half = axis === 'x' ? L / 2 : W / 2;
    const dist = Math.max(0, Math.abs(m) - half);
    let s = dist <= 0 ? fine : Math.min(boardMax, fine + 0.45 * dist);
    for (const r of refine) {
      const [a, b] = axis === 'x' ? [r.x0, r.x1] : [r.y0, r.y1];
      if (m >= a && m <= b) s = Math.min(s, r.size);
    }
    return s;
  };
  const bx: number[] = [], by: number[] = [], bz: number[] = [];
  for (const b of model.blocks) { bx.push(b.x0, b.x1); by.push(b.y0, b.y1); bz.push(b.z0, b.z1); }
  for (const r of refine) { bx.push(r.x0, r.x1); by.push(r.y0, r.y1); }
  const xs = subdivide(uniqSorted(bx, 1e-4), sizeXY('x'));
  const ys = subdivide(uniqSorted(by, 1e-4), sizeXY('y'));
  const dieZ = opt.dieZCells ?? (opt.density === 'fine' ? 4 : opt.density === 'coarse' ? 2 : 3);
  const zMax = opt.density === 'fine' ? 0.25 : opt.density === 'coarse' ? 0.6 : 0.4;
  const blocksZ = model.blocks;
  const zs = subdivide(uniqSorted(bz, 1e-5), () => zMax, (a, b) => {
    const mid = (a + b) / 2;
    if (mid < 0) return opt.density === 'coarse' ? 2 : 3; // board
    const inDie = blocksZ.some((bl) => bl.role === 'die' && mid > bl.z0 && mid < bl.z1);
    return inDie ? dieZ : 1;
  });

  const nx = xs.length - 1, ny = ys.length - 1, nz = zs.length - 1;
  const cellCount = nx * ny * nz;
  const cellBlock = new Int32Array(cellCount).fill(-1);
  const cx = new Float64Array(nx), cy = new Float64Array(ny), cz = new Float64Array(nz);
  for (let i = 0; i < nx; i++) cx[i] = (xs[i] + xs[i + 1]) / 2;
  for (let j = 0; j < ny; j++) cy[j] = (ys[j] + ys[j + 1]) / 2;
  for (let k = 0; k < nz; k++) cz[k] = (zs[k] + zs[k + 1]) / 2;

  // Paint blocks in order (later blocks override earlier ones) using index ranges.
  const lowerIdx = (arr: Float64Array, v: number) => { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } return lo; };
  model.blocks.forEach((b: Block, bi: number) => {
    const i0 = lowerIdx(cx, b.x0), i1 = lowerIdx(cx, b.x1);
    const j0 = lowerIdx(cy, b.y0), j1 = lowerIdx(cy, b.y1);
    const k0 = lowerIdx(cz, b.z0), k1 = lowerIdx(cz, b.z1);
    for (let k = k0; k < k1; k++)
      for (let j = j0; j < j1; j++) {
        const base = (k * ny + j) * nx;
        for (let i = i0; i < i1; i++) cellBlock[base + i] = bi;
      }
  });

  const unk = new Int32Array(cellCount).fill(-1);
  let n = 0;
  for (let c = 0; c < cellCount; c++) if (cellBlock[c] >= 0) unk[c] = n++;
  return { xs, ys, zs, nx, ny, nz, cellBlock, unk, nUnknowns: n, cellCount };
}
