/**
 * Canonical project data model (see spec sheets: Project Fields, Package Definition,
 * BOM & Materials, JEDEC Tests, CFD Integration, Simulation Settings, Leakage & PTPX,
 * Results & Reports, API Data Model).
 *
 * The same Zod schemas validate data in the Next.js front end and the Express back end.
 */
import { z } from 'zod';

// ---------------------------------------------------------------- enums
export const CLASSIFICATIONS = ['Public', 'Internal', 'Confidential', 'Restricted'] as const;
export const PACKAGE_TYPES = ['FC-BGA', 'BGA', 'LGA', 'QFN', 'WLCSP', 'SiP', 'Chiplet', 'Custom'] as const;
export const ORIENTATIONS = ['Horizontal', 'Vertical', 'Custom'] as const;
export const SOLVER_TYPES = ['builtin', 'icepak', 'flotherm', 'starccm', 'fluent', 'custom'] as const;
export const SOLVER_LABELS: Record<(typeof SOLVER_TYPES)[number], string> = {
  builtin: 'Built-in FV Solver',
  icepak: 'Ansys Icepak',
  flotherm: 'Simcenter FloTHERM',
  starccm: 'STAR-CCM+',
  fluent: 'Ansys Mechanical/Fluent',
  custom: 'Custom',
};
export const LICENSE_STATUS = ['Available', 'Busy', 'Missing'] as const;
export const GEOMETRY_FORMATS = ['STEP', 'Parasolid', 'STL', 'native'] as const;
export const SIMULATION_TYPES = ['steady_state', 'transient', 'parametric_sweep', 'optimization'] as const;
export const SIMULATION_TYPE_LABELS: Record<(typeof SIMULATION_TYPES)[number], string> = {
  steady_state: 'Steady State Thermal',
  transient: 'Transient Thermal',
  parametric_sweep: 'Parametric Sweep',
  optimization: 'AI Optimization (Design Suggestion)',
};
export const MESH_MODES = ['automatic', 'ai_optimized', 'manual'] as const;
export const MESH_DENSITIES = ['coarse', 'medium', 'fine'] as const;
export const AI_OBJECTIVES = ['min_tj', 'min_theta_ja', 'min_mass', 'multi_objective'] as const;
export const AI_OBJECTIVE_LABELS: Record<(typeof AI_OBJECTIVES)[number], string> = {
  min_tj: 'Minimize Tj',
  min_theta_ja: 'Minimize Theta-JA',
  min_mass: 'Minimize mass',
  multi_objective: 'Multi-objective',
};
export const JEDEC_STANDARDS = ['JESD51-2A', 'JESD51-6', 'JESD51-8', 'CUSTOM_JC'] as const;
export const BOARD_TYPES = ['1s0p', '2s2p', 'custom'] as const;
export const SWEEP_PARAMETERS = ['power', 'airVelocity', 'timK', 'ambientTemp', 'lidThickness'] as const;
export const REPORT_FORMATS = ['PDF', 'XLSX', 'JSON', 'CSV'] as const;
export const SUBSTRATE_TYPES = ['ABF build-up', 'BT laminate', 'Ceramic (LTCC)', 'Leadframe (Cu)', 'Silicon interposer', 'Custom'] as const;
export const REFINEMENT_AREAS = ['die', 'tim', 'balls', 'vias', 'hotspots'] as const;

// ---------------------------------------------------------------- primitives
const pos = (msg = 'Must be greater than 0') => z.number({ message: 'Required number' }).gt(0, msg);
const nonneg = (msg = 'Must be ≥ 0') => z.number({ message: 'Required number' }).gte(0, msg);

export const FileRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().optional(),
  mime: z.string().optional(),
});
export type FileRef = z.infer<typeof FileRefSchema>;

// ---------------------------------------------------------------- project
export const ProjectInfoSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1, 'Project name is required').max(100, 'Max 100 characters'),
  description: z.string().max(1000, 'Max 1000 characters').default(''),
  customer: z.string().max(100, 'Max 100 characters').default(''),
  deviceId: z.string().trim().min(1, 'Device / part number is required'),
  revision: z.string().trim().min(1, 'Revision is required').regex(/^[A-Za-z0-9._-]+$/, 'Alphanumeric only'),
  owner: z.string().trim().min(1, 'Owner is required'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid date required (YYYY-MM-DD)'),
  classification: z.enum(CLASSIFICATIONS),
});
export type ProjectInfo = z.infer<typeof ProjectInfoSchema>;

// ---------------------------------------------------------------- package
export const PowerMapSchema = z.object({
  file: FileRefSchema.optional(),
  nx: z.number().int().positive(),
  ny: z.number().int().positive(),
  /** row-major [ny][nx] relative weights or watts; normalised to die power when applied */
  values: z.array(z.array(z.number().nonnegative())),
});
export type PowerMap = z.infer<typeof PowerMapSchema>;

export const DieSchema = z.object({
  id: z.string(),
  name: z.string().default('Die'),
  length: pos('Die X must be > 0'),
  width: pos('Die Y must be > 0'),
  thickness: pos('Die thickness must be > 0'),
  power: nonneg('Die power must be ≥ 0'),
  /** centre offset from package centre (mm) */
  x: z.number().default(0),
  y: z.number().default(0),
  material: z.string().default('Silicon'),
  powerMap: PowerMapSchema.optional().nullable(),
});
export type Die = z.infer<typeof DieSchema>;

export const PackageSchema = z.object({
  type: z.enum(PACKAGE_TYPES),
  body: z.object({ length: pos('Body length must be > 0'), width: pos('Body width must be > 0'), height: pos('Body height must be > 0') }),
  power: z.object({
    total: nonneg('Total power must be ≥ 0'),
    /** when true the total power overrides per-die powers (scaled proportionally) */
    overrideDies: z.boolean().default(false),
  }),
  node: z.string().default('7'),
  orientation: z.enum(ORIENTATIONS),
  files: z.object({ drawing: FileRefSchema.nullable().optional(), model3d: FileRefSchema.nullable().optional() }).default({}),
  dies: z.array(DieSchema).min(1, 'At least one die is required'),
  customStacking: z.boolean().default(false),
  substrate: z.object({
    type: z.enum(SUBSTRATE_TYPES),
    layers: z.number().int().min(1),
    thickness: pos('Substrate thickness must be > 0'),
    kIn: pos(),
    kThrough: pos(),
    cte: z.number().default(15),
    thermalVias: z.boolean().default(false),
  }),
  lid: z.object({
    enabled: z.boolean(),
    length: z.number(),
    width: z.number(),
    thickness: z.number(),
    material: z.string().default('Copper'),
  }),
  tim: z.object({ thickness: z.number(), k: z.number(), material: z.string().default('High-k TIM') }),
  underfill: z.object({ enabled: z.boolean(), standoff: z.number().default(0.08), material: z.string().default('Epoxy underfill') }),
  mold: z.object({ enabled: z.boolean(), material: z.string().default('Epoxy mold compound') }),
  balls: z.object({
    count: z.number().int().nonnegative().default(0),
    pitch: z.number().default(1.0),
    diameter: z.number().default(0.6),
    height: z.number().default(0.45),
    material: z.string().default('SAC305'),
  }),
});
export type Package = z.infer<typeof PackageSchema>;

// ---------------------------------------------------------------- BOM / materials
export const MaterialSchema = z.object({
  id: z.string(),
  category: z.string(),
  name: z.string().min(1),
  kIn: z.number().nullable(),
  kThrough: z.number().nullable(),
  cte: z.number().nullable(),
  cp: z.number().nullable(),
  density: z.number().nullable(),
  notes: z.string().default(''),
  builtin: z.boolean().default(false),
});
export type Material = z.infer<typeof MaterialSchema>;

export const BomItemSchema = z.object({
  id: z.string(),
  category: z.string(),
  component: z.string(),
  key: z.string(),
  material: z.string().default(''),
  supplier: z.string().default(''),
  thickness: z.number().nullable().default(null),
  kIn: z.number().nullable().default(null),
  kThrough: z.number().nullable().default(null),
  cte: z.number().nullable().default(null),
  cp: z.number().nullable().default(null),
  density: z.number().nullable().default(null),
  notes: z.string().default(''),
  optional: z.boolean().default(false),
  included: z.boolean().default(true),
});
export type BomItem = z.infer<typeof BomItemSchema>;

// ---------------------------------------------------------------- JEDEC
export const JedecSchema = z.object({
  /** primary characterization standard (API Data Model jedec.standard) */
  standard: z.enum(JEDEC_STANDARDS),
  tests: z.object({
    j51_2a: z.object({ enabled: z.boolean() }),
    j51_6: z.object({ enabled: z.boolean(), velocities: z.array(z.number()), flowDirection: z.enum(['+X', '-X', '+Y', '-Y']).default('+X') }),
    j51_8: z.object({ enabled: z.boolean() }),
    custom_case: z.object({ enabled: z.boolean(), coldPlateTemp: z.number().default(25), contactH: z.number().default(10000) }),
  }),
  boardType: z.enum(BOARD_TYPES),
  board: z.object({ length: pos('Board length must be > 0'), width: pos('Board width must be > 0'), thickness: pos('Board thickness must be > 0') }),
  /** custom board effective conductivity (used when boardType = custom or expert override) */
  boardK: z.object({ kIn: z.number().default(0.3), kThrough: z.number().default(0.3) }).default({ kIn: 0.3, kThrough: 0.3 }),
  expertOverride: z.boolean().default(false),
  useStandardBC: z.boolean().default(true),
});
export type Jedec = z.infer<typeof JedecSchema>;

// ---------------------------------------------------------------- solver
export const SolverSchema = z.object({
  type: z.enum(SOLVER_TYPES),
  version: z.string().default(''),
  endpoint: z.string().default(''),
  licenseStatus: z.enum(LICENSE_STATUS).default('Available'),
  geometryFormat: z.enum(GEOMETRY_FORMATS),
  meshExport: z.boolean().default(false),
  remote: z.object({ enabled: z.boolean(), host: z.string().default('') }),
  jobId: z.string().default(''),
});
export type Solver = z.infer<typeof SolverSchema>;

// ---------------------------------------------------------------- simulation + AI
export const SimulationSchema = z.object({
  type: z.enum(SIMULATION_TYPES),
  ambientTemp: z.number().min(-40, 'Ambient must be ≥ -40 °C').max(150, 'Ambient must be ≤ 150 °C'),
  airVelocity: nonneg('Air velocity must be ≥ 0'),
  mesh: z.object({
    mode: z.enum(MESH_MODES),
    density: z.enum(MESH_DENSITIES).default('medium'),
    target: z.number().positive().nullable().default(null),
    refinement: z.array(z.object({ area: z.enum(REFINEMENT_AREAS), size: z.number().positive() })).default([]),
  }),
  convergence: z.object({ energy: pos('Energy residual must be > 0'), maxIter: z.number().int().positive('Max iterations must be > 0') }),
  includeDetailedGeometry: z.boolean().default(true),
  useSymmetry: z.boolean().default(false),
  includeRadiation: z.boolean().default(true),
  transient: z.object({ duration: pos(), timeStep: pos() }),
  sweep: z.object({ parameter: z.enum(SWEEP_PARAMETERS), start: z.number(), end: z.number(), steps: z.number().int().min(2).max(25) }),
});
export type Simulation = z.infer<typeof SimulationSchema>;

export const AiSchema = z.object({
  preAnalysis: z.boolean(),
  optimization: z.boolean(),
  objective: z.enum(AI_OBJECTIVES),
  recommendImprovements: z.boolean().default(true),
  predictHotspots: z.boolean().default(true),
});
export type Ai = z.infer<typeof AiSchema>;

// ---------------------------------------------------------------- leakage
export const LeakageSchema = z.object({
  enabled: z.boolean(),
  voltage: z.number(),
  power: z.number(),
  powerRange: z.object({ min: z.number(), max: z.number() }),
  temperature: z.array(z.number()),
  current: z.array(z.number()),
  thetaJASource: z.enum(['results', 'manual']).default('results'),
  thetaJA: z.number().nullable().default(null),
  fitModel: z.enum(['exponential', 'polynomial2']).default('exponential'),
});
export type Leakage = z.infer<typeof LeakageSchema>;

// ---------------------------------------------------------------- reports
export const ReportConfigSchema = z.object({
  format: z.enum(REPORT_FORMATS),
  sections: z.object({
    packageBom: z.boolean(),
    jedecSetup: z.boolean(),
    cfdModel: z.boolean(),
    thermalPlots: z.boolean(),
    aiRecommendations: z.boolean(),
    compliance: z.boolean(),
  }),
});
export type ReportConfig = z.infer<typeof ReportConfigSchema>;

// ---------------------------------------------------------------- full document
export const ProjectDocSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  project: ProjectInfoSchema,
  package: PackageSchema,
  bom: z.array(BomItemSchema),
  jedec: JedecSchema,
  solver: SolverSchema,
  simulation: SimulationSchema,
  ai: AiSchema,
  leakage: LeakageSchema,
  reports: ReportConfigSchema,
  updatedAt: z.string().optional(),
  createdAt: z.string().optional(),
});
export type ProjectDoc = z.infer<typeof ProjectDocSchema>;

// ---------------------------------------------------------------- results
export interface FieldMap {
  /** cell-centre coordinates (mm) */
  x: number[];
  y: number[];
  /** [ny][nx] temperatures °C */
  T: (number | null)[][];
  min: number;
  max: number;
  label: string;
}
export interface Hotspot {
  rank: number;
  x: number;
  y: number;
  z: number;
  temp: number;
  location: string;
}
export interface ComplianceRow {
  standard: string;
  metric: string;
  setup: string;
  solver: string;
  status: 'Pass' | 'Warning' | 'Fail';
  deviations: string[];
}
export interface Recommendation {
  rank: number;
  title: string;
  detail: string;
  deltaTj: number | null;
  deltaTheta: number | null;
  category: 'TIM' | 'Lid' | 'Board' | 'Airflow' | 'Power' | 'Substrate' | 'Geometry' | 'Leakage';
  confidence: 'High' | 'Medium' | 'Low';
}
export interface HeatFlowSplit {
  topConvection: number;
  packageSides: number;
  intoBoard: number;
  boardConvection: number;
  dieToLid: number;
  dieToSubstrate: number;
}
export interface LeakageResult {
  fit: { model: string; a: number; b: number; c?: number; r2: number; expression: string };
  derivativeAtTj: number;
  threshold: number;
  thetaJA: number;
  tjOperating: number;
  margin: number;
  status: 'Stable' | 'Marginal' | 'Unstable';
  curve: { t: number; measured: number | null; fit: number; derivative: number }[];
  electrothermal: { iteration: number; tj: number; power: number }[];
  runawayTemp: number | null;
  messages: string[];
}
export interface PreAnalysis {
  estimatedTj: number;
  estimatedThetaJA: number;
  predictedHotspot: { x: number; y: number; die: string };
  dominantPath: string;
  resistanceNetwork: { name: string; r: number }[];
  meshRecommendation: { cells: number; density: string; refinements: string[] };
  notes: string[];
}
export interface ThermalResults {
  jobId: string;
  projectId: string;
  createdAt: string;
  solver: string;
  simulationType: string;
  standard: string;
  ambientTemp: number;
  power: number;
  tjMax: number;
  tjLocation: { x: number; y: number; z: number; die: string };
  tc: number;
  tb: number;
  thetaJA: number;
  thetaJAStill: number | null;
  thetaJAMoving: { velocity: number; thetaJA: number; tj: number }[];
  thetaJB: number | null;
  thetaJC: number | null;
  psiJT: number;
  psiJB: number;
  heatFlowSplit: HeatFlowSplit;
  hotspots: Hotspot[];
  jedecCompliance: ComplianceRow[];
  aiRecommendations: Recommendation[];
  preAnalysis: PreAnalysis | null;
  fields: { dieTop: FieldMap; packageTop: FieldMap; boardTop: FieldMap; crossSection: FieldMap };
  convergence: { iteration: number; residual: number }[];
  transient: { t: number; tj: number; tc: number }[] | null;
  sweep: { parameter: string; points: { x: number; tj: number; thetaJA: number }[] } | null;
  optimization: { objective: string; baseline: number; best: number; candidates: { label: string; params: Record<string, number>; tj: number; thetaJA: number; mass: number }[] } | null;
  leakage: LeakageResult | null;
  mesh: { nx: number; ny: number; nz: number; cells: number };
  warnings: string[];
  elapsedMs: number;
}

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export interface JobInfo {
  id: string;
  projectId: string;
  status: JobStatus;
  progress: number;
  stage: string;
  createdAt: string;
  finishedAt: string | null;
  error: string | null;
  solver: string;
}
