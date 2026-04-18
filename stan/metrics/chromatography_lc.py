"""LC system trace reader for Bruker timsTOF .d directories.

Every .d folder recorded with HyStar + nanoElute contains
chromatography-data.sqlite with pump pressure, gradient, flow,
column temperature, and MS-derived TIC/BPC chromatograms.

Blob encoding (confirmed from real files):
  Times       — array of float64 (8 bytes each)
  Intensities — array of float32 (4 bytes each), same length as Times
"""

from __future__ import annotations

import logging
import sqlite3
import struct
from pathlib import Path

logger = logging.getLogger(__name__)

# TraceSources description substrings → display names shown in dashboard.
# Order determines rendering order in the UI.
_TRACE_MAP: list[tuple[str, str, str]] = [
    ("Pump A Pressure",      "Pump Pressure A",   "bar"),
    ("Pump B Pressure",      "Pump Pressure B",   "bar"),
    ("Solvent B Composition","Gradient B",        "%"),
    ("Flowsensor A Flow",    "Flow Rate A",       "µL/min"),
    ("Flowsensor B Flow",    "Flow Rate B",       "µL/min"),
    ("Column Temperature",   "Column Temp",       "°C"),
    ("TIC,±MS",              "TIC MS1",           "counts"),
    ("TIC,±AllMS",           "TIC MS/MS",         "counts"),
    ("BPC",                  "BPC",               "counts"),
]

# Maximum points per trace sent to the dashboard (downsampled if exceeded)
_MAX_PTS = 2000


def _decode_chunk(times_blob: bytes, ints_blob: bytes) -> tuple[list[float], list[float]]:
    """Decode one TraceChunk blob pair into (times_seconds, values)."""
    n = len(times_blob) // 8
    if n == 0 or len(ints_blob) < n * 4:
        return [], []
    times = list(struct.unpack_from(f"{n}d", times_blob))
    values = list(struct.unpack_from(f"{n}f", ints_blob))
    return times, values


def get_lc_traces(d_path: str | Path) -> dict:
    """Extract LC system traces from chromatography-data.sqlite.

    Args:
        d_path: Path to the Bruker .d acquisition directory.

    Returns:
        Dict keyed by display name, each entry::

            {
                "times":  [float, ...],   # seconds from run start
                "values": [float, ...],   # in reported unit
                "unit":   str,            # e.g. "bar", "%", "°C"
                "description": str,       # original TraceSources.Description
            }

        Returns empty dict if chromatography-data.sqlite is absent.
    """
    d_path = Path(d_path)
    chrom = d_path / "chromatography-data.sqlite"
    if not chrom.exists():
        return {}

    try:
        with sqlite3.connect(str(chrom)) as con:
            sources = con.execute(
                "SELECT Id, Description FROM TraceSources"
            ).fetchall()

            result: dict = {}
            for src_id, description in sources:
                # Match against our priority list
                display_name = unit = None
                for substr, dname, u in _TRACE_MAP:
                    if substr in description:
                        display_name = dname
                        unit = u
                        break
                if display_name is None:
                    continue

                chunks = con.execute(
                    "SELECT Times, Intensities FROM TraceChunks "
                    "WHERE Trace = ? ORDER BY rowid",
                    (src_id,),
                ).fetchall()

                all_t: list[float] = []
                all_v: list[float] = []
                for times_blob, ints_blob in chunks:
                    if times_blob and ints_blob:
                        ts, vs = _decode_chunk(times_blob, ints_blob)
                        all_t.extend(ts)
                        all_v.extend(vs)

                if not all_t:
                    continue

                # Downsample for dashboard efficiency
                n = len(all_t)
                if n > _MAX_PTS:
                    step = max(1, n // _MAX_PTS)
                    all_t = all_t[::step]
                    all_v = all_v[::step]

                result[display_name] = {
                    "times":       [round(t, 2) for t in all_t],
                    "values":      [round(v, 4) for v in all_v],
                    "unit":        unit,
                    "description": description,
                }

        return result

    except Exception:
        logger.exception("Failed to read chromatography-data.sqlite in %s", d_path)
        return {}
