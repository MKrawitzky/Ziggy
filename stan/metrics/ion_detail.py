"""Ion detail extraction — XIC and mobilogram for a clicked precursor.

Uses ``readScans`` + ``mzToIndex`` (the same path used by frame_heatmap/
frame_spectrum, which are known to work) rather than ``extractChromatograms``,
which fails on some timsTOF files with "Job generator produced an error."

Strategy
--------
* XIC   — downsample MS1 frames to ≤ _MAX_XIC_FRAMES evenly spaced across the
           run.  For each sampled frame: convert m/z window → TOF index range
           (one DLL call), read all scans (``readScans``), filter by index,
           sum intensity.  The downsample keeps the total DLL call count low.

* EIM   — read every MS1 frame within ±_MOB_RT_WIN seconds of the clicked RT,
           filter each scan by the same TOF range, accumulate per-scan intensity
           binned into _MOB_N_BINS ook0 bins.  ook0 calibration uses a single
           batch ``scanNumToOneOverK0`` call per frame.

Called by the dashboard when the user clicks a feature point in the
Ion Mobility scatter.  Requires the Bruker timsdata DLL;
returns an empty dict if the DLL is unavailable.
"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

_MZ_TOL_PPM: float  = 10.0
_MOB_N_BINS: int    = 80       # ook0 bins for EIM
_MOB_RT_WIN: float  = 20.0     # ±20 s around reported RT for EIM
_MAX_XIC_FRAMES: int = 400     # downsample XIC to at most this many frames


def get_ion_detail(
    d_path: str | Path,
    mz: float,
    rt_sec: float,
    ook0: float,
    mz_tol_ppm: float = _MZ_TOL_PPM,
) -> dict:
    """XIC + EIM mobilogram for a specific precursor ion.

    Uses ``readScans`` + ``mzToIndex`` (no ``extractChromatograms``).

    Args:
        d_path:      Bruker .d directory.
        mz:          Precursor m/z (Th).
        rt_sec:      Approximate retention time in seconds.
        ook0:        Measured 1/K₀ (Vs/cm²) — reference line on the EIM.
        mz_tol_ppm:  m/z extraction window (default 10 ppm).

    Returns:
        ``{xic: {rt_sec, intensity}, mobilogram: {ook0, intensity},
           peak_mz, peak_rt, peak_ook0}``
        or ``{}`` on failure / DLL unavailable.
    """
    try:
        import numpy as np
        from stan.tools.timsdata.timsdata import TimsData
    except Exception:
        logger.warning("timsdata DLL unavailable — cannot extract ion detail")
        return {}

    d_path = Path(d_path)
    if not d_path.is_dir():
        logger.warning("ion_detail: directory not found: %s", d_path)
        return {}

    mz_lo = mz * (1.0 - mz_tol_ppm / 1e6)
    mz_hi = mz * (1.0 + mz_tol_ppm / 1e6)

    try:
        with TimsData(str(d_path)) as td:

            # ── 1. Build frame list (MS1 only, fallback to all) ──────────────
            frame_rows = td.conn.execute(
                "SELECT Id, NumScans, Time FROM Frames WHERE MsMsType=0 ORDER BY Id"
            ).fetchall()
            if not frame_rows:
                frame_rows = td.conn.execute(
                    "SELECT Id, NumScans, Time FROM Frames ORDER BY Id"
                ).fetchall()
            if not frame_rows:
                return {}

            fids          = [int(r[0]) for r in frame_rows]
            n_scans_map   = {int(r[0]): int(r[1]) for r in frame_rows}
            rt_map        = {int(r[0]): float(r[2]) for r in frame_rows}

            # ── 2. ook0 calibration from a mid-run MS1 frame ─────────────────
            ref_fid    = fids[len(fids) // 2]
            ref_nscans = n_scans_map[ref_fid]
            endpoints  = td.scanNumToOneOverK0(
                ref_fid, np.array([0.0, float(ref_nscans - 1)])
            )
            ook0_lo = float(min(endpoints))
            ook0_hi = float(max(endpoints))
            bin_w   = (ook0_hi - ook0_lo) / _MOB_N_BINS

            # ── 3. Global TOF index range for this m/z window ─────────────────
            #    Use a representative frame; small calibration drift is OK for
            #    a QC XIC preview.
            tof_bounds = td.mzToIndex(ref_fid, np.array([mz_lo, mz_hi]))
            tof_lo_i   = int(min(tof_bounds))
            tof_hi_i   = int(max(tof_bounds))

            # ── 4. XIC — downsampled MS1 frames ──────────────────────────────
            if len(fids) > _MAX_XIC_FRAMES:
                step    = len(fids) / _MAX_XIC_FRAMES
                sampled = [fids[int(i * step)] for i in range(_MAX_XIC_FRAMES)]
            else:
                sampled = fids

            xic_rt_list:  list[float] = []
            xic_int_list: list[int]   = []

            for fid in sampled:
                n_sc  = n_scans_map[fid]
                scans = td.readScans(fid, 0, n_sc)
                arrs  = [(idx, ints) for idx, ints in scans if len(idx) > 0]
                if not arrs:
                    xic_rt_list.append(round(rt_map[fid], 2))
                    xic_int_list.append(0)
                    continue
                all_idx  = np.concatenate([a[0] for a in arrs])
                all_ints = np.concatenate([a[1] for a in arrs])
                mask     = (all_idx >= tof_lo_i) & (all_idx <= tof_hi_i)
                xic_rt_list.append(round(rt_map[fid], 2))
                xic_int_list.append(int(all_ints[mask].sum()))

            # ── 5. EIM mobilogram — frames within ±_MOB_RT_WIN of rt_sec ─────
            rt_lo     = rt_sec - _MOB_RT_WIN
            rt_hi     = rt_sec + _MOB_RT_WIN
            mob_fids  = [f for f in fids if rt_lo <= rt_map[f] <= rt_hi]
            if not mob_fids:
                mob_fids = [min(fids, key=lambda f: abs(rt_map[f] - rt_sec))]

            mob_acc = np.zeros(_MOB_N_BINS, dtype=np.int64)

            for fid in mob_fids:
                n_sc = n_scans_map[fid]
                # Batch ook0 conversion for all scan indices in this frame
                scan_nums  = np.arange(n_sc, dtype=float)
                ook0_vals  = td.scanNumToOneOverK0(fid, scan_nums)
                bin_idxs   = np.clip(
                    ((ook0_vals - ook0_lo) / bin_w).astype(int),
                    0, _MOB_N_BINS - 1,
                )
                scans = td.readScans(fid, 0, n_sc)
                for scan_i, (idx_arr, int_arr) in enumerate(scans):
                    if len(idx_arr) == 0:
                        continue
                    mask = (idx_arr >= tof_lo_i) & (idx_arr <= tof_hi_i)
                    if not mask.any():
                        continue
                    mob_acc[bin_idxs[scan_i]] += int(int_arr[mask].sum())

            ook0_centres = [
                round(ook0_lo + (i + 0.5) * bin_w, 4)
                for i in range(_MOB_N_BINS)
            ]

            return {
                "xic": {
                    "rt_sec":    xic_rt_list,
                    "intensity": xic_int_list,
                },
                "mobilogram": {
                    "ook0":      ook0_centres,
                    "intensity": mob_acc.tolist(),
                },
                "peak_mz":   mz,
                "peak_rt":   rt_sec,
                "peak_ook0": ook0,
            }

    except Exception:
        logger.exception("ion_detail extraction failed for %s  mz=%.4f", d_path, mz)
        return {}


def _find_closest_ms1_frame(
    conn,
    rt_sec: float,
) -> tuple[int, int, float] | None:
    """Return (frame_id, n_scans, actual_rt) for the MS1 frame nearest to rt_sec."""
    row = conn.execute(
        "SELECT Id, NumScans, Time FROM Frames WHERE MsMsType=0 "
        "ORDER BY ABS(Time - ?) LIMIT 1",
        (rt_sec,),
    ).fetchone()
    if not row:
        # Fall back to any frame type (some runs have no MsMsType=0 tagged frames)
        row = conn.execute(
            "SELECT Id, NumScans, Time FROM Frames ORDER BY ABS(Time - ?) LIMIT 1",
            (rt_sec,),
        ).fetchone()
    return row  # (Id, NumScans, Time) or None


def get_frame_heatmap(
    d_path: str | Path,
    rt_sec: float,
    mz_lo: float | None = None,
    mz_hi: float | None = None,
    n_mz_bins: int = 220,
    n_ook0_bins: int = 150,
) -> dict:
    """Raw 2D frame heatmap — m/z × 1/K₀ intensity for the frame nearest rt_sec.

    Equivalent to mzmine's Frame Heatmap panel (panel 5).  Reads all mobility
    scans in the frame, converts TOF indices → m/z and scan numbers → 1/K₀,
    and accumulates into a 2D intensity grid rendered with a log colour scale.

    Args:
        d_path:     Bruker .d directory.
        rt_sec:     Target retention time in seconds.
        mz_lo:      Lower m/z bound (None → use frame minimum).
        mz_hi:      Upper m/z bound (None → use frame maximum).
        n_mz_bins:  Number of m/z bins in the output grid.
        n_ook0_bins: Number of 1/K₀ bins in the output grid.

    Returns:
        {
            "mz_edges":   [...],          # length n_mz_bins+1
            "ook0_edges": [...],          # length n_ook0_bins+1
            "grid":       [[...],...],    # [ook0_row][mz_col] = log10(intensity+1)
            "frame_id": int, "rt_sec": float,
            "n_scans": int, "n_peaks": int,
            "mz_range": [lo, hi], "ook0_range": [lo, hi],
        }
        or {} on failure.
    """
    try:
        import numpy as np
        from stan.tools.timsdata.timsdata import TimsData
    except Exception:
        logger.warning("timsdata DLL unavailable — cannot extract frame heatmap")
        return {}

    d_path = Path(d_path)
    if not d_path.is_dir():
        return {}

    try:
        with TimsData(str(d_path)) as td:
            row = _find_closest_ms1_frame(td.conn, rt_sec)
            if not row:
                return {}
            frame_id, n_scans, actual_rt = int(row[0]), int(row[1]), float(row[2])

            # ── ook0 calibration bounds ───────────────────────────────────
            ook0_pts = td.scanNumToOneOverK0(
                frame_id, np.array([0.0, float(n_scans - 1)])
            )
            ook0_lo_inst = float(min(ook0_pts))
            ook0_hi_inst = float(max(ook0_pts))

            # ── Read all mobility scans ───────────────────────────────────
            scans = td.readScans(frame_id, 0, n_scans)

            peak_mzs:   list[np.ndarray] = []
            peak_ints:  list[np.ndarray] = []
            peak_scans: list[np.ndarray] = []
            n_peaks = 0

            for scan_idx, (idx_arr, int_arr) in enumerate(scans):
                if len(idx_arr) == 0:
                    continue
                mzs = td.indexToMz(frame_id, idx_arr.astype(float))
                peak_mzs.append(mzs)
                peak_ints.append(int_arr.astype(float))
                peak_scans.append(np.full(len(mzs), scan_idx, dtype=np.int32))
                n_peaks += len(mzs)

            if not peak_mzs:
                return {}

            all_mz   = np.concatenate(peak_mzs)
            all_int  = np.concatenate(peak_ints)
            all_scan = np.concatenate(peak_scans)

            # ── m/z range ─────────────────────────────────────────────────
            actual_mz_lo = float(all_mz.min())
            actual_mz_hi = float(all_mz.max())
            if mz_lo is None:
                mz_lo = actual_mz_lo
            if mz_hi is None:
                mz_hi = actual_mz_hi
            mz_lo, mz_hi = float(mz_lo), float(mz_hi)

            # Filter to requested m/z range
            mask = (all_mz >= mz_lo) & (all_mz <= mz_hi)
            if not mask.any():
                return {}
            all_mz   = all_mz[mask]
            all_int  = all_int[mask]
            all_scan = all_scan[mask]

            # ── Convert scan indices → 1/K₀ ───────────────────────────────
            unique_scans    = np.unique(all_scan)
            ook0_for_scans  = td.scanNumToOneOverK0(
                frame_id, unique_scans.astype(float)
            )
            scan_ook0 = dict(zip(unique_scans.tolist(), ook0_for_scans.tolist()))
            ook0_vals = np.array([scan_ook0[int(s)] for s in all_scan])

            # ── Build 2D grid ─────────────────────────────────────────────
            mz_step   = (mz_hi   - mz_lo)          / n_mz_bins
            ook0_step = (ook0_hi_inst - ook0_lo_inst) / n_ook0_bins

            mz_bi   = np.clip(
                ((all_mz - mz_lo) / mz_step).astype(int), 0, n_mz_bins - 1
            )
            ook0_bi = np.clip(
                ((ook0_vals - ook0_lo_inst) / ook0_step).astype(int), 0, n_ook0_bins - 1
            )

            grid = np.zeros((n_ook0_bins, n_mz_bins), dtype=np.float32)
            np.add.at(grid, (ook0_bi, mz_bi), all_int)

            log_grid = np.log10(grid + 1.0)

            mz_edges   = [round(mz_lo   + i * mz_step,  3) for i in range(n_mz_bins   + 1)]
            ook0_edges = [
                round(ook0_lo_inst + i * ook0_step, 4)
                for i in range(n_ook0_bins + 1)
            ]

            # Round grid to 3 dp to keep JSON compact
            grid_list = [[round(float(v), 3) for v in row] for row in log_grid.tolist()]

            return {
                "mz_edges":   mz_edges,
                "ook0_edges": ook0_edges,
                "grid":       grid_list,
                "frame_id":   frame_id,
                "rt_sec":     round(actual_rt, 2),
                "n_scans":    n_scans,
                "n_peaks":    n_peaks,
                "mz_range":   [round(mz_lo, 3),          round(mz_hi, 3)],
                "ook0_range": [round(ook0_lo_inst, 4), round(ook0_hi_inst, 4)],
            }

    except Exception:
        logger.exception("frame_heatmap failed for %s  rt=%.1f", d_path, rt_sec)
        return {}


def get_frame_spectrum(
    d_path: str | Path,
    rt_sec: float,
    n_bins: int = 2000,
) -> dict:
    """Summed MS spectrum for the frame nearest rt_sec.

    Equivalent to mzmine's Summed Frame Spectrum panel (panel 1).
    All mobility scans are summed into a single m/z-intensity profile.

    Args:
        d_path:  Bruker .d directory.
        rt_sec:  Target retention time in seconds.
        n_bins:  Number of m/z bins in the output profile.

    Returns:
        {"mz": [...], "intensity": [...], "rt_sec": float, "frame_id": int}
        or {} on failure.
    """
    try:
        import numpy as np
        from stan.tools.timsdata.timsdata import TimsData
    except Exception:
        logger.warning("timsdata DLL unavailable — cannot extract frame spectrum")
        return {}

    d_path = Path(d_path)
    if not d_path.is_dir():
        return {}

    try:
        with TimsData(str(d_path)) as td:
            row = _find_closest_ms1_frame(td.conn, rt_sec)
            if not row:
                return {}
            frame_id, n_scans, actual_rt = int(row[0]), int(row[1]), float(row[2])

            scans = td.readScans(frame_id, 0, n_scans)

            all_mz:  list[np.ndarray] = []
            all_int: list[np.ndarray] = []

            for idx_arr, int_arr in scans:
                if len(idx_arr) == 0:
                    continue
                mzs = td.indexToMz(frame_id, idx_arr.astype(float))
                all_mz.append(mzs)
                all_int.append(int_arr.astype(float))

            if not all_mz:
                return {}

            flat_mz  = np.concatenate(all_mz)
            flat_int = np.concatenate(all_int)

            mz_lo = float(flat_mz.min())
            mz_hi = float(flat_mz.max())
            if mz_hi <= mz_lo:
                return {}

            step = (mz_hi - mz_lo) / n_bins
            bins = np.zeros(n_bins, dtype=np.float64)
            idx  = np.clip(((flat_mz - mz_lo) / step).astype(int), 0, n_bins - 1)
            np.add.at(bins, idx, flat_int)

            # Keep only non-zero bins for compact transfer
            nonzero = bins > 0
            mz_centers = mz_lo + (np.where(nonzero)[0] + 0.5) * step

            return {
                "mz":       [round(float(v), 3) for v in mz_centers],
                "intensity": [round(float(v))   for v in bins[nonzero]],
                "rt_sec":   round(actual_rt, 2),
                "frame_id": frame_id,
                "mz_range": [round(mz_lo, 3), round(mz_hi, 3)],
            }

    except Exception:
        logger.exception("frame_spectrum failed for %s  rt=%.1f", d_path, rt_sec)
        return {}
