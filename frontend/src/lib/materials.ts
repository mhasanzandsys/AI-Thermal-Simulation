import type { Draft } from 'immer';
import type { Material, ProjectDoc } from '@ats/shared';

export function applyMaterial(d: ProjectDoc | Draft<ProjectDoc>, key: string, m: Material) {
  const row = d.bom.find((b) => b.key === key);
  if (row) Object.assign(row, { material: m.name, kIn: m.kIn, kThrough: m.kThrough, cte: m.cte, cp: m.cp, density: m.density });
  if (key === 'bom.tim1' && m.kThrough) { d.package.tim.k = m.kThrough; d.package.tim.material = m.name; }
  if (key === 'bom.lid') d.package.lid.material = m.name;
  if (key === 'bom.underfill') d.package.underfill.material = m.name;
  if (key === 'bom.mold') d.package.mold.material = m.name;
  if (key === 'bom.balls') d.package.balls.material = m.name;
}

