"""Ion mobility visualization from DIA-NN report.parquet (no 4DFF needed).

Extracts RT × 1/K0 density maps, 3D feature scatter, charge distribution,
FWHM and intensity histograms directly from the existing DIA-NN search output.

All return formats are identical to mobility_viz.py so the dashboard API
endpoints can transparently fall back to this when no .features file exists.

Confirmed column names from DIA-NN 2.x report.parquet on timsTOF:
  IM                Float32   measured 1/K0 (Vs/cm²)
  RT                Float32   retention time (min)
  Precursor.Mz      Float32   precursor m/z (Th)
  Precursor.Charge  Int32     charge state
  Precursor.Quantity Float32  precursor intensity
  FWHM              Float32   chromatographic peak FWHM (min)
  Q.Value           Float32   precursor FDR score
  Run               String    run name (DIA-NN 2.x)  / File.Name (1.x)
  Modified.Sequence String    peptide sequence with inline UniMod notation
  Stripped.Sequence String    bare amino acid sequence (no mods)
"""

from __future__ import annotations

import logging
import math
import re
from pathlib import Path

logger = logging.getLogger(__name__)

_Q_CUTOFF = 0.01   # 1% FDR


def _load_precursors(report_path: str | Path, run_name: str | None = None):
    """Load and filter precursors from a DIA-NN report.parquet.

    Filters to Q.Value ≤ 1% FDR.  If run_name is supplied, also filters to
    that run (for multi-file reports).

    Returns a list of dicts with keys: rt, mz, mobility, charge, intensity, fwhm.
    Returns empty list if the file is missing or has no IM column.
    """
    try:
        import polars as pl
    except ImportError:
        logger.error("polars is required for DIA-NN mobility extraction")
        return []

    report_path = Path(report_path)
    if not report_path.exists():
        return []

    try:
        schema = pl.read_parquet_schema(str(report_path))
    except Exception:
        logger.exception("Cannot read report schema: %s", report_path)
        return []

    available = set(schema.keys())

    # Must have ion mobility — timsTOF-only column
    if "IM" not in available:
        logger.debug("No IM column in %s — not a timsTOF report", report_path.name)
        return []

    file_col = "Run" if "Run" in available else "File.Name"

    want = [c for c in [
        "IM", "RT", "Precursor.Mz", "Precursor.Charge",
        "Precursor.Quantity", "Q.Value", "FWHM", file_col,
    ] if c in available]

    try:
        df = pl.read_parquet(str(report_path), columns=want)
    except Exception:
        logger.exception("Failed to read %s", report_path)
        return []

    # Filter FDR
    df = df.filter(pl.col("Q.Value") <= _Q_CUTOFF)

    # Filter to requested run if this is a multi-run report
    if run_name and file_col in df.columns:
        stem = Path(run_name).stem
        df_run = df.filter(pl.col(file_col).str.contains(stem, literal=True))
        if df_run.height > 0:
            df = df_run

    if df.height == 0:
        return []

    # Build row dicts
    rows = []
    rt_col = df["RT"].to_list()
    mz_col = df["Precursor.Mz"].to_list()
    im_col  = df["IM"].to_list()
    ch_col  = df["Precursor.Charge"].to_list() if "Precursor.Charge" in df.columns else [2] * df.height
    qty_col = df["Precursor.Quantity"].to_list() if "Precursor.Quantity" in df.columns else [1.0] * df.height
    fw_col  = df["FWHM"].to_list() if "FWHM" in df.columns else [None] * df.height

    for rt, mz, im, ch, qty, fw in zip(rt_col, mz_col, im_col, ch_col, qty_col, fw_col):
        if rt is None or mz is None or im is None or im == 0.0:
            continue
        rows.append({
            "rt": float(rt) * 60,   # DIA-NN stores RT in minutes → convert to seconds
            "mz": float(mz),
            "mobility": float(im),
            "charge": int(ch) if ch is not None else 0,
            "intensity": float(qty) if qty and qty > 0 else 1.0,
            "fwhm": float(fw) * 60 if fw else None,  # min → seconds
        })
    return rows


# ── 2D RT × 1/K0 density map ─────────────────────────────────────────

def get_mobility_map_diann(
    report_path: str | Path,
    run_name: str | None = None,
    rt_bins: int = 60,
    mobility_bins: int = 50,
) -> dict:
    """Same output format as mobility_viz.get_mobility_map but from report.parquet."""
    rows = _load_precursors(report_path, run_name)
    if not rows:
        return {}

    rts = [r["rt"] for r in rows]
    mobs = [r["mobility"] for r in rows]
    intensities = [r["intensity"] for r in rows]

    rt_min, rt_max = min(rts), max(rts)
    mob_min, mob_max = min(mobs), max(mobs)

    rt_pad  = (rt_max  - rt_min)  * 0.01 + 0.1
    mob_pad = (mob_max - mob_min) * 0.01 + 0.001
    rt_lo,  rt_hi  = rt_min  - rt_pad,  rt_max  + rt_pad
    mob_lo, mob_hi = mob_min - mob_pad, mob_max + mob_pad

    rt_step  = (rt_hi  - rt_lo)  / rt_bins
    mob_step = (mob_hi - mob_lo) / mobility_bins

    grid = [[0.0] * mobility_bins for _ in range(rt_bins)]
    for rt, mob, intensity in zip(rts, mobs, intensities):
        ri = min(int((rt  - rt_lo)  / rt_step),  rt_bins - 1)
        mi = min(int((mob - mob_lo) / mob_step), mobility_bins - 1)
        if 0 <= ri < rt_bins and 0 <= mi < mobility_bins:
            grid[ri][mi] += intensity

    for i in range(rt_bins):
        for j in range(mobility_bins):
            grid[i][j] = round(math.log10(grid[i][j] + 1), 3)

    rt_edges  = [round(rt_lo  + i * rt_step,  2) for i in range(rt_bins + 1)]
    mob_edges = [round(mob_lo + i * mob_step, 4) for i in range(mobility_bins + 1)]

    return {
        "rt_edges":       rt_edges,
        "mobility_edges": mob_edges,
        "grid":           grid,
        "n_features":     len(rows),
        "rt_range":       [round(rt_min,  1), round(rt_max,  1)],
        "mobility_range": [round(mob_min, 4), round(mob_max, 4)],
        "source":         "diann",   # lets the UI show a subtitle
    }


# ── Charge state distribution ─────────────────────────────────────────

def get_charge_distribution_diann(
    report_path: str | Path,
    run_name: str | None = None,
) -> dict:
    """Same output format as mobility_viz.get_charge_distribution."""
    rows = _load_precursors(report_path, run_name)
    if not rows:
        return {}

    counts: dict[int, int] = {}
    for r in rows:
        counts[r["charge"]] = counts.get(r["charge"], 0) + 1

    charges = sorted(counts)
    total = sum(counts.values())
    return {
        "charges":   charges,
        "counts":    [counts[z] for z in charges],
        "fractions": [round(counts[z] / total * 100, 1) for z in charges],
        "total":     total,
    }


# ── RT FWHM histogram (chromatographic peak width) ───────────────────

def get_fwhm_histogram_diann(
    report_path: str | Path,
    run_name: str | None = None,
    bins: int = 40,
) -> dict:
    """Histogram of per-precursor RT FWHM (seconds).

    DIA-NN reports RT FWHM in minutes — converted to seconds here so the
    axis label matches the 4DFF mobility FWHM panel.  The x-axis label in
    the UI shows 'RT FWHM (s)' to distinguish from ion mobility FWHM.

    Same return format as mobility_viz.get_mobility_fwhm_histogram.
    """
    rows = _load_precursors(report_path, run_name)
    if not rows:
        return {}

    fwhms = sorted(r["fwhm"] for r in rows if r["fwhm"] is not None and r["fwhm"] > 0)
    if len(fwhms) < 2:
        return {}

    fwhm_min, fwhm_max = fwhms[0], fwhms[-1]
    if fwhm_max <= fwhm_min:
        return {}

    step = (fwhm_max - fwhm_min) / bins
    hist = [0] * bins
    for f in fwhms:
        i = min(int((f - fwhm_min) / step), bins - 1)
        hist[i] += 1

    median = fwhms[len(fwhms) // 2]
    edges = [round(fwhm_min + i * step, 2) for i in range(bins + 1)]

    return {
        "edges":      edges,
        "counts":     hist,
        "median_fwhm": round(median, 2),
        "n":          len(fwhms),
        "label":      "RT FWHM (s)",   # distinguish from K0 FWHM in UI
    }


# ── Feature intensity histogram ───────────────────────────────────────

def get_intensity_histogram_diann(
    report_path: str | Path,
    run_name: str | None = None,
    bins: int = 40,
) -> dict:
    """Same output format as mobility_viz.get_intensity_histogram."""
    rows = _load_precursors(report_path, run_name)
    if not rows:
        return {}

    log_intensities = sorted(
        math.log10(r["intensity"]) for r in rows if r["intensity"] > 0
    )
    if len(log_intensities) < 2:
        return {}

    lo, hi = log_intensities[0], log_intensities[-1]
    if hi <= lo:
        return {}

    step = (hi - lo) / bins
    hist = [0] * bins
    for v in log_intensities:
        i = min(int((v - lo) / step), bins - 1)
        hist[i] += 1

    edges = [round(lo + i * step, 3) for i in range(bins + 1)]
    return {
        "edges":  edges,
        "counts": hist,
        "n":      len(log_intensities),
    }


# ── 3D feature point cloud ────────────────────────────────────────────

def get_feature_3d_data_diann(
    report_path: str | Path,
    run_name: str | None = None,
    max_features: int = 5000,
) -> dict:
    """Same output format as mobility_viz.get_feature_3d_data."""
    rows = _load_precursors(report_path, run_name)
    if not rows:
        return {}

    n_total = len(rows)
    # Top features by intensity
    rows.sort(key=lambda r: r["intensity"], reverse=True)
    rows = rows[:max_features]

    return {
        "rt":       [round(r["rt"],       2) for r in rows],
        "mz":       [round(r["mz"],       4) for r in rows],
        "mobility": [round(r["mobility"], 4) for r in rows],
        "log_int":  [round(math.log10(r["intensity"]), 2) for r in rows],
        "charge":   [r["charge"] for r in rows],
        "n_total":  n_total,
        "n_shown":  len(rows),
        "source":   "diann",
    }


# ── CCS values (1/K₀ → Å²) ───────────────────────────────────────────

def get_ccs_data_diann(
    report_path: str | Path,
    run_name: str | None = None,
    max_scatter: int = 5000,
    hist_bins: int = 50,
) -> dict:
    """CCS vs m/z scatter and per-charge CCS distribution histograms.

    Converts 1/K₀ → CCS (Å²) using the Bruker timsdata DLL function
    ``tims_oneoverk0_to_ccs_for_mz``.  Falls back to an error payload if the
    DLL is unavailable (Linux without libtimsdata.so, or missing bundled DLL).

    Returns:
        dict with keys:
          ``scatter`` — {charge_str: {mz: [...], ccs: [...]}}
          ``histograms`` — {charge_str: {edges, counts, median, n}}
          ``n_total`` — total precursor count before downsampling
        or ``{"error": "timsdata_unavailable"}`` if DLL cannot be loaded.
    """
    rows = _load_precursors(report_path, run_name)
    if not rows:
        return {}

    ccs_available = False
    try:
        from stan.tools.timsdata.timsdata import oneOverK0ToCCSforMz
        ccs_available = True
    except Exception:
        logger.warning("timsdata DLL not available — falling back to 1/K₀ mobility plots")

    if ccs_available:
        working_rows: list[dict] = []
        for r in rows:
            try:
                ccs = oneOverK0ToCCSforMz(r["mobility"], r["charge"], r["mz"])
                if ccs and ccs > 0:
                    working_rows.append({**r, "ccs": round(float(ccs), 2)})
            except Exception:
                continue
        if not working_rows:
            # CCS conversion yielded nothing — fall back to mobility
            ccs_available = False
            working_rows = rows
    else:
        working_rows = rows

    if not working_rows:
        return {}

    n_total = len(working_rows)

    # Group by charge state
    by_charge: dict[int, list] = {}
    for r in working_rows:
        z = r["charge"]
        by_charge.setdefault(z, []).append(r)

    # Scatter — proportional downsample per charge, top by intensity
    scatter: dict[str, dict] = {}
    for z, zrows in sorted(by_charge.items()):
        zrows_sorted = sorted(zrows, key=lambda r: r["intensity"], reverse=True)
        cap = max(300, int(max_scatter * len(zrows) / n_total))
        sub = zrows_sorted[:cap]
        entry: dict = {
            "mz": [round(r["mz"],      3) for r in sub],
            "im": [round(r["mobility"], 4) for r in sub],
            # RT stored internally as seconds → return as minutes for display
            "rt": [round(r["rt"] / 60, 3) for r in sub],
        }
        if ccs_available:
            entry["ccs"] = [r["ccs"] for r in sub]
        scatter[str(z)] = entry

    # Histograms — all data per charge
    # Use CCS when available, otherwise raw 1/K0 mobility
    histograms: dict[str, dict] = {}
    for z, zrows in sorted(by_charge.items()):
        vals = sorted(
            r["ccs"] if ccs_available else r["mobility"]
            for r in zrows
        )
        if len(vals) < 2:
            continue
        lo, hi = vals[0], vals[-1]
        if hi <= lo:
            continue
        step = (hi - lo) / hist_bins
        counts = [0] * hist_bins
        for v in vals:
            i = min(int((v - lo) / step), hist_bins - 1)
            counts[i] += 1
        dp = 1 if ccs_available else 4
        edges = [round(lo + i * step, dp) for i in range(hist_bins + 1)]
        median = vals[len(vals) // 2]
        histograms[str(z)] = {
            "edges":  edges,
            "counts": counts,
            "median": round(median, dp),
            "n":      len(vals),
        }

    return {
        "scatter":       scatter,
        "histograms":    histograms,
        "n_total":       n_total,
        "ccs_available": ccs_available,
    }


# ── Enzyme efficiency / PTM stats ─────────────────────────────────────

# DIA-NN inline modification notation: M(UniMod:21) = oxidation, etc.
_UNIMOD_LABELS: dict[str, str] = {
    "1":   "Acetyl (N-term)",
    "4":   "Carbamidomethyl (C)",
    "5":   "Carbamyl",
    "7":   "Deamidated (N/Q)",
    "21":  "Oxidation (M)",
    "35":  "Hydroxylation",
    "56":  "Acetyl (K)",
    "259": "Trimethyl (K)",
}

_MOD_RE = re.compile(r"\(UniMod:(\d+)\)")


# ── Enzyme cleavage rules ──────────────────────────────────────────────────────
# Each entry: sites = C-terminal cleavage AAs (or N-terminal for direction='n')
# blocked_next = next AA that BLOCKS cleavage (e.g. P for trypsin)
# direction: 'c' = cleave after site AA, 'n' = cleave before site AA

_ENZYME_RULES: dict[str, dict] = {
    "trypsin":       {"sites": frozenset("KR"),   "blocked_next": frozenset("P"), "direction": "c"},
    "trypsin_lysc":  {"sites": frozenset("KR"),   "blocked_next": frozenset("P"), "direction": "c"},
    "lysc":          {"sites": frozenset("K"),    "blocked_next": frozenset(),   "direction": "c"},
    "argc":          {"sites": frozenset("R"),    "blocked_next": frozenset(),   "direction": "c"},
    "chymotrypsin":  {"sites": frozenset("FWY"),  "blocked_next": frozenset("P"),"direction": "c"},
    "rchymoselect":  {"sites": frozenset("RFWY"), "blocked_next": frozenset(),   "direction": "c"},
    "krakatoa":      {"sites": frozenset("KR"),   "blocked_next": frozenset(),   "direction": "c"},
    "vesuvius":      {"sites": frozenset("FWY"),  "blocked_next": frozenset(),   "direction": "c"},
    "aspn":          {"sites": frozenset("D"),    "blocked_next": frozenset(),   "direction": "n"},
    "proalanase":    {"sites": frozenset("PA"),   "blocked_next": frozenset(),   "direction": "c"},
    "pepsin":        {"sites": frozenset("FL"),   "blocked_next": frozenset(),   "direction": "c"},
    "nonspecific":   {"sites": frozenset(),       "blocked_next": frozenset(),   "direction": "c"},
}


def _count_missed_cleavages(stripped: str, enzyme: str = "trypsin") -> int:
    """Count missed cleavages in a bare amino acid sequence for a given enzyme.

    For C-terminal enzymes: counts cleavage-site AAs not at C-terminus
    and not followed by a blocked AA.
    For N-terminal enzymes (Asp-N): counts cleavage-site AAs not at
    N-terminus.
    Returns 0 for nonspecific digestion.
    """
    if not stripped:
        return 0
    rules = _ENZYME_RULES.get(enzyme, _ENZYME_RULES["trypsin"])
    sites = rules["sites"]
    blocked_next = rules["blocked_next"]
    direction = rules["direction"]

    if not sites:           # nonspecific
        return 0

    seq = stripped.upper()
    count = 0

    if direction == "c":
        # cleave after site AA — missed if not at C-terminus and next AA not blocked
        for i, aa in enumerate(seq[:-1]):
            if aa in sites and seq[i + 1] not in blocked_next:
                count += 1
    else:
        # cleave before site AA (Asp-N style) — missed if not at N-terminus
        for i, aa in enumerate(seq[1:], start=1):
            if aa in sites:
                count += 1

    return count


def get_enzyme_stats_diann(
    report_path: str | Path,
    run_name: str | None = None,
    enzyme: str = "trypsin",
) -> dict:
    """Parse DIA-NN report.parquet for enzyme efficiency and PTM statistics.

    Returns missed cleavage distribution, modification frequencies, and
    per-charge peptide counts — all derived from Modified.Sequence and
    Stripped.Sequence columns at 1% FDR.

    Returns empty dict if the report cannot be read or lacks sequence columns.
    """
    try:
        import polars as pl
    except ImportError:
        logger.error("polars is required for enzyme stats extraction")
        return {}

    report_path = Path(report_path)
    if not report_path.exists():
        return {}

    try:
        schema = pl.read_parquet_schema(str(report_path))
    except Exception:
        logger.exception("Cannot read schema: %s", report_path)
        return {}

    available = set(schema.keys())
    file_col = "Run" if "Run" in available else "File.Name"

    # Must have at least one sequence column
    if "Stripped.Sequence" not in available and "Modified.Sequence" not in available:
        logger.debug("No sequence columns in %s", report_path.name)
        return {}

    want = [c for c in [
        "Modified.Sequence", "Stripped.Sequence", "Precursor.Charge",
        "Q.Value", file_col,
    ] if c in available]

    try:
        df = pl.read_parquet(str(report_path), columns=want)
    except Exception:
        logger.exception("Failed to read %s", report_path)
        return {}

    df = df.filter(pl.col("Q.Value") <= _Q_CUTOFF)

    if run_name and file_col in df.columns:
        stem = Path(run_name).stem
        df_run = df.filter(pl.col(file_col).str.contains(stem, literal=True))
        if df_run.height > 0:
            df = df_run

    if df.height == 0:
        return {}

    n_precursors = df.height

    # ── Missed cleavages ──────────────────────────────────────────────
    mc_counts: dict[str, int] = {"0": 0, "1": 0, "2": 0, "3+": 0}
    if "Stripped.Sequence" in df.columns:
        seqs = df["Stripped.Sequence"].to_list()
    elif "Modified.Sequence" in df.columns:
        # Strip inline mods as fallback
        seqs = [_MOD_RE.sub("", s or "") for s in df["Modified.Sequence"].to_list()]
    else:
        seqs = []

    for seq in seqs:
        mc = _count_missed_cleavages(seq or "", enzyme=enzyme)
        key = str(min(mc, 3)) if mc < 3 else "3+"
        mc_counts[key] = mc_counts.get(key, 0) + 1

    total_mc = sum(mc_counts.values()) or 1
    mc_pct = {k: round(v / total_mc * 100, 1) for k, v in mc_counts.items()}

    # ── PTM frequencies ───────────────────────────────────────────────
    mod_counts: dict[str, int] = {}
    if "Modified.Sequence" in df.columns:
        for mod_seq in df["Modified.Sequence"].to_list():
            if not mod_seq:
                continue
            for unimod_id in _MOD_RE.findall(mod_seq):
                label = _UNIMOD_LABELS.get(unimod_id, f"UniMod:{unimod_id}")
                mod_counts[label] = mod_counts.get(label, 0) + 1

    # Remove Carbamidomethyl (fixed mod — not informative as PTM)
    mod_counts.pop("Carbamidomethyl (C)", None)

    # ── Unique peptides ───────────────────────────────────────────────
    if "Stripped.Sequence" in df.columns:
        n_unique_peptides = df["Stripped.Sequence"].n_unique()
    elif "Modified.Sequence" in df.columns:
        n_unique_peptides = df["Modified.Sequence"].n_unique()
    else:
        n_unique_peptides = 0

    # Sort mods by frequency descending, keep top 12
    sorted_mods = sorted(mod_counts.items(), key=lambda x: x[1], reverse=True)[:12]
    mods_out = [
        {"name": name, "count": cnt, "pct": round(cnt / n_precursors * 100, 2)}
        for name, cnt in sorted_mods
    ]

    return {
        "n_precursors":         n_precursors,
        "n_unique_peptides":    n_unique_peptides,
        "missed_cleavages":     mc_counts,
        "missed_cleavages_pct": mc_pct,
        "modifications":        mods_out,
        "enzyme":               enzyme,
        "source":               "diann",
    }
