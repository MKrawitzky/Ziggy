"""Ion mobility visualization data from 4DFF .features SQLite output.

Reads LcTimsMsFeature table and produces pre-binned 2D grids and
histogram data for the STAN dashboard ion mobility viewer.

Skyline-style: RT × 1/K0 heatmap colored by log(intensity)
Peaks Studio-style: charge-state distribution, intensity histogram,
                    feature-count FWHM histogram
4D scatter:   RT × m/z × 1/K0 point cloud coloured by charge state
              (Plotly scatter3d in the Ion Mobility tab)
"""

from __future__ import annotations

import logging
import math
import sqlite3
from pathlib import Path

logger = logging.getLogger(__name__)

_MIN_CHARGE_FOR_PLOTS = 0   # include unassigned (0) and singly-charged (1)


def find_features_file(raw_path: str | Path) -> Path | None:
    """Locate the .features SQLite file that 4DFF writes alongside a .d run.

    4DFF places <run_stem>.features in the same directory as the .d folder.
    Example: /data/Run01.d  →  /data/Run01.features

    Returns None if the file does not exist (4DFF may not have been run).
    """
    raw_path = Path(raw_path)
    parent = raw_path.parent if raw_path.suffix.lower() == ".d" else raw_path.parent
    stem = raw_path.stem
    candidate = parent / f"{stem}.features"
    if candidate.exists():
        return candidate
    # Also check inside the .d directory itself (older 4DFF versions)
    inside = raw_path / f"{stem}.features"
    if inside.exists():
        return inside
    return None


# ── 2D RT × 1/K0 density map ─────────────────────────────────────────

def get_mobility_map(
    features_path: str | Path,
    rt_bins: int = 60,
    mobility_bins: int = 50,
    min_charge: int = _MIN_CHARGE_FOR_PLOTS,
) -> dict:
    """Compute a 2D RT × 1/K0 intensity grid from .features data.

    Returns a dict for JSON serialization:
      rt_edges       : list[float], length rt_bins+1 (seconds)
      mobility_edges : list[float], length mobility_bins+1 (1/K0, Vs/cm²)
      grid           : list[list[float]], [rt_bin][mob_bin] = log10(Σintensity+1)
      n_features     : int, total feature count (z ≥ min_charge)
      rt_range       : [min_rt, max_rt] in seconds
      mobility_range : [min_mob, max_mob] in 1/K0
    """
    features_path = Path(features_path)
    if not features_path.exists():
        return {}

    with sqlite3.connect(str(features_path)) as con:
        rows = con.execute(
            "SELECT RT, Mobility, Intensity FROM LcTimsMsFeature "
            "WHERE (Charge >= ? OR Charge IS NULL)",
            (min_charge,),
        ).fetchall()

    if not rows:
        return {}

    rts = [r[0] for r in rows]
    mobs = [r[1] for r in rows]
    intensities = [r[2] for r in rows]

    rt_min, rt_max = min(rts), max(rts)
    mob_min, mob_max = min(mobs), max(mobs)

    # Small padding so edge features fall inside the last bin
    rt_pad = (rt_max - rt_min) * 0.01 + 0.1
    mob_pad = (mob_max - mob_min) * 0.01 + 0.001
    rt_lo, rt_hi = rt_min - rt_pad, rt_max + rt_pad
    mob_lo, mob_hi = mob_min - mob_pad, mob_max + mob_pad

    rt_step = (rt_hi - rt_lo) / rt_bins
    mob_step = (mob_hi - mob_lo) / mobility_bins

    grid = [[0.0] * mobility_bins for _ in range(rt_bins)]

    for rt, mob, intensity in zip(rts, mobs, intensities):
        ri = min(int((rt - rt_lo) / rt_step), rt_bins - 1)
        mi = min(int((mob - mob_lo) / mob_step), mobility_bins - 1)
        if 0 <= ri < rt_bins and 0 <= mi < mobility_bins:
            grid[ri][mi] += intensity

    # log10 transform for display
    for i in range(rt_bins):
        for j in range(mobility_bins):
            grid[i][j] = round(math.log10(grid[i][j] + 1), 3)

    rt_edges = [round(rt_lo + i * rt_step, 2) for i in range(rt_bins + 1)]
    mob_edges = [round(mob_lo + i * mob_step, 4) for i in range(mobility_bins + 1)]

    return {
        "rt_edges": rt_edges,
        "mobility_edges": mob_edges,
        "grid": grid,
        "n_features": len(rows),
        "rt_range": [round(rt_min, 1), round(rt_max, 1)],
        "mobility_range": [round(mob_min, 4), round(mob_max, 4)],
    }


# ── Charge state distribution ─────────────────────────────────────────

def get_charge_distribution(features_path: str | Path) -> dict:
    """Return per-charge-state feature counts and fractions.

    Returns:
      charges   : list[int]   charge states present
      counts    : list[int]   feature count per charge state
      fractions : list[float] percentage per charge state (0–100)
      total     : int         grand total
    """
    features_path = Path(features_path)
    if not features_path.exists():
        return {}

    with sqlite3.connect(str(features_path)) as con:
        rows = con.execute(
            "SELECT COALESCE(Charge, 0) AS z, COUNT(*) "
            "FROM LcTimsMsFeature GROUP BY z ORDER BY z",
        ).fetchall()

    if not rows:
        return {}

    total = sum(r[1] for r in rows)
    return {
        "charges": [r[0] for r in rows],
        "counts": [r[1] for r in rows],
        "fractions": [round(r[1] / total * 100, 1) for r in rows],
        "total": total,
    }


# ── Ion mobility FWHM histogram ───────────────────────────────────────

def get_mobility_fwhm_histogram(
    features_path: str | Path,
    bins: int = 40,
    min_charge: int = _MIN_CHARGE_FOR_PLOTS,
) -> dict:
    """Histogram of per-feature 1/K0 FWHM (Mobility_upper − Mobility_lower).

    Returns:
      edges      : list[float] bin edges (1/K0 units), length bins+1
      counts     : list[int]   feature count per bin
      median_fwhm: float       median FWHM across all features
      n          : int         feature count used
    """
    features_path = Path(features_path)
    if not features_path.exists():
        return {}

    with sqlite3.connect(str(features_path)) as con:
        rows = con.execute(
            """SELECT (Mobility_upper - Mobility_lower) AS fwhm
               FROM LcTimsMsFeature
               WHERE (Charge >= ? OR Charge IS NULL) AND Mobility_upper IS NOT NULL""",
            (min_charge,),
        ).fetchall()

    if not rows:
        return {}

    fwhms = sorted(r[0] for r in rows)
    fwhm_min, fwhm_max = fwhms[0], fwhms[-1]

    if fwhm_max <= fwhm_min:
        return {}

    step = (fwhm_max - fwhm_min) / bins
    counts = [0] * bins
    for f in fwhms:
        i = min(int((f - fwhm_min) / step), bins - 1)
        counts[i] += 1

    edges = [round(fwhm_min + i * step, 5) for i in range(bins + 1)]
    median = fwhms[len(fwhms) // 2]

    return {
        "edges": edges,
        "counts": counts,
        "median_fwhm": round(median, 5),
        "n": len(fwhms),
    }


# ── Feature intensity histogram ───────────────────────────────────────

def get_intensity_histogram(
    features_path: str | Path,
    bins: int = 40,
    min_charge: int = _MIN_CHARGE_FOR_PLOTS,
) -> dict:
    """Log10(intensity) histogram — dynamic range view (Peaks Studio style).

    Returns:
      edges   : list[float] log10(intensity) bin edges, length bins+1
      counts  : list[int]   feature count per bin
      n       : int         total features
    """
    features_path = Path(features_path)
    if not features_path.exists():
        return {}

    with sqlite3.connect(str(features_path)) as con:
        rows = con.execute(
            "SELECT Intensity FROM LcTimsMsFeature "
            "WHERE (Charge >= ? OR Charge IS NULL) AND Intensity > 0",
            (min_charge,),
        ).fetchall()

    if not rows:
        return {}

    log_intensities = sorted(math.log10(r[0]) for r in rows)
    lo, hi = log_intensities[0], log_intensities[-1]

    if hi <= lo:
        return {}

    step = (hi - lo) / bins
    counts = [0] * bins
    for v in log_intensities:
        i = min(int((v - lo) / step), bins - 1)
        counts[i] += 1

    edges = [round(lo + i * step, 3) for i in range(bins + 1)]
    return {
        "edges": edges,
        "counts": counts,
        "n": len(log_intensities),
    }


# ── 3D feature point cloud (RT × m/z × 1/K0) ────────────────────────

def get_feature_3d_data(
    features_path: str | Path,
    max_features: int = 5000,
    min_charge: int = _MIN_CHARGE_FOR_PLOTS,
) -> dict:
    """Return feature coordinates for a Plotly scatter3d plot.

    Axes: RT (X), m/z (Y), 1/K0 (Z).  Colour = charge state.
    Marker size encodes log10(intensity).
    Top features by intensity are returned so the loudest peptide
    landscape is always visible even at the default point cap.

    Returns:
      rt       : list[float]  retention times (s)
      mz       : list[float]  m/z (monoisotopic, Th)
      mobility : list[float]  1/K0 (Vs/cm²)
      log_int  : list[float]  log10(intensity) for size encoding
      charge   : list[int]    charge state per feature
      n_total  : int          total features in the file (for subtitle)
      n_shown  : int          features actually returned
    """
    features_path = Path(features_path)
    if not features_path.exists():
        return {}

    with sqlite3.connect(str(features_path)) as con:
        cols = {r[1] for r in con.execute("PRAGMA table_info(LcTimsMsFeature)")}
        if "MZ" not in cols:
            logger.warning(
                "LcTimsMsFeature has no MZ column in %s — "
                "cannot build 3D scatter (4DFF version mismatch?)",
                features_path.name,
            )
            return {}

        total_row = con.execute(
            "SELECT COUNT(*) FROM LcTimsMsFeature "
            "WHERE (Charge >= ? OR Charge IS NULL) AND Intensity > 0",
            (min_charge,),
        ).fetchone()
        n_total = total_row[0] if total_row else 0

        rows = con.execute(
            "SELECT RT, MZ, Mobility, Intensity, COALESCE(Charge, 0) AS z "
            "FROM LcTimsMsFeature "
            "WHERE (Charge >= ? OR Charge IS NULL) AND Intensity > 0 "
            "ORDER BY Intensity DESC LIMIT ?",
            (min_charge, max_features),
        ).fetchall()

    if not rows:
        return {}

    return {
        "rt":       [round(r[0], 2) for r in rows],
        "mz":       [round(r[1], 4) for r in rows],
        "mobility": [round(r[2], 4) for r in rows],
        "log_int":  [round(math.log10(r[3]), 2) for r in rows],
        "charge":   [r[4] for r in rows],
        "n_total":  n_total,
        "n_shown":  len(rows),
    }
