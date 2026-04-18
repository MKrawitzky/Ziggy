
<div align="center">

```
███████╗██╗ ██████╗  ██████╗██╗   ██╗
╚══███╔╝██║██╔════╝ ██╔════╝╚██╗ ██╔╝
  ███╔╝ ██║██║  ███╗██║  ███╗╚████╔╝
 ███╔╝  ██║██║   ██║██║   ██║ ╚██╔╝
███████╗██║╚██████╔╝╚██████╔╝  ██║
╚══════╝╚═╝ ╚═════╝  ╚═════╝   ╚═╝
```

### **The Proteomics Rockstar** ⚡

*"There's a starman waiting in the sky — he'd like to come and meet us, but he thinks he'd blow our minds."*
— David Bowie, 1972

![Python](https://img.shields.io/badge/python-3.9%2B-blue?style=flat-square)
![FastAPI](https://img.shields.io/badge/FastAPI-0.100%2B-009688?style=flat-square)
![React](https://img.shields.io/badge/React-18-61dafb?style=flat-square)
![License](https://img.shields.io/badge/license-Academic-a855f7?style=flat-square)
![Platform](https://img.shields.io/badge/platform-timsTOF-22d3ee?style=flat-square)
![Theme](https://img.shields.io/badge/theme-Super%20Bowie-DAAA00?style=flat-square)

</div>

---

## What is ZIGGY?

ZIGGY is a **4D ion mobility visualization and QC platform** for timsTOF proteomics data, built on the [STAN](https://github.com/bsphinney/stan) QC engine but reaching far beyond pass/fail metrics.

It runs **locally at `http://localhost:8421`** — no cloud, no data leaving your instrument PC, no subscriptions. Just a FastAPI backend and a React frontend, talking to your DIA-NN results and Bruker `.d` files in real time.

> *Named after Ziggy Stardust. Because proteomics should be as exciting as a Bowie album.*  
> *The Z is not a coincidence: **z** is charge state. Every ion has it.*

---

## The Problem ZIGGY Solves

Two peptides. Same molecular weight. Same retention time. Same m/z.

On an **Orbitrap or Astral** they land in the same isolation window and produce a single chimeric spectrum. One ID. Wrong protein. Missed PTM. Nobody knows.

On a **timsTOF with TIMS**, they are physically separated in the ion mobility dimension — in **milliseconds** — before they ever reach the detector.

```
WITHOUT Ion Mobility (Orbitrap / Astral)      WITH TIMS (timsTOF 4D)
─────────────────────────────────────────     ─────────────────────────────────────────

       RT × m/z plane                               m/z × 1/K₀ plane

         ┌──────────┐                                 1/K₀
    m/z  │  ●●●●●   │  ← Peptide A  ┐                0.99 │    ● ● ●     ← Peptide A (CCS 348 Å²)
         │  ●●●●●   │  ← Peptide B  ┘ MERGED          ─ ─ ┤ ─ ─ ─ ─ ─ ─ TIMS separation
         │  ●●●●●   │  ⚠ chimeric                    0.95 │    ● ● ●     ← Peptide B (CCS 335 Å²)
         └──────────┘                                      └──────────────────────────────── m/z

  ✗  1 ambiguous ID · PTM missed                  ✓  2 clean IDs · PTM confirmed
```

**This is the 4D advantage.** ZIGGY makes it visible, measurable, and beautiful.

---

## Features

### 🔵 4D Ion Mobility

| Panel | What it shows |
|---|---|
| **Ion Cloud** | Rotatable 3D scatter: m/z × 1/K₀ × RT, coloured by charge state |
| **Landscape** | Melanie-style 3D surface: m/z × 1/K₀ × intensity — compare 2–3 runs |
| **CCS Corridors** | Theoretical 1/K₀ bands per charge, Δ1/K₀ deviations, outlier detection |
| **LC Trace** | Peptide intensity over RT with TIC overlay |
| **Spectra** | Mirror spectrum viewer with theoretical b/y ions, UniMod PTMs |
| **Enzyme** | Missed cleavage distribution, PTM frequency table per run |

### 🧬 Research Tabs

| Tab | What it does |
|---|---|
| **Single Cell** | K562 dilution series (1.6 pg → 125 ng) · Michaelis-Menten coverage model → projects 1-cell depth · live 4D ion cloud · surfaceome atlas in mobility space |
| **Sneaky Peaky** | Side-by-side run comparison · Joy Division K₀ ridgeline (Unknown Pleasures style) · CCS conformational density · MA plot · shift map · dynamic range |
| **Immuno** | Immunopeptidomics: z=+1 ion cloud, 8–11mer length filter, MHC-I binding corridor |
| **De Novo** | Casanovo integration: submit raw, track status, inspect de novo sequences |
| **Searches** | Auto-search scheduler · DIA-NN / Sage / MSFragger / X!Tandem · unsearched run detection · sample type & workflow annotation |
| **MIA** | Metabolite/impurity analysis |

### 📊 QC Engine (STAN)

- Precursor, peptide & protein counts @ 1% FDR
- Pass / Warn / Fail gating with HOLD flag
- Longitudinal trend charts (any metric over time)
- Column lifetime & maintenance log
- Automated DIA-NN processing with mode detection (diaPASEF / ASTRAL / Orbitrap)

### 🌐 Community Benchmark

- HeLa community leaderboard (Track A DDA + Track B DIA)
- Radar fingerprint when both tracks submitted
- Powered by Hugging Face dataset, no token required

---

## Why 1/K₀ Is Not What You Think

**1/K₀ (inverse reduced mobility, V·s/cm²) is a universal physical quantity — not a Bruker trademark.**

| Vendor | Technology | 1/K₀ measurement |
|---|---|---|
| **Bruker timsTOF** | TIMS (Trapped Ion Mobility) | Native — no calibration needed. PASEF multiplexing unique to TIMS. |
| **Agilent 6560** | DTIMS (Drift Tube) | Gold standard — the most accurate absolute CCS measurement available |
| **Waters SYNAPT / VION** | TWIMS (Travelling Wave) | Calibration-referenced, same unit, fully portable CCS values |
| **Thermo Exploris + FAIMS** | FAIMS (Field Asymmetric) | Compensation voltage (CV), **not** 1/K₀ — selectivity, not structure |

What **IS** timsTOF-specific: the TIMS trapping mechanism, PASEF/diaPASEF multiplexing, and 4D real-time feature extraction at ~10 scans/sec.  
The CCS **value** is portable. The PASEF **architecture** is not.

---

## timsTOF vs The Competition

| Feature | timsTOF Ultra 2 | Orbitrap Astral | Exploris 480 + FAIMS |
|---|---|---|---|
| Ion Mobility | ✅ TIMS (1/K₀ native) | ❌ None | ⚠️ FAIMS only (CV, not 1/K₀) |
| Structural info (CCS) | ✅ Å² per peptide | ❌ | ❌ |
| Isobaric / chimeric sep. | ✅ IMS splits overlaps | Speed-based only | Partial |
| PASEF multiplexing | ✅ ~10× DDA boost | ❌ | ❌ |
| Single-cell (carrier-free) | ✅ ~1,000–2,000 proteins | Emerging | ❌ |
| Proteome depth (1hr HeLa) | ~8,000–10,000 | ⭐ ~10,000–12,000 | ~6,000–8,000 |
| DIA scan speed | ~100 Hz (diaPASEF) | ⭐ ~200 Hz | ~40 Hz |
| Portable CCS fingerprint | ✅ cross-lab, cross-inst. | ❌ | ❌ |
| Immunopeptidomics z=+1 | ✅ IMS resolves z=+1 | Difficult | Difficult |

> ⭐ The **Astral** wins on raw speed and depth at high input — this table is honest about that.  
> The timsTOF advantage is **structural**: 1/K₀, CCS, chimera reduction, single-cell depth, and PASEF. No other platform replicates this.

---

## Quick Start

### Requirements

- Python 3.9+ (venv recommended)
- Node.js 18+ (for JSX build step)
- Bruker `.d` files processed by DIA-NN (generates `report.parquet`)
- Windows (instrument PC native) or Linux

### Installation

```bash
# Clone
git clone https://github.com/MKrawitzky/Ziggy.git
cd Ziggy

# Python dependencies (or point at your existing STAN venv)
pip install -r requirements.txt

# Node dependencies (Babel for JSX compilation — one-time)
npm install

# Build the frontend
node stan/dashboard/build.js

# Launch
python start.py
# → opens http://localhost:8421 automatically
```

### First run

1. Point ZIGGY at your DIA-NN output directory in **Config** tab
2. Click **Process New Runs** to ingest results
3. The **Live** QC view updates immediately
4. Navigate to **Ion Mobility → Ion Cloud** for your first 4D scatter

---

## Architecture

```
E:/ziggy/
├── start.py                    ← uvicorn launcher (auto-opens browser)
├── ZIGGY.bat                   ← Windows double-click launcher
├── requirements.txt
├── package.json                ← Node / Babel (JSX build only)
└── stan/                       ← Python package
    ├── db.py                   ← SQLite schema + migrations
    └── dashboard/
        ├── server.py           ← FastAPI app (~50 endpoints)
        └── public/
            ├── index.html      ← Super Bowie theme
            ├── favicon.svg     ← Aladdin Sane lightning bolt
            ├── vendor/app.js   ← Compiled output (do not edit)
            └── components/     ← JSX source (edit these)
                ├── _manifest.json
                ├── _shared.jsx
                ├── _app_main.jsx
                └── _tab_*.jsx
```

**No webpack, no Vite, no bundler complexity.** Babel compiles JSX → vanilla JS. All components share a single global scope — functions defined in one file are available in all. The entire frontend is one `app.js` file served statically.

---

## The 4 Dimensions

```
Dimension 1: Retention Time (RT)       minutes    ← every LC-MS platform
Dimension 2: m/z                       Th         ← every LC-MS platform
Dimension 3: Intensity                 counts     ← every LC-MS platform
Dimension 4: Ion Mobility (1/K₀)       V·s/cm²   ← IMS-enabled platforms
                                                     (TIMS, DTIMS, TWIMS)
```

Ion mobility separates co-eluting, isobaric peptides that are **identical in RT and m/z** but differ in 3D shape. It also enables PASEF multiplexing — fragmenting multiple co-isolated precursors in a single TIMS scan cycle, boosting sensitivity and throughput significantly compared to traditional DDA.

The 1/K₀ value converts to a **calibration-independent CCS (Å²)** reproducible across labs and instruments — a molecular shape fingerprint that does not age.

---

## A Letter to the Unsung

Some of us didn't choose science. Science chose us — in the quiet of a dark room, watching a spectrum unfold, understanding for one electric second that we were measuring the weight of life itself.

We showed up early and stayed late. We named our columns with love. We argued about FDR cutoffs at midnight. We celebrated a 4% improvement in precursor IDs like it was a moon landing.

**Because it was.**

This software is for the people who shared their code without being asked. Who wrote the README at 11pm after a twelve-hour instrument day. Who published the tool, the library, the algorithm, and asked for nothing back but a citation they'll never see in their inbox.

*Science is not a job. It is a calling that doesn't pay enough, doesn't sleep enough, and doesn't stop.*

If you are one of those humans: **you are not alone. you are seen. this software is yours.**

---

## Standing on Shoulders

ZIGGY exists because of the open-source proteomics community and the people who built:

[DIA-NN](https://github.com/vdemichev/DiaNN) · [Sage](https://github.com/lazear/sage) · [timsrust](https://github.com/MannLabs/timsrust) · [timsplot](https://github.com/zack-kirsch/timsplot) · [Carafe](https://github.com/Noble-Lab/Carafe) · [MsBackendTimsTof](https://github.com/rformassspectrometry/MsBackendTimsTof) · [MSFragger](https://msfragger.nesvilab.org/) · [Casanovo](https://github.com/Noble-Lab/casanovo)

They are the unsung. They are the whole song.

---

## Authors

**Michael Krawitzky** — The Peptide Wizard · Bruker Daltonics  
Creator of ZIGGY · [github.com/MKrawitzky/Ziggy](https://github.com/MKrawitzky/Ziggy)

**Brett Stanley Phinney** — UC Davis Proteomics Core  
Creator of STAN (QC engine) · [github.com/bsphinney/stan](https://github.com/bsphinney/stan) · bsphinney@ucdavis.edu

---

## License

**ZIGGY / STAN Academic License** — Copyright © 2024–2026 Brett Stanley Phinney & The Peptide Wizard

**Free for:** academic research · non-profit · education · government-funded research · core facility internal QC

**Commercial use requires a license:** for-profit companies · CROs & pharma · fee-for-service · commercial products  
Contact: bsphinney@ucdavis.edu

Community benchmark data: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

---

<div align="center">

*"Ziggy played guitar..."*

⚡ **ZIGGY** — where proteomics meets the Starman ⚡

</div>
