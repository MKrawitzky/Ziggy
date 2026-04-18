"""Bruker TDF-SDK Python wrapper (timsdata v3.3.6.2).

Exposes TimsData and TsfData classes for reading Bruker .d directories.
The native DLLs (timsdata.dll / libtimsdata.so) must be present in the
libs/ subdirectory alongside this package, or available on the system PATH.

Key API:
    TimsData(analysis_directory)        — open a .d directory
    .scanNumToOneOverK0(frame_id, scans) — scan numbers → 1/K0 (Vs/cm²)
    .oneOverK0ToScanNum(frame_id, mobs) — inverse
    .oneOverK0ToCCSforMz(ook0, charge, mz) — 1/K0 → CCS (Å²)
    .indexToMz(frame_id, indices)       — TOF index → m/z
    .readScans(frame_id, begin, end)    — raw scan data

Reference: timsdata/tdf-schema.sql for the full TDF SQLite schema.
"""

import os
import sys
from pathlib import Path

# Point the timsdata module at the bundled DLLs before importing it.
_libs_dir = Path(__file__).parent / "libs"
if _libs_dir.exists():
    # Prepend to PATH so ctypes.cdll.LoadLibrary finds the bundled binary.
    os.environ["PATH"] = str(_libs_dir) + os.pathsep + os.environ.get("PATH", "")
    if sys.platform.startswith("linux"):
        _ld = os.environ.get("LD_LIBRARY_PATH", "")
        os.environ["LD_LIBRARY_PATH"] = str(_libs_dir) + (":" + _ld if _ld else "")

from stan.tools.timsdata.timsdata import TimsData, PressureCompensationStrategy  # noqa: E402
from stan.tools.timsdata.tsfdata import TsfData  # noqa: E402

__all__ = ["TimsData", "TsfData", "PressureCompensationStrategy"]
