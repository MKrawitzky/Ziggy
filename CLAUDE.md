# ZIGGY — Claude Code Guide

**ZIGGY** is a standalone proteomics dashboard built on STAN (FastAPI + React).  
It runs at `http://localhost:8421` and is the single source of truth for the dashboard UI.

---

## Directory layout

```
E:/ziggy/
├── start.py                        ← uvicorn launcher (auto-opens browser)
├── ZIGGY.bat / ziggy-start.bat     ← Windows launchers
├── package.json                    ← Node.js build deps (Babel)
├── node_modules/                   ← npm install (Babel for JSX build)
├── requirements.txt
├── tools/                          ← casanovo, etc.
└── stan/                           ← Python package (FastAPI server + React frontend)
    ├── dashboard/
    │   ├── server.py               ← FastAPI app
    │   ├── build.js                ← JSX → app.js compiler
    │   └── public/
    │       ├── index.html          ← Super Bowie theme, favicon link
    │       ├── favicon.svg         ← Aladdin Sane lightning bolt
    │       ├── vendor/app.js       ← COMPILED OUTPUT (do not edit directly)
    │       └── components/         ← JSX source files (edit these)
    │           ├── _manifest.json  ← ordered component list
    │           ├── _shared.jsx
    │           ├── _app_main.jsx
    │           ├── _tab_*.jsx      ← one file per tab
    │           └── ...
    └── ...
```

---

## Build workflow (everything from E:/ziggy)

```bash
# 1. Edit component files in:
#    E:/ziggy/stan/dashboard/public/components/

# 2. Build (from E:/ziggy root):
node stan/dashboard/build.js

# 3. Reload the browser — no restart needed
```

The build compiles all JSX from `components/` (in manifest order) into `vendor/app.js`.
No copy step needed — ziggy is self-contained.

---

## Running ZIGGY

```bash
# From E:/ziggy:
python start.py
# or double-click ZIGGY.bat / ziggy-start.bat
```

Uses venv at `C:\Users\Admin\STAN\venv`.

---

## Tab inventory (Research → Single Cell uses real K562 API data)

| Group    | Key          | Component file              |
|----------|--------------|-----------------------------|
| QC       | live         | (in _shared.jsx)            |
| QC       | history      | _shared.jsx / _tab_health   |
| QC       | trends       | _tab_trends.jsx             |
| QC       | health       | _tab_health.jsx             |
| 4D       | mobility     | _tab_mobility.jsx           |
| 4D       | landscape    | _tab_landscape.jsx          |
| 4D       | advantage    | _tab_4d.jsx                 |
| 4D       | ccs          | _tab_ccs.jsx                |
| 4D       | lc           | _tab_lc.jsx                 |
| 4D       | spectra      | _tab_spectra_enzyme.jsx     |
| 4D       | enzyme       | _tab_spectra_enzyme.jsx     |
| Research | immuno       | _tab_immuno.jsx             |
| Research | discovery    | _tab_immuno_discovery.jsx   |
| Research | denovo       | _tab_denovo.jsx             |
| Research | searches     | _tab_searches.jsx           |
| Research | search       | _tab_search_assistant.jsx   |
| Research | sneaky       | _tab_sneaky.jsx             |
| Research | mia          | _tab_mia.jsx                |
| Research | singlecell   | _tab_singlecell.jsx         |
| System   | config       | _tab_config.jsx             |
| System   | community    | _tab_community.jsx          |
| System   | about        | _tab_about.jsx              |

---

## Key technical notes

- All components are **global function declarations** (no ES module imports/exports).
  They share a single global scope — functions defined in one file are available in all.
- `useFetch(url)` is defined in `_shared.jsx` and available everywhere.
- `_lsCcsExpected(mz, z)` — theoretical ion mobility: `0.3 + z*0.12 + mz*(0.00015 + z*0.00008)`
- Ion data from `/api/runs/{id}/mobility-3d`: `rt` is in **seconds**, not minutes.
- Plotly charts: use `window.Plotly.react(el, traces, layout, config)`
- Canvas heatmaps: use `ImageData` pixel manipulation for performance
- `yieldToUI = () => new Promise(r => setTimeout(r, 0))` — yield to browser between heavy ops

## Single Cell tab

Uses real K562 dilution series runs (run_name must contain "K562"):
- 1.6pg → 8pg → 40pg → 200pg → 1ng → 5ng → 25ng → 125ng
- K562 cell ≈ 150pg protein → single-cell depth modeled at that point
- Panels: Sensitivity Curve, Charge Signature, 4D Ion Cloud, Peak Quality, Coverage Model,
  Surfaceome Atlas, Run Replicates

## Sneaky Peaky tab

Requires two runs selected (Run A / Run B). Panels:
SP4DIonCloud, SPMAPlot, SPShiftMap, SPUnknownPleasures (Joy Division ridgeline),
SPDynamicRange, SPCCSMap, SPTargetFinder

## Theme

"Super Bowie" dark purple:
- `--bg: #0e0018`, `--surface: #1a0030`, `--border: #3d1060`
- `--accent: #DAAA00` (gold), `--violet: #d946ef`, `--cyan: #22d3ee`
