"""Bruker baf2sql-c v2.9.0 Python wrapper.

Provides read access to Bruker BAF files (.d directories containing
analysis.baf) used by non-timsTOF Bruker QTOF instruments (maXis,
impact, compact, micrOTOF series).

BAF is a two-layer format:
  1. SQLite cache — metadata, spectrum headers, acquisition parameters
  2. Binary storage — raw m/z and intensity arrays (accessed by ID)

Usage:
    from stan.tools.baf2sql import BafData

    with BafData("path/to/file.d") as baf:
        # SQLite queries on the cache
        rows = baf.conn.execute("SELECT * FROM Spectra LIMIT 5").fetchall()
        # Read a binary array (e.g. profile m/z)
        mz = baf.storage.readArrayDouble(row["ProfileMzId"])

Key API:
    BafData(analysis_dir)         — open a .d directory (finds analysis.baf)
    .conn                         — sqlite3 connection to the SQLite cache
    .storage                      — BinaryStorage for reading spectral arrays
    BinaryStorage.readArrayDouble(id) — returns np.float64 array

Reference: schema.h for the full SQLite cache schema documentation.
"""

import os
import sys
from pathlib import Path

# Point the baf2sql module at the bundled DLLs before importing it.
_libs_dir = Path(__file__).parent / "libs"
if _libs_dir.exists():
    os.environ["PATH"] = str(_libs_dir) + os.pathsep + os.environ.get("PATH", "")
    if sys.platform.startswith("linux"):
        _ld = os.environ.get("LD_LIBRARY_PATH", "")
        os.environ["LD_LIBRARY_PATH"] = str(_libs_dir) + (":" + _ld if _ld else "")

import sqlite3
from ctypes import cdll, c_char_p, c_uint32, c_int, c_uint64, POINTER, c_double, create_string_buffer
import numpy as np

from stan.tools.baf2sql.baf2sql import BinaryStorage, getSQLiteCacheFilename, throwLastBaf2SqlError  # noqa: E402


class BafData:
    """High-level wrapper for a Bruker .d directory containing analysis.baf.

    Opens both the SQLite metadata cache and the binary array storage.
    Use as a context manager to ensure proper cleanup.

    Args:
        analysis_dir: Path to a .d directory (or directly to analysis.baf).
    """

    def __init__(self, analysis_dir: str | Path):
        analysis_dir = Path(analysis_dir)
        if analysis_dir.suffix.lower() == ".d":
            baf_path = analysis_dir / "analysis.baf"
        else:
            baf_path = analysis_dir

        if not baf_path.exists():
            raise FileNotFoundError(f"analysis.baf not found in {analysis_dir}")

        self._baf_path = str(baf_path)
        cache_path = getSQLiteCacheFilename(self._baf_path)
        self.conn = sqlite3.connect(cache_path)
        self.conn.row_factory = sqlite3.Row
        self.storage = BinaryStorage(self._baf_path)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def close(self):
        if hasattr(self, "conn") and self.conn:
            self.conn.close()
            self.conn = None

    def instrument_name(self) -> str | None:
        """Return instrument name from Properties table."""
        row = self.conn.execute(
            "SELECT Value FROM Properties WHERE Key = 'AcquisitionSoftware'"
        ).fetchone()
        return row[0] if row else None


__all__ = ["BafData", "BinaryStorage", "getSQLiteCacheFilename"]
