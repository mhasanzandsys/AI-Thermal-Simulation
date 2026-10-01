# AI Thermal Simulator

Semiconductor package thermal analysis (JEDEC compliant) — Next.js front end + Node.js/Express back end, built from `AI_Thermal_Simulator_GUI_React_Spec.xlsx`.

```
aithermalsimulator/
├─ shared/     Zod schemas, canonical project JSON model, defaults, JEDEC templates, validation rules VAL-001…010
├─ backend/    Express API, SQLite store, 3D thermal solver, AI engine, solver adapters, report generator
└─ frontend/   Next.js (App Router) GUI — dashboard matching the mockup + detail pages per the component map
```

## Quick start (Windows / macOS / Linux)

Requirements: **Node.js 20 or 22 LTS** (npm 10+).

```bash
npm install          # installs all three workspaces
npm run dev          # API on http://localhost:4000, web on http://localhost:3000
```

Open http://localhost:3000. A demo project (NDP120B1 FC-BGA, as in the mockup) is created on first start.
Press **Run AI + CFD Simulation** to solve; progress, logs and residuals stream live on the Run Monitor.

Other scripts: `npm run build` (production build of the web app), `npm start` (production API + web), `npm test` (solver/validation tests), `npm run typecheck`.

Configuration (optional, copy the `.env.example` files):

| Variable | Where | Default |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | frontend | dev: `http://localhost:4000/api`, production: `/api` (same domain). Only set it if the API is on another host. |
| `PORT`, `CORS_ORIGIN` | backend | `4000`; CORS reflects any origin unless `CORS_ORIGIN` is set |
| `DATA_DIR` | backend | `backend/data` locally, `/tmp/ats-data` on Vercel |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | backend | unset = local SQLite file. Set them to use a Turso (libSQL) database — required for persistent data on Vercel |

## Deploying to Vercel (single project, two services)

`vercel.json` at the repo root defines two services — `backend` (Express) and `frontend` (Next.js) — and routes `/api/*` to the backend and everything else to the frontend, all on one domain.

1. Import the repository in Vercel with the **root directory left as the repo root** (Framework Preset: Services, picked up from `vercel.json`).
2. **Do not set `NEXT_PUBLIC_API_URL`** — the app calls `/api` on its own domain, which also works for preview URLs. If you set it earlier, delete it and redeploy (`NEXT_PUBLIC_*` values are baked in at build time).
3. Add a database so data survives restarts: Vercel → Storage / Marketplace → **Turso** (or create one at turso.tech) and make sure `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` are available to the project. Without it the API uses `/tmp` SQLite, which works but resets whenever Vercel starts a new instance (the app shows a yellow banner).
4. Redeploy, then check `https://<your-domain>/api/health` → `{"ok":true, "storage": {...}}`.

Notes for Vercel: simulations run inside the `POST /api/run/stream` request (progress is streamed), so they stay within the function's max duration (300 s by default on Fluid compute). Uploads are limited to ~4.5 MB by Vercel's request-body limit. Preview deployments with Vercel Authentication enabled are only reachable while you are logged in to Vercel.

## What is implemented

| Spec sheet | Implementation |
|---|---|
| GUI Mockup | `/` dashboard: Project Information, Workflow, CFD Tool Integration, Package Definition (Overview/BOM/Substrate/Die/Heat Spreader/Lid-TIM/Package Model), JEDEC setup with board drawing, Material Properties, AI & Simulation Settings, Results & Analysis (3D temperature surface + JEDEC table), Leakage vs Temperature with instability check, Reports + Recommendations |
| App Structure / React Component Map | Routes `/project /package /package/bom /materials /jedec /simulation /leakage /run /results /ai /reports /projects /settings /help`; Zustand store with debounced autosave; Zod validation shared with the API |
| Project / Package / BOM / CFD / Simulation fields | All state keys from the sheets (`project.*`, `package.*`, `bom[]`, `solver.*`, `simulation.*`, `ai.*`, `leakage.*`, `reports.*`) with defaults, units and allowed values |
| JEDEC Tests | JESD51-2A still air, JESD51-6 multi-velocity sweep, JESD51-7 1s0p / JESD51-9 2s2p board templates (locked unless expert override), JESD51-8 θJB (ring cold plate), custom θJC labelled non-JEDEC |
| Leakage & PTPX | CSV/JSON import, exponential/quadratic fit with R², dI/dT, threshold 1/(V·θJA), Stable/Marginal/Unstable, electrothermal iteration, max stable power |
| Results & Reports | Tj,max + location, Tc, Tb, θJA still/moving, θJB, θJC (estimate), Ψ-JT/Ψ-JB, heat-path split, top-N hotspots, compliance table, AI recommendations; PDF / XLSX / JSON / CSV export |
| Validation Rules | VAL-001…VAL-010 in `shared/src/validation.ts`, shown inline on fields and enforced before a run |
| API Data Model | `POST /api/run/stream` (run + live SSE progress in one request), `GET/POST/PUT/DELETE /api/projects…`, `PUT /api/projects/:id/{package,setup,simulation,…}`, `GET/PUT /api/materials`, `GET /api/jedec/templates`, `GET /api/solver/status`, `POST /api/solver/connect`, `POST /api/analysis/leakage`, `POST /api/run`, `GET /api/run/:id`, `GET /api/run/:id/events` (SSE), `GET /api/results/:jobId`, `POST /api/reports` |
| Material Library | Seeded presets + editable custom materials |

### Thermal engine (built-in solver)
* 3D finite-volume conduction on a non-uniform Cartesian mesh generated from the package definition (board, solder-ball/land layer as effective medium, substrate with optional thermal vias, bumps + underfill, multiple dies with power maps, TIM, lid with foot ring and cavity, or mold compound).
* IC(0)-preconditioned conjugate gradient; energy-residual / max-iteration controls from the spec; Picard iterations for nonlinear natural convection + radiation; forced convection for JESD51-6; implicit-Euler transient; parametric sweeps.
* Energy balance is checked every run (typically < 1e-6 %).

### "AI" features (offline, no external service)
* **Pre-analysis** — thermal-resistance-network model predicting Tj, θJA, dominant path and hotspot; drives AI-optimized mesh refinement.
* **Recommendations** — automated sensitivity study (lid thickness, TIM k, thermal vias, balls, power floor-plan, board, airflow) ranked by ΔTj.
* **Optimization** — Latin-hypercube sampling + quadratic response-surface surrogate, optimum verified with a solve (objectives: min Tj, min θJA, min mass, multi-objective). "Apply optimum to design" writes the parameters back.

### External CFD tools
Select Icepak / FloTHERM / STAR-CCM+ / Fluent / Custom on the Simulation page and set the executable path or URL. The back end writes a solver deck (PyAEDT script for Icepak, FloXML for FloTHERM, JSON otherwise — also downloadable via *Export solver input deck*) and, if the executable exists, launches it in batch mode and reads `results.json`. If the tool isn't reachable the run falls back to the built-in solver. The generated Icepak/FloTHERM decks are templates and should be checked against your installed tool version.

## Notes
* JEDEC has no steady-state θJC spec; θJC is always reported as a custom simulation estimate (VAL-007).
* Board copper layer coverages for 1s0p/2s2p effective conductivity are in `shared/src/constants.ts` — adjust to your test-board drawings.
* Material values are room-temperature placeholders from the spec; verify with supplier data.
