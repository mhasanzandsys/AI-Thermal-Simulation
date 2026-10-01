import { ProjectDocSchema, type ProjectDoc } from './schema';
import { PACKAGE_FEATURES } from './constants';

export type Severity = 'Error' | 'Warning' | 'Info';
export interface ValidationIssue {
  id: string; // VAL-xxx or SCHEMA
  path: string;
  message: string;
  severity: Severity;
}

export interface ValidationContext {
  /** Theta-JA available from a previous result (enables VAL-008 when source = results) */
  resultThetaJA?: number | null;
  /** validating right before "Run simulation" */
  forRun?: boolean;
}

/** Which BOM keys are physically used by the current package configuration. */
export function activeBomKeys(doc: ProjectDoc): string[] {
  const f = PACKAGE_FEATURES[doc.package.type] ?? PACKAGE_FEATURES.Custom;
  const keys = ['bom.die'];
  if (doc.package.lid.enabled && f.lid) keys.push('bom.tim1', 'bom.lid');
  if (doc.package.underfill.enabled && f.flipChip) keys.push('bom.underfill');
  if (f.substrate) keys.push('bom.substrate.buildUp', 'bom.substrate.copper', 'bom.substrate.core');
  if (f.balls && doc.package.balls.count > 0) keys.push('bom.balls');
  if (doc.package.mold.enabled && f.mold) keys.push('bom.mold');
  return keys;
}

/** Cross-field validation & business rules (spec sheet "Validation Rules"). */
export function validateProject(doc: ProjectDoc, ctx: ValidationContext = {}): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const parsed = ProjectDocSchema.safeParse(doc);
  if (!parsed.success) {
    for (const e of parsed.error.issues) {
      issues.push({ id: 'SCHEMA', path: e.path.join('.'), message: e.message, severity: 'Error' });
    }
  }
  const pkg = doc.package;
  const feat = PACKAGE_FEATURES[pkg.type] ?? PACKAGE_FEATURES.Custom;

  // VAL-001 package dimensions > 0
  const dims = [pkg.body.length, pkg.body.width, pkg.body.height];
  if (dims.some((d) => !(d > 0))) {
    issues.push({ id: 'VAL-001', path: 'package.body', message: 'Package dimensions must be greater than zero.', severity: 'Error' });
  }

  // VAL-002 die must fit in package envelope
  if (!pkg.customStacking) {
    for (const [i, d] of pkg.dies.entries()) {
      const fitsX = Math.abs(d.x) + d.length / 2 <= pkg.body.length / 2 + 1e-9;
      const fitsY = Math.abs(d.y) + d.width / 2 <= pkg.body.width / 2 + 1e-9;
      if (!fitsX || !fitsY) {
        issues.push({ id: 'VAL-002', path: `package.dies.${i}`, message: `Die geometry exceeds available package area (${d.name}).`, severity: 'Error' });
      }
    }
    // overlapping dies
    for (let i = 0; i < pkg.dies.length; i++)
      for (let j = i + 1; j < pkg.dies.length; j++) {
        const a = pkg.dies[i], b = pkg.dies[j];
        const ox = Math.abs(a.x - b.x) < (a.length + b.length) / 2 - 1e-9;
        const oy = Math.abs(a.y - b.y) < (a.width + b.width) / 2 - 1e-9;
        if (ox && oy) issues.push({ id: 'VAL-002', path: `package.dies.${j}`, message: `${a.name} and ${b.name} overlap in XY.`, severity: 'Error' });
      }
  }

  // VAL-003 lid requires TIM thickness + material
  if (pkg.lid.enabled && feat.lid) {
    if (!(pkg.tim.thickness > 0) || !(pkg.tim.k > 0) || !pkg.tim.material) {
      issues.push({ id: 'VAL-003', path: 'package.tim', message: 'Define TIM thickness and material for lid/heat-spreader model.', severity: 'Error' });
    }
    if (!(pkg.lid.length > 0 && pkg.lid.width > 0 && pkg.lid.thickness > 0)) {
      issues.push({ id: 'VAL-003', path: 'package.lid', message: 'Lid X / Y / Z must be > 0 when the lid is enabled.', severity: 'Error' });
    }
    if (pkg.lid.length > pkg.body.length + 1e-9 || pkg.lid.width > pkg.body.width + 1e-9) {
      issues.push({ id: 'VAL-003', path: 'package.lid', message: 'Lid is larger than the package body.', severity: 'Warning' });
    }
  }

  // VAL-004 JESD51-6 requires airflow > 0
  if (doc.jedec.tests.j51_6.enabled || doc.jedec.standard === 'JESD51-6') {
    const v = doc.jedec.tests.j51_6.velocities;
    if (!v.length || v.some((x) => !(x > 0))) {
      issues.push({ id: 'VAL-004', path: 'jedec.tests.j51_6.velocities', message: 'Moving-air characterization requires a non-zero airflow.', severity: 'Error' });
    }
  }
  if (doc.jedec.standard === 'JESD51-6' && !(doc.simulation.airVelocity > 0)) {
    issues.push({ id: 'VAL-004', path: 'simulation.airVelocity', message: 'Moving-air characterization requires a non-zero airflow.', severity: 'Error' });
  }

  // VAL-005 / VAL-006 board template
  const std = { length: 114.3, width: 76.2, thickness: 1.6 };
  const boardIsStd = Math.abs(doc.jedec.board.length - std.length) < 0.05 && Math.abs(doc.jedec.board.width - std.width) < 0.05 && Math.abs(doc.jedec.board.thickness - std.thickness) < 0.05;
  const bigStd = Math.abs(doc.jedec.board.length - 101.6) < 0.05 && Math.abs(doc.jedec.board.width - 114.3) < 0.05;
  if (!doc.jedec.expertOverride) {
    if (doc.jedec.boardType === '1s0p' && !(boardIsStd || bigStd)) issues.push({ id: 'VAL-005', path: 'jedec.board', message: 'Use the JESD51-7 1s0p board or enable expert override.', severity: 'Warning' });
    if (doc.jedec.boardType === '2s2p' && !(boardIsStd || bigStd)) issues.push({ id: 'VAL-006', path: 'jedec.board', message: 'Use the JESD51-9 2s2p board or enable expert override.', severity: 'Warning' });
    if (doc.jedec.boardType === 'custom') issues.push({ id: 'VAL-005', path: 'jedec.boardType', message: 'Custom board is non-JEDEC; enable expert override to suppress this warning.', severity: 'Warning' });
  }
  if (pkg.body.length > doc.jedec.board.length || pkg.body.width > doc.jedec.board.width) {
    issues.push({ id: 'VAL-001', path: 'jedec.board', message: 'Package does not fit on the test board.', severity: 'Error' });
  }

  // VAL-007 Theta-JC requested
  if (doc.jedec.tests.custom_case.enabled || doc.jedec.standard === 'CUSTOM_JC') {
    issues.push({ id: 'VAL-007', path: 'jedec.tests.custom_case', message: 'Steady-state Theta-JC is being reported as a simulation estimate, not a JEDEC steady-state result.', severity: 'Warning' });
  }

  // VAL-008 / VAL-009 leakage
  if (doc.leakage.enabled) {
    const L = doc.leakage;
    const thetaOk = L.thetaJASource === 'manual' ? (L.thetaJA ?? 0) > 0 : true; // 'results': θJA is produced by the run
    if (!(L.voltage > 0) || !thetaOk || L.temperature.length < 2) {
      issues.push({ id: 'VAL-008', path: 'leakage', message: 'Provide V, Theta-JA, and leakage-vs-temperature data.', severity: 'Error' });
    }
    const T = L.temperature, I = L.current;
    const monotonic = T.every((t, i) => i === 0 || t > T[i - 1]);
    if (T.length !== I.length || !monotonic || I.some((x) => !(x >= 0) || !Number.isFinite(x))) {
      issues.push({ id: 'VAL-009', path: 'leakage.temperature', message: 'PTPX leakage data is incomplete or inconsistent.', severity: 'Error' });
    }
  }

  // VAL-010 material completeness
  const keys = activeBomKeys(doc);
  for (const key of keys) {
    const item = doc.bom.find((b) => b.key === key);
    if (!item) {
      issues.push({ id: 'VAL-010', path: `bom.${key}`, message: `BOM entry ${key} is missing. Complete required material properties before running.`, severity: 'Error' });
      continue;
    }
    if (!(item.kIn && item.kIn > 0) || !(item.kThrough && item.kThrough > 0)) {
      issues.push({ id: 'VAL-010', path: `bom.${key}`, message: `${item.component}: thermal conductivity required. Complete required material properties before running.`, severity: 'Error' });
    }
    if (doc.simulation.type === 'transient' && (!(item.density && item.density > 0) || !(item.cp && item.cp > 0))) {
      issues.push({ id: 'VAL-010', path: `bom.${key}`, message: `${item.component}: transient analysis requires density and specific heat.`, severity: 'Error' });
    }
  }

  // other helpful checks
  const diePower = pkg.dies.reduce((s, d) => s + d.power, 0);
  if (!pkg.power.overrideDies && Math.abs(diePower - pkg.power.total) > 1e-6) {
    issues.push({ id: 'INFO-001', path: 'package.power.total', message: `Sum of die powers (${diePower.toFixed(3)} W) differs from total power (${pkg.power.total} W). Die powers will be used.`, severity: 'Info' });
  }
  if (feat.balls && pkg.balls.count > 0 && pkg.balls.pitch > 0) {
    const maxBalls = Math.floor(pkg.body.length / pkg.balls.pitch) * Math.floor(pkg.body.width / pkg.balls.pitch);
    if (pkg.balls.count > maxBalls) issues.push({ id: 'INFO-002', path: 'package.balls.count', message: `Ball count exceeds the ${maxBalls} positions available at ${pkg.balls.pitch} mm pitch.`, severity: 'Warning' });
  }
  if (doc.solver.type !== 'builtin' && !doc.solver.endpoint) {
    issues.push({ id: 'SCHEMA', path: 'solver.endpoint', message: 'Executable / API endpoint is required.', severity: 'Error' });
  }
  if (doc.ai.optimization && !doc.ai.objective) {
    issues.push({ id: 'SCHEMA', path: 'ai.objective', message: 'Optimization objective is required when AI design optimization is enabled.', severity: 'Error' });
  }
  return issues;
}

export const hasBlockingErrors = (issues: ValidationIssue[]) => issues.some((i) => i.severity === 'Error');

/** Parse PTPX / CSV leakage export: columns temperature, current (header optional). */
export function parseLeakageCsv(text: string): { temperature: number[]; current: number[]; errors: string[] } {
  const temperature: number[] = [];
  const current: number[] = [];
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));
  for (const [n, line] of lines.entries()) {
    const cols = line.split(/[,;\t ]+/).filter(Boolean);
    const t = parseFloat(cols[0]);
    const i = parseFloat(cols[cols.length - 1]);
    if (cols.length < 2 || !Number.isFinite(t) || !Number.isFinite(i)) {
      if (n === 0) continue; // header
      errors.push(`Line ${n + 1}: could not parse "${line}"`);
      continue;
    }
    temperature.push(t);
    current.push(i);
  }
  return { temperature, current, errors };
}

/** Parse a power-map CSV (grid of numbers). */
export function parsePowerMapCsv(text: string): { values: number[][]; nx: number; ny: number; errors: string[] } {
  const errors: string[] = [];
  const rows = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split(/[,;\t ]+/).filter(Boolean).map(Number))
    .filter((r) => r.length && r.every((v) => Number.isFinite(v)));
  const nx = rows[0]?.length ?? 0;
  if (!rows.length) errors.push('Power map is empty.');
  if (rows.some((r) => r.length !== nx)) errors.push('Power map rows have inconsistent lengths.');
  if (rows.flat().some((v) => v < 0)) errors.push('Power map contains negative values.');
  return { values: rows, nx, ny: rows.length, errors };
}
