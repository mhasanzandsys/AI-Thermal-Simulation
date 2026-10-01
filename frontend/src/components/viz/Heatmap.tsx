'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FieldMap, Hotspot } from '@ats/shared';

export function jet(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  const r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 3)));
  const g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 2)));
  const b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 1)));
  return [r * 255, g * 255, b * 255];
}
const css = (t: number) => { const [r, g, b] = jet(t); return `rgb(${r | 0},${g | 0},${b | 0})`; };

function edges(a: number[]) {
  if (a.length === 1) return [a[0] - 0.5, a[0] + 0.5];
  const e = [a[0] - (a[1] - a[0]) / 2];
  for (let i = 1; i < a.length; i++) e.push((a[i - 1] + a[i]) / 2);
  e.push(a[a.length - 1] + (a[a.length - 1] - a[a.length - 2]) / 2);
  return e;
}

export function Colorbar({ min, max, height = 140, unit = '°C', ticks = 5 }: { min: number; max: number; height?: number; unit?: string; ticks?: number }) {
  return (
    <div className="flex items-stretch gap-1.5 text-[11px] text-slate-600" style={{ height }}>
      <div className="w-3 rounded-sm" style={{ background: `linear-gradient(to top, ${Array.from({ length: 9 }, (_, i) => css(i / 8)).join(',')})` }} />
      <div className="flex flex-col justify-between">
        {Array.from({ length: ticks }, (_, i) => <span key={i}>{(max - ((max - min) * i) / (ticks - 1)).toFixed(1)}</span>)}
      </div>
      <span className="sr-only">{unit}</span>
    </div>
  );
}

/** 2D contour map on a non-uniform grid (null cells are void). */
export function Heatmap2D({ field, hotspots, height = 220, aspect = true, title }: { field: FieldMap; hotspots?: Hotspot[]; height?: number; aspect?: boolean; title?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number; t: number | null; px: number; py: number } | null>(null);
  const ex = useMemo(() => edges(field.x), [field]);
  const ey = useMemo(() => edges(field.y), [field]);
  const spanX = ex[ex.length - 1] - ex[0], spanY = ey[ey.length - 1] - ey[0];
  const h = height, w = aspect ? Math.max(80, Math.round((h * spanX) / spanY)) : Math.round(h * 1.4);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const sx = w / spanX, sy = h / spanY;
    const rng = field.max - field.min || 1;
    for (let j = 0; j < field.y.length; j++)
      for (let i = 0; i < field.x.length; i++) {
        const v = field.T[j][i];
        if (v == null) continue;
        g.fillStyle = css((v - field.min) / rng);
        g.fillRect((ex[i] - ex[0]) * sx, h - (ey[j + 1] - ey[0]) * sy, (ex[i + 1] - ex[i]) * sx + 0.6, (ey[j + 1] - ey[j]) * sy + 0.6);
      }
    for (const hs of hotspots ?? []) {
      const px = (hs.x - ex[0]) * sx, py = h - (hs.y - ey[0]) * sy;
      g.strokeStyle = 'white'; g.lineWidth = 2;
      g.beginPath(); g.arc(px, py, 6, 0, Math.PI * 2); g.stroke();
      g.fillStyle = 'white'; g.font = 'bold 10px sans-serif'; g.fillText(String(hs.rank), px + 8, py - 6);
    }
  }, [field, hotspots, w, h, spanX, spanY, ex, ey]);
  const onMove = (e: React.MouseEvent) => {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const x = ex[0] + (px / r.width) * spanX, y = ey[0] + (1 - py / r.height) * spanY;
    const i = ex.findIndex((v, k) => k < ex.length - 1 && x >= v && x < ex[k + 1]);
    const j = ey.findIndex((v, k) => k < ey.length - 1 && y >= v && y < ey[k + 1]);
    setHover({ x, y, t: i >= 0 && j >= 0 ? field.T[j][i] : null, px, py });
  };
  return (
    <div className="flex items-start gap-3">
      <div className="relative">
        {title && <div className="mb-1 text-[11.5px] font-medium text-slate-600">{title}</div>}
        <canvas ref={ref} style={{ width: w, height: h }} className="rounded border border-slate-200" onMouseMove={onMove} onMouseLeave={() => setHover(null)} />
        {hover && hover.t != null && (
          <div className="pointer-events-none absolute z-10 rounded bg-navy-900/90 px-2 py-1 text-[11px] text-white" style={{ left: hover.px + 12, top: hover.py + (title ? 20 : 0) }}>
            {hover.t.toFixed(2)} °C<br /><span className="text-slate-300">({hover.x.toFixed(2)}, {hover.y.toFixed(2)}) mm</span>
          </div>
        )}
        <div className="mt-0.5 flex justify-between text-[10px] text-slate-400"><span>{ex[0].toFixed(1)} mm</span><span>x →</span><span>{ex[ex.length - 1].toFixed(1)} mm</span></div>
      </div>
      <Colorbar min={field.min} max={field.max} height={h} />
    </div>
  );
}

/** Isometric 3D temperature surface (as in the GUI mockup). */
export function Heatmap3D({ field, width = 300, height = 200 }: { field: FieldMap; width?: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr; c.height = height * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    // resample to ≤ 36×36 uniform grid
    const N = 36;
    const nx = Math.min(N, field.x.length), ny = Math.min(N, field.y.length);
    const sample = (u: number, v: number) => {
      const i = Math.min(field.x.length - 1, Math.floor(u * field.x.length));
      const j = Math.min(field.y.length - 1, Math.floor(v * field.y.length));
      return field.T[j][i];
    };
    const rng = field.max - field.min || 1;
    const a = width * 0.36, zScale = height * 0.28;
    const cx = width / 2, cy = height * 0.55;
    const P = (u: number, v: number, t: number) => [cx + (u - v) * a * 0.87, cy + (u + v - 1) * a * 0.5 - ((t - field.min) / rng) * zScale] as const;
    for (let s = 0; s <= nx + ny - 2; s++) {
      for (let i = 0; i < nx; i++) {
        const j = s - i;
        if (j < 0 || j >= ny) continue;
        const u0 = i / nx, u1 = (i + 1) / nx, v0 = j / ny, v1 = (j + 1) / ny;
        const t = sample((u0 + u1) / 2, (v0 + v1) / 2);
        if (t == null) continue;
        const pts = [P(u0, v0, t), P(u1, v0, t), P(u1, v1, t), P(u0, v1, t)];
        const [cr, cg, cb] = jet((t - field.min) / rng);
        const shade = (k: number) => `rgb(${(cr * k) | 0},${(cg * k) | 0},${(cb * k) | 0})`;
        const base = field.min - rng * 0.06;
        const poly = (q: (readonly [number, number])[], fill: string) => { g.fillStyle = fill; g.strokeStyle = fill; g.lineWidth = 0.6; g.beginPath(); g.moveTo(q[0][0], q[0][1]); for (const p of q.slice(1)) g.lineTo(p[0], p[1]); g.closePath(); g.fill(); g.stroke(); };
        // visible column walls (+v and +u faces), then the top face
        poly([pts[3], pts[2], P(u1, v1, base), P(u0, v1, base)], shade(0.62));
        poly([pts[1], pts[2], P(u1, v1, base), P(u1, v0, base)], shade(0.45));
        poly(pts, css((t - field.min) / rng));
      }
    }
  }, [field, width, height]);
  return <canvas ref={ref} style={{ width, height }} aria-label="3D temperature surface" />;
}

/** Vertical cross-section (x–z) map: z is exaggerated to fill the box. */
export function SectionMap({ field, height = 160, width = 520 }: { field: FieldMap; height?: number; width?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = width * dpr; c.height = height * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = '#f8fafc'; g.fillRect(0, 0, width, height);
    const ex = edges(field.x);
    const nz = field.y.length;
    const rng = field.max - field.min || 1;
    const sx = width / (ex[ex.length - 1] - ex[0]);
    const rowH = height / nz; // uniform rows per z-cell (exaggerated thin layers)
    for (let k = 0; k < nz; k++)
      for (let i = 0; i < field.x.length; i++) {
        const v = field.T[k][i];
        if (v == null) continue;
        g.fillStyle = css((v - field.min) / rng);
        g.fillRect((ex[i] - ex[0]) * sx, height - (k + 1) * rowH, (ex[i + 1] - ex[i]) * sx + 0.6, rowH + 0.6);
      }
  }, [field, width, height]);
  return (
    <div className="flex items-start gap-3">
      <div>
        <canvas ref={ref} style={{ width, height }} className="rounded border border-slate-200" />
        <div className="mt-0.5 text-[10.5px] text-slate-400">Each row is one mesh layer (z exaggerated): board → interconnect → substrate → die → TIM/lid.</div>
      </div>
      <Colorbar min={field.min} max={field.max} height={height} />
    </div>
  );
}
