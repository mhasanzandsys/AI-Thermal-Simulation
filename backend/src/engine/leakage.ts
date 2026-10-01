/**
 * Leakage-current / thermal-runaway analysis (spec sheet "Leakage & PTPX").
 * Instability criterion: dI_leak/dT >= 1 / (V × Theta-JA).
 */
import type { Leakage, LeakageResult } from '@ats/shared';

export interface LeakageInput {
  leakage: Leakage;
  thetaJA: number;
  ambient: number;
  /** operating Tj from simulation, if available */
  tjOperating?: number | null;
}

function lstsq(X: number[][], y: number[]) {
  const n = X[0].length;
  const A = Array.from({ length: n }, () => new Array(n).fill(0));
  const b = new Array(n).fill(0);
  for (let r = 0; r < X.length; r++)
    for (let i = 0; i < n; i++) {
      b[i] += X[r][i] * y[r];
      for (let j = 0; j < n; j++) A[i][j] += X[r][i] * X[r][j];
    }
  return solveLinear(A, b);
}

export function solveLinear(A: number[][], b: number[]) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / (r[i] || 1e-12));
}

export function fitLeakage(T: number[], I: number[], model: 'exponential' | 'polynomial2') {
  if (model === 'exponential' && I.every((v) => v > 0)) {
    const [lnA, b] = lstsq(T.map((t) => [1, t]), I.map(Math.log));
    const a = Math.exp(lnA);
    const f = (t: number) => a * Math.exp(b * t);
    const df = (t: number) => a * b * Math.exp(b * t);
    const ly = I.map(Math.log), mean = ly.reduce((s, v) => s + v, 0) / ly.length;
    const ssr = ly.reduce((s, v, i) => s + (v - Math.log(f(T[i]))) ** 2, 0);
    const sst = ly.reduce((s, v) => s + (v - mean) ** 2, 0) || 1;
    return { model: 'exponential', a, b, r2: 1 - ssr / sst, f, df, expression: `I_leak(T) = ${a.toExponential(3)} · exp(${b.toFixed(5)} · T)` };
  }
  const [c0, c1, c2] = lstsq(T.map((t) => [1, t, t * t]), I);
  const f = (t: number) => c0 + c1 * t + c2 * t * t;
  const df = (t: number) => c1 + 2 * c2 * t;
  const mean = I.reduce((s, v) => s + v, 0) / I.length;
  const ssr = I.reduce((s, v, i) => s + (v - f(T[i])) ** 2, 0);
  const sst = I.reduce((s, v) => s + (v - mean) ** 2, 0) || 1;
  return { model: 'polynomial2', a: c0, b: c1, c: c2, r2: 1 - ssr / sst, f, df, expression: `I_leak(T) = ${c0.toExponential(3)} + ${c1.toExponential(3)}·T + ${c2.toExponential(3)}·T²` };
}

export function analyzeLeakage(inp: LeakageInput): LeakageResult {
  const { leakage: L, thetaJA, ambient } = inp;
  const V = L.voltage;
  const fit = fitLeakage(L.temperature, L.current, L.fitModel);
  const threshold = 1 / (V * thetaJA);
  const messages: string[] = [];
  const P0 = L.power;
  const tjNominal = inp.tjOperating ?? ambient + thetaJA * P0;
  // dynamic power = nominal power minus leakage power at nominal Tj
  const leakAtNominal = V * fit.f(tjNominal);
  const inconsistent = leakAtNominal >= P0;
  const pDyn = Math.max(0, P0 - leakAtNominal);

  const iterate = (pd: number) => {
    const hist: { iteration: number; tj: number; power: number }[] = [];
    let T = ambient;
    for (let i = 0; i < 60; i++) {
      const P = pd + V * Math.max(0, fit.f(T));
      const Tn = ambient + thetaJA * P;
      hist.push({ iteration: i, tj: +Tn.toFixed(3), power: +P.toFixed(5) });
      if (!Number.isFinite(Tn) || Tn > 400) return { hist, converged: false, tj: Tn };
      if (Math.abs(Tn - T) < 1e-4) return { hist, converged: true, tj: Tn };
      T = Tn;
    }
    return { hist, converged: false, tj: T };
  };
  const et = iterate(pDyn);
  const tjOp = et.converged ? et.tj : tjNominal;
  const deriv = fit.df(tjOp);
  let status: LeakageResult['status'] = deriv >= threshold || !et.converged || inconsistent ? 'Unstable' : deriv >= 0.7 * threshold ? 'Marginal' : 'Stable';

  // runaway temperature where V·θ·dI/dT = 1
  let runawayTemp: number | null = null;
  for (let t = ambient; t <= 400; t += 0.25) {
    if (fit.df(t) >= threshold) { runawayTemp = +t.toFixed(2); break; }
  }
  if (inconsistent) messages.push(`Leakage power at Tj ≈ ${tjNominal.toFixed(0)} °C (${leakAtNominal.toExponential(2)} W) exceeds the operating power — no stable operating point.`);
  if (!et.converged) messages.push('Electrothermal iteration diverged — thermal runaway predicted at this operating point.');
  messages.push(`Fit ${fit.model}, R² = ${fit.r2.toFixed(4)}${fit.r2 < 0.95 ? ' (poor fit — check PTPX data)' : ''}.`);
  if (runawayTemp != null) messages.push(`Criterion dI/dT ≥ 1/(V·θJA) is reached at T ≈ ${runawayTemp} °C.`);
  else messages.push('Criterion is not reached below 400 °C.');

  // max stable power by bisection over the user power range
  const stableAt = (pd: number) => { const r = iterate(pd); return r.converged && fit.df(r.tj) < threshold; };
  let lo = L.powerRange.min, hi = L.powerRange.max;
  if (hi > lo && !stableAt(lo)) messages.push(`Unstable even at the minimum power ${lo} W.`);
  else if (hi > lo) {
    if (stableAt(hi)) messages.push(`Stable over the full dynamic-power range ${lo}–${hi} W.`);
    else {
      for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (stableAt(m)) lo = m; else hi = m; }
      messages.push(`Maximum stable dynamic power ≈ ${lo.toFixed(2)} W (θJA = ${thetaJA.toFixed(2)} °C/W).`);
    }
  }
  if (status === 'Marginal') messages.push('Derivative is within 30 % of the instability threshold — design margin is low.');

  const tMin = Math.min(...L.temperature, ambient), tMax = Math.max(...L.temperature, tjOp) + 25;
  const curve: LeakageResult['curve'] = [];
  const step = (tMax - tMin) / 40;
  for (let t = tMin; t <= tMax + 1e-9; t += step) curve.push({ t: +t.toFixed(2), measured: null, fit: fit.f(t), derivative: fit.df(t) });
  L.temperature.forEach((t, i) => curve.push({ t, measured: L.current[i], fit: fit.f(t), derivative: fit.df(t) }));
  curve.sort((a, b) => a.t - b.t);

  return {
    fit: { model: fit.model, a: fit.a, b: fit.b, c: (fit as { c?: number }).c, r2: fit.r2, expression: fit.expression },
    derivativeAtTj: deriv,
    threshold,
    thetaJA,
    tjOperating: +tjOp.toFixed(2),
    margin: +(1 - deriv / threshold).toFixed(4),
    status,
    curve,
    electrothermal: et.hist,
    runawayTemp,
    messages,
  };
}
