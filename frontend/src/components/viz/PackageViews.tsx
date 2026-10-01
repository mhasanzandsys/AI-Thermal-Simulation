'use client';
import { PACKAGE_FEATURES, type ProjectDoc } from '@ats/shared';

const C = { sub: '#2fa84f', subDark: '#1f7a37', die: '#f08a3c', lid: '#a8b3c2', lidDark: '#7f8a99', tim: '#e8d36a', uf: '#5b6b7d', ball: '#8c939c', mold: '#3a3f47', board: '#1e6b3a', text: '#1d2939' };

/** Schematic cross-section (side view) driven by the package definition. */
export function PackageCrossSection({ doc, width = 330, height = 190, labels = true }: { doc: ProjectDoc; width?: number; height?: number; labels?: boolean }) {
  const p = doc.package;
  const f = PACKAGE_FEATURES[p.type] ?? PACKAGE_FEATURES.Custom;
  const hasLid = p.lid.enabled && f.lid;
  const hasMold = p.mold.enabled && f.mold && !hasLid;
  // exaggerated vertical scale: nominal unit heights
  const ballH = f.balls ? 26 : 8, subH = f.substrate ? 26 : 0, attH = f.substrate ? 7 : 0, dieH = 24, timH = hasLid ? 6 : 0, lidH = hasLid ? 18 : 0;
  const capH = hasMold ? 16 : 0;
  const total = ballH + subH + attH + dieH + timH + lidH + capH;
  const pad = labels ? 64 : 10;
  const w = width - pad * 2 + (labels ? 0 : 0);
  const sx = w / p.body.length;
  const x0 = pad - (labels ? 40 : 0);
  const yb = height - 14;
  const zTop = yb - total;
  const cx = (x: number) => x0 + (x + p.body.length / 2) * sx;
  const ySub = yb - ballH - subH;
  const yDie = ySub - attH - dieH;
  const nBalls = Math.max(3, Math.min(14, Math.round(p.body.length / Math.max(0.3, p.balls.pitch))));
  const r = Math.min(ballH / 2, (w / nBalls) * 0.42);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-auto max-h-64 w-full" role="img" aria-label="Package cross-section">
      {/* balls / interconnect */}
      {f.balls ? Array.from({ length: nBalls }, (_, i) => <circle key={i} cx={x0 + (w / nBalls) * (i + 0.5)} cy={yb - r} r={r} fill={C.ball} stroke="#5f666e" />)
        : <rect x={x0 + w * 0.05} y={yb - ballH} width={w * 0.9} height={ballH} fill={C.ball} />}
      {f.substrate && <rect x={x0} y={ySub} width={w} height={subH} fill={C.sub} stroke={C.subDark} />}
      {f.substrate && <text x={x0 + w / 2} y={ySub + subH / 2 + 4} textAnchor="middle" fontSize="12" fill="white">{p.type === 'QFN' ? 'Leadframe' : 'Substrate'}</text>}
      {hasMold && <rect x={x0} y={zTop} width={w} height={ySub - zTop} fill={C.mold} opacity={0.85} />}
      {p.dies.map((d) => {
        const dx = cx(d.x - d.length / 2), dw = d.length * sx;
        return (
          <g key={d.id}>
            {f.substrate && <path d={`M${dx - 10},${ySub} L${dx},${yDie + dieH * 0.6} L${dx + dw},${yDie + dieH * 0.6} L${dx + dw + 10},${ySub} Z`} fill={p.underfill.enabled ? C.uf : 'none'} />}
            <rect x={dx} y={yDie} width={dw} height={dieH} fill={C.die} stroke="#c0631f" />
            <text x={dx + dw / 2} y={yDie + dieH / 2 + 4} textAnchor="middle" fontSize="12" fill={C.text}>{p.dies.length > 1 ? d.name : 'Die'}</text>
            {hasLid && <rect x={dx} y={yDie - timH} width={dw} height={timH} fill={C.tim} />}
          </g>
        );
      })}
      {hasLid && (() => {
        const lw = Math.min(p.lid.length, p.body.length) * sx, lx = x0 + (w - lw) / 2, yl = yDie - timH - lidH;
        return (
          <g>
            <rect x={lx} y={yl} width={lw} height={lidH} fill={C.lid} stroke={C.lidDark} />
            <path d={`M${lx},${yl + lidH} L${lx},${ySub} L${lx + 12},${ySub} L${lx + 12},${yl + lidH}`} fill={C.lid} stroke={C.lidDark} />
            <path d={`M${lx + lw},${yl + lidH} L${lx + lw},${ySub} L${lx + lw - 12},${ySub} L${lx + lw - 12},${yl + lidH}`} fill={C.lid} stroke={C.lidDark} />
          </g>
        );
      })()}
      {labels && (
        <g fontSize="12" fill={C.text}>
          {hasLid && <text x={x0 + w / 2} y={yDie - timH - lidH - 8} textAnchor="middle">Heat Spreader / Lid</text>}
          {hasMold && <text x={x0 + w / 2} y={zTop - 6} textAnchor="middle">Mold Compound</text>}
          {hasLid && <><line x1={cx(p.dies[0].x + p.dies[0].length / 2)} y1={yDie - timH / 2} x2={x0 + w + 12} y2={yDie - timH - 6} stroke="#333" /><text x={x0 + w + 14} y={yDie - timH - 3}>TIM</text></>}
          {f.flipChip && f.substrate && <><line x1={cx(p.dies[0].x + p.dies[0].length / 2) + 6} y1={ySub - 4} x2={x0 + w + 12} y2={yDie + dieH} stroke="#333" /><text x={x0 + w + 14} y={yDie + dieH + 4}>Underfill</text></>}
          <line x1={x0 + w * 0.48} y1={yb - 2} x2={x0 + w * 0.55} y2={yb + 8} stroke="#333" /><text x={x0 + w * 0.56} y={yb + 12}>{f.interconnect.split(' ')[0] === 'Solder' ? 'Solder Balls' : f.interconnect}</text>
        </g>
      )}
    </svg>
  );
}

/** Top view with ball grid, die outlines and lid outline. */
export function PackageTopView({ doc, size = 150, bottom = false }: { doc: ProjectDoc; size?: number; bottom?: boolean }) {
  const p = doc.package;
  const f = PACKAGE_FEATURES[p.type] ?? PACKAGE_FEATURES.Custom;
  const s = size / Math.max(p.body.length, p.body.width);
  const W = p.body.length * s, H = p.body.width * s;
  const balls: [number, number][] = [];
  if (f.balls && p.balls.count > 0 && p.balls.pitch > 0) {
    const nx = Math.floor(p.body.length / p.balls.pitch), ny = Math.floor(p.body.width / p.balls.pitch);
    const all: [number, number][] = [];
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) all.push([(i - (nx - 1) / 2) * p.balls.pitch, (j - (ny - 1) / 2) * p.balls.pitch]);
    // depopulate centre-out until count matches (perimeter arrays first)
    all.sort((a, b) => Math.max(Math.abs(b[0]) / p.body.length, Math.abs(b[1]) / p.body.width) - Math.max(Math.abs(a[0]) / p.body.length, Math.abs(a[1]) / p.body.width));
    balls.push(...all.slice(0, Math.min(p.balls.count, 2500)));
  }
  const br = Math.max(0.8, (p.balls.diameter / 2) * s);
  return (
    <svg viewBox={`-4 -4 ${W + 8} ${H + 8}`} width={W + 8} height={H + 8} role="img" aria-label="Package top view">
      <rect x={0} y={0} width={W} height={H} rx={2} fill="#3f6b3a" stroke="#24411f" />
      {(bottom || !(p.lid.enabled && f.lid)) && balls.map(([x, y], i) => <circle key={i} cx={W / 2 + x * s} cy={H / 2 - y * s} r={br} fill="#d9c36a" opacity={bottom ? 1 : 0.55} />)}
      {!bottom && p.lid.enabled && f.lid && <rect x={(W - p.lid.length * s) / 2} y={(H - p.lid.width * s) / 2} width={p.lid.length * s} height={p.lid.width * s} fill="#b8c2cf" stroke="#7f8a99" opacity={0.55} />}
      {!bottom && p.dies.map((d) => (
        <rect key={d.id} x={W / 2 + (d.x - d.length / 2) * s} y={H / 2 - (d.y + d.width / 2) * s} width={d.length * s} height={d.width * s} fill="#6f7782" stroke="#30363d" opacity={p.lid.enabled && f.lid ? 0.55 : 1} />
      ))}
    </svg>
  );
}

/** Isometric exploded layer stack (used for the 3D view and material illustration). */
export function PackageIso({ doc, width = 230, highlight }: { doc: ProjectDoc; width?: number; highlight?: string }) {
  const p = doc.package;
  const f = PACKAGE_FEATURES[p.type] ?? PACKAGE_FEATURES.Custom;
  const layers: { key: string; color: string; h: number; scale: number }[] = [];
  if (f.balls) layers.push({ key: 'balls', color: '#9aa1aa', h: 5, scale: 0.98 });
  if (f.substrate) for (let i = 0; i < Math.min(6, Math.ceil(p.substrate.layers / 2)); i++) layers.push({ key: 'substrate', color: i % 2 ? '#c9a227' : '#e5c84a', h: 4, scale: 1 });
  layers.push({ key: 'die', color: '#f08a3c', h: 8, scale: Math.min(...p.dies.map((d) => d.length / p.body.length)) });
  if (p.lid.enabled && f.lid) { layers.push({ key: 'tim', color: '#e8d36a', h: 3, scale: Math.min(...p.dies.map((d) => d.length / p.body.length)) }); layers.push({ key: 'lid', color: '#b8c2cf', h: 7, scale: Math.min(1, p.lid.length / p.body.length) }); }
  if (p.mold.enabled && f.mold && !(p.lid.enabled && f.lid)) layers.push({ key: 'mold', color: '#4a5059', h: 10, scale: 1 });
  const a = width * 0.32;
  let y = width * 0.62;
  const cx = width / 2;
  const iso = (sx: number, sy: number, z: number) => `${cx + (sx - sy) * a * 0.87},${z + (sx + sy) * a * 0.5}`;
  return (
    <svg viewBox={`0 0 ${width} ${width * 0.8}`} className="h-auto w-full" role="img" aria-label="Package 3D view">
      {layers.map((l, i) => {
        const s = l.scale;
        const top = y - l.h;
        const hl = highlight && highlight === l.key;
        const shade = (c: string, k: number) => { const n = parseInt(c.slice(1), 16); const r = Math.round(((n >> 16) & 255) * k), g = Math.round(((n >> 8) & 255) * k), b = Math.round((n & 255) * k); return `rgb(${r},${g},${b})`; };
        const el = (
          <g key={i} opacity={highlight && !hl ? 0.55 : 1}>
            <polygon points={`${iso(s, -s, top)} ${iso(s, s, top)} ${iso(s, s, y)} ${iso(s, -s, y)}`} fill={shade(l.color, 0.75)} />
            <polygon points={`${iso(-s, s, top)} ${iso(s, s, top)} ${iso(s, s, y)} ${iso(-s, s, y)}`} fill={shade(l.color, 0.6)} />
            <polygon points={`${iso(-s, -s, top)} ${iso(s, -s, top)} ${iso(s, s, top)} ${iso(-s, s, top)}`} fill={l.color} stroke={hl ? '#1f6feb' : 'rgba(0,0,0,0.15)'} strokeWidth={hl ? 2 : 0.6} />
          </g>
        );
        y = top - (i < layers.length - 1 && layers[i + 1].key !== l.key ? 2 : 0);
        return el;
      })}
    </svg>
  );
}

/** JEDEC board drawing with dimensions. */
export function BoardDrawing({ doc, width = 290 }: { doc: ProjectDoc; width?: number }) {
  const b = doc.jedec.board, p = doc.package;
  const s = (width - 50) / b.length;
  const W = b.length * s, H = b.width * s;
  const ox = 10, oy = 26;
  const pads = Array.from({ length: 22 }, (_, i) => i);
  return (
    <svg viewBox={`0 0 ${width} ${H + oy + 10}`} className="h-auto w-full" role="img" aria-label="JEDEC board">
      <line x1={ox} y1={10} x2={ox + W} y2={10} stroke="#333" markerStart="url(#a)" markerEnd="url(#a)" />
      <line x1={ox} y1={5} x2={ox} y2={15} stroke="#333" /><line x1={ox + W} y1={5} x2={ox + W} y2={15} stroke="#333" />
      <text x={ox + W / 2} y={8} textAnchor="middle" fontSize="11">{b.length} mm</text>
      <rect x={ox} y={oy} width={W} height={H} fill="#2b7a3f" stroke="#1a4d27" />
      {doc.jedec.boardType !== '1s0p' && <rect x={ox + 4} y={oy + 4} width={W - 8} height={H - 8} fill="none" stroke="#c6a53c" strokeDasharray="3 2" opacity={0.6} />}
      {pads.map((i) => <circle key={`t${i}`} cx={ox + 10 + (i * (W - 20)) / 21} cy={oy + 7} r={1.4} fill="#e6d27a" />)}
      {pads.map((i) => <circle key={`b${i}`} cx={ox + 10 + (i * (W - 20)) / 21} cy={oy + H - 7} r={1.4} fill="#e6d27a" />)}
      {Array.from({ length: 10 }, (_, i) => <line key={i} x1={ox + W / 2 - (p.body.length * s) / 2 - 2 - i * 3} y1={oy + H / 2 - 10 + i * 2.4} x2={ox + 14} y2={oy + 12 + i * 4} stroke="#e6d27a" strokeWidth={0.6} opacity={0.7} />)}
      <rect x={ox + W / 2 - (p.body.length * s) / 2} y={oy + H / 2 - (p.body.width * s) / 2} width={p.body.length * s} height={p.body.width * s} fill="#9aa1aa" stroke="#555" />
      <rect x={ox + W / 2 - (p.dies[0].length * s) / 2} y={oy + H / 2 - (p.dies[0].width * s) / 2} width={p.dies[0].length * s} height={p.dies[0].width * s} fill="#4b5058" />
      <line x1={ox + W + 12} y1={oy} x2={ox + W + 12} y2={oy + H} stroke="#333" />
      <text x={ox + W + 24} y={oy + H / 2} fontSize="11" textAnchor="middle" transform={`rotate(90 ${ox + W + 24} ${oy + H / 2})`}>{b.width} mm</text>
    </svg>
  );
}
