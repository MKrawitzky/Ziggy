"""diaPASEF ion mobility window extraction and drift monitoring.

Reads DIA window definitions from Bruker analysis.tdf and compares
against a reference (first QC run or saved template) to detect drift.

Window drift can indicate:
  - Method file corruption or misconfiguration
  - Firmware changes after instrument service
  - Calibration shifts in the TIMS tunnel

Tables used from analysis.tdf:
  - DiaFrameMsMsWindows: m/z boundaries per WindowGroup
  - DiaFrameMsMsInfo: frame-to-window mapping with ScanNumBegin/ScanNumEnd
  - Frames: scan number to 1/K0 calibration
"""

from __future__ import annotations

import logging
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

logger = logging.getLogger(__name__)


@dataclass
class DiaWindow:
    """A single diaPASEF isolation window."""

    window_group: int
    mz_lower: float
    mz_upper: float
    scan_num_begin: int = 0
    scan_num_end: int = 0
    # Derived from scan calibration
    oneoverk0_lower: float = 0.0
    oneoverk0_upper: float = 0.0
    # RT range (seconds) over which this window group is measured
    rt_begin_sec: float = 0.0
    rt_end_sec: float = 0.0


@dataclass
class WindowLayout:
    """Complete diaPASEF window layout for a run."""

    windows: list[DiaWindow] = field(default_factory=list)
    n_window_groups: int = 0
    mz_range: tuple[float, float] = (0.0, 0.0)
    mobility_range: tuple[float, float] = (0.0, 0.0)
    run_name: str = ""
    rt_range: tuple[float, float] = (0.0, 0.0)


@dataclass
class PasefEvent:
    """A single ddaPASEF precursor isolation event."""

    frame: int
    rt_sec: float          # retention time of this frame (seconds)
    scan_num_begin: int
    scan_num_end: int
    isolation_mz: float    # precursor m/z centre
    isolation_width: float # m/z isolation window width
    collision_energy: float = 0.0
    # Derived from scan calibration
    oneoverk0_lower: float = 0.0
    oneoverk0_upper: float = 0.0

    @property
    def mz_lower(self) -> float:
        return self.isolation_mz - self.isolation_width / 2.0

    @property
    def mz_upper(self) -> float:
        return self.isolation_mz + self.isolation_width / 2.0


@dataclass
class DriftReport:
    """Result of comparing two window layouts."""

    is_drifted: bool = False
    max_mz_shift: float = 0.0        # largest m/z boundary shift (Da)
    max_mobility_shift: float = 0.0   # largest 1/K0 shift
    n_windows_shifted: int = 0        # windows with any shift > threshold
    n_windows_total: int = 0
    details: list[str] = field(default_factory=list)


def extract_dia_windows(d_path: Path) -> WindowLayout | None:
    """Extract diaPASEF window layout from a Bruker .d directory.

    Args:
        d_path: Path to the .d directory.

    Returns:
        WindowLayout with all window definitions, or None if not diaPASEF.
    """
    d_path = Path(d_path)
    tdf = d_path / "analysis.tdf"
    if not tdf.exists():
        logger.warning("analysis.tdf not found in %s", d_path)
        return None

    try:
        with sqlite3.connect(str(tdf)) as con:
            # Check if diaPASEF tables exist
            tables = {
                r[0] for r in
                con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            }

            if "DiaFrameMsMsWindows" not in tables:
                logger.debug("No DiaFrameMsMsWindows table — not diaPASEF: %s", d_path.name)
                return None

            # Read all sub-windows from DiaFrameMsMsWindows.
            # Each row is one isolation box: (WindowGroup, ScanNumBegin, ScanNumEnd,
            # IsolationMz, IsolationWidth, CollisionEnergy)
            # m/z bounds = IsolationMz ± IsolationWidth/2
            win_cols = {r[1] for r in con.execute(
                "PRAGMA table_info(DiaFrameMsMsWindows)"
            ).fetchall()}

            # Handle two known column-name variants across TDF versions:
            #   New (most Bruker instruments): IsolationMz + IsolationWidth
            #   Old/alternate: IsolationWindowLowerMz + IsolationWindowUpperMz
            if "IsolationMz" in win_cols and "IsolationWidth" in win_cols:
                sub_rows = con.execute(
                    "SELECT WindowGroup, ScanNumBegin, ScanNumEnd, "
                    "       IsolationMz, IsolationWidth "
                    "FROM DiaFrameMsMsWindows ORDER BY WindowGroup, ScanNumBegin"
                ).fetchall()
                sub_windows: list[DiaWindow] = []
                for group, scan_begin, scan_end, iso_mz, iso_width in sub_rows:
                    sub_windows.append(DiaWindow(
                        window_group=group,
                        mz_lower=iso_mz - iso_width / 2.0,
                        mz_upper=iso_mz + iso_width / 2.0,
                        scan_num_begin=scan_begin,
                        scan_num_end=scan_end,
                    ))
            elif "IsolationWindowLowerMz" in win_cols and "IsolationWindowUpperMz" in win_cols:
                sub_rows = con.execute(
                    "SELECT WindowGroup, ScanNumBegin, ScanNumEnd, "
                    "       IsolationWindowLowerMz, IsolationWindowUpperMz "
                    "FROM DiaFrameMsMsWindows ORDER BY WindowGroup, ScanNumBegin"
                ).fetchall()
                sub_windows = []
                for group, scan_begin, scan_end, mz_lo, mz_hi in sub_rows:
                    sub_windows.append(DiaWindow(
                        window_group=group,
                        mz_lower=mz_lo,
                        mz_upper=mz_hi,
                        scan_num_begin=scan_begin,
                        scan_num_end=scan_end,
                    ))
            else:
                logger.warning("Unrecognised DiaFrameMsMsWindows schema in %s", d_path.name)
                return None

            if not sub_windows:
                return None

            # Build lookup by (window_group, scan_begin) so _apply can modify in place
            windows_by_group: dict[int, DiaWindow] = {}
            # For RT range query we need one entry per group — keep the first per group
            # but _apply_scan_to_mobility needs access to every sub-window
            sub_window_dict: dict[tuple[int, int], DiaWindow] = {
                (w.window_group, w.scan_num_begin): w for w in sub_windows
            }
            # Legacy: also build single-entry-per-group for backward compat with
            # _apply_scan_to_mobility which expects dict[int, DiaWindow]
            for w in sub_windows:
                if w.window_group not in windows_by_group:
                    windows_by_group[w.window_group] = w

            # Fetch RT range per window group from DiaFrameMsMsInfo × Frames
            if "DiaFrameMsMsInfo" in tables:
                try:
                    rt_rows = con.execute(
                        "SELECT dfi.WindowGroup, MIN(f.Time), MAX(f.Time) "
                        "FROM DiaFrameMsMsInfo dfi "
                        "JOIN Frames f ON dfi.Frame = f.Id "
                        "GROUP BY dfi.WindowGroup"
                    ).fetchall()
                    # Distribute RT range to ALL sub-windows in that group
                    rt_by_group: dict[int, tuple[float, float]] = {}
                    for group, rt_min, rt_max in rt_rows:
                        if rt_min is not None:
                            rt_by_group[group] = (float(rt_min), float(rt_max))
                    for w in sub_windows:
                        if w.window_group in rt_by_group:
                            w.rt_begin_sec, w.rt_end_sec = rt_by_group[w.window_group]
                except Exception:
                    logger.debug("Could not fetch RT ranges for window groups", exc_info=True)

            # Convert scan numbers to 1/K0 for ALL sub-windows
            _apply_scan_to_mobility_list(con, sub_windows)

            windows = sorted(sub_windows, key=lambda w: (w.window_group, w.scan_num_begin))

            # Compute summary ranges
            all_mz = [w.mz_lower for w in windows] + [w.mz_upper for w in windows]
            all_mob = [w.oneoverk0_lower for w in windows if w.oneoverk0_lower > 0]
            all_mob += [w.oneoverk0_upper for w in windows if w.oneoverk0_upper > 0]
            all_rt = [w.rt_begin_sec for w in windows if w.rt_begin_sec > 0]
            all_rt += [w.rt_end_sec for w in windows if w.rt_end_sec > 0]
            n_groups = len(set(w.window_group for w in windows))

            return WindowLayout(
                windows=windows,
                n_window_groups=n_groups,
                mz_range=(min(all_mz), max(all_mz)) if all_mz else (0, 0),
                mobility_range=(min(all_mob), max(all_mob)) if all_mob else (0, 0),
                run_name=d_path.stem,
                rt_range=(min(all_rt), max(all_rt)) if all_rt else (0, 0),
            )

    except sqlite3.Error:
        logger.exception("Failed to read DIA windows from %s", tdf)
        return None


def _get_max_scan(con: sqlite3.Connection) -> int:
    """Return the max scan number for 1/K₀ linear approximation."""
    max_scan = 920
    try:
        row = con.execute("SELECT MAX(NumScans) FROM Frames").fetchone()
        if row and row[0]:
            max_scan = int(row[0])
    except sqlite3.Error:
        pass
    return max_scan


def _apply_scan_to_mobility_list(
    con: sqlite3.Connection,
    windows: list[DiaWindow],
) -> None:
    """Convert scan numbers to 1/K₀ values for a list of DiaWindow objects.

    Uses linear approximation: 1/K₀ ≈ 1.6 - (scan / max_scan) × 1.0
    Higher scan number = lower 1/K₀ (ions with lower mobility exit TIMS later).
    """
    max_scan = _get_max_scan(con)
    for w in windows:
        if w.scan_num_begin > 0 or w.scan_num_end > 0:
            w.oneoverk0_upper = round(1.6 - (w.scan_num_begin / max_scan) * 1.0, 4)
            w.oneoverk0_lower = round(1.6 - (w.scan_num_end   / max_scan) * 1.0, 4)


def _apply_scan_to_mobility(
    con: sqlite3.Connection,
    windows: dict[int, DiaWindow],
) -> None:
    """Convert scan numbers to 1/K0 values for a dict of DiaWindow objects.

    Legacy interface used by compare_window_layouts. Prefer
    _apply_scan_to_mobility_list for new code.
    """
    max_scan = _get_max_scan(con)
    for w in windows.values():
        if w.scan_num_begin > 0 or w.scan_num_end > 0:
            w.oneoverk0_upper = round(1.6 - (w.scan_num_begin / max_scan) * 1.0, 4)
            w.oneoverk0_lower = round(1.6 - (w.scan_num_end   / max_scan) * 1.0, 4)


def compare_window_layouts(
    current: WindowLayout,
    reference: WindowLayout,
    mz_threshold: float = 1.0,       # Da — flag if window shifted by >1 Da
    mobility_threshold: float = 0.02,  # 1/K0 units — flag if shifted by >0.02
) -> DriftReport:
    """Compare two diaPASEF window layouts to detect drift.

    Args:
        current: Layout from the current QC run.
        reference: Layout from the reference run (first baseline or template).
        mz_threshold: Maximum allowed m/z shift before flagging (Da).
        mobility_threshold: Maximum allowed 1/K0 shift before flagging.

    Returns:
        DriftReport with drift analysis.
    """
    report = DriftReport(n_windows_total=current.n_window_groups)

    # Build lookup by window group
    ref_map = {w.window_group: w for w in reference.windows}
    cur_map = {w.window_group: w for w in current.windows}

    # Check window count mismatch
    if current.n_window_groups != reference.n_window_groups:
        report.is_drifted = True
        report.details.append(
            f"Window count changed: {reference.n_window_groups} -> {current.n_window_groups}"
        )

    max_mz = 0.0
    max_mob = 0.0
    shifted = 0

    for group in sorted(set(ref_map.keys()) & set(cur_map.keys())):
        ref_w = ref_map[group]
        cur_w = cur_map[group]

        # m/z drift
        mz_lo_shift = abs(cur_w.mz_lower - ref_w.mz_lower)
        mz_hi_shift = abs(cur_w.mz_upper - ref_w.mz_upper)
        mz_shift = max(mz_lo_shift, mz_hi_shift)

        # Mobility drift
        mob_lo_shift = abs(cur_w.oneoverk0_lower - ref_w.oneoverk0_lower)
        mob_hi_shift = abs(cur_w.oneoverk0_upper - ref_w.oneoverk0_upper)
        mob_shift = max(mob_lo_shift, mob_hi_shift)

        max_mz = max(max_mz, mz_shift)
        max_mob = max(max_mob, mob_shift)

        if mz_shift > mz_threshold or mob_shift > mobility_threshold:
            shifted += 1
            report.details.append(
                f"Window {group}: m/z shift {mz_shift:.1f} Da, "
                f"1/K0 shift {mob_shift:.3f}"
            )

    report.max_mz_shift = round(max_mz, 2)
    report.max_mobility_shift = round(max_mob, 4)
    report.n_windows_shifted = shifted
    report.is_drifted = shifted > 0 or report.is_drifted

    if report.is_drifted:
        logger.warning(
            "diaPASEF window drift detected in %s: %d/%d windows shifted "
            "(max m/z: %.1f Da, max 1/K0: %.3f)",
            current.run_name, shifted, report.n_windows_total,
            max_mz, max_mob,
        )
    else:
        logger.info(
            "diaPASEF windows stable in %s: %d windows, max m/z shift %.2f Da",
            current.run_name, report.n_windows_total, max_mz,
        )

    return report


def extract_pasef_windows(
    d_path: Path,
    max_events: int = 5000,
) -> list[PasefEvent] | None:
    """Extract ddaPASEF precursor isolation events from a Bruker .d directory.

    Each event is a single precursor selection box in RT × m/z × 1/K₀ space.

    Args:
        d_path: Path to the .d directory.
        max_events: Maximum number of events to return (sampled evenly by RT
                    when total exceeds this limit).

    Returns:
        List of PasefEvent objects, or None if not a ddaPASEF acquisition.
    """
    d_path = Path(d_path)
    tdf = d_path / "analysis.tdf"
    if not tdf.exists():
        return None

    try:
        with sqlite3.connect(str(tdf)) as con:
            tables = {
                r[0] for r in
                con.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            }

            if "PasefMsMsSpectra" not in tables:
                logger.debug("No PasefMsMsSpectra table — not ddaPASEF: %s", d_path.name)
                return None

            # Get max scan for mobility conversion
            max_scan = 920
            try:
                row = con.execute("SELECT MAX(NumScans) FROM Frames").fetchone()
                if row and row[0]:
                    max_scan = row[0]
            except sqlite3.Error:
                pass

            # Join PASEF events with Frames to get RT
            rows = con.execute(
                "SELECT p.Frame, f.Time, p.ScanNumBegin, p.ScanNumEnd, "
                "       p.IsolationMz, p.IsolationWidth, p.CollisionEnergy "
                "FROM PasefMsMsSpectra p "
                "JOIN Frames f ON p.Frame = f.Id "
                "ORDER BY f.Time"
            ).fetchall()

            if not rows:
                return None

            # Sample evenly if too many events
            if len(rows) > max_events:
                step = len(rows) / max_events
                rows = [rows[int(i * step)] for i in range(max_events)]

            events = []
            for frame, time_s, scan_begin, scan_end, iso_mz, iso_width, ce in rows:
                # Scan → 1/K₀ linear approximation
                k0_upper = 1.6 - (scan_begin / max_scan) * 1.0
                k0_lower = 1.6 - (scan_end   / max_scan) * 1.0
                events.append(PasefEvent(
                    frame=int(frame),
                    rt_sec=float(time_s),
                    scan_num_begin=int(scan_begin),
                    scan_num_end=int(scan_end),
                    isolation_mz=float(iso_mz),
                    isolation_width=float(iso_width),
                    collision_energy=float(ce) if ce else 0.0,
                    oneoverk0_lower=round(k0_lower, 4),
                    oneoverk0_upper=round(k0_upper, 4),
                ))

            return events

    except sqlite3.Error:
        logger.exception("Failed to read PASEF events from %s", tdf)
        return None
