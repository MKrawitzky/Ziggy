"""Zyna — 4D Chimeric MS2 Deconvolution for timsTOF diaPASEF.

The core insight: chimeric MS2 spectra are unavoidable in DIA because DIA
isolation windows capture multiple co-eluting precursors simultaneously.
Standard tools (DIA-NN, Chimerys) treat the spectrum as a mixture of peptide
sequences and use fragment *m/z* matching only.

Zyna adds a fourth dimension: ion mobility (1/K₀).
In timsTOF data, every MS2 fragment ion has a 1/K₀ coordinate as well as m/z.
Co-isolated precursors A and B typically have different 1/K₀ values. Their
fragment ions therefore cluster at different 1/K₀ positions in the PASEF MS2
frame. This lets us separate their fragment spectra with no ML at all — pure
physics.

Three tiers:
  Tier 3  PASEF geometry: read isolation windows from analysis.tdf +
          cross-reference DIA-NN identified precursors. No raw spectra needed.
          → chimeric rate map, 4D separation efficiency

  Tier 1  Local 4D deconvolution: read raw PASEF MS2 frames via TimsData DLL,
          separate fragment ions by 1/K₀ proximity to each precursor, score
          both peptides against their assigned fragment sub-spectrum.
          → rescued IDs, chimeric PSM list

  Tier 2  Prosit-assisted: use Prosit REST API (Koina) for fragment intensity
          priors; improves scoring when precursor 1/K₀ values overlap closely.

This is qualitatively different from Chimerys:
  - Chimerys deconvolves by *sequence* patterns using deep learning
  - Zyna deconvolves by *physics* (ion mobility separation) first,
    then optionally uses learned intensities for confirmation
  - Zyna works fully offline for Tiers 1 and 3
  - Zyna is specific to timsTOF — it exploits the instrument Chimerys ignores
"""
from __future__ import annotations

import logging
import math
import sqlite3
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

# ── Amino acid residue masses (monoisotopic) ─────────────────────────────────
_RESIDUE_MASS: dict[str, float] = {
    "A": 71.03711, "R": 156.10111, "N": 114.04293, "D": 115.02694,
    "C": 103.00919, "E": 129.04259, "Q": 128.05858, "G": 57.02146,
    "H": 137.05891, "I": 113.08406, "L": 113.08406, "K": 128.09496,
    "M": 131.04049, "F": 147.06841, "P": 97.05276,  "S": 87.03203,
    "T": 101.04768, "W": 186.07931, "Y": 163.06333, "V": 99.06841,
}
_PROTON = 1.007276
_H2O    = 18.010565

_UNIMOD_MASS: dict[str, float] = {
    "1":   42.010565,   # Acetyl
    "4":   57.021464,   # Carbamidomethyl
    "5":   43.005814,   # Carbamyl
    "7":    0.984016,   # Deamidated
    "21":  15.994915,   # Oxidation
    "35":  15.994915,   # Hydroxylation
    "56":  42.010565,   # Acetyl(K)
    "80":  79.966331,   # Phospho
    "259": 42.046950,   # Trimethyl(K)
    "28":  14.015650,   # Methylation
    "737": 229.162932,  # TMT6
    "214": 144.102063,  # iTRAQ4
}

# ── Sequence parsing ──────────────────────────────────────────────────────────

def _parse_residues(mod_seq: str) -> list[dict]:
    """Parse DIA-NN-style Modified.Sequence into list of {aa, mass, mod_label}."""
    import re
    residues = []
    i = 0
    while i < len(mod_seq):
        ch = mod_seq[i]
        if ch == "(":
            # Modification on previous residue
            end = mod_seq.index(")", i)
            mod_str = mod_seq[i + 1:end]
            mass = 0.0
            label = ""
            m = re.match(r"UniMod:(\d+)", mod_str)
            if m:
                uid = m.group(1)
                mass  = _UNIMOD_MASS.get(uid, 0.0)
                label = f"(+{mass:.0f})" if mass > 0 else ""
            if residues:
                residues[-1]["mass"]  += mass
                residues[-1]["label"]  = label
            i = end + 1
        else:
            residues.append({
                "aa":    ch,
                "mass":  _RESIDUE_MASS.get(ch, 111.0),
                "label": "",
            })
            i += 1
    return residues


def calc_theoretical_ions(
    mod_seq: str,
    charge: int = 2,
    ion_types: tuple[str, ...] = ("b", "y"),
    max_z: int = 2,
) -> list[dict]:
    """Calculate theoretical b/y fragment ions for a modified peptide sequence.

    Returns list of {mz, label, z, type, pos}.
    """
    res = _parse_residues(mod_seq)
    n = len(res)
    if n < 2:
        return []

    ions = []
    masses = [r["mass"] for r in res]

    for ion_type in ion_types:
        for pos in range(1, n):
            if ion_type == "b":
                mass = sum(masses[:pos]) + _PROTON
                label_base = f"b{pos}"
            else:
                mass = sum(masses[pos:]) + _H2O + _PROTON
                label_base = f"y{n - pos}"

            for z in range(1, min(max_z + 1, pos + 1)):
                mz = (mass + (z - 1) * _PROTON) / z
                if 150 < mz < 2000:
                    lbl = label_base if z == 1 else f"{label_base}²"
                    ions.append({
                        "mz":   round(mz, 4),
                        "label": lbl,
                        "z":     z,
                        "type":  ion_type,
                        "pos":   pos,
                    })
    return ions


# ── NNLS deconvolution ────────────────────────────────────────────────────────

def _build_spectrum_vector(
    ions: list[dict],
    mz_grid: np.ndarray,
    tolerance_ppm: float = 20.0,
    intensities: list[float] | None = None,
) -> np.ndarray:
    vec = np.zeros(len(mz_grid), dtype=np.float32)
    for j, ion in enumerate(ions):
        imz   = ion["mz"]
        tol   = imz * tolerance_ppm * 1e-6
        inten = 1.0 if intensities is None else intensities[j]
        mask  = np.abs(mz_grid - imz) <= tol
        vec[mask] += inten
    return vec


def nnls_deconvolve(
    observed: np.ndarray,
    basis_a: np.ndarray,
    basis_b: np.ndarray,
) -> tuple[float, float, float]:
    """Non-negative least squares: observed ≈ α·A + β·B → (alpha, beta, residual)."""
    from scipy.optimize import nnls as _nnls
    A = np.column_stack([basis_a, basis_b])
    coeffs, _ = _nnls(A, observed)
    alpha, beta = float(coeffs[0]), float(coeffs[1])
    norm_obs = float(np.linalg.norm(observed))
    if norm_obs > 0:
        fitted   = alpha * basis_a + beta * basis_b
        residual = float(np.linalg.norm(observed - fitted)) / norm_obs
    else:
        residual = 1.0
    return alpha, beta, residual


# ── PASEF window utilities ────────────────────────────────────────────────────

def _read_tdf_pasef_windows(tdf_path: Path) -> list[dict]:
    """Read diaPASEF isolation windows from analysis.tdf."""
    windows = []
    try:
        with sqlite3.connect(str(tdf_path)) as con:
            con.row_factory = sqlite3.Row
            try:
                cur = con.execute("""
                    SELECT WindowGroup, ScanNumBegin, ScanNumEnd,
                           IsolationMz, IsolationWidth, CollisionEnergy
                    FROM DiaFrameMsMsWindows
                    ORDER BY WindowGroup, ScanNumBegin
                """)
                for row in cur.fetchall():
                    half = float(row["IsolationWidth"]) / 2.0
                    windows.append({
                        "window_group": int(row["WindowGroup"]),
                        "scan_begin":   int(row["ScanNumBegin"]),
                        "scan_end":     int(row["ScanNumEnd"]),
                        "mz_center":    float(row["IsolationMz"]),
                        "mz_half":      half,
                        "mz_lower":     float(row["IsolationMz"]) - half,
                        "mz_upper":     float(row["IsolationMz"]) + half,
                        "ce":           float(row["CollisionEnergy"]),
                    })
            except sqlite3.OperationalError:
                pass
    except Exception as e:
        logger.warning("_read_tdf_pasef_windows: %s", e)
    return windows


def _annotate_windows_k0(windows: list[dict], tdf_path: Path) -> list[dict]:
    """Add k0_lower / k0_upper / k0_center to each window.

    Uses linear approximation: 1/K₀ ≈ 1.6 − (scan / max_scan) × 1.0
    This matches the approach in stan.metrics.mobility_windows and is robust
    when the TimsCalibration table uses non-standard column names.
    Higher scan number → lower 1/K₀ (ions with lower mobility exit TIMS later).
    """
    try:
        with sqlite3.connect(str(tdf_path)) as con:
            row = con.execute("SELECT MAX(NumScans) FROM Frames").fetchone()
            max_scan = float(row[0]) if row and row[0] else 920.0

            for w in windows:
                # scan_begin (low scan) → high K0; scan_end (high scan) → low K0
                k0_hi = round(1.6 - (w["scan_begin"] / max_scan) * 1.0, 4)
                k0_lo = round(1.6 - (w["scan_end"]   / max_scan) * 1.0, 4)
                w["k0_lower"]  = min(k0_lo, k0_hi)
                w["k0_upper"]  = max(k0_lo, k0_hi)
                w["k0_center"] = round((k0_lo + k0_hi) / 2, 4)
    except Exception as e:
        logger.debug("_annotate_windows_k0: %s", e)
    return windows


def _load_diann_precursors(
    report_path: Path,
    q_cutoff: float = 0.01,
    max_rows: int = 100_000,
) -> list[dict]:
    """Load DIA-NN precursors from report.parquet."""
    try:
        import polars as pl
        schema = pl.read_parquet_schema(str(report_path))
        want = ["Modified.Sequence", "Stripped.Sequence",
                "Precursor.Mz", "Precursor.Charge", "IM",
                "RT", "Q.Value", "Precursor.Quantity"]
        cols = [c for c in want if c in schema]
        df = pl.read_parquet(str(report_path), columns=cols)
        if "Q.Value" in df.columns:
            df = df.filter(pl.col("Q.Value") <= q_cutoff)
        df = df.head(max_rows)
        out = []
        mz_c  = "Precursor.Mz"      if "Precursor.Mz"      in cols else None
        im_c  = "IM"                 if "IM"                 in cols else None
        seq_c = ("Modified.Sequence" if "Modified.Sequence"  in cols
                 else "Stripped.Sequence" if "Stripped.Sequence" in cols
                 else None)
        chg_c = "Precursor.Charge"  if "Precursor.Charge"   in cols else None
        rt_c  = "RT"                 if "RT"                 in cols else None
        qty_c = "Precursor.Quantity" if "Precursor.Quantity" in cols else None
        for row in df.iter_rows(named=True):
            mz  = float(row[mz_c])  if mz_c  and row.get(mz_c)  else None
            im  = float(row[im_c])  if im_c  and row.get(im_c)  else None
            seq = str(row[seq_c])   if seq_c and row.get(seq_c)  else ""
            chg = int(row[chg_c])   if chg_c and row.get(chg_c)  else 2
            rt  = float(row[rt_c])  if rt_c  and row.get(rt_c)  else 0.0
            qty = float(row[qty_c]) if qty_c and row.get(qty_c)  else 0.0
            if mz:
                out.append({"mz": mz, "im": im, "seq": seq,
                            "charge": chg, "rt": rt, "qty": qty})
        return out
    except Exception as e:
        logger.warning("_load_diann_precursors: %s", e)
        return []


# ── Chimeric pair classifier ──────────────────────────────────────────────────

def _classify_chimeric_pairs(enriched_windows: list[dict]) -> dict:
    """Classify every co-isolated precursor pair in chimeric windows by
    1/K₀ separability.

    Three categories mirror Zyna's tier strategy:
      - Resolved  (gap ≥ 2σ = 0.06):  Tier 1 physically separates them — free IDs
      - Partial   (gap 1σ–2σ = 0.03–0.06): Tier 2 Prosit assists — probable gain
      - Overlapping (gap < 1σ = 0.03): Genuinely chimeric — hardest case

    Returns n_rescuable_ids = count of resolved pairs (conservative lower bound
    on additional peptide IDs that Zyna can recover vs standard DIA pipeline).
    """
    K0_SIGMA = 0.03  # Gaussian assignment width (half-width ~1σ)
    n_resolved = n_partial = n_overlapping = 0
    n_rescuable_ids = 0
    k0_gaps: list[float] = []

    for w in enriched_windows:
        if not w.get("chimeric"):
            continue
        precs = [p for p in w.get("precursors", []) if p.get("im") is not None]
        for i in range(len(precs)):
            for j in range(i + 1, len(precs)):
                gap = abs(precs[i]["im"] - precs[j]["im"])
                k0_gaps.append(round(gap, 4))
                if gap >= 2 * K0_SIGMA:       # Zyna Tier 1 cleanly separates
                    n_resolved += 1
                    n_rescuable_ids += 1
                elif gap >= K0_SIGMA:          # Tier 2 improves scoring
                    n_partial += 1
                else:                          # Truly chimeric, <1σ gap
                    n_overlapping += 1

    total = n_resolved + n_partial + n_overlapping
    return {
        "n_pairs_resolved":    n_resolved,
        "n_pairs_partial":     n_partial,
        "n_pairs_overlapping": n_overlapping,
        "n_total_pairs":       total,
        "n_rescuable_ids":     n_rescuable_ids,
        "k0_gap_histogram":    sorted(k0_gaps)[:500],
    }


# ── Tier 3: PASEF geometry chimeric analysis ──────────────────────────────────

def tier3_chimeric_map(
    d_path: Path,
    report_path: Path | None,
    mz_bins: int = 40,
    k0_bins: int = 30,
    rt_bins:  int = 30,
    max_precursors: int = 50_000,
) -> dict:
    """Tier 3 — PASEF geometry chimeric analysis.

    Reads diaPASEF isolation windows and DIA-NN precursors.
    For each window: counts how many distinct identified precursors fall within
    its m/z × 1/K₀ cell. Windows with ≥2 precursors are chimeric.

    4D advantage: because PASEF windows are defined in BOTH m/z and 1/K₀ space,
    many precursors that overlap in m/z are actually separated by ion mobility
    and are NOT chimeric. Zyna reports this separation rate as the "TIMS rescue"
    fraction — the proportion of apparent m/z collisions that TIMS eliminates.
    """
    tdf = d_path / "analysis.tdf"
    if not tdf.exists():
        return {"error": "analysis.tdf not found", "available": False}

    windows = _read_tdf_pasef_windows(tdf)
    if not windows:
        return {"error": "No diaPASEF windows in analysis.tdf — DDA run?",
                "available": False}

    windows = _annotate_windows_k0(windows, tdf)

    # Load identified precursors
    precursors: list[dict] = []
    if report_path and report_path.exists():
        precursors = _load_diann_precursors(report_path, max_rows=max_precursors)

    # ── Diagnostics ───────────────────────────────────────────────────────────
    n_prec_with_im = sum(1 for p in precursors if p["im"] is not None)
    im_vals = [p["im"] for p in precursors if p["im"] is not None]
    k0_vals_windows = [w.get("k0_center", 0) for w in windows if w.get("k0_center", 0) > 0]
    has_k0_windows = len(k0_vals_windows) > 0

    # ── Assign precursors to windows ─────────────────────────────────────────
    enriched: list[dict] = []
    n_chimeric = 0
    n_mz_only_collisions = 0  # m/z overlap but TIMS-separated (4D rescue)

    for w in windows:
        mz_lo = w["mz_lower"]
        mz_hi = w["mz_upper"]
        k0_lo = w.get("k0_lower", 0)
        k0_hi = w.get("k0_upper", 0)
        has_k0 = k0_hi > k0_lo  # valid window K0 range

        # Precursors within m/z window (ignoring mobility)
        prec_mz = [p for p in precursors if mz_lo <= p["mz"] <= mz_hi]
        n_mz = len(prec_mz)

        if has_k0:
            # 4D filter: precursor must have IM data AND fall within window K0 range.
            # Precursors with im=None are NOT counted as co-isolated (unknown K0).
            prec_4d = [p for p in prec_mz
                       if p["im"] is not None and k0_lo <= p["im"] <= k0_hi]
            # For chimeric count: also include unknown-IM precursors (conservative)
            prec_4d_conservative = [p for p in prec_mz
                                    if p["im"] is None or k0_lo <= p["im"] <= k0_hi]
        else:
            # No K0 calibration: fall back to m/z-only
            prec_4d = prec_mz
            prec_4d_conservative = prec_mz

        n_4d             = len(prec_4d)
        n_4d_conservative = len(prec_4d_conservative)

        # TIMS rescue: m/z overlap present, but K0 filter reduces to 0 or 1 precursor
        if has_k0 and n_mz > 1 and n_4d <= 1:
            n_mz_only_collisions += 1

        # Use conservative count for chimeric flag (includes unknown-IM precursors)
        is_chimeric = n_4d_conservative > 1
        if is_chimeric:
            n_chimeric += 1

        prec_pool   = prec_4d if prec_4d else prec_4d_conservative
        prec_sample = sorted(prec_pool, key=lambda p: p.get("qty", 0), reverse=True)[:4]

        enriched.append({
            "mz_center":  round(w["mz_center"], 3),
            "mz_lower":   round(mz_lo, 3),
            "mz_upper":   round(mz_hi, 3),
            "k0_lower":   round(k0_lo, 4),
            "k0_upper":   round(k0_hi, 4),
            "k0_center":  round(w.get("k0_center", 0), 4),
            "n_prec_mz":  n_mz,
            "n_prec_4d":  n_4d_conservative,
            "chimeric":   is_chimeric,
            "ce":         round(w.get("ce", 0), 1),
            "precursors": [{"mz": p["mz"], "im": p.get("im"), "seq": p["seq"][:20]}
                           for p in prec_sample],
        })

    n_windows = len(enriched)
    chimeric_rate = n_chimeric / n_windows if n_windows else 0.0

    # TIMS rescue: of all m/z collisions, what fraction was separated by TIMS?
    total_mz_collisions = n_mz_only_collisions + n_chimeric
    tims_rescue_rate = (n_mz_only_collisions / total_mz_collisions
                        if total_mz_collisions > 0 else 0.0)

    # Pair-level K0 separability analysis
    pair_analysis = _classify_chimeric_pairs(enriched)

    # ── m/z profile ──────────────────────────────────────────────────────────
    all_mz    = [w["mz_center"] for w in enriched]
    mz_lo_gl  = min(all_mz) if all_mz else 400
    mz_hi_gl  = max(all_mz) if all_mz else 1200
    mz_step   = (mz_hi_gl - mz_lo_gl) / mz_bins if mz_hi_gl > mz_lo_gl else 10
    mz_tot    = [0] * mz_bins
    mz_chim   = [0] * mz_bins
    for w in enriched:
        bi = min(int((w["mz_center"] - mz_lo_gl) / mz_step), mz_bins - 1)
        mz_tot[bi]  += 1
        if w["chimeric"]: mz_chim[bi] += 1

    mz_profile = [
        {"bin_center": round(mz_lo_gl + (i + 0.5) * mz_step, 1),
         "n_total": mz_tot[i], "n_chimeric": mz_chim[i],
         "rate": round(mz_chim[i] / mz_tot[i], 3) if mz_tot[i] else 0.0}
        for i in range(mz_bins) if mz_tot[i] > 0
    ]

    # ── 1/K₀ profile ─────────────────────────────────────────────────────────
    k0_vals = [w["k0_center"] for w in enriched if w["k0_center"] > 0]
    k0_profile: list[dict] = []
    if k0_vals:
        k0_lo_gl = min(k0_vals)
        k0_hi_gl = max(k0_vals)
        k0_step  = (k0_hi_gl - k0_lo_gl) / k0_bins if k0_hi_gl > k0_lo_gl else 0.05
        k0_tot   = [0] * k0_bins
        k0_chim  = [0] * k0_bins
        for w in enriched:
            kc = w["k0_center"]
            if kc <= 0:
                continue
            bi = min(int((kc - k0_lo_gl) / k0_step), k0_bins - 1)
            k0_tot[bi]  += 1
            if w["chimeric"]: k0_chim[bi] += 1
        k0_profile = [
            {"bin_center": round(k0_lo_gl + (i + 0.5) * k0_step, 4),
             "n_total": k0_tot[i], "n_chimeric": k0_chim[i],
             "rate": round(k0_chim[i] / k0_tot[i], 3) if k0_tot[i] else 0.0}
            for i in range(k0_bins) if k0_tot[i] > 0
        ]

    # Precursor scatter sample
    scatter_cap = 3000
    scatter = [
        {"mz": p["mz"], "im": p["im"], "rt": p["rt"]}
        for p in precursors[:scatter_cap]
        if p.get("im")
    ]

    return {
        "available":        True,
        "tier":             3,
        "window_cells":     enriched,
        "mz_profile":       mz_profile,
        "k0_profile":       k0_profile,
        "precursor_scatter": scatter,
        "pair_analysis":    pair_analysis,
        "stats": {
            "n_windows":              n_windows,
            "n_chimeric_windows":     n_chimeric,
            "chimeric_rate":          round(chimeric_rate, 4),
            "n_precursors":           len(precursors),
            "n_precursors_with_im":   n_prec_with_im,
            "im_coverage_pct":        round(100 * n_prec_with_im / len(precursors), 1)
                                      if precursors else 0.0,
            "precursor_k0_range":     [round(min(im_vals), 4), round(max(im_vals), 4)]
                                      if im_vals else None,
            "window_k0_range":        [round(min(k0_vals_windows), 4), round(max(k0_vals_windows), 4)]
                                      if k0_vals_windows else None,
            "has_k0_calibration":     has_k0_windows,
            "n_mz_only_collisions":   n_mz_only_collisions,
            "tims_rescue_rate":       round(tims_rescue_rate, 4),
            "tims_rescued_count":     n_mz_only_collisions,
            # Pair-level K0 classification (Zyna ID gain estimate)
            "n_rescuable_pairs":      pair_analysis["n_pairs_resolved"],
            "n_partial_pairs":        pair_analysis["n_pairs_partial"],
            "est_id_gain":            pair_analysis["n_rescuable_ids"],
            "id_gain_pct":            round(
                                          100 * pair_analysis["n_rescuable_ids"] / max(1, n_chimeric), 1
                                      ),
        },
    }


# ── Tier 1: 4D fragment ion deconvolution ─────────────────────────────────────

def _read_ms2_frame_4d(
    td: Any,
    frame_id: int,
    scan_begin: int,
    scan_end: int,
) -> dict:
    """Read one PASEF MS2 frame, returning fragment ions with 1/K₀ coordinates.

    Returns {mz, intensity, k0} arrays or empty dict on failure.
    """
    try:
        scans = td.readScans(frame_id, scan_begin, scan_end)
        scan_nums: list[int] = []
        tof_idxs:  list[int] = []
        intensities: list[int] = []

        for scan_i, (tof_arr, int_arr) in enumerate(scans):
            actual_scan = scan_begin + scan_i
            if len(tof_arr) > 0:
                scan_nums.extend([actual_scan] * len(tof_arr))
                tof_idxs.extend(tof_arr.tolist())
                intensities.extend(int_arr.tolist())

        if not tof_idxs:
            return {}

        tof_np   = np.array(tof_idxs,  dtype=np.float64)
        scan_np  = np.array(scan_nums, dtype=np.float64)
        mz_np    = td.indexToMz(frame_id, tof_np)
        k0_np    = td.scanNumToOneOverK0(frame_id, scan_np)
        int_np   = np.array(intensities, dtype=np.float32)

        # Filter to typical fragment m/z range
        mask = (mz_np > 100) & (mz_np < 2500)
        return {
            "mz":        mz_np[mask].tolist(),
            "intensity": int_np[mask].tolist(),
            "k0":        k0_np[mask].tolist(),
        }
    except Exception as e:
        logger.debug("_read_ms2_frame_4d frame %d: %s", frame_id, e)
        return {}


def tier1_4d_deconvolve(
    d_path: Path,
    seq_a: str,
    charge_a: int,
    k0_a: float,
    seq_b: str,
    charge_b: int,
    k0_b: float,
    frame_id: int | None = None,
    scan_begin: int = 0,
    scan_end: int = 1000,
    tolerance_ppm: float = 20.0,
    k0_sigma: float = 0.03,
) -> dict:
    """Tier 1 — 4D chimeric deconvolution using ion mobility of fragment ions.

    Algorithm:
    1. Read the PASEF MS2 frame (actual fragment ions with 1/K₀ coordinates)
    2. For each fragment ion, compute its probability of originating from
       precursor A vs B using a Gaussian model centered on each precursor's 1/K₀
    3. Build weighted sub-spectra for A and B
    4. Match against theoretical b/y ions → per-peptide identification score
    5. Return mixing fractions, scores, and fragment assignment

    This is the 4D advantage: Chimerys sees (m/z, intensity) only.
    Zyna sees (m/z, intensity, 1/K₀) → direct physical separation.
    """
    try:
        from stan.tools.timsdata.timsdata import TimsData
    except ImportError:
        return {"error": "timsdata DLL not available", "tier": 1}

    # ── Compute theoretical ions ──────────────────────────────────────────────
    ions_a = calc_theoretical_ions(seq_a, charge_a)
    ions_b = calc_theoretical_ions(seq_b, charge_b)

    if not ions_a or not ions_b:
        return {"error": "No theoretical ions generated"}

    # ── Read raw 4D MS2 frame ─────────────────────────────────────────────────
    try:
        with TimsData(str(d_path)) as td:
            if frame_id is None:
                # Use first MS2 frame as demo
                row = td.conn.execute(
                    "SELECT Id, NumScans FROM Frames WHERE MsMsType > 0 LIMIT 1"
                ).fetchone()
                if not row:
                    return {"error": "No MS2 frames found"}
                frame_id  = int(row[0])
                scan_end  = int(row[1])
                scan_begin = 0

            raw4d = _read_ms2_frame_4d(td, frame_id, scan_begin, scan_end)
    except Exception as e:
        return {"error": f"TimsData read failed: {e}"}

    if not raw4d or not raw4d.get("mz"):
        return {"error": "Empty MS2 frame"}

    mz_obs  = np.array(raw4d["mz"],        dtype=np.float32)
    int_obs = np.array(raw4d["intensity"], dtype=np.float32)
    k0_obs  = np.array(raw4d["k0"],        dtype=np.float32)

    # ── 4D fragment assignment (Gaussian probability by 1/K₀) ────────────────
    if abs(k0_a - k0_b) > 0.005:
        # Use ion mobility to assign fragments
        prob_a = np.exp(-0.5 * ((k0_obs - k0_a) / k0_sigma) ** 2)
        prob_b = np.exp(-0.5 * ((k0_obs - k0_b) / k0_sigma) ** 2)
        total  = prob_a + prob_b + 1e-9
        frac_a_per_ion = prob_a / total
        frac_b_per_ion = prob_b / total
    else:
        # Precursors too close in mobility → can't separate by K0
        frac_a_per_ion = np.full(len(mz_obs), 0.5, dtype=np.float32)
        frac_b_per_ion = np.full(len(mz_obs), 0.5, dtype=np.float32)

    # Weighted intensity vectors for A and B
    int_a = int_obs * frac_a_per_ion
    int_b = int_obs * frac_b_per_ion

    # ── Build shared m/z grid ─────────────────────────────────────────────────
    all_mz = [ion["mz"] for ion in ions_a + ions_b]
    lo     = max(150.0, min(all_mz) * 0.97)
    hi     = min(2000.0, max(all_mz) * 1.03)
    n_pts  = 600
    grid   = np.linspace(lo, hi, n_pts, dtype=np.float32)

    def project_observed(mz_arr: np.ndarray, int_arr: np.ndarray) -> np.ndarray:
        vec = np.zeros(n_pts, dtype=np.float32)
        for mz, intensity in zip(mz_arr, int_arr):
            tol  = mz * tolerance_ppm * 1e-6
            mask = np.abs(grid - mz) <= tol
            vec[mask] += intensity
        max_v = vec.max()
        return vec / max_v if max_v > 0 else vec

    obs_a = project_observed(mz_obs, int_a)
    obs_b = project_observed(mz_obs, int_b)

    theo_a = _build_spectrum_vector(ions_a, grid, tolerance_ppm)
    theo_b = _build_spectrum_vector(ions_b, grid, tolerance_ppm)

    # ── Score each peptide against its assigned sub-spectrum ─────────────────
    def cosine_score(obs: np.ndarray, theo: np.ndarray) -> float:
        n1 = np.linalg.norm(obs)
        n2 = np.linalg.norm(theo)
        if n1 > 0 and n2 > 0:
            return float(np.dot(obs, theo) / (n1 * n2))
        return 0.0

    score_a = cosine_score(obs_a, theo_a)
    score_b = cosine_score(obs_b, theo_b)

    # Fragment counts
    def count_matched(ions: list[dict], mz_arr: np.ndarray) -> int:
        c = 0
        for ion in ions:
            tol = ion["mz"] * tolerance_ppm * 1e-6
            if np.any(np.abs(mz_arr - ion["mz"]) <= tol):
                c += 1
        return c

    matched_a = count_matched(ions_a, mz_obs)
    matched_b = count_matched(ions_b, mz_obs)

    # Mixing fraction from intensity-weighted K0 assignment
    total_a = float(int_a.sum())
    total_b = float(int_b.sum())
    grand    = total_a + total_b
    frac_a   = round(total_a / grand, 4) if grand > 0 else 0.5
    frac_b   = round(total_b / grand, 4) if grand > 0 else 0.5

    k0_separation = abs(k0_a - k0_b)
    separated_by_tims = k0_separation > 2 * k0_sigma

    # Sample of fragment ions for visualization (cap at 300 for response size)
    N = min(300, len(mz_obs))
    idx = np.argsort(int_obs)[::-1][:N]
    fragment_scatter = [
        {
            "mz":    round(float(mz_obs[i]),  3),
            "k0":    round(float(k0_obs[i]),  4),
            "int":   round(float(int_obs[i]), 0),
            "prob_a": round(float(frac_a_per_ion[i]), 3),
        }
        for i in idx
    ]

    return {
        "available":           True,
        "tier":                1,
        "k0_separation":       round(k0_separation, 4),
        "separated_by_tims":   separated_by_tims,
        "frac_a":              frac_a,
        "frac_b":              frac_b,
        "score_a":             round(score_a, 4),
        "score_b":             round(score_b, 4),
        "matched_a":           matched_a,
        "matched_b":           matched_b,
        "n_ions_a":            len(ions_a),
        "n_ions_b":            len(ions_b),
        "n_fragments_observed": len(mz_obs),
        "is_chimeric":         score_a > 0.15 and score_b > 0.15,
        "fragment_scatter":    fragment_scatter,
        "ions_a": [{"mz": i["mz"], "label": i["label"]} for i in ions_a[:80]],
        "ions_b": [{"mz": i["mz"], "label": i["label"]} for i in ions_b[:80]],
    }


# ── Tier 2: Prosit REST predictions ──────────────────────────────────────────

async def _prosit_predict_async(
    sequences: list[str],
    charges:   list[int],
    ce: float  = 25.0,
    timeout_s: float = 30.0,
) -> list[list[dict]] | None:
    """Predict fragment intensities via Koina/Prosit REST API."""
    try:
        import httpx
        import re

        # Koina v2 inference endpoint (public, no auth)
        payload = {
            "id": "zyna",
            "inputs": [
                {"name": "peptide_sequences",
                 "shape": [len(sequences), 1],
                 "datatype": "BYTES",
                 "data": [[s] for s in sequences]},
                {"name": "precursor_charges",
                 "shape": [len(charges), 1],
                 "datatype": "INT32",
                 "data": [[c] for c in charges]},
                {"name": "collision_energies",
                 "shape": [len(sequences), 1],
                 "datatype": "FP32",
                 "data": [[ce] for _ in sequences]},
            ],
        }
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(
                "https://koina.wilhelmlab.org/v2/models/"
                "Prosit_2020_intensity_hcd/infer",
                json=payload,
            )
        if resp.status_code != 200:
            return None

        data = resp.json()
        outs = {o["name"]: o for o in data.get("outputs", [])}
        mz_dat  = outs.get("mz",         {}).get("data", [])
        int_dat = outs.get("intensities", {}).get("data", [])
        lbl_dat = outs.get("annotation",  {}).get("data", [])

        n_per = 174  # Prosit returns 174 ions per peptide
        results = []
        for i in range(len(sequences)):
            s = i * n_per
            e = s + n_per
            ions = []
            for j in range(s, min(e, len(mz_dat))):
                if j < len(mz_dat) and mz_dat[j] > 0 and j < len(int_dat) and int_dat[j] > 0:
                    ions.append({
                        "mz":       round(float(mz_dat[j]),  4),
                        "intensity": round(float(int_dat[j]), 4),
                        "label":    str(lbl_dat[j]) if j < len(lbl_dat) else "",
                    })
            results.append(ions)
        return results
    except Exception as e:
        logger.warning("Prosit REST error: %s", e)
        return None


async def tier2_4d_deconvolve(
    d_path: Path,
    seq_a: str,
    charge_a: int,
    k0_a: float,
    seq_b: str,
    charge_b: int,
    k0_b: float,
    frame_id: int | None = None,
    scan_begin: int = 0,
    scan_end: int = 1000,
    tolerance_ppm: float = 20.0,
    k0_sigma: float = 0.03,
    ce: float = 25.0,
) -> dict:
    """Tier 2 — Prosit-assisted 4D chimeric deconvolution.

    Same 4D physics-based fragment assignment as Tier 1, but replaces
    uniform theoretical ion intensities with Prosit predictions for
    improved scoring when 1/K₀ values overlap closely.
    Falls back to Tier 1 (theoretical) if Prosit is unreachable.
    """
    import re

    def strip_mods(s: str) -> str:
        return re.sub(r"\(UniMod:\d+\)", "", s)

    prosit = await _prosit_predict_async(
        [strip_mods(seq_a), strip_mods(seq_b)],
        [charge_a, charge_b],
        ce=ce,
    )

    if prosit and len(prosit) == 2 and prosit[0] and prosit[1]:
        ions_a_raw, ions_b_raw = prosit
        prosit_used = True
    else:
        ions_a_raw = calc_theoretical_ions(seq_a, charge_a)
        ions_b_raw = calc_theoretical_ions(seq_b, charge_b)
        prosit_used = False

    # Delegate to tier1 with Prosit-informed ion lists by reusing core logic
    # (We rebuild the scoring here with actual predicted intensities)
    try:
        from stan.tools.timsdata.timsdata import TimsData

        with TimsData(str(d_path)) as td:
            if frame_id is None:
                row = td.conn.execute(
                    "SELECT Id, NumScans FROM Frames WHERE MsMsType > 0 LIMIT 1"
                ).fetchone()
                if not row:
                    return {"error": "No MS2 frames"}
                frame_id  = int(row[0])
                scan_end  = int(row[1])
            raw4d = _read_ms2_frame_4d(td, frame_id, scan_begin, scan_end)
    except Exception as e:
        return {"error": str(e)}

    if not raw4d or not raw4d.get("mz"):
        return {"error": "Empty MS2 frame"}

    mz_obs  = np.array(raw4d["mz"],        dtype=np.float32)
    int_obs = np.array(raw4d["intensity"], dtype=np.float32)
    k0_obs  = np.array(raw4d["k0"],        dtype=np.float32)

    k0_sep = abs(k0_a - k0_b)
    if k0_sep > 0.005:
        prob_a = np.exp(-0.5 * ((k0_obs - k0_a) / k0_sigma) ** 2)
        prob_b = np.exp(-0.5 * ((k0_obs - k0_b) / k0_sigma) ** 2)
        t = prob_a + prob_b + 1e-9
        fa = prob_a / t
        fb = prob_b / t
    else:
        fa = np.full(len(mz_obs), 0.5, dtype=np.float32)
        fb = 1 - fa

    all_mz = [ion["mz"] for ion in ions_a_raw + ions_b_raw]
    lo, hi = max(150.0, min(all_mz) * 0.97), min(2000.0, max(all_mz) * 1.03)
    grid   = np.linspace(lo, hi, 600, dtype=np.float32)

    def proj(mz_arr, int_arr):
        vec = np.zeros(600, dtype=np.float32)
        for mz, intensity in zip(mz_arr, int_arr):
            tol = mz * tolerance_ppm * 1e-6
            vec[np.abs(grid - mz) <= tol] += intensity
        mx = vec.max()
        return vec / mx if mx > 0 else vec

    obs_a = proj(mz_obs, int_obs * fa)
    obs_b = proj(mz_obs, int_obs * fb)

    def theo_vec(ions):
        intensities = [ion.get("intensity", 1.0) for ion in ions]
        return _build_spectrum_vector(ions, grid, tolerance_ppm, intensities)

    theo_a = theo_vec(ions_a_raw)
    theo_b = theo_vec(ions_b_raw)

    def cos(a, b):
        n1, n2 = np.linalg.norm(a), np.linalg.norm(b)
        return float(np.dot(a, b) / (n1 * n2)) if n1 > 0 and n2 > 0 else 0.0

    score_a = cos(obs_a, theo_a)
    score_b = cos(obs_b, theo_b)

    grand = float(int_obs.sum())
    frac_a = round(float((int_obs * fa).sum()) / grand, 4) if grand > 0 else 0.5
    frac_b = round(float((int_obs * fb).sum()) / grand, 4) if grand > 0 else 0.5

    N = min(300, len(mz_obs))
    idx = np.argsort(int_obs)[::-1][:N]
    scatter = [{"mz": round(float(mz_obs[i]), 3),
                "k0": round(float(k0_obs[i]), 4),
                "int": round(float(int_obs[i]), 0),
                "prob_a": round(float(fa[i]), 3)} for i in idx]

    return {
        "available":           True,
        "tier":                2,
        "prosit_used":         prosit_used,
        "k0_separation":       round(k0_sep, 4),
        "separated_by_tims":   k0_sep > 2 * k0_sigma,
        "frac_a":              frac_a,
        "frac_b":              frac_b,
        "score_a":             round(score_a, 4),
        "score_b":             round(score_b, 4),
        "n_fragments_observed": len(mz_obs),
        "is_chimeric":         score_a > 0.15 and score_b > 0.15,
        "fragment_scatter":    scatter,
        "ions_a": [{"mz": i["mz"], "intensity": i.get("intensity", 1.0),
                    "label": i.get("label", "")} for i in ions_a_raw[:80]],
        "ions_b": [{"mz": i["mz"], "intensity": i.get("intensity", 1.0),
                    "label": i.get("label", "")} for i in ions_b_raw[:80]],
    }
