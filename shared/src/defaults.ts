import type { BomItem, Die, ProjectDoc } from './schema';

export const uid = (prefix = '') =>
  prefix + Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

export const today = () => new Date().toISOString().slice(0, 10);

export function defaultDie(i = 0, over: Partial<Die> = {}): Die {
  return { id: uid('die-'), name: `Die ${i + 1}`, length: 10, width: 10, thickness: 0.775, power: 15, x: 0, y: 0, material: 'Silicon', powerMap: null, ...over };
}

/** BOM rows from spec sheet "BOM & Materials". */
export function defaultBom(): BomItem[] {
  const row = (category: string, component: string, key: string, material: string, notes = '', optional = false, props: Partial<BomItem> = {}): BomItem => ({
    id: uid('bom-'), category, component, key, material, supplier: '', thickness: null, kIn: null, kThrough: null, cte: null, cp: null, density: null, notes, optional, included: !optional, ...props,
  });
  return [
    row('Semiconductor', 'Die', 'bom.die', 'Silicon', 'Assign to die solid body', false, { kIn: 130, kThrough: 130, cte: 2.6, cp: 700, density: 2330 }),
    row('Interface', 'TIM1', 'bom.tim1', 'High-k TIM', 'Between die and lid/heat spreader', false, { kIn: 5, kThrough: 5, cte: 50, cp: 1000, density: 2500 }),
    row('Package', 'Heat Spreader / Lid', 'bom.lid', 'Copper', '', false, { kIn: 400, kThrough: 400, cte: 17, cp: 385, density: 8960 }),
    row('Package', 'Underfill', 'bom.underfill', 'Epoxy underfill', '', false, { kIn: 0.7, kThrough: 0.7, cte: 30, cp: 1000, density: 1700 }),
    row('Substrate', 'Build-up dielectric', 'bom.substrate.buildUp', 'ABF dielectric', 'Layered material', false, { kIn: 0.6, kThrough: 0.6, cte: 50, cp: 1000, density: 1800 }),
    row('Substrate', 'Copper layers', 'bom.substrate.copper', 'Copper', 'Layered material', false, { kIn: 400, kThrough: 400, cte: 17, cp: 385, density: 8960 }),
    row('Substrate', 'Core', 'bom.substrate.core', 'BT core', '', false, { kIn: 0.35, kThrough: 0.35, cte: 15, cp: 1100, density: 1850 }),
    row('Interconnect', 'Solder Balls', 'bom.balls', 'SAC305', '', false, { kIn: 50, kThrough: 50, cte: 22, cp: 230, density: 7400 }),
    row('Package', 'Mold Compound', 'bom.mold', 'Epoxy mold compound', 'Optional', true, { kIn: 0.8, kThrough: 0.8, cte: 12, cp: 1000, density: 1900 }),
    row('Mechanical', 'Stiffener', 'bom.stiffener', 'Copper', 'Optional', true, { kIn: 400, kThrough: 400, cte: 17, cp: 385, density: 8960 }),
  ];
}

/** New project using the "Default" column of the spec. */
export function defaultProject(over: { name?: string; deviceId?: string; owner?: string } = {}): ProjectDoc {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    project: { id: '', name: over.name ?? 'New Thermal Study', description: '', customer: '', deviceId: over.deviceId ?? 'DEVICE-001', revision: 'A0', owner: over.owner ?? 'Engineer', date: today(), classification: 'Confidential' },
    package: {
      type: 'FC-BGA',
      body: { length: 50, width: 50, height: 2.5 },
      power: { total: 15, overrideDies: false },
      node: '7',
      orientation: 'Horizontal',
      files: { drawing: null, model3d: null },
      dies: [defaultDie(0, { length: 20, width: 20 })],
      customStacking: false,
      substrate: { type: 'ABF build-up', layers: 12, thickness: 1.2, kIn: 20, kThrough: 0.8, cte: 15, thermalVias: false },
      lid: { enabled: true, length: 46, width: 46, thickness: 0.4, material: 'Copper' },
      tim: { thickness: 0.1, k: 5, material: 'High-k TIM' },
      underfill: { enabled: true, standoff: 0.08, material: 'Epoxy underfill' },
      mold: { enabled: false, material: 'Epoxy mold compound' },
      balls: { count: 2209, pitch: 1.0, diameter: 0.6, height: 0.45, material: 'SAC305' },
    },
    bom: defaultBom(),
    jedec: {
      standard: 'JESD51-2A',
      tests: {
        j51_2a: { enabled: true },
        j51_6: { enabled: false, velocities: [1, 2, 3], flowDirection: '+X' },
        j51_8: { enabled: true },
        custom_case: { enabled: true, coldPlateTemp: 25, contactH: 10000 },
      },
      boardType: '2s2p',
      board: { length: 114.3, width: 76.2, thickness: 1.6 },
      boardK: { kIn: 0.3, kThrough: 0.3 },
      expertOverride: false,
      useStandardBC: true,
    },
    solver: { type: 'builtin', version: '1.0', endpoint: 'local://builtin', licenseStatus: 'Available', geometryFormat: 'STEP', meshExport: false, remote: { enabled: false, host: '' }, jobId: '' },
    simulation: {
      type: 'steady_state',
      ambientTemp: 25,
      airVelocity: 0,
      mesh: { mode: 'ai_optimized', density: 'medium', target: null, refinement: [] },
      convergence: { energy: 1e-6, maxIter: 1000 },
      includeDetailedGeometry: true,
      useSymmetry: false,
      includeRadiation: true,
      transient: { duration: 60, timeStep: 1 },
      sweep: { parameter: 'power', start: 5, end: 25, steps: 5 },
    },
    ai: { preAnalysis: true, optimization: false, objective: 'min_tj', recommendImprovements: true, predictHotspots: true },
    leakage: {
      enabled: false, voltage: 0.8, power: 15, powerRange: { min: 0.1, max: 20 },
      temperature: [], current: [], thetaJASource: 'results', thetaJA: null, fitModel: 'exponential',
    },
    reports: { format: 'PDF', sections: { packageBom: true, jedecSetup: true, cfdModel: true, thermalPlots: true, aiRecommendations: true, compliance: true } },
    createdAt: now,
    updatedAt: now,
  };
}

/** Demo project reproducing the GUI mockup ("NDP120B1 Thermal Study"). */
export function demoProject(): ProjectDoc {
  const p = defaultProject({ name: 'NDP120B1 Thermal Study', deviceId: 'NDP120B1', owner: 'Thermal Team' });
  p.project.description = 'FC-BGA package thermal analysis per JEDEC standards';
  p.project.customer = 'Syntiant';
  p.project.revision = 'A1';
  p.package.body = { length: 15, width: 15, height: 1.6 };
  p.package.power.total = 2;
  p.package.dies = [defaultDie(0, { name: 'NDP120 core', length: 6, width: 6, thickness: 0.25, power: 2,
    powerMap: { nx: 4, ny: 4, values: [[1, 1, 1, 1], [1, 3, 2, 1], [1, 2, 2, 1], [1, 1, 1, 1]] } })];
  p.package.substrate = { type: 'ABF build-up', layers: 12, thickness: 0.8, kIn: 20, kThrough: 0.8, cte: 15, thermalVias: false };
  p.package.lid = { enabled: true, length: 14, width: 14, thickness: 0.45, material: 'Copper' };
  p.package.tim = { thickness: 0.05, k: 5, material: 'High-k TIM' };
  p.package.underfill = { enabled: true, standoff: 0.05, material: 'Epoxy underfill' };
  p.package.balls = { count: 196, pitch: 1.0, diameter: 0.5, height: 0.4, material: 'SAC305' };
  p.jedec.boardType = '1s0p';
  p.jedec.tests.j51_6 = { enabled: true, velocities: [1, 2, 3], flowDirection: '+X' };
  p.leakage = {
    enabled: true, voltage: 0.8, power: 2, powerRange: { min: 0.1, max: 20 },
    temperature: [25, 50, 75, 100, 125],
    current: [0.05, 0.12, 0.29, 0.7, 1.66],
    thetaJASource: 'results', thetaJA: null, fitModel: 'exponential',
  };
  return p;
}
