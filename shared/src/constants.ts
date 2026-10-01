import type { Material } from './schema';

/** Starter material library (spec sheet "Material Library") + extra common materials. */
export const MATERIAL_LIBRARY: Material[] = [
  { id: 'mat-silicon', category: 'Semiconductor', name: 'Silicon', kIn: 130, kThrough: 130, cte: 2.6, cp: 700, density: 2330, notes: 'Example default; user/material database should override by temperature if available.', builtin: true },
  { id: 'mat-copper', category: 'Metal', name: 'Copper', kIn: 400, kThrough: 400, cte: 17, cp: 385, density: 8960, notes: 'Typical room-temperature placeholder.', builtin: true },
  { id: 'mat-sac305', category: 'Interconnect', name: 'SAC305', kIn: 50, kThrough: 50, cte: 22, cp: 230, density: 7400, notes: 'Placeholder; verify supplier data.', builtin: true },
  { id: 'mat-abf', category: 'Substrate', name: 'ABF dielectric', kIn: 0.6, kThrough: 0.6, cte: 50, cp: 1000, density: 1800, notes: 'Placeholder; actual properties vary by grade and direction.', builtin: true },
  { id: 'mat-tim-hk', category: 'TIM', name: 'High-k TIM', kIn: 5, kThrough: 5, cte: 50, cp: 1000, density: 2500, notes: 'Example only; user-selectable.', builtin: true },
  { id: 'mat-emc', category: 'Mold', name: 'Epoxy mold compound', kIn: 0.8, kThrough: 0.8, cte: 12, cp: 1000, density: 1900, notes: 'Example only.', builtin: true },
  { id: 'mat-uf', category: 'Underfill', name: 'Epoxy underfill', kIn: 0.7, kThrough: 0.7, cte: 30, cp: 1000, density: 1700, notes: 'Example only.', builtin: true },
  // additional presets
  { id: 'mat-al', category: 'Metal', name: 'Aluminum 6061', kIn: 167, kThrough: 167, cte: 23.6, cp: 896, density: 2700, notes: 'Lid / heat-sink alloy.', builtin: true },
  { id: 'mat-cuw', category: 'Metal', name: 'CuW (10/90)', kIn: 180, kThrough: 180, cte: 6.5, cp: 150, density: 17000, notes: 'Low-CTE heat spreader.', builtin: true },
  { id: 'mat-bt', category: 'Substrate', name: 'BT core', kIn: 0.35, kThrough: 0.35, cte: 15, cp: 1100, density: 1850, notes: 'Bismaleimide-triazine core.', builtin: true },
  { id: 'mat-fr4', category: 'Board', name: 'FR-4', kIn: 0.3, kThrough: 0.3, cte: 16, cp: 1100, density: 1900, notes: 'JEDEC test board dielectric.', builtin: true },
  { id: 'mat-indium', category: 'TIM', name: 'Indium solder TIM', kIn: 80, kThrough: 80, cte: 29, cp: 233, density: 7310, notes: 'Metallic TIM1.', builtin: true },
  { id: 'mat-grease', category: 'TIM', name: 'Thermal grease', kIn: 3, kThrough: 3, cte: 100, cp: 1200, density: 2400, notes: 'Generic grease.', builtin: true },
  { id: 'mat-dieattach', category: 'Interface', name: 'Silver-filled die attach', kIn: 2.5, kThrough: 2.5, cte: 40, cp: 900, density: 3500, notes: 'Wire-bond die attach epoxy.', builtin: true },
  { id: 'mat-alumina', category: 'Substrate', name: 'Alumina (96%)', kIn: 24, kThrough: 24, cte: 7, cp: 880, density: 3720, notes: 'Ceramic substrate.', builtin: true },
  { id: 'mat-air', category: 'Fluid', name: 'Air', kIn: 0.026, kThrough: 0.026, cte: null, cp: 1007, density: 1.16, notes: 'Still air at 25 °C.', builtin: true },
];

export interface JedecTemplate {
  id: string;
  standard: string;
  title: string;
  metric: string;
  environment: string;
  inputs: string[];
  outputs: string[];
  notes: string;
  defaults: Record<string, unknown>;
}

/** Spec sheet "JEDEC Tests". */
export const JEDEC_TEMPLATES: JedecTemplate[] = [
  { id: 'jedec.j51_2a', standard: 'JESD51-2A', title: 'Theta-JA — Still Air', metric: 'Theta-JA', environment: 'Natural convection / still air', inputs: ['Ambient temperature', 'Orientation', 'Board definition', 'Dissipated power'], outputs: ['Tj', 'Ta', 'Theta-JA', 'Temperature map'], notes: 'JEDEC-compliant still-air boundary conditions: 1 ft³ enclosure, natural convection + radiation.', defaults: { airVelocity: 0, enclosure: '304.8 mm cube' } },
  { id: 'jedec.j51_6', standard: 'JESD51-6', title: 'Theta-JA — Moving Air', metric: 'Theta-JA vs airflow', environment: 'Forced convection', inputs: ['Air velocity', 'Flow direction', 'Ambient', 'Board', 'Power'], outputs: ['Tj', 'Ta', 'Theta-JA vs airflow'], notes: 'Supports multiple airflow points / parametric sweep.', defaults: { velocities: [1, 2, 3] } },
  { id: 'jedec.j51_7', standard: 'JESD51-7', title: '1s0p Board', metric: 'Board template', environment: '1 signal layer, 0 power planes', inputs: ['JEDEC board dimensions', 'Copper pattern', 'Package location'], outputs: ['Thermal metrics on 1s0p board'], notes: 'Locked template; editable in expert mode.', defaults: { length: 114.3, width: 76.2, thickness: 1.6 } },
  { id: 'jedec.j51_9', standard: 'JESD51-9', title: '2s2p Board', metric: 'Board template', environment: '2 signal layers, 2 power planes', inputs: ['JEDEC board dimensions', 'Copper pattern', 'Package location'], outputs: ['Thermal metrics on 2s2p board'], notes: 'Locked template; editable in expert mode.', defaults: { length: 114.3, width: 76.2, thickness: 1.6 } },
  { id: 'jedec.j51_8', standard: 'JESD51-8', title: 'Theta-JB', metric: 'Theta-JB', environment: 'Board-referenced (ring cold plate)', inputs: ['Board thermocouple / reference point', 'Package power'], outputs: ['Tj', 'Tb', 'Theta-JB'], notes: 'Board temperature measured on top-side trace 1 mm from package edge at centre of long side.', defaults: {} },
  { id: 'jedec.custom_case', standard: 'Custom / non-JEDEC', title: 'Theta-JC (custom estimate)', metric: 'Theta-JC', environment: 'Custom boundary: cold plate on case top', inputs: ['Case temperature or cold-plate definition'], outputs: ['Estimated / simulation-only Theta-JC'], notes: 'JEDEC has no steady-state Theta-JC spec — reported as simulation estimate only.', defaults: { coldPlateTemp: 25 } },
];

/** JEDEC board layer stacks used to derive effective anisotropic conductivity. */
export const JEDEC_BOARDS = {
  '1s0p': {
    label: '1s0p (Single-layer, JESD51-3/7)',
    layers: [
      { name: 'Top signal Cu (2 oz, ~20% coverage)', thickness: 0.07, k: 400, coverage: 0.2 },
      { name: 'FR-4', thickness: 1.53, k: 0.3, coverage: 1 },
    ],
  },
  '2s2p': {
    label: '2s2p (Multi-layer, JESD51-9)',
    layers: [
      { name: 'Top signal Cu (2 oz, ~20%)', thickness: 0.07, k: 400, coverage: 0.2 },
      { name: 'FR-4', thickness: 0.5, k: 0.3, coverage: 1 },
      { name: 'Power plane Cu (1 oz)', thickness: 0.035, k: 400, coverage: 0.9 },
      { name: 'FR-4', thickness: 0.36, k: 0.3, coverage: 1 },
      { name: 'Ground plane Cu (1 oz)', thickness: 0.035, k: 400, coverage: 0.9 },
      { name: 'FR-4', thickness: 0.5, k: 0.3, coverage: 1 },
      { name: 'Bottom signal Cu (2 oz, ~20%)', thickness: 0.07, k: 400, coverage: 0.2 },
    ],
  },
} as const;

/** Effective anisotropic conductivity of a layered board. */
export function boardEffectiveK(boardType: '1s0p' | '2s2p', thickness?: number) {
  const layers = JEDEC_BOARDS[boardType].layers;
  const t = layers.reduce((s, l) => s + l.thickness, 0);
  const kIn = layers.reduce((s, l) => s + l.thickness * (l.k * l.coverage + 0.3 * (1 - l.coverage)), 0) / t;
  const kThrough = t / layers.reduce((s, l) => s + l.thickness / (l.k * l.coverage + 0.3 * (1 - l.coverage)), 0);
  const scale = thickness ? t / thickness : 1; // copper amount fixed; dilute if thicker board
  return { kIn: kIn * Math.min(1, scale) + (scale < 1 ? 0.3 * (1 - scale) : 0), kThrough };
}

/** Which sub-tabs / features apply to each package family ("Controls available sub-tabs"). */
export const PACKAGE_FEATURES: Record<string, { substrate: boolean; lid: boolean; mold: boolean; balls: boolean; flipChip: boolean; multiDie: boolean; interconnect: string }> = {
  'FC-BGA': { substrate: true, lid: true, mold: false, balls: true, flipChip: true, multiDie: true, interconnect: 'Solder balls' },
  BGA: { substrate: true, lid: false, mold: true, balls: true, flipChip: false, multiDie: true, interconnect: 'Solder balls' },
  LGA: { substrate: true, lid: true, mold: true, balls: false, flipChip: true, multiDie: true, interconnect: 'Lands (LGA pads)' },
  QFN: { substrate: true, lid: false, mold: true, balls: false, flipChip: false, multiDie: false, interconnect: 'Exposed pad + leads' },
  WLCSP: { substrate: false, lid: false, mold: false, balls: true, flipChip: true, multiDie: false, interconnect: 'Wafer-level bumps' },
  SiP: { substrate: true, lid: true, mold: true, balls: true, flipChip: true, multiDie: true, interconnect: 'Solder balls' },
  Chiplet: { substrate: true, lid: true, mold: false, balls: true, flipChip: true, multiDie: true, interconnect: 'Solder balls (C4 + μbumps)' },
  Custom: { substrate: true, lid: true, mold: true, balls: true, flipChip: true, multiDie: true, interconnect: 'User defined' },
};

export const WORKFLOW_STEPS = [
  { step: 1, label: 'Define Package', href: '/package' },
  { step: 2, label: 'Select JEDEC Test', href: '/jedec' },
  { step: 3, label: 'Configure Simulation', href: '/simulation' },
  { step: 4, label: 'Run (AI + CFD)', href: '/run' },
  { step: 5, label: 'Results & Report', href: '/results' },
] as const;
