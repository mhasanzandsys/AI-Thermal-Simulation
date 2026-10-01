import { Card } from '@/components/ui';
import { PageHeader } from '@/components/PageHeader';

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-[1000px] space-y-3 p-4 text-[12.5px] leading-relaxed text-slate-700">
      <PageHeader title="Help" subtitle="How the AI Thermal Simulator works" />
      <Card title="Workflow">
        <ol className="list-decimal space-y-1 pl-5">
          <li><b>Define Package</b> — package type, body size, dies (multi-die, offsets, power maps), substrate, interconnect, lid/TIM or mold, BOM materials.</li>
          <li><b>Select JEDEC Test</b> — JESD51-2A (still air), JESD51-6 (moving air sweep), JESD51-7 1s0p / JESD51-9 2s2p boards, JESD51-8 (θJB), and a custom θJC estimate.</li>
          <li><b>Configure Simulation</b> — solver adapter, analysis type (steady, transient, parametric sweep, optimization), mesh, convergence and AI options.</li>
          <li><b>Run (AI + CFD)</b> — AI pre-analysis, 3D finite-volume solve of every enabled JEDEC condition, sensitivity study and optional optimization; progress streams live.</li>
          <li><b>Results &amp; Report</b> — maps, θ metrics, compliance, hotspots, leakage stability; export PDF/XLSX/JSON/CSV.</li>
        </ol>
      </Card>
      <Card title="Built-in solver">
        <p>Steady/transient 3D conduction on a non-uniform Cartesian mesh (finite volume, harmonic-mean face conductances), solved with IC(0)-preconditioned conjugate gradients. Exterior surfaces use natural-convection correlations (h = 1.42(ΔT/L)<sup>¼</sup> vertical, 1.32 / 0.59 horizontal up/down), laminar flat-plate forced convection for JESD51-6, and linearised grey-body radiation, iterated to convergence (Picard). JESD51-8 uses a ring cold plate 5 mm outside the package; the custom θJC case applies a cold plate on the case top with all other faces adiabatic.</p>
        <p className="mt-1">Solder-ball, bump and land layers are modelled as effective anisotropic media; JEDEC boards use effective conductivities from their copper layer stacks.</p>
      </Card>
      <Card title="Thermal runaway criterion">
        <p>I<sub>leak</sub>(T) is fitted (exponential or quadratic) from PTPX data. The design is <b>Unstable</b> when dI<sub>leak</sub>/dT ≥ 1/(V·θJA) at the operating junction temperature (or the electrothermal iteration diverges), <b>Marginal</b> above 70 % of that threshold, otherwise <b>Stable</b>.</p>
      </Card>
      <Card title="External CFD tools">
        <p>Select Icepak, FloTHERM, STAR-CCM+, Fluent or a custom endpoint on the Simulation page. The app writes a solver input deck (PyAEDT script, FloXML or JSON) and, when the executable path exists, launches it in batch mode, expecting a <code>results.json</code> next to the deck. If the tool is not reachable, runs fall back to the built-in solver.</p>
      </Card>
    </div>
  );
}
