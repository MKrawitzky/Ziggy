"""Theoretical MS2 spectrum generation from DIA-NN Modified.Sequence.

Computes singly- and doubly-charged b/y fragment ion series from the
UniMod-annotated peptide sequences DIA-NN writes to report.parquet.
Also provides peptide search for the SpectraTab UI.

Fragment ion notation follows the Roepstorff-Fohlman-Biemann convention:
  b ions — N-terminal, mass = sum(residues) + H+
  y ions — C-terminal, mass = sum(residues) + H₂O + H+
  b²  / y² — doubly-charged, mass = (mass + H+) / 2

UniMod IDs supported (most common in proteomics + immunopeptidomics):
  1  Acetyl      (+42.010565)
  4  Carbamidomethyl (+57.021464)   ← fixed mod, shown in gray
  5  Carbamyl    (+43.005814)
  7  Deamidated  (+0.984016)
  21 Oxidation   (+15.994915)
  35 Hydroxylation (+15.994915)
  56 Acetyl(K)   (+42.010565)
  80 Phospho     (+79.966331)
  21 Oxidation   (+15.994915)
"""

from __future__ import annotations

import re
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# ── Masses ────────────────────────────────────────────────────────────────────

_PROTON = 1.007276
_H2O    = 18.010565
_NH3    = 17.026549

_AA_MASS: dict[str, float] = {
    "A": 71.03711,  "R": 156.10111, "N": 114.04293, "D": 115.02694,
    "C": 103.00919, "E": 129.04259, "Q": 128.05858, "G": 57.02146,
    "H": 137.05891, "I": 113.08406, "L": 113.08406, "K": 128.09496,
    "M": 131.04049, "F": 147.06841, "P": 97.05276,  "S": 87.03203,
    "T": 101.04768, "W": 186.07931, "Y": 163.06333, "V": 99.06841,
}

_UNIMOD_MASS: dict[str, float] = {
    "1":   42.010565,   # Acetyl (N-term / K)
    "4":   57.021464,   # Carbamidomethyl (C)
    "5":   43.005814,   # Carbamyl
    "7":    0.984016,   # Deamidated (N/Q)
    "21":  15.994915,   # Oxidation (M)
    "35":  15.994915,   # Hydroxylation
    "56":  42.010565,   # Acetyl (K)
    "80":  79.966331,   # Phospho (S/T/Y)
    "259": 42.046950,   # Trimethyl (K)
    "28":  14.015650,   # Methylation
}

# UniMod IDs that are fixed modifications — shown in gray instead of orange
_FIXED_MOD_IDS = {"4"}

_UNIMOD_LABELS: dict[str, str] = {
    "1":   "Ac",
    "4":   "CAM",
    "5":   "Carb",
    "7":   "Deam",
    "21":  "Ox",
    "35":  "OH",
    "56":  "Ac",
    "80":  "Phos",
    "259": "Me3",
    "28":  "Me",
}

_MOD_TOKEN = re.compile(r"\(UniMod:(\d+)\)")


# ── Sequence parsing ──────────────────────────────────────────────────────────

def _parse_residues(mod_seq: str) -> list[dict]:
    """Parse a DIA-NN Modified.Sequence into a list of residue dicts.

    Each dict has:
      aa      str   amino acid letter
      mass    float monoisotopic residue mass (+ modification delta)
      mods    list  list of (label, is_fixed) tuples for inline mods
    """
    residues: list[dict] = []
    i = 0
    while i < len(mod_seq):
        aa = mod_seq[i]
        if aa not in _AA_MASS:
            i += 1
            continue
        mass = _AA_MASS[aa]
        mods: list[tuple[str, bool]] = []
        i += 1
        # Consume zero or more inline mods, e.g. (UniMod:4)(UniMod:21)
        while i < len(mod_seq) and mod_seq[i] == "(":
            end = mod_seq.index(")", i)
            inner = mod_seq[i + 1 : end]
            if inner.startswith("UniMod:"):
                uid = inner[7:]
                mass += _UNIMOD_MASS.get(uid, 0.0)
                label = _UNIMOD_LABELS.get(uid, f"U:{uid}")
                is_fixed = uid in _FIXED_MOD_IDS
                mods.append((label, is_fixed))
            i = end + 1
        residues.append({"aa": aa, "mass": mass, "mods": mods})
    return residues


# ── Fragment ion computation ──────────────────────────────────────────────────

def compute_fragment_ions(mod_seq: str, charge: int = 2) -> dict:
    """Compute theoretical b and y ion series for a modified peptide.

    Args:
        mod_seq:  DIA-NN Modified.Sequence string.
        charge:   Precursor charge (used to determine which fragment
                  charge states to include: z=1 always; z=2 if charge ≥ 2).

    Returns dict with:
        sequence     str      original Modified.Sequence
        residues     list     [{aa, mods, mass}, ...]
        b_ions       list     [{label, mz, charge, pos}, ...]
        y_ions       list     [{label, mz, charge, pos}, ...]
        precursor_mz float    neutral mass as (M + zH) / z for the given charge
        neutral_mass float    M (no proton)
    """
    residues = _parse_residues(mod_seq)
    n = len(residues)
    if n < 2:
        return {"sequence": mod_seq, "residues": [], "b_ions": [], "y_ions": [],
                "precursor_mz": 0.0, "neutral_mass": 0.0}

    total_mass = sum(r["mass"] for r in residues) + _H2O
    precursor_mz = (total_mass + charge * _PROTON) / charge

    b_ions: list[dict] = []
    y_ions: list[dict] = []

    # b ions (N-terminal, starting from b1)
    b_mass = 0.0
    for pos in range(1, n):            # b1 … b(n-1)
        b_mass += residues[pos - 1]["mass"]
        # +1 charge
        b_ions.append({
            "label": f"b{pos}",
            "mz":    round((b_mass + _PROTON) / 1, 4),
            "charge": 1, "pos": pos, "type": "b",
        })
        # +2 charge (only if precursor is ≥2+)
        if charge >= 2 and pos >= 2:
            b_ions.append({
                "label": f"b{pos}²",
                "mz":    round((b_mass + 2 * _PROTON) / 2, 4),
                "charge": 2, "pos": pos, "type": "b",
            })

    # y ions (C-terminal, starting from y1)
    y_mass = _H2O
    for pos in range(1, n):            # y1 … y(n-1)
        y_mass += residues[n - pos]["mass"]
        y_ions.append({
            "label": f"y{pos}",
            "mz":    round((y_mass + _PROTON) / 1, 4),
            "charge": 1, "pos": pos, "type": "y",
        })
        if charge >= 2 and pos >= 2:
            y_ions.append({
                "label": f"y{pos}²",
                "mz":    round((y_mass + 2 * _PROTON) / 2, 4),
                "charge": 2, "pos": pos, "type": "y",
            })

    return {
        "sequence":     mod_seq,
        "residues":     residues,
        "b_ions":       b_ions,
        "y_ions":       y_ions,
        "precursor_mz": round(precursor_mz, 4),
        "neutral_mass": round(total_mass, 4),
    }


# ── Peptide search from report.parquet ───────────────────────────────────────

_Q_CUTOFF = 0.01


def search_peptides(
    report_path: str | Path,
    run_name: str | None = None,
    query: str = "",
    limit: int = 50,
    mz: float = 0.0,
    mz_ppm: float = 10.0,
) -> list[dict]:
    """Search for peptides in a DIA-NN report.parquet.

    Returns a list of unique precursors matching the query string
    (case-insensitive substring match on Stripped.Sequence) and/or m/z,
    sorted by intensity descending.

    Each item: {sequence, stripped, charge, mz, rt, mobility, intensity,
                best_fr_mz, predicted_im}
    """
    try:
        import polars as pl
    except ImportError:
        logger.error("polars required for peptide search")
        return []

    report_path = Path(report_path)
    if not report_path.exists():
        return []

    try:
        schema = pl.read_parquet_schema(str(report_path))
    except Exception:
        logger.exception("Cannot read schema: %s", report_path)
        return []

    available = set(schema.keys())
    file_col = "Run" if "Run" in available else "File.Name"

    want = [c for c in [
        "Modified.Sequence", "Stripped.Sequence", "Precursor.Charge",
        "Precursor.Mz", "RT", "IM", "Predicted.IM", "Best.Fr.Mz",
        "Precursor.Quantity", "Q.Value", file_col,
    ] if c in available]

    try:
        df = pl.read_parquet(str(report_path), columns=want)
    except Exception:
        logger.exception("Failed to read %s", report_path)
        return []

    df = df.filter(pl.col("Q.Value") <= _Q_CUTOFF)

    # Filter to specific run in multi-run reports
    if run_name and file_col in df.columns:
        stem = Path(run_name).stem
        df_run = df.filter(pl.col(file_col).str.contains(stem, literal=True))
        if df_run.height > 0:
            df = df_run

    if df.height == 0:
        return []

    # m/z filter (takes priority over sequence query if both supplied)
    if mz > 0:
        tol = mz * mz_ppm / 1e6
        df = df.filter(
            (pl.col("Precursor.Mz") >= mz - tol) & (pl.col("Precursor.Mz") <= mz + tol)
        )

    # Sequence query filter
    if query:
        q_upper = query.upper().replace(" ", "")
        seq_col = "Stripped.Sequence" if "Stripped.Sequence" in df.columns else "Modified.Sequence"
        df = df.filter(pl.col(seq_col).str.to_uppercase().str.contains(q_upper, literal=True))

    if df.height == 0:
        return []

    # Aggregate to unique precursors (highest intensity observation)
    has_qty      = "Precursor.Quantity" in df.columns
    has_im       = "IM" in df.columns
    has_pred_im  = "Predicted.IM" in df.columns
    has_best_fr  = "Best.Fr.Mz" in df.columns
    has_str      = "Stripped.Sequence" in df.columns

    rows = df.sort("Precursor.Quantity" if has_qty else "Q.Value", descending=has_qty)
    seen: set[tuple] = set()
    results: list[dict] = []

    for row in rows.iter_rows(named=True):
        key = (row.get("Modified.Sequence", ""), row.get("Precursor.Charge", 2))
        if key in seen:
            continue
        seen.add(key)
        precursor_mz = round(float(row.get("Precursor.Mz", 0) or 0), 4)
        results.append({
            "sequence":     row.get("Modified.Sequence", ""),
            "stripped":     row.get("Stripped.Sequence", "") if has_str else "",
            "charge":       int(row.get("Precursor.Charge", 2) or 2),
            "mz":           precursor_mz,
            "rt":           round(float(row.get("RT", 0) or 0), 3),
            "mobility":     round(float(row.get("IM", 0) or 0), 4) if has_im else None,
            "predicted_im": round(float(row.get("Predicted.IM", 0) or 0), 4) if has_pred_im else None,
            "best_fr_mz":   round(float(row.get("Best.Fr.Mz", 0) or 0), 4) if has_best_fr else None,
            "intensity":    float(row.get("Precursor.Quantity", 0) or 0),
            "mz_ppm_delta": round((precursor_mz - mz) / mz * 1e6, 2) if mz > 0 else None,
        })
        if len(results) >= limit:
            break

    return results
