"""Ion mobility visualization from Sage results.sage.parquet (DDA/ddaPASEF runs).

Extracts RT × 1/K0 density maps, 3D feature scatter, and charge distribution
directly from Sage PSM output so the 4D tabs work for DDA runs without needing
a DIA-NN report.parquet.

Confirmed Sage column names (results.sage.parquet):
  retention_time   Float   retention time in minutes
  charge           Int     precursor charge state
  calcmass         Float   calculated neutral monoisotopic mass
  expmass          Float   experimental neutral precursor mass
  ion_mobility     Float   1/K₀ in Vs/cm² (timsTOF ddaPASEF only)
  spectrum_q       Float   PSM-level q-value (Sage ≥ 0.14) — or q_value
  peptide          String  peptide sequence with Sage mod notation [+15.9949]
  proteins         String  protein accessions (semicolon-separated)

All return formats are identical to mobility_diann.py so the server endpoints
can transparently add Sage as a third fallback (4DFF > DIA-NN > Sage).
"""

from __future__ import annotations

import logging
import math
import random
import re
from pathlib import Path

logger = logging.getLogger(__name__)

_Q_CUTOFF   = 0.01    # 1% FDR
_PROTON     = 1.007276  # Da


def _load_psms(sage_path: str | Path) -> list[dict]:
    """Load Sage PSMs at 1% FDR with RT / m/z / mobility / charge.

    Filters to rows with ion_mobility > 0 (non-timsTOF files will have no
    ion_mobility column and return an empty list).

    Returns list of dicts: {rt, mz, mobility, charge, intensity}.
    """
    try:
        import polars as pl
    except ImportError:
        logger.error("polars required for Sage mobility extraction")
        return []

    sage_path = Path(sage_path)
    if not sage_path.exists():
        return []

    try:
        schema = pl.read_parquet_schema(str(sage_path))
    except Exception:
        logger.exception("Cannot read Sage schema: %s", sage_path)
        return []

    available = set(schema.keys())

    # ion_mobility only present for timsTOF acquisitions
    if "ion_mobility" not in available:
        logger.debug("No ion_mobility column in %s — not a timsTOF run", sage_path.name)
        return []

    q_col = next((c for c in ("spectrum_q", "q_value", "posterior_error") if c in available), None)
    if q_col is None:
        logger.warning("No q-value column found in %s", sage_path.name)
        return []

    mass_col = next((c for c in ("calcmass", "expmass") if c in available), None)
    if mass_col is None:
        logger.warning("No mass column found in %s", sage_path.name)
        return []

    rt_col     = next((c for c in ("retention_time", "rt") if c in available), None)
    charge_col = next((c for c in ("charge",) if c in available), None)
    score_col  = next((c for c in ("hyperscore", "score") if c in available), None)

    if not rt_col or not charge_col:
        logger.warning("Missing rt/charge columns in %s", sage_path.name)
        return []

    want = [c for c in [q_col, mass_col, rt_col, charge_col, "ion_mobility", score_col] if c]
    try:
        df = pl.read_parquet(str(sage_path), columns=want)
    except Exception:
        logger.exception("Failed to read %s", sage_path)
        return []

    df = df.filter(pl.col(q_col) <= _Q_CUTOFF)
    df = df.filter(pl.col("ion_mobility") > 0)

    if df.height == 0:
        return []

    rows = []
    for row in df.iter_rows(named=True):
        charge = int(row[charge_col]) if row[charge_col] else 0
        if charge < 1:
            continue
        mass   = float(row[mass_col] or 0)
        mz     = (mass + charge * _PROTON) / charge
        rt_min = float(row[rt_col] or 0)
        im     = float(row["ion_mobility"])
        score  = float(row[score_col]) if score_col and row.get(score_col) else 1.0
        rows.append({
            "rt":       rt_min * 60,   # minutes → seconds (same as DIA-NN module)
            "mz":       mz,
            "mobility": im,
            "charge":   charge,
            "intensity": score,        # hyperscore as proxy for intensity
        })
    return rows


# ── 3D feature point cloud ────────────────────────────────────────────

def get_feature_3d_data_sage(
    sage_path: str | Path,
    max_features: int = 5000,
) -> dict:
    """3D scatter (RT × m/z × 1/K₀) from Sage PSMs.

    Same output format as mobility_diann.get_feature_3d_data_diann.
    """
    rows = _load_psms(sage_path)
    if not rows:
        return {}

    if len(rows) > max_features:
        rows = random.sample(rows, max_features)

    return {
        "rt":       [round(r["rt"],       2) for r in rows],
        "mz":       [round(r["mz"],       4) for r in rows],
        "mobility": [round(r["mobility"], 4) for r in rows],
        "charge":   [r["charge"]             for r in rows],
        "intensity":[round(r["intensity"], 1)for r in rows],
        "source":   "sage",
    }


# ── 2D RT × 1/K0 density map ─────────────────────────────────────────

def get_mobility_map_sage(
    sage_path: str | Path,
    rt_bins: int = 60,
    mobility_bins: int = 50,
) -> dict:
    """2D density grid from Sage PSMs.

    Same output format as mobility_diann.get_mobility_map_diann.
    """
    rows = _load_psms(sage_path)
    if not rows:
        return {}

    rts  = [r["rt"]       for r in rows]
    mobs = [r["mobility"] for r in rows]

    rt_min, rt_max   = min(rts),  max(rts)
    mob_min, mob_max = min(mobs), max(mobs)

    rt_pad  = (rt_max  - rt_min)  * 0.01 + 0.1
    mob_pad = (mob_max - mob_min) * 0.01 + 0.001
    rt_lo,  rt_hi  = rt_min  - rt_pad,  rt_max  + rt_pad
    mob_lo, mob_hi = mob_min - mob_pad, mob_max + mob_pad

    rt_step  = (rt_hi  - rt_lo)  / rt_bins
    mob_step = (mob_hi - mob_lo) / mobility_bins

    grid = [[0.0] * mobility_bins for _ in range(rt_bins)]
    for r in rows:
        ri = min(int((r["rt"]       - rt_lo)  / rt_step),  rt_bins       - 1)
        mi = min(int((r["mobility"] - mob_lo) / mob_step), mobility_bins - 1)
        if 0 <= ri < rt_bins and 0 <= mi < mobility_bins:
            grid[ri][mi] += 1.0   # count-based (no quantity in Sage PSMs)

    for i in range(rt_bins):
        for j in range(mobility_bins):
            grid[i][j] = round(math.log10(grid[i][j] + 1), 3)

    rt_edges  = [round(rt_lo  + i * rt_step,  2) for i in range(rt_bins  + 1)]
    mob_edges = [round(mob_lo + i * mob_step, 4) for i in range(mobility_bins + 1)]

    return {
        "rt_edges":       rt_edges,
        "mobility_edges": mob_edges,
        "grid":           grid,
        "n_features":     len(rows),
        "rt_range":       [round(rt_min,  1), round(rt_max,  1)],
        "mobility_range": [round(mob_min, 4), round(mob_max, 4)],
        "source":         "sage",
    }


# ── Charge state distribution ─────────────────────────────────────────

def get_charge_distribution_sage(sage_path: str | Path) -> dict:
    """Charge distribution from Sage PSMs.

    Same output format as mobility_diann.get_charge_distribution_diann.
    """
    rows = _load_psms(sage_path)
    if not rows:
        return {}

    counts: dict[int, int] = {}
    for r in rows:
        counts[r["charge"]] = counts.get(r["charge"], 0) + 1

    charges = sorted(counts)
    total   = sum(counts.values())
    return {
        "charges":   charges,
        "counts":    [counts[z] for z in charges],
        "fractions": [round(counts[z] / total * 100, 1) for z in charges],
        "total":     total,
    }


# ── Immunopeptidomics helper ──────────────────────────────────────────

def load_immuno_psms_sage(
    sage_path: str | Path,
    mhc_class: int = 0,
) -> list[dict]:
    """Load peptides from Sage PSMs for immunopeptidomics analysis.

    Returns list of dicts: {seq, pep_len, intensity, im, protein}.
    mhc_class: 0=all lengths, 1=MHC-I (8-14aa), 2=MHC-II (13-25aa).
    """
    try:
        import polars as pl
        import re as _re
    except ImportError:
        return []

    sage_path = Path(sage_path)
    if not sage_path.exists():
        return []

    try:
        schema = pl.read_parquet_schema(str(sage_path))
    except Exception:
        return []

    available = set(schema.keys())

    q_col     = next((c for c in ("spectrum_q", "q_value", "posterior_error") if c in available), None)
    score_col = next((c for c in ("hyperscore", "score") if c in available), None)
    pep_col   = next((c for c in ("peptide", "sequence") if c in available), None)
    prot_col  = next((c for c in ("proteins", "protein") if c in available), None)
    im_col    = "ion_mobility" if "ion_mobility" in available else None

    if not q_col or not pep_col:
        return []

    want = [c for c in [q_col, pep_col, prot_col, im_col, score_col] if c]
    try:
        df = pl.read_parquet(str(sage_path), columns=want)
    except Exception:
        return []

    df = df.filter(pl.col(q_col) <= _Q_CUTOFF)
    if df.height == 0:
        return []

    # Strip Sage mod notation: [+15.9949], [-17.0265], etc.
    _mod_pat = _re.compile(r"\[[\+\-][\d\.]+\]")

    results = []
    for row in df.iter_rows(named=True):
        raw_seq = row.get(pep_col, "") or ""
        clean   = _mod_pat.sub("", raw_seq).upper().strip()
        if not clean:
            continue
        plen = len(clean)
        if mhc_class == 1 and not (8 <= plen <= 14):
            continue
        if mhc_class == 2 and not (13 <= plen <= 25):
            continue

        im    = float(row[im_col])  if im_col and row.get(im_col)  else None
        score = float(row[score_col]) if score_col and row.get(score_col) else 1.0
        prot  = str(row.get(prot_col) or "") if prot_col else ""

        results.append({
            "seq":       clean,
            "pep_len":   plen,
            "intensity": score,
            "im":        im,
            "protein":   prot[:60],
        })

    return results


# ── CCS values (1/K₀ → Å²) ───────────────────────────────────────────

def get_ccs_data_sage(
    sage_path: str | Path,
    max_scatter: int = 5000,
    hist_bins: int = 50,
) -> dict:
    """CCS vs m/z scatter and per-charge CCS distribution from Sage PSMs.

    Same output format as mobility_diann.get_ccs_data_diann so the CCS tab
    works identically for ddaPASEF runs searched with Sage.
    """
    rows = _load_psms(sage_path)
    if not rows:
        return {}

    ccs_available = False
    try:
        from stan.tools.timsdata.timsdata import oneOverK0ToCCSforMz
        ccs_available = True
    except Exception:
        logger.warning("timsdata DLL not available — using 1/K₀ for CCS tab")

    if ccs_available:
        working: list[dict] = []
        for r in rows:
            try:
                ccs = oneOverK0ToCCSforMz(r["mobility"], r["charge"], r["mz"])
                if ccs and ccs > 0:
                    working.append({**r, "ccs": round(float(ccs), 2)})
            except Exception:
                continue
        if not working:
            ccs_available = False
            working = rows
    else:
        working = rows

    if not working:
        return {}

    n_total = len(working)
    by_charge: dict[int, list] = {}
    for r in working:
        by_charge.setdefault(r["charge"], []).append(r)

    scatter: dict[str, dict] = {}
    for z, zrows in sorted(by_charge.items()):
        zrows_s = sorted(zrows, key=lambda r: r["intensity"], reverse=True)
        cap = max(300, int(max_scatter * len(zrows) / n_total))
        sub = zrows_s[:cap]
        entry: dict = {
            "mz": [round(r["mz"],      3) for r in sub],
            "im": [round(r["mobility"], 4) for r in sub],
            "rt": [round(r["rt"] / 60, 3) for r in sub],
        }
        if ccs_available:
            entry["ccs"] = [r["ccs"] for r in sub]
        scatter[str(z)] = entry

    histograms: dict[str, dict] = {}
    for z, zrows in sorted(by_charge.items()):
        vals = sorted(r["ccs"] if ccs_available else r["mobility"] for r in zrows)
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
        histograms[str(z)] = {
            "edges":  [round(lo + i * step, dp) for i in range(hist_bins + 1)],
            "counts": counts,
            "median": round(vals[len(vals) // 2], dp),
            "n":      len(vals),
        }

    return {
        "scatter":       scatter,
        "histograms":    histograms,
        "n_total":       n_total,
        "ccs_available": ccs_available,
    }


# ── Enzyme efficiency / PTM stats ─────────────────────────────────────

# Sage mass-shift → modification label for enzyme stats display
_SAGE_MOD_LABELS: dict[str, str] = {
    "+15.9949": "Oxidation (M)",    "15.9949": "Oxidation (M)",
    "+57.0215": "Carbamidomethyl (C)", "57.0215": "Carbamidomethyl (C)",
    "+57.021":  "Carbamidomethyl (C)",
    "+79.9663": "Phospho (STY)",    "79.9663": "Phospho (STY)",
    "+42.0106": "Acetyl (N-term)",  "42.0106": "Acetyl (N-term)",
    "-17.0265": "Deamidation (NQ)", "+0.9840":  "Deamidation (NQ)",
    "+14.0157": "Methylation",
    "+28.0313": "Dimethylation",
}

_SAGE_MOD_RE = re.compile(r"\[([\+\-]?[\d\.]+)\]")


def get_enzyme_stats_sage(
    sage_path: str | Path,
    enzyme: str = "trypsin",
) -> dict:
    """Enzyme efficiency and PTM statistics from Sage results.sage.parquet.

    Same output format as mobility_diann.get_enzyme_stats_diann.
    """
    try:
        import polars as pl
    except ImportError:
        return {}

    # Import shared helpers from mobility_diann
    try:
        from stan.metrics.mobility_diann import _count_missed_cleavages
    except ImportError:
        return {}

    sage_path = Path(sage_path)
    if not sage_path.exists():
        return {}

    try:
        schema = pl.read_parquet_schema(str(sage_path))
    except Exception:
        return {}

    available = set(schema.keys())
    q_col     = next((c for c in ("spectrum_q", "q_value", "posterior_error") if c in available), None)
    pep_col   = next((c for c in ("peptide", "sequence") if c in available), None)
    charge_col = "charge" if "charge" in available else None

    if not q_col or not pep_col:
        return {}

    want = [c for c in [q_col, pep_col, charge_col] if c]
    try:
        df = pl.read_parquet(str(sage_path), columns=want)
    except Exception:
        return {}

    df = df.filter(pl.col(q_col) <= _Q_CUTOFF)
    if df.height == 0:
        return {}

    n_precursors = df.height

    # Missed cleavages — strip Sage mod notation first
    mc_counts: dict[str, int] = {"0": 0, "1": 0, "2": 0, "3+": 0}
    n_unique_peptides = 0
    mod_counts: dict[str, int] = {}
    unique_stripped: set[str] = set()

    for pep_raw in df[pep_col].drop_nulls().to_list():
        # Extract mods before stripping
        for shift in _SAGE_MOD_RE.findall(pep_raw):
            lbl = _SAGE_MOD_LABELS.get(shift) or _SAGE_MOD_LABELS.get(f"+{shift}") or f"[{shift}]"
            mod_counts[lbl] = mod_counts.get(lbl, 0) + 1

        stripped = _SAGE_MOD_RE.sub("", pep_raw).upper().strip()
        unique_stripped.add(stripped)
        mc = _count_missed_cleavages(stripped, enzyme=enzyme)
        key = str(mc) if mc < 3 else "3+"
        mc_counts[key] = mc_counts.get(key, 0) + 1

    n_unique_peptides = len(unique_stripped)

    # Remove fixed mod (Carbamidomethyl) — not informative as PTM
    mod_counts.pop("Carbamidomethyl (C)", None)

    total_mc = sum(mc_counts.values()) or 1
    mc_pct = {k: round(v / total_mc * 100, 1) for k, v in mc_counts.items()}

    sorted_mods = sorted(mod_counts.items(), key=lambda x: x[1], reverse=True)[:12]
    mods_out = [
        {"name": n, "count": c, "pct": round(c / n_precursors * 100, 2)}
        for n, c in sorted_mods
    ]

    return {
        "n_precursors":         n_precursors,
        "n_unique_peptides":    n_unique_peptides,
        "missed_cleavages":     mc_counts,
        "missed_cleavages_pct": mc_pct,
        "modifications":        mods_out,
        "enzyme":               enzyme,
        "source":               "sage",
    }
