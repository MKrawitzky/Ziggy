"""Ion mobility visualization from MSAID CHIMERYS platform results.

CHIMERYS deconvolutes chimeric MS2 spectra — it identifies multiple peptides
per co-fragmented spectrum using regularized linear regression over deep-learning-
predicted fragment intensities.  This module parses the resulting Parquet files
(downloaded via msaid_platform.py) and converts them to the ZIGGY standard format.

Column reference (MSAID Platform parquet levels)
------------------------------------------------
PSMs level:
  PSM_ID, SEQUENCE, MODIFIED_SEQUENCE, PEPTIDE_ID, PRECURSOR_ID,
  MASS, PRECURSOR_CHARGE, Q_VALUE, DECOY, SAMPLE_NAME, QUANTIFICATION,
  RETENTION_TIME (*), ION_MOBILITY (*), PRECURSOR_MZ (*)
  (* present for timsTOF runs when Chimerys 5 is used)

PRECURSORS level:
  PRECURSOR_ID, SEQUENCE, MODIFIED_SEQUENCE, GLOBAL_Q_VALUE, DECOY,
  IS_IDENTIFIED_BY_MBR, SAMPLE_NAME, QUANTIFICATION, COUNT_PSMS

PEPTIDES / PROTEIN_GROUPS: aggregated, no RT/IM.

For ion mobility visualization, the PSMs level is preferred (has per-PSM
RT and 1/K₀ when available).  Falls back to PRECURSORS for peptide stats
when PSM-level data lacks mobility columns.
"""

from __future__ import annotations

import logging
import math
from pathlib import Path

logger = logging.getLogger(__name__)

_Q_CUTOFF = 0.01   # 1 % FDR


# ── Column aliases ─────────────────────────────────────────────────────────────
# The platform uses uppercase snake_case; handle both with/without column aliases.

_RT_CANDIDATES  = ("RETENTION_TIME", "RT", "retention_time", "rt")
_IM_CANDIDATES  = ("ION_MOBILITY", "IM", "ion_mobility", "im", "MOBILITY")
_MZ_CANDIDATES  = ("PRECURSOR_MZ", "MZ", "precursor_mz", "mz", "MASS")
_CHG_CANDIDATES = ("PRECURSOR_CHARGE", "CHARGE", "precursor_charge", "charge")
_SEQ_CANDIDATES = ("SEQUENCE", "sequence", "STRIPPED_SEQUENCE", "MODIFIED_SEQUENCE")
_Q_CANDIDATES   = ("Q_VALUE", "GLOBAL_Q_VALUE", "q_value", "global_q_value")
_QTY_CANDIDATES = ("QUANTIFICATION", "quantification", "INTENSITY", "intensity")
_DECOY_CANDIDATES = ("DECOY", "decoy", "IS_DECOY", "is_decoy")


def _pick(columns: set, candidates: tuple[str, ...]) -> str | None:
    for c in candidates:
        if c in columns:
            return c
    return None


# ── Core loader ────────────────────────────────────────────────────────────────

def _load_psms(parquet_path: str | Path, sample_name: str | None = None) -> list[dict]:
    """Load Chimerys PSM-level parquet and return a list of row dicts.

    Each dict has keys: rt (s), mz, mobility, charge, intensity, fwhm, sequence.
    Returns empty list if file is missing or lacks usable columns.
    """
    try:
        import polars as pl
    except ImportError:
        logger.error("polars is required for Chimerys result parsing")
        return []

    parquet_path = Path(parquet_path)
    if not parquet_path.exists():
        logger.warning("Chimerys parquet not found: %s", parquet_path)
        return []

    try:
        schema = pl.read_parquet_schema(str(parquet_path))
    except Exception:
        logger.exception("Cannot read Chimerys parquet schema: %s", parquet_path)
        return []

    available = set(schema.keys())
    logger.debug("Chimerys parquet columns: %s", sorted(available))

    q_col  = _pick(available, _Q_CANDIDATES)
    seq_col = _pick(available, _SEQ_CANDIDATES)

    if not q_col or not seq_col:
        logger.warning("Chimerys parquet lacks Q_VALUE or SEQUENCE — cannot parse")
        return []

    want = [c for c in [
        seq_col,
        _pick(available, _RT_CANDIDATES),
        _pick(available, _IM_CANDIDATES),
        _pick(available, _MZ_CANDIDATES),
        _pick(available, _CHG_CANDIDATES),
        _pick(available, _QTY_CANDIDATES),
        _pick(available, _DECOY_CANDIDATES),
        q_col,
        _pick(available, ("SAMPLE_NAME", "sample_name")),
    ] if c] + []

    # deduplicate preserving order
    seen: set[str] = set()
    want = [c for c in want if not (c in seen or seen.add(c))]  # type: ignore[func-returns-value]

    try:
        df = pl.read_parquet(str(parquet_path), columns=want)
    except Exception:
        logger.exception("Failed to read Chimerys parquet: %s", parquet_path)
        return []

    # FDR filter
    df = df.filter(pl.col(q_col) <= _Q_CUTOFF)

    # Remove decoys
    decoy_col = _pick(available, _DECOY_CANDIDATES)
    if decoy_col and decoy_col in df.columns:
        df = df.filter(pl.col(decoy_col).is_null() | ~pl.col(decoy_col).cast(pl.Boolean))

    # Filter to sample if multi-sample experiment
    sn_col = _pick(available, ("SAMPLE_NAME", "sample_name"))
    if sample_name and sn_col and sn_col in df.columns:
        df_filt = df.filter(pl.col(sn_col).str.contains(sample_name, literal=True))
        if df_filt.height > 0:
            df = df_filt

    if df.height == 0:
        return []

    rt_col  = _pick(available, _RT_CANDIDATES)
    im_col  = _pick(available, _IM_CANDIDATES)
    mz_col  = _pick(available, _MZ_CANDIDATES)
    chg_col = _pick(available, _CHG_CANDIDATES)
    qty_col = _pick(available, _QTY_CANDIDATES)

    has_rt = rt_col and rt_col in df.columns
    has_im = im_col and im_col in df.columns
    has_mz = mz_col and mz_col in df.columns

    rows: list[dict] = []
    for row in df.iter_rows(named=True):
        seq = row.get(seq_col) or ""
        rt  = float(row[rt_col])  if (has_rt and row.get(rt_col)  is not None) else None
        im  = float(row[im_col])  if (has_im and row.get(im_col)  is not None) else None
        mz  = float(row[mz_col])  if (has_mz and row.get(mz_col)  is not None) else None
        chg = int(row[chg_col])   if (chg_col and row.get(chg_col) is not None) else 0
        qty = float(row[qty_col]) if (qty_col and row.get(qty_col) is not None) else 1.0

        if im is not None and im == 0.0:
            continue  # skip invalid IM values

        # RT: Chimerys stores in minutes like DIA-NN; convert to seconds
        if rt is not None:
            rt = rt * 60 if rt < 200 else rt  # heuristic: <200 → minutes

        rows.append({
            "rt":       rt,
            "mz":       mz,
            "mobility": im,
            "charge":   chg,
            "intensity": qty if qty and qty > 0 else 1.0,
            "fwhm":     None,
            "sequence": seq,
        })
    return rows


# ── Mobility visualization functions ──────────────────────────────────────────

def get_feature_3d_data_chimerys(
    parquet_path: str | Path,
    sample_name: str | None = None,
    max_features: int = 5000,
) -> dict:
    """Same output format as mobility_viz.get_feature_3d_data."""
    rows = _load_psms(parquet_path, sample_name)
    if not rows:
        return {}

    # Filter to rows that have mobility data (timsTOF runs)
    mobile_rows = [r for r in rows if r["mobility"] is not None and r["rt"] is not None]
    source_rows = mobile_rows if mobile_rows else rows

    n_total = len(source_rows)
    source_rows.sort(key=lambda r: r["intensity"], reverse=True)
    source_rows = source_rows[:max_features]

    result: dict = {
        "n_total":  n_total,
        "n_shown":  len(source_rows),
        "source":   "chimerys",
        "chimeric": True,   # flag: Chimerys deconvoluted chimeric spectra
    }

    if mobile_rows:
        result.update({
            "rt":       [round(r["rt"], 2)       for r in source_rows],
            "mz":       [round(r["mz"], 4)       for r in source_rows if r["mz"] is not None],
            "mobility": [round(r["mobility"], 4) for r in source_rows],
            "log_int":  [round(math.log10(r["intensity"]), 2) for r in source_rows],
            "charge":   [r["charge"]             for r in source_rows],
        })
    else:
        # No RT/IM — return peptide-only payload (used for immuno tab)
        result["no_mobility"] = True

    return result


def get_mobility_map_chimerys(
    parquet_path: str | Path,
    sample_name: str | None = None,
    rt_bins: int = 60,
    mobility_bins: int = 50,
) -> dict:
    """Same output format as mobility_viz.get_mobility_map."""
    rows = [r for r in _load_psms(parquet_path, sample_name)
            if r["rt"] is not None and r["mobility"] is not None]
    if not rows:
        return {}

    rts   = [r["rt"]       for r in rows]
    mobs  = [r["mobility"] for r in rows]
    intys = [r["intensity"] for r in rows]

    rt_min,  rt_max  = min(rts),  max(rts)
    mob_min, mob_max = min(mobs), max(mobs)

    rt_pad  = (rt_max  - rt_min)  * 0.01 + 0.1
    mob_pad = (mob_max - mob_min) * 0.01 + 0.001
    rt_lo,  rt_hi  = rt_min  - rt_pad,  rt_max  + rt_pad
    mob_lo, mob_hi = mob_min - mob_pad, mob_max + mob_pad

    rt_step  = (rt_hi  - rt_lo)  / rt_bins
    mob_step = (mob_hi - mob_lo) / mobility_bins
    grid     = [[0.0] * mobility_bins for _ in range(rt_bins)]

    for rt, mob, inty in zip(rts, mobs, intys):
        ri = min(int((rt  - rt_lo)  / rt_step),  rt_bins - 1)
        mi = min(int((mob - mob_lo) / mob_step), mobility_bins - 1)
        if 0 <= ri < rt_bins and 0 <= mi < mobility_bins:
            grid[ri][mi] += inty

    for i in range(rt_bins):
        for j in range(mobility_bins):
            grid[i][j] = round(math.log10(grid[i][j] + 1), 3)

    return {
        "rt_edges":       [round(rt_lo  + i * rt_step,  2) for i in range(rt_bins + 1)],
        "mobility_edges": [round(mob_lo + i * mob_step, 4) for i in range(mobility_bins + 1)],
        "grid":           grid,
        "n_features":     len(rows),
        "rt_range":       [round(rt_min,  1), round(rt_max,  1)],
        "mobility_range": [round(mob_min, 4), round(mob_max, 4)],
        "source":         "chimerys",
    }


def get_charge_distribution_chimerys(parquet_path: str | Path, sample_name: str | None = None) -> dict:
    rows = _load_psms(parquet_path, sample_name)
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


def get_peptide_stats_chimerys(parquet_path: str | Path, sample_name: str | None = None) -> dict:
    """Return HLA-friendly peptide statistics from Chimerys PSM-level results.

    Includes peptide length distribution, sequence list, charge distribution,
    and a flag indicating chimeric spectrum origin.
    """
    rows = _load_psms(parquet_path, sample_name)
    if not rows:
        return {}

    seqs = [r["sequence"] for r in rows if r["sequence"]]
    lengths = [len(s) for s in seqs]

    len_counts: dict[int, int] = {}
    for l in lengths:
        len_counts[l] = len_counts.get(l, 0) + 1

    unique_seqs = sorted(set(seqs))
    return {
        "n_psms":          len(rows),
        "n_unique_seqs":   len(unique_seqs),
        "length_dist":     {str(l): c for l, c in sorted(len_counts.items())},
        "top_sequences":   unique_seqs[:200],
        "chimeric_origin": True,
        "source":          "chimerys",
    }


# ── CCS (1/K₀ → Å²) ───────────────────────────────────────────────────────────

def get_ccs_data_chimerys(
    parquet_path: str | Path,
    sample_name: str | None = None,
    max_scatter: int = 5000,
    hist_bins: int = 50,
) -> dict:
    """CCS scatter + histograms from Chimerys PSMs (timsTOF only)."""
    rows = [r for r in _load_psms(parquet_path, sample_name)
            if r["mobility"] is not None and r["mz"] is not None]
    if not rows:
        return {}

    ccs_available = False
    try:
        from stan.tools.timsdata.timsdata import oneOverK0ToCCSforMz
        ccs_available = True
    except Exception:
        logger.debug("timsdata DLL not available — using raw 1/K₀")

    working: list[dict] = []
    for r in rows:
        if ccs_available:
            try:
                ccs = oneOverK0ToCCSforMz(r["mobility"], r["charge"], r["mz"])
                if ccs and ccs > 0:
                    working.append({**r, "ccs": round(float(ccs), 2)})
            except Exception:
                continue
        else:
            working.append(r)

    if not working:
        return {}

    n_total = len(working)
    by_charge: dict[int, list] = {}
    for r in working:
        by_charge.setdefault(r["charge"], []).append(r)

    scatter: dict[str, dict] = {}
    for z, zrows in sorted(by_charge.items()):
        zrows.sort(key=lambda r: r["intensity"], reverse=True)
        cap = max(300, int(max_scatter * len(zrows) / n_total))
        sub = zrows[:cap]
        entry: dict = {
            "mz": [round(r["mz"],      3) for r in sub],
            "im": [round(r["mobility"], 4) for r in sub],
            "rt": [round(r["rt"] / 60, 3) for r in sub if r["rt"] is not None],
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
        step   = (hi - lo) / hist_bins
        counts = [0] * hist_bins
        for v in vals:
            i = min(int((v - lo) / step), hist_bins - 1)
            counts[i] += 1
        dp     = 1 if ccs_available else 4
        median = vals[len(vals) // 2]
        histograms[str(z)] = {
            "edges":  [round(lo + i * step, dp) for i in range(hist_bins + 1)],
            "counts": counts,
            "median": round(median, dp),
            "n":      len(vals),
        }

    return {
        "scatter":       scatter,
        "histograms":    histograms,
        "n_total":       n_total,
        "ccs_available": ccs_available,
        "source":        "chimerys",
    }


# ── Novel chimeric collision analysis ─────────────────────────────────────────

def get_chimeric_collision_analysis(
    parquet_path: str | Path,
    sample_name: str | None = None,
    rt_bin_sec: float = 2.0,     # seconds — scan-level RT window for grouping
    mz_bin_da: float = 0.012,    # Da — scan-level MZ window for grouping
    mobility_bins: int = 30,
    max_scatter: int = 8000,
) -> dict:
    """Novel chimeric spectrum analysis leveraging timsTOF ion mobility.

    Groups Chimerys PSMs by scan proxy (RT_bin × MZ_bin) to detect chimeric
    spectra — spectra where multiple distinct peptides were co-identified from
    overlapping precursors.  Returns:

    1. collision_map  — per-PSM scatter with chimeric multiplicity count,
       ready to plot in m/z × 1/K₀ space.  Chimeric PSMs reveal WHERE in the
       4D timsTOF space the TIMS dimension fails to separate co-eluting precursors.

    2. mobility_profile — per-1/K₀-bin chimeric fraction, quantifying TIMS
       separation efficiency across the mobility axis.

    3. stats — global chimeric rate, rescued peptide count (additional peptides
       Chimerys found beyond the first identification per chimeric scan), and
       scan-level multiplicity distribution.

    This is a first-of-its-kind analysis: standard DDA search tools report a
    single peptide per spectrum and cannot reveal chimeric co-isolation patterns.
    Chimerys' multi-peptide-per-spectrum output makes this possible.
    """
    rows = _load_psms(parquet_path, sample_name)
    if not rows:
        return {}

    # ── Group PSMs into scan proxies ─────────────────────────────────────────
    # Each scan proxy = (RT_bin, MZ_bin).  PSMs sharing a bin that have
    # different sequences were co-isolated and co-fragmented → chimeric.
    from collections import defaultdict

    scan_groups: dict[tuple, list[dict]] = defaultdict(list)
    for r in rows:
        if r["rt"] is None or r["mz"] is None:
            continue
        rt_key  = round(r["rt"]  / rt_bin_sec)    # r["rt"] already in seconds
        mz_key  = round(r["mz"]  / mz_bin_da)
        scan_groups[(rt_key, mz_key)].append(r)

    # ── Annotate each PSM with chimeric count ────────────────────────────────
    enriched: list[dict] = []
    n_chimeric_scans  = 0
    n_singleton_scans = 0
    max_multiplicity  = 1
    multiplicity_hist: dict[int, int] = {}

    for group in scan_groups.values():
        unique_seqs = {r["sequence"] for r in group if r["sequence"]}
        mult        = len(unique_seqs)
        max_multiplicity = max(max_multiplicity, mult)
        multiplicity_hist[mult] = multiplicity_hist.get(mult, 0) + 1
        if mult > 1:
            n_chimeric_scans += 1
        else:
            n_singleton_scans += 1
        for r in group:
            enriched.append({**r, "chimeric_count": mult})

    n_psms          = len(enriched)
    n_chimeric_psms = sum(1 for r in enriched if r["chimeric_count"] > 1)
    chimeric_rate   = n_chimeric_psms / n_psms if n_psms else 0.0
    # Rescued = extra peptides found in chimeric scans beyond the first ID
    n_rescued = sum(r["chimeric_count"] - 1 for r in enriched if r["chimeric_count"] > 1)
    total_scans = n_singleton_scans + n_chimeric_scans
    chimeric_scan_rate = n_chimeric_scans / total_scans if total_scans else 0.0

    # ── Mobility profile ─────────────────────────────────────────────────────
    mobile_rows = [r for r in enriched if r["mobility"] is not None]
    mobility_profile: list[dict] = []
    if mobile_rows:
        mob_vals     = [r["mobility"] for r in mobile_rows]
        mob_lo, mob_hi = min(mob_vals), max(mob_vals)
        mob_step = (mob_hi - mob_lo) / mobility_bins if mob_hi > mob_lo else 0.01

        bins_total: list[int]   = [0] * mobility_bins
        bins_chim:  list[int]   = [0] * mobility_bins
        for r in mobile_rows:
            bi = min(int((r["mobility"] - mob_lo) / mob_step), mobility_bins - 1)
            bins_total[bi] += 1
            if r["chimeric_count"] > 1:
                bins_chim[bi] += 1

        for i in range(mobility_bins):
            center = mob_lo + (i + 0.5) * mob_step
            total  = bins_total[i]
            chim   = bins_chim[i]
            mobility_profile.append({
                "bin_center":    round(center, 4),
                "n_total":       total,
                "n_chimeric":    chim,
                "chimeric_rate": round(chim / total, 3) if total > 0 else 0.0,
            })

    # ── Collision map (downsampled scatter) ──────────────────────────────────
    # Sort by intensity desc; take top max_scatter ensuring chimeric PSMs are
    # well-represented (take all chimeric, then fill with singletons).
    chimeric_pts   = [r for r in enriched if r["chimeric_count"] > 1 and r["mz"] is not None and r["mobility"] is not None]
    singleton_pts  = [r for r in enriched if r["chimeric_count"] == 1 and r["mz"] is not None and r["mobility"] is not None]
    chimeric_pts.sort(key=lambda r: r["intensity"], reverse=True)
    singleton_pts.sort(key=lambda r: r["intensity"], reverse=True)

    n_chim_show = min(len(chimeric_pts), max_scatter // 2)
    n_sing_show = min(len(singleton_pts), max_scatter - n_chim_show)
    scatter_rows = chimeric_pts[:n_chim_show] + singleton_pts[:n_sing_show]

    collision_map = [
        {
            "mz":       round(r["mz"],       3),
            "mobility": round(r["mobility"],  4),
            "charge":   r["charge"],
            "count":    r["chimeric_count"],
        }
        for r in scatter_rows
    ]

    return {
        "available":        True,
        "collision_map":    collision_map,
        "mobility_profile": mobility_profile,
        "stats": {
            "n_psms":              n_psms,
            "n_chimeric_psms":     n_chimeric_psms,
            "chimeric_rate":       round(chimeric_rate, 4),
            "max_multiplicity":    max_multiplicity,
            "multiplicity_hist":   {str(k): v for k, v in sorted(multiplicity_hist.items())},
            "n_singleton_scans":   n_singleton_scans,
            "n_chimeric_scans":    n_chimeric_scans,
            "chimeric_scan_rate":  round(chimeric_scan_rate, 4),
            "n_rescued_peptides":  n_rescued,
        },
        "has_mobility": len(mobile_rows) > 0,
        "source": "chimerys",
    }
