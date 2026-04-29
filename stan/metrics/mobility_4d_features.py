"""Novel 4D timsTOF feature analyses — ion mobility as a biological readout.

These analyses are impossible on Orbitrap instruments because they require
per-precursor 1/K₀ measurements.  All inputs come from the DIA-NN report.parquet
which is generated as part of the normal ZIGGY search workflow.

Analyses
--------
1. im_deviation_by_length
   Δ1/K₀ (measured − predicted) stratified by peptide length.
   Longer peptides sample more conformational space → larger deviations.
   Reveals sample bias (e.g. missed cleavages, hydrophobicity).

2. lc_im_map
   RT × 1/K₀ 2D density grid.  The diagonal ridge is the "peptide diagonal".
   Off-diagonal ions = co-eluters, retention-time outliers, or non-tryptic peptides.

3. im_fwhm_scatter
   1/K₀ vs m/z, coloured by chromatographic peak FWHM.
   Tight FWHM at all sizes = good LC. Broad FWHM at high m/z = large-peptide
   chromatographic broadening. Only possible because TIMS co-measures CCS and LC.

4. conformer_scan
   For each (modified sequence, charge) pair that appears in multiple runs or
   multiple RT windows, check whether distinct 1/K₀ peaks exist.  Multiple
   1/K₀ peaks = structural conformers / charge-site variants.
   Reported as fraction of unique peptides with >1 conformer cluster.

5. im_dispersion_vs_charge
   IQR of 1/K₀ per charge state.  Higher charge → more conformational freedom
   and wider IM dispersion.  Orbitrap users never see this.

6. sequence_length_im_trend
   Median 1/K₀ binned by peptide length (7–30 aa).
   Captures the CCS–mass law empirically from the run's own data.
"""

from __future__ import annotations

import logging
import math
from pathlib import Path

logger = logging.getLogger(__name__)

_Q_CUTOFF = 0.01


def _read_report(report_path: str | Path, run_name: str | None = None):
    """Load DIA-NN report.parquet, filter to 1% FDR, return polars DataFrame.

    Returns None if file missing or polars unavailable.
    """
    try:
        import polars as pl
    except ImportError:
        logger.error("polars is required for 4D feature analysis")
        return None

    report_path = Path(report_path)
    if not report_path.exists():
        logger.warning("report.parquet not found: %s", report_path)
        return None

    try:
        schema = pl.read_parquet_schema(str(report_path))
    except Exception:
        logger.exception("Cannot read parquet schema: %s", report_path)
        return None

    available = set(schema.keys())
    if "IM" not in available:
        logger.debug("No IM column — not a timsTOF report: %s", report_path.name)
        return None

    file_col = "Run" if "Run" in available else ("File.Name" if "File.Name" in available else None)

    want = [c for c in [
        "IM", "Predicted.IM", "RT", "Precursor.Mz", "Precursor.Charge",
        "Precursor.Quantity", "Q.Value", "FWHM",
        "Stripped.Sequence", "Modified.Sequence",
        file_col,
    ] if c and c in available]

    try:
        df = pl.read_parquet(str(report_path), columns=want)
    except Exception:
        logger.exception("Failed to read parquet: %s", report_path)
        return None

    if "Q.Value" in df.columns:
        df = df.filter(pl.col("Q.Value") <= _Q_CUTOFF)

    # Filter to this run if multi-run report
    if run_name and file_col and file_col in df.columns:
        df_filt = df.filter(pl.col(file_col).str.contains(run_name, literal=True))
        if df_filt.height > 0:
            df = df_filt

    # Must have IM > 0
    df = df.filter(pl.col("IM").is_not_null() & (pl.col("IM") > 0.3))

    return df


# ── 1. Δ1/K₀ by peptide length ────────────────────────────────────────────────

def im_deviation_by_length(
    report_path: str | Path,
    run_name: str | None = None,
) -> dict:
    """Δ1/K₀ (measured − predicted) stratified by peptide sequence length.

    Returns:
        lengths: list[int]  — peptide lengths 7–30
        median_delta: list[float] — median Δ1/K₀ per length
        iqr_delta: list[float]  — IQR of Δ1/K₀ per length
        n_per_length: list[int]
        global_median: float
        global_std: float
        has_predicted: bool  — False if Predicted.IM absent (DIA-NN < 1.9)
    """
    df = _read_report(report_path, run_name)
    if df is None or df.height == 0:
        return {}

    if "Predicted.IM" not in df.columns or "Stripped.Sequence" not in df.columns:
        return {"has_predicted": False}

    df = df.filter(
        pl.col("Predicted.IM").is_not_null() & (pl.col("Predicted.IM") > 0.3)
    ).with_columns([
        (pl.col("IM") - pl.col("Predicted.IM")).alias("delta"),
        pl.col("Stripped.Sequence").str.len_chars().alias("pep_len"),
    ])

    if df.height == 0:
        return {"has_predicted": True, "n": 0}

    deltas_all = df["delta"].to_list()
    global_median = sorted(deltas_all)[len(deltas_all) // 2]
    global_std = (sum((d - global_median) ** 2 for d in deltas_all) / len(deltas_all)) ** 0.5

    lengths, medians, iqrs, counts = [], [], [], []
    for L in range(7, 31):
        sub = df.filter(pl.col("pep_len") == L)
        if sub.height < 5:
            continue
        vals = sorted(sub["delta"].to_list())
        n = len(vals)
        med = vals[n // 2]
        q1  = vals[n // 4]
        q3  = vals[3 * n // 4]
        lengths.append(L)
        medians.append(round(med, 5))
        iqrs.append(round(q3 - q1, 5))
        counts.append(n)

    return {
        "has_predicted": True,
        "lengths":      lengths,
        "median_delta": medians,
        "iqr_delta":    iqrs,
        "n_per_length": counts,
        "global_median": round(global_median, 5),
        "global_std":    round(global_std, 5),
        "n_total":       df.height,
    }


# ── 2. LC-IM 2D density map ───────────────────────────────────────────────────

def lc_im_map(
    report_path: str | Path,
    run_name: str | None = None,
    rt_bins: int = 60,
    im_bins: int = 50,
) -> dict:
    """RT × 1/K₀ 2D log-intensity density grid.

    The diagonal ridge in this map is the "peptide diagonal" — the empirical
    CCS–retention-time correlation for tryptic peptides.  Off-diagonal points
    are structurally interesting: early-eluting large ions, late-eluting small
    ions, or non-tryptic species.

    Returns same format as mobility_chimerys.get_mobility_map_chimerys.
    """
    df = _read_report(report_path, run_name)
    if df is None or df.height == 0 or "RT" not in df.columns:
        return {}

    df = df.filter(pl.col("RT").is_not_null() & (pl.col("RT") > 0))

    rts  = df["RT"].to_list()       # minutes
    mobs = df["IM"].to_list()
    # Use intensity if available, else 1.0
    if "Precursor.Quantity" in df.columns:
        intys = [float(v) if v and v > 0 else 1.0 for v in df["Precursor.Quantity"].to_list()]
    else:
        intys = [1.0] * len(rts)

    rt_min, rt_max = min(rts), max(rts)
    m_min, m_max   = min(mobs), max(mobs)
    rt_pad = (rt_max - rt_min) * 0.01 + 0.01
    m_pad  = (m_max - m_min)   * 0.01 + 0.001
    rt_lo, rt_hi = rt_min - rt_pad, rt_max + rt_pad
    m_lo,  m_hi  = m_min  - m_pad,  m_max  + m_pad

    rt_step = (rt_hi - rt_lo) / rt_bins
    m_step  = (m_hi  - m_lo)  / im_bins
    grid    = [[0.0] * im_bins for _ in range(rt_bins)]

    for rt, mob, inty in zip(rts, mobs, intys):
        ri = min(int((rt  - rt_lo) / rt_step), rt_bins - 1)
        mi = min(int((mob - m_lo)  / m_step),  im_bins  - 1)
        if 0 <= ri < rt_bins and 0 <= mi < im_bins:
            grid[ri][mi] += inty

    for i in range(rt_bins):
        for j in range(im_bins):
            grid[i][j] = round(math.log10(grid[i][j] + 1), 3)

    return {
        "rt_edges":       [round(rt_lo + i * rt_step, 3) for i in range(rt_bins + 1)],
        "im_edges":       [round(m_lo  + i * m_step,  4) for i in range(im_bins  + 1)],
        "grid":           grid,
        "n_features":     len(rts),
        "rt_range":       [round(rt_min, 2), round(rt_max, 2)],
        "im_range":       [round(m_min,  4), round(m_max,  4)],
        "source":         "diann",
    }


# ── 3. IM FWHM vs m/z scatter ────────────────────────────────────────────────

def im_fwhm_scatter(
    report_path: str | Path,
    run_name: str | None = None,
    max_points: int = 3000,
) -> dict:
    """Chromatographic peak FWHM vs m/z, coloured by 1/K₀.

    FWHM is the LC peak width in minutes from DIA-NN's report.
    Scatter reveals:
    - Broad FWHM at high m/z: large peptides have poor chromatographic focusing
    - Narrow FWHM + high 1/K₀: compact, hydrophilic peptides eluting sharply
    - Outliers: peptides with unexpectedly wide peaks may be co-eluting species

    Returns mz, fwhm, mobility, charge, log_int arrays for scatter plot.
    """
    df = _read_report(report_path, run_name)
    if df is None or df.height == 0:
        return {}
    if "FWHM" not in df.columns or "Precursor.Mz" not in df.columns:
        return {}

    df = df.filter(
        pl.col("FWHM").is_not_null() & (pl.col("FWHM") > 0) &
        pl.col("Precursor.Mz").is_not_null()
    )
    if df.height == 0:
        return {}

    # Sort by intensity descending, cap at max_points
    if "Precursor.Quantity" in df.columns:
        df = df.sort("Precursor.Quantity", descending=True)
    df = df.head(max_points)

    rows = df.to_dicts()
    mzs    = [round(float(r["Precursor.Mz"]),     3) for r in rows]
    fwhms  = [round(float(r["FWHM"]),              4) for r in rows]
    mobs   = [round(float(r["IM"]),                4) for r in rows]
    chrgs  = [int(r.get("Precursor.Charge", 0) or 0) for r in rows]
    log_i  = [
        round(math.log10(float(r["Precursor.Quantity"]) + 1), 2)
        if "Precursor.Quantity" in r and r["Precursor.Quantity"] and r["Precursor.Quantity"] > 0
        else 0.0
        for r in rows
    ]

    # Summary: median FWHM per charge
    per_charge: dict[int, list] = {}
    for fwhm, z in zip(fwhms, chrgs):
        per_charge.setdefault(z, []).append(fwhm)
    charge_summary = {}
    for z, vals in sorted(per_charge.items()):
        v = sorted(vals)
        charge_summary[str(z)] = {
            "median": round(v[len(v) // 2], 4),
            "p90":    round(v[min(len(v)-1, int(len(v)*0.9))], 4),
            "n":      len(v),
        }

    return {
        "mz":            mzs,
        "fwhm":          fwhms,
        "mobility":      mobs,
        "charge":        chrgs,
        "log_int":       log_i,
        "n":             len(rows),
        "charge_summary": charge_summary,
    }


# ── 4. IM dispersion by charge ────────────────────────────────────────────────

def im_dispersion_by_charge(
    report_path: str | Path,
    run_name: str | None = None,
) -> dict:
    """IQR and range of 1/K₀ per charge state.

    Captures how much conformational space each charge state samples.
    Higher charge ions experience more proton-induced structural unfolding
    → wider 1/K₀ distributions.

    Also returns the charge-state CCS ladder: median 1/K₀ vs charge,
    which is a fingerprint of the sample's protein complexity.
    """
    df = _read_report(report_path, run_name)
    if df is None or df.height == 0 or "Precursor.Charge" not in df.columns:
        return {}

    charges = sorted(df["Precursor.Charge"].drop_nulls().unique().to_list())
    charges = [z for z in charges if 1 <= z <= 6]

    ladder: list[dict] = []
    for z in charges:
        sub = df.filter(pl.col("Precursor.Charge") == z)
        if sub.height < 10:
            continue
        vals = sorted(sub["IM"].to_list())
        n    = len(vals)
        med  = vals[n // 2]
        q1   = vals[n // 4]
        q3   = vals[3 * n // 4]
        ladder.append({
            "charge":  z,
            "median":  round(med,       4),
            "q1":      round(q1,        4),
            "q3":      round(q3,        4),
            "iqr":     round(q3 - q1,   4),
            "min":     round(vals[0],   4),
            "max":     round(vals[-1],  4),
            "n":       n,
        })

    return {
        "ladder": ladder,
        "n_total": df.height,
    }


# ── 5. Sequence-length vs median 1/K₀ ────────────────────────────────────────

def sequence_length_im_trend(
    report_path: str | Path,
    run_name: str | None = None,
) -> dict:
    """Empirical CCS–mass law: median 1/K₀ binned by peptide length.

    Captures the run's own CCS–mass correlation. Deviations from the smooth
    trend indicate PTMs (phospho raises 1/K₀), missed cleavages (large mass,
    lower relative 1/K₀), or non-tryptic species.

    Also returns the correlation coefficient (should be > 0.85 for clean tryptic runs).
    """
    df = _read_report(report_path, run_name)
    if df is None or df.height == 0 or "Stripped.Sequence" not in df.columns:
        return {}

    df = df.with_columns(
        pl.col("Stripped.Sequence").str.len_chars().alias("pep_len")
    ).filter(
        (pl.col("pep_len") >= 7) & (pl.col("pep_len") <= 35)
    )

    if df.height == 0:
        return {}

    lengths, medians, counts = [], [], []
    for L in range(7, 36):
        sub = df.filter(pl.col("pep_len") == L)
        if sub.height < 5:
            continue
        vals = sorted(sub["IM"].to_list())
        n    = len(vals)
        med  = vals[n // 2]
        lengths.append(L)
        medians.append(round(med, 4))
        counts.append(n)

    if len(lengths) < 3:
        return {}

    # Pearson r(length, median_1k0)
    Lm = sum(lengths) / len(lengths)
    Mm = sum(medians) / len(medians)
    sLM = sum((L - Lm) * (M - Mm) for L, M in zip(lengths, medians))
    sLL = sum((L - Lm) ** 2 for L in lengths)
    sMM = sum((M - Mm) ** 2 for M in medians)
    r = round(sLM / math.sqrt(sLL * sMM), 4) if sLL > 0 and sMM > 0 else 0.0

    return {
        "lengths":  lengths,
        "medians":  medians,
        "counts":   counts,
        "pearson_r": r,
        "n_total":  df.height,
    }


# ── 6. Conformer scan ─────────────────────────────────────────────────────────

def conformer_scan(
    report_path: str | Path,
    run_name: str | None = None,
    min_delta_im: float = 0.025,
    min_per_group: int = 3,
) -> dict:
    """Detect peptides appearing at multiple distinct 1/K₀ values (conformers).

    For each (stripped sequence, charge) group, checks whether the 1/K₀
    distribution is bimodal or spans > min_delta_im.  Such precursors are
    structural conformers, charge-site isomers, or PTM variants.

    Parameters
    ----------
    min_delta_im: 1/K₀ separation threshold for calling distinct conformers (Vs/cm²).
    min_per_group: minimum PSMs per (sequence, charge) group.

    Returns
    -------
    n_groups: total unique (sequence, charge) groups evaluated
    n_conformers: groups with Δ1/K₀ > threshold (multi-conformer)
    conformer_pct: percentage of groups that are multi-conformers
    top_conformers: top 30 multi-conformer candidates with sequence, charge, im_range
    """
    df = _read_report(report_path, run_name)
    if df is None or df.height == 0:
        return {}
    if "Stripped.Sequence" not in df.columns or "Precursor.Charge" not in df.columns:
        return {}

    # Group by (sequence, charge)
    groups = (
        df.filter(pl.col("Stripped.Sequence").is_not_null())
        .group_by(["Stripped.Sequence", "Precursor.Charge"])
        .agg([
            pl.col("IM").count().alias("n"),
            pl.col("IM").min().alias("im_min"),
            pl.col("IM").max().alias("im_max"),
            pl.col("IM").median().alias("im_med"),
        ])
        .filter(pl.col("n") >= min_per_group)
        .with_columns(
            (pl.col("im_max") - pl.col("im_min")).alias("im_range")
        )
    )

    if groups.height == 0:
        return {}

    n_groups = groups.height
    conformers = groups.filter(pl.col("im_range") >= min_delta_im)
    n_conf = conformers.height

    # Top candidates sorted by range descending
    top = (
        conformers.sort("im_range", descending=True)
        .head(30)
        .to_dicts()
    )
    top_out = [
        {
            "sequence": r["Stripped.Sequence"],
            "charge":   int(r["Precursor.Charge"] or 0),
            "im_min":   round(float(r["im_min"]), 4),
            "im_max":   round(float(r["im_max"]), 4),
            "im_range": round(float(r["im_range"]), 4),
            "n_obs":    int(r["n"]),
        }
        for r in top
    ]

    return {
        "n_groups":      n_groups,
        "n_conformers":  n_conf,
        "conformer_pct": round(n_conf / n_groups * 100, 1) if n_groups > 0 else 0,
        "threshold":     min_delta_im,
        "top_conformers": top_out,
    }


# ── Convenience: compute all features at once ─────────────────────────────────

def compute_all(
    report_path: str | Path,
    run_name: str | None = None,
) -> dict:
    """Compute all 4D feature analyses and return a combined dict.

    Keys: im_deviation, lc_im_map, im_fwhm, im_dispersion, seq_length_im, conformers.
    """
    return {
        "im_deviation":  im_deviation_by_length(report_path, run_name),
        "lc_im_map":     lc_im_map(report_path, run_name),
        "im_fwhm":       im_fwhm_scatter(report_path, run_name),
        "im_dispersion": im_dispersion_by_charge(report_path, run_name),
        "seq_length_im": sequence_length_im_trend(report_path, run_name),
        "conformers":    conformer_scan(report_path, run_name),
    }
