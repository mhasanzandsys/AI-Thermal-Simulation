/**
 * Converts the canonical project document into a list of axis-aligned solid blocks
 * (the "CAD" model of the package on its JEDEC test board).
 *
 * Coordinate system (mm): origin at board top surface, package centred at (0,0),
 * z positive upward. Board occupies z ∈ [-tb, 0].
 */
import { PACKAGE_FEATURES, boardEffectiveK, type ProjectDoc, type BomItem } from '@ats/shared';

export type Role = 'board' | 'interconnect' | 'substrate' | 'attach' | 'die' | 'tim' | 'lid' | 'mold' | 'air' | 'via';

export interface Block {
  name: string;
  role: Role;
  x0: number; x1: number; y0: number; y1: number; z0: number; z1: number;
  kx: number; ky: number; kz: number;
  rho: number; cp: number;
  emissivity: number;
  /** index into doc.package.dies for die blocks */
  dieIndex?: number;
  /** power (W) dissipated in this block */
  power?: number;
}

export interface Model {
  blocks: Block[];
  board: { L: number; W: number; t: number; kIn: number; kThrough: number };
  pkg: { L: number; W: number; zTop: number; zSubTop: number; zDieBot: number; zDieTop: number; hasLid: boolean; hasMold: boolean };
  dies: { index: number; name: string; x0: number; x1: number; y0: number; y1: number; z0: number; z1: number; power: number; activeBottom: boolean; powerMap: number[][] | null }[];
  totalPower: number;
  warnings: string[];
  massGrams: number;
}

const AIR = { k: 0.026, rho: 1.16, cp: 1007 };

function bomProps(doc: ProjectDoc, key: string, fallback: { k: number; rho: number; cp: number }) {
  const b: BomItem | undefined = doc.bom.find((x) => x.key === key);
  return {
    kIn: b?.kIn && b.kIn > 0 ? b.kIn : fallback.k,
    kThrough: b?.kThrough && b.kThrough > 0 ? b.kThrough : fallback.k,
    rho: b?.density && b.density > 0 ? b.density : fallback.rho,
    cp: b?.cp && b.cp > 0 ? b.cp : fallback.cp,
  };
}

export interface ModelOverrides {
  power?: number;
  timK?: number;
  lidThickness?: number;
  thermalVias?: boolean;
  boardType?: '1s0p' | '2s2p';
  lidEnabled?: boolean;
  uniformPower?: boolean;
  ballCountScale?: number;
  lidMaterial?: { k: number; rho: number; cp: number };
}

export function buildModel(doc: ProjectDoc, ov: ModelOverrides = {}): Model {
  const warnings: string[] = [];
  const pkg = doc.package;
  const feat = PACKAGE_FEATURES[pkg.type] ?? PACKAGE_FEATURES.Custom;
  const blocks: Block[] = [];
  const L = pkg.body.length, W = pkg.body.width;
  const hx = L / 2, hy = W / 2;

  // ---------------- board
  const bt = doc.jedec.board.thickness;
  const boardType = ov.boardType ?? doc.jedec.boardType;
  const bk = boardType === 'custom' ? { kIn: doc.jedec.boardK.kIn, kThrough: doc.jedec.boardK.kThrough } : boardEffectiveK(boardType, bt);
  const board = { L: doc.jedec.board.length, W: doc.jedec.board.width, t: bt, kIn: bk.kIn, kThrough: bk.kThrough };
  blocks.push({ name: `JEDEC ${boardType} board`, role: 'board', x0: -board.L / 2, x1: board.L / 2, y0: -board.W / 2, y1: board.W / 2, z0: -bt, z1: 0, kx: bk.kIn, ky: bk.kIn, kz: bk.kThrough, rho: 1900, cp: 1100, emissivity: 0.9 });

  // ---------------- interconnect layer
  let z = 0;
  const ball = bomProps(doc, 'bom.balls', { k: 50, rho: 7400, cp: 230 });
  if (pkg.type === 'QFN') {
    const h = 0.05;
    const d0 = pkg.dies[0];
    const padL = Math.min(L - 1, (d0?.length ?? L / 2) + 1), padW = Math.min(W - 1, (d0?.width ?? W / 2) + 1);
    blocks.push({ name: 'Perimeter leads (effective)', role: 'interconnect', x0: -hx, x1: hx, y0: -hy, y1: hy, z0: 0, z1: h, kx: 0.3 * ball.kIn * 0.3, ky: 0.3 * ball.kIn * 0.3, kz: 0.3 * ball.kIn + 0.7 * AIR.k, rho: ball.rho * 0.3, cp: ball.cp, emissivity: 0.9 });
    blocks.push({ name: 'Exposed pad solder', role: 'interconnect', x0: -padL / 2, x1: padL / 2, y0: -padW / 2, y1: padW / 2, z0: 0, z1: h, kx: ball.kIn, ky: ball.kIn, kz: ball.kThrough, rho: ball.rho, cp: ball.cp, emissivity: 0.9 });
    z = h;
  } else if (pkg.type === 'LGA') {
    const h = 0.05, f = 0.45;
    blocks.push({ name: 'LGA lands (effective)', role: 'interconnect', x0: -hx, x1: hx, y0: -hy, y1: hy, z0: 0, z1: h, kx: f * ball.kIn * 0.3, ky: f * ball.kIn * 0.3, kz: f * ball.kThrough + (1 - f) * AIR.k, rho: ball.rho * f, cp: ball.cp, emissivity: 0.9 });
    z = h;
  } else if (feat.balls) {
    const h = pkg.balls.height > 0 ? pkg.balls.height : 0.4;
    const count = Math.max(0, pkg.balls.count * (ov.ballCountScale ?? 1));
    // ball array footprint: full body for BGA, die size for WLCSP
    const area = L * W;
    const ballArea = count * Math.PI * (pkg.balls.diameter * 0.8) ** 2 / 4; // neck diameter ~0.8 D
    const f = Math.min(0.6, ballArea / area);
    if (count === 0) warnings.push('No solder balls defined — package-to-board conduction path is air only.');
    blocks.push({ name: `Solder balls ×${Math.round(count)} (effective, ${(f * 100).toFixed(1)}% area)`, role: 'interconnect', x0: -hx, x1: hx, y0: -hy, y1: hy, z0: 0, z1: h, kx: AIR.k + f * 0.5, ky: AIR.k + f * 0.5, kz: f * ball.kThrough + (1 - f) * AIR.k, rho: ball.rho * f + AIR.rho, cp: ball.cp, emissivity: 0.9 });
    z = h;
  }

  // ---------------- substrate
  const zSubBot = z;
  if (feat.substrate) {
    const s = pkg.substrate;
    const bu = bomProps(doc, 'bom.substrate.buildUp', { k: 0.6, rho: 1800, cp: 1000 });
    const cu = bomProps(doc, 'bom.substrate.copper', { k: 400, rho: 8960, cp: 385 });
    const rho = 0.75 * bu.rho + 0.25 * cu.rho, cp = 0.75 * bu.cp + 0.25 * cu.cp;
    blocks.push({ name: `${s.type} substrate (${s.layers}L)`, role: 'substrate', x0: -hx, x1: hx, y0: -hy, y1: hy, z0: z, z1: z + s.thickness, kx: s.kIn, ky: s.kIn, kz: s.kThrough, rho, cp, emissivity: 0.9 });
    const vias = ov.thermalVias ?? s.thermalVias;
    if (vias) {
      for (const d of pkg.dies) {
        blocks.push({ name: `Thermal via field under ${d.name}`, role: 'via', x0: d.x - d.length / 2, x1: d.x + d.length / 2, y0: d.y - d.width / 2, y1: d.y + d.width / 2, z0: z, z1: z + s.thickness, kx: s.kIn, ky: s.kIn, kz: s.kThrough + 0.04 * cu.kThrough, rho, cp, emissivity: 0.9 });
      }
    }
    z += s.thickness;
  }
  const zSubTop = z;

  // ---------------- die attach / bumps + underfill
  const dieMat = bomProps(doc, 'bom.die', { k: 130, rho: 2330, cp: 700 });
  const uf = bomProps(doc, 'bom.underfill', { k: 0.7, rho: 1700, cp: 1000 });
  let attachH = 0;
  if (feat.substrate) {
    if (feat.flipChip) {
      attachH = pkg.underfill.standoff > 0 ? pkg.underfill.standoff : 0.06;
      const fb = 0.12; // bump area fraction
      const kFill = pkg.underfill.enabled ? uf.kIn : AIR.k;
      for (const d of pkg.dies) {
        blocks.push({ name: `C4 bumps + ${pkg.underfill.enabled ? 'underfill' : 'air'} (${d.name})`, role: 'attach', x0: d.x - d.length / 2, x1: d.x + d.length / 2, y0: d.y - d.width / 2, y1: d.y + d.width / 2, z0: z, z1: z + attachH, kx: kFill, ky: kFill, kz: fb * ball.kThrough + (1 - fb) * kFill, rho: uf.rho, cp: uf.cp, emissivity: 0.9 });
      }
    } else {
      attachH = 0.025;
      for (const d of pkg.dies) {
        blocks.push({ name: `Die attach (${d.name})`, role: 'attach', x0: d.x - d.length / 2, x1: d.x + d.length / 2, y0: d.y - d.width / 2, y1: d.y + d.width / 2, z0: z, z1: z + attachH, kx: 2.5, ky: 2.5, kz: 2.5, rho: 3500, cp: 900, emissivity: 0.9 });
      }
    }
  }
  const zDieBot = z + attachH;

  // ---------------- dies
  const diePowers = pkg.dies.map((d) => d.power);
  const sum = diePowers.reduce((a, b) => a + b, 0);
  let targetTotal = pkg.power.overrideDies ? pkg.power.total : sum;
  if (ov.power != null) targetTotal = ov.power;
  const scale = sum > 0 ? targetTotal / sum : 0;
  const dies: Model['dies'] = [];
  let zDieTop = zDieBot;
  pkg.dies.forEach((d, i) => {
    const p = sum > 0 ? d.power * scale : targetTotal / pkg.dies.length;
    const b: Block = { name: d.name, role: 'die', x0: d.x - d.length / 2, x1: d.x + d.length / 2, y0: d.y - d.width / 2, y1: d.y + d.width / 2, z0: zDieBot, z1: zDieBot + d.thickness, kx: dieMat.kIn, ky: dieMat.kIn, kz: dieMat.kThrough, rho: dieMat.rho, cp: dieMat.cp, emissivity: 0.6, dieIndex: i, power: p };
    blocks.push(b);
    zDieTop = Math.max(zDieTop, b.z1);
    const pm = !ov.uniformPower && d.powerMap && d.powerMap.values?.length ? d.powerMap.values : null;
    dies.push({ index: i, name: d.name, x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1, z0: b.z0, z1: b.z1, power: p, activeBottom: feat.flipChip, powerMap: pm });
  });

  // ---------------- lid / TIM or mold
  const hasLid = (ov.lidEnabled ?? pkg.lid.enabled) && (feat.lid || ov.lidEnabled === true);
  let hasMold = pkg.mold.enabled && feat.mold && !hasLid;
  let zTop = zDieTop;
  if (hasLid) {
    const timK = ov.timK ?? pkg.tim.k;
    const timT = pkg.tim.thickness > 0 ? pkg.tim.thickness : 0.05;
    const timB = bomProps(doc, 'bom.tim1', { k: timK, rho: 2500, cp: 1000 });
    for (const d of dies) {
      blocks.push({ name: `TIM1 (${pkg.dies[d.index].name})`, role: 'tim', x0: d.x0, x1: d.x1, y0: d.y0, y1: d.y1, z0: d.z1, z1: zDieTop + timT, kx: timK, ky: timK, kz: timK, rho: timB.rho, cp: timB.cp, emissivity: 0.9 });
    }
    const lm = ov.lidMaterial ?? (() => { const l = bomProps(doc, 'bom.lid', { k: 400, rho: 8960, cp: 385 }); return { k: l.kIn, rho: l.rho, cp: l.cp }; })();
    const lidT = ov.lidThickness ?? (pkg.lid.thickness > 0 ? pkg.lid.thickness : 0.5);
    const lL = Math.min(pkg.lid.length > 0 ? pkg.lid.length : L, L), lW = Math.min(pkg.lid.width > 0 ? pkg.lid.width : W, W);
    const zLidBot = zDieTop + timT;
    // cavity air (inside lid) then lid foot ring + top plate
    blocks.push({ name: 'Lid cavity air', role: 'air', x0: -lL / 2, x1: lL / 2, y0: -lW / 2, y1: lW / 2, z0: zSubTop, z1: zLidBot, kx: AIR.k, ky: AIR.k, kz: AIR.k, rho: AIR.rho, cp: AIR.cp, emissivity: 0 });
    // re-add die/attach/TIM blocks so they override cavity air (order matters)
    for (const b of blocks.filter((b) => b.role === 'attach' || b.role === 'die' || b.role === 'tim')) blocks.push({ ...b });
    const foot = Math.min(1.5, lL * 0.1, lW * 0.1);
    const ring = [
      [-lL / 2, -lL / 2 + foot, -lW / 2, lW / 2],
      [lL / 2 - foot, lL / 2, -lW / 2, lW / 2],
      [-lL / 2 + foot, lL / 2 - foot, -lW / 2, -lW / 2 + foot],
      [-lL / 2 + foot, lL / 2 - foot, lW / 2 - foot, lW / 2],
    ];
    for (const [x0, x1, y0, y1] of ring) blocks.push({ name: 'Lid foot / seal ring', role: 'lid', x0, x1, y0, y1, z0: zSubTop, z1: zLidBot, kx: lm.k, ky: lm.k, kz: lm.k, rho: lm.rho, cp: lm.cp, emissivity: 0.3 });
    blocks.push({ name: 'Heat spreader / lid', role: 'lid', x0: -lL / 2, x1: lL / 2, y0: -lW / 2, y1: lW / 2, z0: zLidBot, z1: zLidBot + lidT, kx: lm.k, ky: lm.k, kz: lm.k, rho: lm.rho, cp: lm.cp, emissivity: 0.3 });
    zTop = zLidBot + lidT;
    const expected = zSubBot + pkg.body.height;
    if (Math.abs(zTop - zSubBot - pkg.body.height) > 0.1 * pkg.body.height + 0.05) {
      warnings.push(`Stack-up height (${(zTop - zSubBot).toFixed(2)} mm) differs from body height (${pkg.body.height} mm); geometry uses the stack-up. Expected top ${expected.toFixed(2)} mm.`);
    }
  } else if (hasMold) {
    const m = bomProps(doc, 'bom.mold', { k: 0.8, rho: 1900, cp: 1000 });
    let top = zSubBot + pkg.body.height;
    if (top <= zDieTop + 0.05) {
      warnings.push('Mold cap is thinner than the die stack; raised to die top + 0.1 mm.');
      top = zDieTop + 0.1;
    }
    blocks.push({ name: 'Mold compound', role: 'mold', x0: -hx, x1: hx, y0: -hy, y1: hy, z0: zSubTop, z1: top, kx: m.kIn, ky: m.kIn, kz: m.kThrough, rho: m.rho, cp: m.cp, emissivity: 0.9 });
    for (const b of blocks.filter((b) => b.role === 'attach' || b.role === 'die')) blocks.push({ ...b });
    zTop = top;
  } else {
    hasMold = false;
    if (feat.flipChip && pkg.underfill.enabled && feat.substrate) {
      // underfill fillet around dies
      for (const d of dies) blocks.push({ name: 'Underfill fillet', role: 'attach', x0: d.x0 - 0.3, x1: d.x1 + 0.3, y0: d.y0 - 0.3, y1: d.y1 + 0.3, z0: zSubTop, z1: zDieBot + 0.2 * (d.z1 - d.z0), kx: uf.kIn, ky: uf.kIn, kz: uf.kThrough, rho: uf.rho, cp: uf.cp, emissivity: 0.9 });
      for (const b of blocks.filter((b) => b.role === 'attach' && b.name !== 'Underfill fillet' || b.role === 'die')) blocks.push({ ...b });
    }
  }

  // WLCSP: package == die; die sits directly on bumps
  if (!feat.substrate && dies.length) {
    // nothing extra
  }

  // mass (g)
  let mass = 0;
  for (const b of blocks) {
    if (b.role === 'board' || b.role === 'air') continue;
    mass += (b.x1 - b.x0) * (b.y1 - b.y0) * (b.z1 - b.z0) * 1e-9 * b.rho * 1000;
  }
  // duplicates (override blocks) are counted twice for die/attach/tim — correct approx by halving dup volume
  const dupMass = blocks.filter((b, i) => blocks.findIndex((c) => c.name === b.name && c.z0 === b.z0 && c.x0 === b.x0) !== i)
    .reduce((s, b) => s + (b.x1 - b.x0) * (b.y1 - b.y0) * (b.z1 - b.z0) * 1e-9 * b.rho * 1000, 0);
  mass -= dupMass;

  return {
    blocks,
    board,
    pkg: { L, W, zTop, zSubTop, zDieBot, zDieTop, hasLid, hasMold },
    dies,
    totalPower: dies.reduce((s, d) => s + d.power, 0),
    warnings,
    massGrams: mass,
  };
}
