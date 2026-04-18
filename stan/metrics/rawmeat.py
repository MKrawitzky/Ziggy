"""RawMeat-style identification-free QC metrics for Bruker timsTOF .d files.

Reads analysis.tdf (SQLite) directly — no DIA-NN or Sage results needed.
Inspired by the discontinued RawMeat tool (Vast Scientific) but reimplemented
from scratch for timsTOF data using the open TDF schema.

Metrics extracted:
  - TIC trace split by MS level (MS1 vs MS2/PASEF frames)
  - Spray stability score and dropout detection
  - Accumulation time profile (TIMS trap fill times)
  - Pressure trace (from Frames.Pressure if populated)
  - Run summary (frame counts, RT range, intensity stats)
  - Instrument metadata from GlobalMetadata

MsMsType values in Bruker TDF:
  0  → MS1 (survey / PASEF precursor frames)
  2  → DDA MS2 (traditional ion trap / Qtof)
  8  → ddaPASEF (data-dependent PASEF MS2)
  9  → diaPASEF (data-independent PASEF MS2 / windows)
"""

from __future__ import annotations

import logging
import math
import sqlite3
import statistics
from pathlib import Path

logger = logging.getLogger(__name__)

# MsMsType → human label
_MSMS_LABELS = {0: "MS1", 2: "MS2", 8: "ddaPASEF", 9: "diaPASEF"}

# Dropout: frame whose summed intensity is below this fraction of the
# rolling median is flagged as a potential spray instability event.
_DROPOUT_THRESHOLD = 0.25
_ROLLING_WINDOW = 11  # frames on each side for local median


def _tdf_path(d_path: Path) -> Path:
    tdf = d_path / "analysis.tdf"
    if not tdf.exists():
        raise FileNotFoundError(f"analysis.tdf not found in {d_path}")
    return tdf


def extract_rawmeat_metrics(d_path: str | Path) -> dict:
    """Extract RawMeat-style metrics from a Bruker timsTOF .d directory.

    No search results are needed — reads analysis.tdf only.

    Args:
        d_path: Path to the .d acquisition directory.

    Returns:
        dict with keys: tic, spray, accumulation, pressure, summary, metadata.
        Returns empty dict if d_path does not contain a valid analysis.tdf.
    """
    d_path = Path(d_path)
    try:
        tdf = _tdf_path(d_path)
    except FileNotFoundError as e:
        logger.warning("rawmeat: %s", e)
        return {}

    with sqlite3.connect(str(tdf)) as con:
        # ── Frames ──────────────────────────────────────────────────
        col_names = {r[1] for r in con.execute("PRAGMA table_info(Frames)")}
        has_pressure = "Pressure" in col_names
        has_acc_time = "AccumulationTime" in col_names

        select_cols = "Id, Time, MsMsType, SummedIntensities, NumScans, MaxIntensity"
        if has_acc_time:
            select_cols += ", AccumulationTime, RampTime"
        if has_pressure:
            select_cols += ", Pressure"

        rows = con.execute(f"SELECT {select_cols} FROM Frames ORDER BY Id").fetchall()

        # ── GlobalMetadata ───────────────────────────────────────────
        meta_rows = con.execute("SELECT Key, Value FROM GlobalMetadata").fetchall()

    if not rows:
        return {}

    meta = {r[0]: r[1] for r in meta_rows}

    # Parse rows into typed lists
    frame_ids, rts, msms_types, summed_int, num_scans, max_int = [], [], [], [], [], []
    acc_times, ramp_times, pressures = [], [], []

    col_idx = 6  # next column index after fixed 6
    for row in rows:
        frame_ids.append(row[0])
        rts.append(row[1])
        msms_types.append(row[2])
        summed_int.append(row[3] or 0)
        num_scans.append(row[4] or 0)
        max_int.append(row[5] or 0)
        idx = col_idx
        if has_acc_time:
            acc_times.append(row[idx])
            ramp_times.append(row[idx + 1])
            idx += 2
        if has_pressure:
            pressures.append(row[idx])

    n_frames = len(rows)

    # ── TIC by MS level ───────────────────────────────────────────────
    ms1_rt, ms1_int = [], []
    ms2_rt, ms2_int = [], []
    for rt, mtype, sint in zip(rts, msms_types, summed_int):
        if mtype == 0:
            ms1_rt.append(round(rt, 3))
            ms1_int.append(sint)
        else:
            ms2_rt.append(round(rt, 3))
            ms2_int.append(sint)

    # ── Spray stability ───────────────────────────────────────────────
    # Use MS1 MaxIntensity (best peak per frame) — more sensitive to
    # spray dropouts than SummedIntensities, which is dominated by
    # the gradient plateau and compresses the dynamic range.
    ms1_maxint = [max_int[i] for i, t in enumerate(msms_types) if t == 0]

    dropouts = []
    if len(ms1_maxint) >= _ROLLING_WINDOW * 2:
        half = _ROLLING_WINDOW
        for i in range(half, len(ms1_maxint) - half):
            window = ms1_maxint[i - half: i] + ms1_maxint[i + 1: i + half + 1]
            local_med = statistics.median(window)
            if local_med > 0 and ms1_maxint[i] < _DROPOUT_THRESHOLD * local_med:
                dropouts.append(round(ms1_rt[i], 2))

    ms1_nonzero = [v for v in ms1_maxint if v > 0]
    spray_cv = 0.0
    if len(ms1_nonzero) >= 2:
        mean_i = statistics.mean(ms1_nonzero)
        sd_i = statistics.stdev(ms1_nonzero)
        spray_cv = round((sd_i / mean_i) * 100, 1) if mean_i > 0 else 0.0

    # Stability score: based on dropouts only (not global CV, which is
    # inflated by the normal LC gradient ramp-up/ramp-down).
    # 0 dropouts = 100, each dropout costs 10 pts, floor at 0.
    dropout_penalty = min(100, len(dropouts) * 10)
    stability_score = max(0, 100 - dropout_penalty)

    # ── Accumulation time profile ─────────────────────────────────────
    acc_data: dict = {}
    if acc_times:
        ms1_acc = [(rts[i], acc_times[i]) for i in range(n_frames) if msms_types[i] == 0 and acc_times[i]]
        ms2_acc = [(rts[i], acc_times[i]) for i in range(n_frames) if msms_types[i] != 0 and acc_times[i]]
        acc_data = {
            "ms1_rt":  [round(x[0], 2) for x in ms1_acc],
            "ms1_acc": [x[1] for x in ms1_acc],
            "ms2_rt":  [round(x[0], 2) for x in ms2_acc],
            "ms2_acc": [x[1] for x in ms2_acc],
            "median_ms1_acc": round(statistics.median([x[1] for x in ms1_acc]), 2) if ms1_acc else None,
            "median_ms2_acc": round(statistics.median([x[1] for x in ms2_acc]), 2) if ms2_acc else None,
        }

    # ── Pressure trace ────────────────────────────────────────────────
    pressure_data: dict = {}
    if pressures:
        valid = [(rts[i], pressures[i]) for i in range(n_frames)
                 if pressures[i] is not None and pressures[i] > 0]
        if valid:
            pressure_data = {
                "rt":      [round(v[0], 2) for v in valid],
                "mbar":    [v[1] for v in valid],
                "mean":    round(statistics.mean(v[1] for v in valid), 4),
                "min":     round(min(v[1] for v in valid), 4),
                "max":     round(max(v[1] for v in valid), 4),
            }

    # ── Frame type breakdown ──────────────────────────────────────────
    type_counts: dict[str, int] = {}
    for mtype in msms_types:
        label = _MSMS_LABELS.get(mtype, f"type{mtype}")
        type_counts[label] = type_counts.get(label, 0) + 1

    # ── Intensity stats ───────────────────────────────────────────────
    ms1_max = max(ms1_int) if ms1_int else 0
    total_tic = sum(ms1_int)

    # Dynamic range: log10(max MS1 MaxIntensity / median MS1 MaxIntensity)
    # MaxIntensity spans a wider range than SummedIntensities across gradient.
    dyn_range = None
    ms1_maxint_nonzero = [v for v in ms1_maxint if v > 0]
    if ms1_maxint_nonzero:
        med_nz = statistics.median(ms1_maxint_nonzero)
        peak = max(ms1_maxint_nonzero)
        if med_nz > 0 and peak > 0:
            dyn_range = round(math.log10(peak / med_nz), 1)

    # ── Summary ───────────────────────────────────────────────────────
    rt_min_s = min(rts) if rts else 0
    rt_max_s = max(rts) if rts else 0
    summary = {
        "n_frames_total":   n_frames,
        "n_ms1_frames":     type_counts.get("MS1", 0),
        "n_ms2_frames":     n_frames - type_counts.get("MS1", 0),
        "frame_types":      type_counts,
        "rt_start_s":       round(rt_min_s, 1),
        "rt_end_s":         round(rt_max_s, 1),
        "rt_duration_min":  round((rt_max_s - rt_min_s) / 60, 2),
        "ms1_max_intensity": ms1_max,
        "ms1_total_tic":    total_tic,
        "dynamic_range_log10": dyn_range,
        "spray_cv_pct":     spray_cv,
        "n_dropouts":       len(dropouts),
        "stability_score":  stability_score,
    }

    # ── Instrument metadata ───────────────────────────────────────────
    metadata = {
        "instrument":        meta.get("InstrumentName", ""),
        "serial_number":     meta.get("InstrumentSerialNumber", ""),
        "software":          meta.get("AcquisitionSoftware", ""),
        "software_version":  meta.get("AcquisitionSoftwareVersion", ""),
        "acquisition_date":  meta.get("AcquisitionDateTime", ""),
        "operator":          meta.get("OperatorName", ""),
        "method":            meta.get("MethodName", ""),
    }

    return {
        "tic": {
            "ms1_rt":  ms1_rt,
            "ms1_int": ms1_int,
            "ms2_rt":  ms2_rt,
            "ms2_int": ms2_int,
        },
        "spray": {
            "cv_pct":          spray_cv,
            "stability_score": stability_score,
            "dropout_rts":     dropouts,
            "n_dropouts":      len(dropouts),
        },
        "accumulation": acc_data,
        "pressure":     pressure_data,
        "summary":      summary,
        "metadata":     metadata,
    }
