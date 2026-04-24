
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
| **Landscape** | Melanie-style 3D surface: m/z × 1/K₀ × intensity — compare 2–3 runs, differential A−B surface |
| **4D Advantage** | Chimera probability map (Clean / IM-rescued / Still chimeric), Mobility Corridor, Orthogonality Index, Breathing Proteome animation, 4D Run Fingerprint |
| **CCS Corridors** | Theoretical 1/K₀ bands per charge, Δ1/K₀ deviations, outlier detection |
| **LC Trace** | Peptide intensity over RT with TIC overlay |
| **Spectra** | Mirror spectrum viewer with theoretical b/y ions, UniMod PTMs |
| **Enzyme** | Missed cleavage distribution, PTM frequency table per run |
| **Mob Calibration** | Per-run Δ1/K₀ scatter, histogram, 30-run trend — catches pressure-induced drift early |

### 🧬 Omics Tabs

| Tab | What it does |
|---|---|
| **Immunopeptidomics** | z=+1 ion cloud, 8–11mer length filter, MHC-I binding corridor, HLA allele annotation |
| **HLA Discovery** | Allele discovery workflow, Cutler/Ctortecka 2025 single-cell HLA integration |
| **Histones** | Crosstalk Matrix (14 marks), 4D TIMS Storm, Sequence Aligner, SC Drug Response (Orsburn 2026), Workflow guide |
| **Phospho** | Phosphoisomer separation showcase — Gaussian isomer profiles, Δ1/K₀ annotation, Resolution Gauge, IM Advantage infographic (Oliinyk 2023: 727 pairs, ~5% Δ1/K₀), phospho landscape scatter |
| **Chemoproteomics** | Cysteine reactivity landscape, probe enrichment QC, target engagement |
| **Metaproteomics** | Taxonomic and functional diversity from community proteomics |
| **Single Cell** | K562 dilution series (1.6 pg → 125 ng), Michaelis-Menten coverage model, live 4D ion cloud, surfaceome atlas in ion mobility space |

### 🔍 Search & Analysis

| Tab | What it does |
|---|---|
| **Search Assistant** | DIA-NN / Sage search launcher · live unsearched-run badge counter · auto-detect DDA/DIA, ddaPASEF, diaPASEF |
| **Searches** | Search history, result browser, re-search queue |
| **De Novo** | Casanovo integration: submit raw, track status, inspect sequences |
| **MIA** | Metabolite/impurity analysis with ★ spectrum jump to Spectra viewer |
| **Sneaky Peaky** | Side-by-side run comparison · Joy Division K₀ ridgeline · CCS conformational density · MA plot · shift map · dynamic range |

### 📊 QC Engine (STAN)

| Tab | What it does |
|---|---|
| **Run History** | All runs with QC flags; filter by **column**, **LC system**, and **instrument** when Lab Setup catalog is populated |
| **Trends** | Longitudinal trend charts (any metric over time), pinned run comparisons |
| **Health** | Instrument health dashboard, HOLD flag management |

### ⊛ Lab Setup

A column and LC system catalog seeded on first launch with entries from:

| Vendor | Lines |
|---|---|
| **PepSep** | Ultra (UHP/nC, 150µm) · Advance (PepSeal, 75/50µm) · Pro (1.9µm, 75/150µm) |
| **Evosep** | Endurance · Endurance OE · Performance · Performance OE · Whisper |
| **IonOpticks** | Aurora Ultimate · Aurora Elite · Aurora Series |
| **Thermo** | PepMap Neo · Easy-Spray |

Tag any run with the column and LC system used. Run History filter dropdowns appear automatically and let you answer questions like: *"How does the PepSep Ultra 25cm perform on nanoElute 2 vs. the Evosep One at the same gradient length?"*

### 🌐 Community Benchmark

- HeLa community leaderboard (Track A DDA + Track B DIA)
- Radar fingerprint when both tracks submitted
- Powered by Hugging Face dataset — no token required

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
| Phosphoisomer separation | ✅ ~5% Δ1/K₀, R ≥ 0.6 baseline | ❌ | ❌ |
| Single-cell (carrier-free) | ✅ ~1,000–2,000 proteins | Emerging | ❌ |
| Proteome depth (1hr HeLa) | ~8,000–10,000 | ⭐ ~10,000–12,000 | ~6,000–8,000 |
| DIA scan speed | ~100 Hz (diaPASEF) | ⭐ ~200 Hz | ~40 Hz |
| Portable CCS fingerprint | ✅ cross-lab, cross-inst. | ❌ | ❌ |
| Immunopeptidomics z=+1 | ✅ IMS resolves z=+1 | Difficult | Difficult |

> ⭐ The **Astral** wins on raw speed and depth at high input — this table is honest about that.  
> The timsTOF advantage is **structural**: 1/K₀, CCS, chimera reduction, phosphoisomer separation, single-cell depth, and PASEF. No other platform replicates this.

---

## Quick Start

### Requirements

- Python 3.9+ (venv recommended)
- Node.js 18+ (for JSX build step)
- Bruker `.d` files processed by DIA-NN or Sage (generates `report.parquet` / `results.sage.parquet`)
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
3. Navigate to **Ion Mobility → Ion Cloud** for your first 4D scatter
4. Open **Lab Setup** to tag your runs with column and LC system — enables cross-instrument filtering in Run History

---

## Architecture

```
E:/ziggy/
├── start.py                    ← uvicorn launcher (auto-opens browser)
├── ZIGGY.bat                   ← Windows double-click launcher
├── requirements.txt
├── package.json                ← Node / Babel (JSX build only)
└── stan/                       ← Python package
    ├── db.py                   ← SQLite schema + migrations + catalog seeding
    ├── columns.py              ← Column catalog (PepSep, Evosep, IonOpticks, Thermo)
    └── dashboard/
        ├── server.py           ← FastAPI app (~60 endpoints)
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
