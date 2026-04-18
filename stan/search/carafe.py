"""Carafe2 integration — experiment-specific spectral library generation.

After each DIA-NN search completes, STAN can automatically invoke Carafe2
to train a custom RT/intensity/ion-mobility model on that run's data and
write a DIA-NN-compatible TSV library.  The library is stored per-instrument
and automatically injected into the next DIA-NN search as ``--lib``.

Opt-in per instrument in instruments.yml::

    instruments:
      - name: "timsTOF HT"
        vendor: bruker
        carafe_enabled: true
        carafe_fasta: /path/to/proteome.fasta   # required
        carafe_java: java                         # optional, default "java"

The generated library is stored at::

    ~/.stan/libraries/<instrument_slug>/carafe_latest.tsv

and the path is written back to ``carafe_library`` on the run's DB row.
"""

from __future__ import annotations

import logging
import re
import subprocess
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

_CARAFE_VERSION = "2.0.0"
_CARAFE_DOWNLOAD_URL = (
    "https://github.com/Noble-Lab/Carafe/releases/download/"
    f"v{_CARAFE_VERSION}/carafe-{_CARAFE_VERSION}.zip"
)


# ── JAR discovery ─────────────────────────────────────────────────────

def _tools_dir() -> Path:
    from stan.config import get_user_config_dir
    return get_user_config_dir() / "tools" / "carafe"


def find_carafe_jar() -> Path | None:
    """Return the path to the Carafe JAR if installed, else None."""
    base = _tools_dir()
    for pattern in ["carafe-*.jar", "*/carafe-*.jar", "carafe*/carafe-*.jar"]:
        matches = list(base.glob(pattern))
        if matches:
            return matches[0]
    return None


def is_installed() -> bool:
    return find_carafe_jar() is not None


# ── Per-instrument library storage ────────────────────────────────────

def _library_dir(instrument_name: str) -> Path:
    from stan.config import get_user_config_dir
    slug = re.sub(r"[^a-zA-Z0-9_-]", "_", instrument_name)
    lib_dir = get_user_config_dir() / "libraries" / slug
    lib_dir.mkdir(parents=True, exist_ok=True)
    return lib_dir


def get_latest_library(instrument_name: str) -> Path | None:
    """Return the most recently built Carafe library for an instrument, or None."""
    lib = _library_dir(instrument_name) / "carafe_latest.tsv"
    return lib if lib.exists() else None


def _set_latest_library(instrument_name: str, library_path: Path) -> None:
    """Symlink/copy the new library to carafe_latest.tsv."""
    latest = _library_dir(instrument_name) / "carafe_latest.tsv"
    # Keep a versioned copy alongside
    try:
        import shutil
        shutil.copy2(library_path, latest)
        logger.info("Carafe library updated: %s", latest)
    except Exception:
        logger.exception("Failed to update Carafe latest library symlink")


# ── Running Carafe ────────────────────────────────────────────────────

def _infer_report_path(raw_path: Path, output_dir: Path | None = None) -> Path | None:
    """Find the DIA-NN report.parquet alongside the raw file or in output_dir."""
    candidates: list[Path] = []
    if output_dir:
        candidates += [
            output_dir / "report.parquet",
            output_dir / "report.tsv",
        ]
    candidates += [
        raw_path.parent / "report.parquet",
        raw_path.parent / "report.tsv",
        raw_path.parent / (raw_path.stem + ".parquet"),
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


def run_carafe(
    raw_path: Path,
    fasta_path: str,
    instrument_name: str,
    report_path: Path | None = None,
    output_dir: Path | None = None,
    java_exe: str = "java",
    run_id: str | None = None,
) -> Path | None:
    """Run Carafe2 synchronously and return the library path on success.

    Args:
        raw_path:        Path to the .d or .raw file.
        fasta_path:      Path to the protein FASTA database.
        instrument_name: Used to name the output library.
        report_path:     DIA-NN report.parquet (auto-inferred if None).
        output_dir:      Where to write the library (default: next to .d).
        java_exe:        Java executable (default "java").
        run_id:          STAN run ID to update with the library path.

    Returns:
        Path to the generated TSV library, or None on failure.
    """
    jar = find_carafe_jar()
    if not jar:
        logger.warning("Carafe JAR not found — skipping library build. Run: stan carafe --install")
        return None

    if not report_path:
        report_path = _infer_report_path(raw_path, output_dir)

    out_dir = output_dir or (raw_path.parent / f"carafe_{raw_path.stem}")
    out_dir.mkdir(parents=True, exist_ok=True)
    out_lib = out_dir / f"{raw_path.stem}_carafe.tsv"

    cmd = [
        java_exe, "-jar", str(jar),
        "--input-raw", str(raw_path),
        "--organism-database", str(fasta_path),
        "--output-lib", str(out_lib),
    ]
    if report_path and report_path.exists():
        cmd += ["--diann-results", str(report_path)]
        logger.info("Carafe: using DIA-NN report %s", report_path.name)
    else:
        logger.info("Carafe: no DIA-NN report found — running de-novo mode")

    logger.info("Carafe: starting library build for %s", raw_path.name)
    logger.debug("Carafe command: %s", " ".join(cmd))

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(out_dir))
        if result.returncode != 0:
            logger.error(
                "Carafe failed (exit %d):\n%s",
                result.returncode,
                (result.stderr or result.stdout)[-2000:],
            )
            return None

        if not out_lib.exists():
            logger.error("Carafe completed but output library not found: %s", out_lib)
            return None

        logger.info("Carafe: library written to %s", out_lib)

        # Store as the latest library for this instrument
        _set_latest_library(instrument_name, out_lib)

        # Update the DB row with the library path
        if run_id:
            _update_db_library(run_id, str(out_lib))

        return out_lib

    except FileNotFoundError:
        logger.error("Java not found at '%s'. Install Java 21+ and add to PATH.", java_exe)
        return None
    except Exception:
        logger.exception("Carafe run failed unexpectedly")
        return None


def run_carafe_async(
    raw_path: Path,
    fasta_path: str,
    instrument_name: str,
    report_path: Path | None = None,
    output_dir: Path | None = None,
    java_exe: str = "java",
    run_id: str | None = None,
) -> None:
    """Launch Carafe in a background daemon thread (non-blocking).

    Called from the watcher after metrics are stored so the watcher loop
    is not blocked by a multi-minute Carafe training run.
    """
    def _worker():
        run_carafe(
            raw_path=raw_path,
            fasta_path=fasta_path,
            instrument_name=instrument_name,
            report_path=report_path,
            output_dir=output_dir,
            java_exe=java_exe,
            run_id=run_id,
        )

    t = threading.Thread(target=_worker, daemon=True, name=f"carafe-{raw_path.stem}")
    t.start()
    logger.info("Carafe: library build started in background (thread: %s)", t.name)


def _update_db_library(run_id: str, library_path: str) -> None:
    """Write the Carafe library path back to the runs table."""
    try:
        import sqlite3
        from stan.db import get_db_path
        db_path = get_db_path()
        with sqlite3.connect(str(db_path)) as con:
            con.execute(
                "UPDATE runs SET carafe_library = ? WHERE id = ?",
                (library_path, run_id),
            )
    except Exception:
        logger.exception("Failed to update carafe_library in DB for run %s", run_id)
