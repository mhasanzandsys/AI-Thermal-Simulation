/** Report generation (spec: ReportBuilder — PDF / XLSX / JSON / CSV). */
import PDFDocument from 'pdfkit';
import ExcelJS from 'exceljs';
import { SOLVER_LABELS, SIMULATION_TYPE_LABELS, validateProject, type FieldMap, type ProjectDoc, type ReportConfig, type ThermalResults } from '@ats/shared';

type Sections = ReportConfig['sections'];

const winAnsi = (s: string) => s.replace(/θ/g, 'Theta-').replace(/Δ/g, 'd').replace(/→/g, '->').replace(/≥/g, '>=').replace(/≤/g, '<=').replace(/Ψ|ψ/g, 'Psi-').replace(/³/g, '3').replace(/≈/g, '~').replace(/[^\x00-\xFF•–—…]/g, '?');

const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');

export function jetColor(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t));
  const r = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 3)));
  const g = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 2)));
  const b = Math.max(0, Math.min(1, 1.5 - Math.abs(4 * x - 1)));
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

function metricRows(r: ThermalResults): [string, string, string][] {
  const rows: [string, string, string][] = [
    ['Maximum junction temperature (Tj,max)', r.tjMax.toFixed(2), '°C'],
    ['Tj location', `${r.tjLocation.die} (${r.tjLocation.x}, ${r.tjLocation.y}, ${r.tjLocation.z}) mm`, ''],
    ['Case temperature (Tc)', r.tc.toFixed(2), '°C'],
    ['Board temperature (Tb)', r.tb.toFixed(2), '°C'],
    ['Theta-JA (operating condition)', r.thetaJA.toFixed(3), '°C/W'],
  ];
  if (r.thetaJAStill != null) rows.push(['Theta-JA still air (JESD51-2A)', r.thetaJAStill.toFixed(3), '°C/W']);
  for (const m of r.thetaJAMoving) rows.push([`Theta-JA moving air ${m.velocity} m/s (JESD51-6)`, m.thetaJA.toFixed(3), '°C/W']);
  if (r.thetaJB != null) rows.push(['Theta-JB (JESD51-8)', r.thetaJB.toFixed(3), '°C/W']);
  if (r.thetaJC != null) rows.push(['Theta-JC (custom estimate, non-JEDEC)', r.thetaJC.toFixed(3), '°C/W']);
  rows.push(['Psi-JT', r.psiJT.toFixed(3), '°C/W'], ['Psi-JB', r.psiJB.toFixed(3), '°C/W'], ['Dissipated power', r.power.toFixed(3), 'W'], ['Ambient temperature', r.ambientTemp.toFixed(1), '°C']);
  return rows;
}

// ------------------------------------------------------------------ PDF
export function buildPdf(doc: ProjectDoc, r: ThermalResults, s: Sections): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: `${doc.project.name} — Thermal Report`, Author: doc.project.owner } });
    const chunks: Buffer[] = [];
    pdf.on('data', (c) => chunks.push(c));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
    // Standard PDF fonts use WinAnsi encoding: map symbols that are not representable.
    const origText = pdf.text.bind(pdf) as (...a: unknown[]) => PDFKit.PDFDocument;
    (pdf as unknown as { text: (...a: unknown[]) => PDFKit.PDFDocument }).text = (t: unknown, ...rest: unknown[]) => origText(typeof t === 'string' ? winAnsi(t) : t, ...rest);
    const W = pdf.page.width - 96;
    const navy = '#0f2747', accent = '#1f6feb';

    const h1 = (t: string) => { ensure(60); pdf.moveDown(0.6).font('Helvetica-Bold').fontSize(14).fillColor(navy).text(t); pdf.moveTo(48, pdf.y + 2).lineTo(48 + W, pdf.y + 2).strokeColor(accent).lineWidth(1).stroke(); pdf.moveDown(0.5).font('Helvetica').fontSize(9.5).fillColor('#222'); };
    const ensure = (h: number) => { if (pdf.y + h > pdf.page.height - 60) pdf.addPage(); };
    const table = (rows: (string | number)[][], widths: number[], header?: string[]) => {
      const all = header ? [header, ...rows] : rows;
      all.forEach((row, ri) => {
        const hgt = Math.max(...row.map((c, i) => pdf.heightOfString(String(c), { width: widths[i] - 8 }))) + 6;
        ensure(hgt);
        const y = pdf.y;
        if (header && ri === 0) pdf.rect(48, y, W, hgt).fill('#e8eef7');
        else if (ri % 2 === 0) pdf.rect(48, y, W, hgt).fill('#f7f9fc');
        let x = 48;
        row.forEach((c, i) => {
          pdf.fillColor('#222').font(header && ri === 0 ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).text(String(c), x + 4, y + 3, { width: widths[i] - 8 });
          x += widths[i];
        });
        pdf.y = y + hgt;
        pdf.x = 48;
      });
      pdf.moveDown(0.4);
    };
    const kv = (rows: [string, string][]) => table(rows, [W * 0.38, W * 0.62]);

    // cover
    pdf.rect(0, 0, pdf.page.width, 110).fill(navy);
    pdf.fillColor('white').font('Helvetica-Bold').fontSize(22).text('AI Thermal Simulator', 48, 32);
    pdf.font('Helvetica').fontSize(11).text('Semiconductor Package Thermal Analysis (JEDEC Compliant)', 48, 62);
    pdf.fontSize(9).text(`${doc.project.classification.toUpperCase()}`, 48, 82);
    pdf.y = 130; pdf.x = 48;
    pdf.fillColor(navy).font('Helvetica-Bold').fontSize(16).text(doc.project.name);
    pdf.font('Helvetica').fontSize(10).fillColor('#444').text(doc.project.description || '');
    pdf.moveDown(0.5);
    kv([
      ['Project ID', doc.project.id], ['Device / Part Number', doc.project.deviceId], ['Customer', doc.project.customer || '—'],
      ['Revision', doc.project.revision], ['Owner', doc.project.owner], ['Date', doc.project.date],
      ['Job ID', r.jobId], ['Solver', r.solver], ['Analysis', r.simulationType], ['Generated', new Date().toISOString().replace('T', ' ').slice(0, 19)],
    ]);

    h1('Executive Summary');
    table(metricRows(r), [W * 0.55, W * 0.3, W * 0.15], ['Parameter', 'Value', 'Units']);
    if (r.thetaJC != null) pdf.fontSize(8.5).fillColor('#a15c00').text('Note: Theta-JC is a simulation estimate. JEDEC has no steady-state Theta-JC specification (VAL-007).').fillColor('#222').fontSize(9.5);

    if (s.packageBom) {
      h1('Package Definition & BOM');
      const p = doc.package;
      kv([
        ['Package type', p.type], ['Body (L × W × H)', `${p.body.length} × ${p.body.width} × ${p.body.height} mm`], ['Total power', `${p.power.total} W`],
        ['Technology node', `${p.node} nm`], ['Orientation', p.orientation],
        ['Dies', p.dies.map((d) => `${d.name}: ${d.length}×${d.width}×${d.thickness} mm, ${d.power} W @ (${d.x}, ${d.y})${d.powerMap ? ', power map' : ''}`).join('\n')],
        ['Substrate', `${p.substrate.type}, ${p.substrate.layers} layers, ${p.substrate.thickness} mm, k_in ${p.substrate.kIn} / k_z ${p.substrate.kThrough} W/m-K${p.substrate.thermalVias ? ', thermal vias' : ''}`],
        ['Lid / heat spreader', p.lid.enabled ? `${p.lid.length} × ${p.lid.width} × ${p.lid.thickness} mm (${p.lid.material})` : 'None'],
        ['TIM1', p.lid.enabled ? `${p.tim.thickness} mm, k = ${p.tim.k} W/m-K (${p.tim.material})` : '—'],
        ['Underfill', p.underfill.enabled ? `Yes (standoff ${p.underfill.standoff} mm)` : 'No'],
        ['Solder balls', `${p.balls.count} × Ø${p.balls.diameter} mm @ ${p.balls.pitch} mm pitch`],
      ]);
      table(doc.bom.filter((b) => b.included).map((b) => [b.component, b.material, b.kIn ?? '—', b.kThrough ?? '—', b.cte ?? '—', b.cp ?? '—', b.density ?? '—']),
        [W * 0.2, W * 0.2, W * 0.12, W * 0.12, W * 0.12, W * 0.12, W * 0.12], ['Component', 'Material', 'k in-plane', 'k through', 'CTE', 'Cp', 'Density']);
    }
    if (s.jedecSetup) {
      h1('JEDEC Test Setup');
      const j = doc.jedec;
      kv([
        ['Primary standard', j.standard], ['Board', `${j.boardType} — ${j.board.length} × ${j.board.width} × ${j.board.thickness} mm`],
        ['Enabled tests', [j.tests.j51_2a.enabled && 'JESD51-2A', j.tests.j51_6.enabled && `JESD51-6 (${j.tests.j51_6.velocities.join(', ')} m/s)`, j.tests.j51_8.enabled && 'JESD51-8', j.tests.custom_case.enabled && 'Custom θJC'].filter(Boolean).join(', ')],
        ['Ambient', `${doc.simulation.ambientTemp} °C`], ['Standard JEDEC BCs', j.useStandardBC ? 'Yes' : 'No'], ['Expert override', j.expertOverride ? 'Yes' : 'No'],
      ]);
    }
    if (s.cfdModel) {
      h1('CFD Model & Mesh');
      kv([
        ['CFD tool', SOLVER_LABELS[doc.solver.type]], ['Executed by', r.solver], ['Simulation type', SIMULATION_TYPE_LABELS[doc.simulation.type]],
        ['Mesh mode', `${doc.simulation.mesh.mode} / ${doc.simulation.mesh.density}`], ['Mesh', `${r.mesh.nx} × ${r.mesh.ny} × ${r.mesh.nz} = ${r.mesh.cells.toLocaleString()} cells`],
        ['Convergence', `energy residual ${doc.simulation.convergence.energy}, max ${doc.simulation.convergence.maxIter} iterations`],
        ['Radiation', doc.simulation.includeRadiation ? 'Included' : 'Excluded'], ['Elapsed', `${(r.elapsedMs / 1000).toFixed(1)} s`],
      ]);
      const issues = validateProject(doc).filter((i) => i.severity !== 'Info');
      const assumptions = [...new Set([...r.warnings, ...issues.map((i) => `${i.id}: ${i.message}`)])];
      if (assumptions.length) { pdf.font('Helvetica-Bold').text('Assumptions & warnings'); pdf.font('Helvetica'); assumptions.forEach((a) => pdf.text('• ' + a)); }
    }
    if (s.thermalPlots) {
      ensure(260);
      h1('Thermal Plots');
      const drawMap = (f: FieldMap, title: string) => {
        ensure(230);
        const x0 = 48;
        pdf.font('Helvetica-Bold').fontSize(9.5).text(title, x0, pdf.y);
        const y0 = pdf.y + 6;
        const spanX = f.x[f.x.length - 1] - f.x[0] || 1, spanY = f.y[f.y.length - 1] - f.y[0] || 1;
        const size = 190, sx = size / Math.max(spanX, spanY), w = spanX * sx, h = spanY * sx;
        const edges = (a: number[]) => a.map((v, i) => (i === 0 ? v - (a[1] - a[0]) / 2 : (a[i - 1] + v) / 2)).concat([a[a.length - 1] + (a[a.length - 1] - a[a.length - 2] || 0) / 2]);
        const ex = edges(f.x), ey = edges(f.y);
        for (let j = 0; j < f.y.length; j++) for (let i = 0; i < f.x.length; i++) {
          const v = f.T[j][i];
          if (v == null) continue;
          const [cr, cg, cb] = jetColor((v - f.min) / (f.max - f.min || 1));
          pdf.rect(x0 + (ex[i] - ex[0]) * sx, y0 + h - (ey[j + 1] - ey[0]) * sx, (ex[i + 1] - ex[i]) * sx + 0.3, (ey[j + 1] - ey[j]) * sx + 0.3).fill(hex(cr, cg, cb));
        }
        // legend
        for (let k = 0; k < 50; k++) { const [cr, cg, cb] = jetColor(k / 49); pdf.rect(x0 + w + 16, y0 + h - (k + 1) * (h / 50), 10, h / 50 + 0.3).fill(hex(cr, cg, cb)); }
        pdf.fillColor('#222').font('Helvetica').fontSize(8).text(`${f.max.toFixed(1)} °C`, x0 + w + 30, y0 - 3).text(`${f.min.toFixed(1)} °C`, x0 + w + 30, y0 + h - 8);
        pdf.y = y0 + h + 10; pdf.x = 48;
      };
      drawMap(r.fields.dieTop, 'Die junction temperature map');
      drawMap(r.fields.packageTop, 'Package top-surface temperature');
      pdf.fontSize(9.5);
      kv([
        ['Heat path split', `Top convection ${r.heatFlowSplit.topConvection}% · Package sides ${r.heatFlowSplit.packageSides}% · Into board ${r.heatFlowSplit.intoBoard}%`],
        ['Die heat split', `Die→lid/top ${r.heatFlowSplit.dieToLid}% · Die→substrate ${r.heatFlowSplit.dieToSubstrate}%`],
      ]);
      if (r.hotspots.length) table(r.hotspots.map((h) => [h.rank, h.location, h.x, h.y, h.z, h.temp]), [W * 0.08, W * 0.32, W * 0.15, W * 0.15, W * 0.15, W * 0.15], ['#', 'Location', 'x (mm)', 'y (mm)', 'z (mm)', 'T (°C)']);
      if (r.thetaJAMoving.length) table(r.thetaJAMoving.map((m) => [m.velocity, m.thetaJA, m.tj]), [W / 3, W / 3, W / 3], ['Air velocity (m/s)', 'θJA (°C/W)', 'Tj (°C)']);
      if (r.sweep) table(r.sweep.points.map((p) => [p.x, p.tj, p.thetaJA]), [W / 3, W / 3, W / 3], [`Sweep: ${r.sweep.parameter}`, 'Tj (°C)', 'θJA (°C/W)']);
      if (r.transient) table(r.transient.filter((_, i, a) => i % Math.ceil(a.length / 12) === 0 || i === a.length - 1).map((p) => [p.t, p.tj, p.tc]), [W / 3, W / 3, W / 3], ['Time (s)', 'Tj (°C)', 'Tc (°C)']);
      if (r.leakage) {
        kv([
          ['Leakage fit', r.leakage.fit.expression], ['dI/dT at Tj', `${r.leakage.derivativeAtTj.toExponential(3)} A/°C`],
          ['Threshold 1/(V·θJA)', `${r.leakage.threshold.toExponential(3)} A/°C`], ['Stability', r.leakage.status], ['Notes', r.leakage.messages.join('\n')],
        ]);
      }
    }
    if (s.aiRecommendations && (r.aiRecommendations.length || r.optimization || r.preAnalysis)) {
      h1('AI Recommendations');
      if (r.preAnalysis) pdf.text(`Pre-analysis estimate: Tj ≈ ${r.preAnalysis.estimatedTj} °C, θJA ≈ ${r.preAnalysis.estimatedThetaJA} °C/W; ${r.preAnalysis.dominantPath}.`).moveDown(0.3);
      if (r.aiRecommendations.length) table(r.aiRecommendations.map((a) => [a.rank, a.title, a.deltaTj ?? '—', a.confidence]), [W * 0.07, W * 0.63, W * 0.15, W * 0.15], ['#', 'Recommendation', 'ΔTj (°C)', 'Confidence']);
      if (r.optimization) {
        pdf.text(`Optimization objective: ${r.optimization.objective} — baseline ${r.optimization.baseline} → best ${r.optimization.best}`);
        const best = r.optimization.candidates[r.optimization.candidates.length - 1];
        pdf.text('Optimum parameters: ' + Object.entries(best.params).map(([k, v]) => `${k} = ${v}`).join(', '));
      }
    }
    if (s.compliance) {
      h1('JEDEC Compliance Summary');
      table(r.jedecCompliance.map((c) => [c.standard, c.metric, c.setup, c.status, c.deviations.join('; ') || '—']), [W * 0.16, W * 0.2, W * 0.32, W * 0.1, W * 0.22], ['Standard', 'Metric', 'Setup', 'Status', 'Deviations']);
    }
    const range = pdf.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      pdf.switchToPage(i);
      pdf.page.margins.bottom = 0;
      pdf.fontSize(7.5).fillColor('#888').text(`${doc.project.name} · ${doc.project.id} · Rev ${doc.project.revision} · ${doc.project.classification} · Page ${i + 1}/${range.count}`, 48, pdf.page.height - 36, { width: W, align: 'center', lineBreak: false });
    }
    pdf.end();
  });
}

// ------------------------------------------------------------------ XLSX
export async function buildXlsx(doc: ProjectDoc, r: ThermalResults, s: Sections): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AI Thermal Simulator';
  const header = (ws: ExcelJS.Worksheet) => { ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F2747' } }; };
  const sum = wb.addWorksheet('Summary');
  sum.columns = [{ header: 'Parameter', width: 46 }, { header: 'Value', width: 36 }, { header: 'Units', width: 10 }];
  sum.addRows([['Project', doc.project.name, ''], ['Project ID', doc.project.id, ''], ['Device', doc.project.deviceId, ''], ['Job ID', r.jobId, ''], ['Solver', r.solver, ''], ...metricRows(r)]);
  header(sum);
  if (s.packageBom) {
    const ws = wb.addWorksheet('BOM');
    ws.columns = ['Category', 'Component', 'State Key', 'Material', 'Supplier', 'Thickness (mm)', 'k In-plane', 'k Through', 'CTE', 'Cp', 'Density', 'Notes'].map((h) => ({ header: h, width: 16 }));
    doc.bom.forEach((b) => ws.addRow([b.category, b.component, b.key, b.material, b.supplier, b.thickness, b.kIn, b.kThrough, b.cte, b.cp, b.density, b.notes]));
    header(ws);
    const pk = wb.addWorksheet('Package');
    pk.columns = [{ header: 'Field', width: 32 }, { header: 'Value', width: 60 }];
    const flat = (o: unknown, pre = ''): [string, string][] => (o && typeof o === 'object' && !Array.isArray(o) ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => flat(v, pre ? `${pre}.${k}` : k)) : [[pre, Array.isArray(o) ? JSON.stringify(o) : String(o)]]);
    pk.addRows(flat(doc.package, 'package'));
    header(pk);
  }
  if (s.jedecSetup || s.compliance) {
    const ws = wb.addWorksheet('JEDEC');
    ws.columns = ['Standard', 'Metric', 'Setup', 'Solver', 'Status', 'Deviations'].map((h, i) => ({ header: h, width: [18, 30, 50, 28, 10, 50][i] }));
    r.jedecCompliance.forEach((c) => ws.addRow([c.standard, c.metric, c.setup, c.solver, c.status, c.deviations.join('; ')]));
    header(ws);
    if (r.thetaJAMoving.length) { ws.addRow([]); ws.addRow(['Air velocity (m/s)', 'θJA (°C/W)', 'Tj (°C)']).font = { bold: true }; r.thetaJAMoving.forEach((m) => ws.addRow([m.velocity, m.thetaJA, m.tj])); }
  }
  if (s.thermalPlots) {
    const hs = wb.addWorksheet('Hotspots');
    hs.columns = ['Rank', 'Location', 'x (mm)', 'y (mm)', 'z (mm)', 'T (°C)'].map((h) => ({ header: h, width: 14 }));
    r.hotspots.forEach((h) => hs.addRow([h.rank, h.location, h.x, h.y, h.z, h.temp]));
    header(hs);
    const map = wb.addWorksheet('Die Map');
    map.addRow(['y \\ x (mm)', ...r.fields.dieTop.x]);
    [...r.fields.dieTop.y].map((y, j) => [y, ...r.fields.dieTop.T[j]]).reverse().forEach((row) => map.addRow(row));
    map.getRow(1).font = { bold: true };
    if (r.sweep) { const ws = wb.addWorksheet('Sweep'); ws.addRow([r.sweep.parameter, 'Tj (°C)', 'θJA (°C/W)']); r.sweep.points.forEach((p) => ws.addRow([p.x, p.tj, p.thetaJA])); header(ws); }
    if (r.transient) { const ws = wb.addWorksheet('Transient'); ws.addRow(['Time (s)', 'Tj (°C)', 'Tc (°C)']); r.transient.forEach((p) => ws.addRow([p.t, p.tj, p.tc])); header(ws); }
    if (r.leakage) { const ws = wb.addWorksheet('Leakage'); ws.addRow(['T (°C)', 'Measured I (A)', 'Fit I (A)', 'dI/dT (A/°C)']); r.leakage.curve.forEach((p) => ws.addRow([p.t, p.measured, p.fit, p.derivative])); header(ws); }
    const cv = wb.addWorksheet('Convergence'); cv.addRow(['Iteration', 'Residual']); r.convergence.forEach((c) => cv.addRow([c.iteration, c.residual])); header(cv);
  }
  if (s.aiRecommendations) {
    const ws = wb.addWorksheet('AI Recommendations');
    ws.columns = ['Rank', 'Title', 'Detail', 'ΔTj (°C)', 'ΔθJA (°C/W)', 'Category', 'Confidence'].map((h, i) => ({ header: h, width: [6, 60, 60, 10, 12, 12, 12][i] }));
    r.aiRecommendations.forEach((a) => ws.addRow([a.rank, a.title, a.detail, a.deltaTj, a.deltaTheta, a.category, a.confidence]));
    header(ws);
    if (r.optimization) {
      const o = wb.addWorksheet('Optimization');
      const keys = Object.keys(r.optimization.candidates[0]?.params ?? {});
      o.addRow(['Candidate', ...keys, 'Tj (°C)', 'θJA (°C/W)', 'Mass (g)']);
      r.optimization.candidates.forEach((c) => o.addRow([c.label, ...keys.map((k) => c.params[k]), c.tj, c.thetaJA, c.mass]));
      header(o);
    }
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ------------------------------------------------------------------ CSV
export function buildCsv(doc: ProjectDoc, r: ThermalResults): string {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['Section,Parameter,Value,Units'];
  lines.push(`Project,Name,${q(doc.project.name)},`, `Project,ID,${q(doc.project.id)},`, `Project,Job,${q(r.jobId)},`);
  for (const [k, v, u] of metricRows(r)) lines.push(`Results,${q(k)},${q(v)},${q(u)}`);
  for (const h of r.hotspots) lines.push(`Hotspot ${h.rank},${q(h.location)},${h.temp},°C @ (${h.x} ${h.y} ${h.z}) mm`);
  for (const c of r.jedecCompliance) lines.push(`Compliance,${q(c.standard)},${q(c.status)},${q(c.deviations.join('; '))}`);
  for (const a of r.aiRecommendations) lines.push(`AI,${q(a.title)},${a.deltaTj ?? ''},°C`);
  return lines.join('\r\n');
}

export function buildJson(doc: ProjectDoc, r: ThermalResults, s: Sections) {
  return {
    generatedAt: new Date().toISOString(),
    project: doc.project,
    ...(s.packageBom ? { package: doc.package, bom: doc.bom } : {}),
    ...(s.jedecSetup ? { jedec: doc.jedec } : {}),
    ...(s.cfdModel ? { solver: doc.solver, simulation: doc.simulation } : {}),
    results: {
      ...r,
      fields: s.thermalPlots ? r.fields : undefined,
      aiRecommendations: s.aiRecommendations ? r.aiRecommendations : undefined,
      jedecCompliance: s.compliance ? r.jedecCompliance : undefined,
    },
  };
}
