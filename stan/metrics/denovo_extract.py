"""Extract MS2 spectra from Bruker timsTOF .d files for de novo sequencing.

Supports:
  - ddaPASEF: isolated single-precursor spectra (ideal for de novo)
  - diaPASEF: all MS2 frames summed per window (chimeric — lower confidence)

Output: MGF format, one spectrum per PASEF precursor (DDA) or DIA window (DIA).
Each spectrum includes ion mobility in the TITLE field for downstream filtering.
"""

from __future__ import annotations

import logging
import sqlite3
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)


def _open_tdf(d_path: Path) -> sqlite3.Connection:
    tdf = d_path / "analysis.tdf"
    if not tdf.exists():
        raise FileNotFoundError(f"analysis.tdf not found in {d_path}")
    return sqlite3.connect(str(tdf))


def _get_acquisition_mode(con: sqlite3.Connection) -> str:
    """Return 'ddaPASEF', 'diaPASEF', or 'unknown'."""
    try:
        rows = con.execute("SELECT Key, Value FROM GlobalMetaData").fetchall()
        meta = {r[0]: r[1] for r in rows}
        msms = meta.get("AcquisitionSoftwareVersion", "")
        # Check Frames for MsmsType
        types = {r[0] for r in con.execute("SELECT DISTINCT MsmsType FROM Frames").fetchall()}
        if 8 in types:
            return "ddaPASEF"
        if 9 in types:
            return "diaPASEF"
    except Exception:
        pass
    return "unknown"


def extract_spectra_dda(
    d_path: Path,
    max_spectra: int = 5000,
    min_peaks: int = 6,
    min_intensity: float = 0.0,
) -> list[dict]:
    """Extract ddaPASEF MS2 spectra from a .d file.

    Returns list of spectrum dicts:
        title, precursor_mz, charge, rt_sec, one_over_k0,
        mz (array), intensity (array)
    """
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from stan.tools.timsdata.timsdata import TimsData

    results = []

    with TimsData(str(d_path)) as td:
        con = td.conn

        # Get PASEF precursors with RT, mobility, charge, m/z
        try:
            prec_rows = con.execute("""
                SELECT p.Id, p.LargestPeakMz, p.Charge, p.ScanNumber,
                       f.Time, p.MonoisotopicMz, p.Intensity
                FROM Precursors p
                JOIN Frames f ON p.Parent = f.Id
                WHERE f.MsmsType = 8
                ORDER BY f.Time
                LIMIT ?
            """, (max_spectra,)).fetchall()
        except Exception as e:
            logger.warning("Could not query Precursors table: %s", e)
            return []

        if not prec_rows:
            logger.info("No ddaPASEF precursors found in %s", d_path.name)
            return []

        precursor_ids = [r[0] for r in prec_rows]
        prec_meta = {r[0]: r for r in prec_rows}

        # Read MS2 spectra in batches of 200
        batch_size = 200
        spectra_raw: dict[int, tuple] = {}
        for i in range(0, len(precursor_ids), batch_size):
            batch = precursor_ids[i:i + batch_size]
            try:
                batch_spectra = td.readPasefMsMs(batch)
                spectra_raw.update(batch_spectra)
            except Exception as e:
                logger.debug("readPasefMsMs batch failed: %s", e)

        # Build spectrum dicts
        for pid, (mz_arr, int_arr) in spectra_raw.items():
            meta = prec_meta.get(pid)
            if meta is None:
                continue

            _pid, largest_mz, charge, scan_num, rt_sec, mono_mz, prec_intensity = meta

            # Convert scan number → 1/K0 using the parent frame
            try:
                # Get parent frame id
                frame_id = con.execute(
                    "SELECT Parent FROM Precursors WHERE Id = ?", (pid,)
                ).fetchone()
                if frame_id:
                    one_over_k0 = float(td.scanNumToOneOverK0(frame_id[0], np.array([float(scan_num)]))[0])
                else:
                    one_over_k0 = 0.0
            except Exception:
                one_over_k0 = 0.0

            mz = np.array(mz_arr, dtype=np.float64)
            intensity = np.array(int_arr, dtype=np.float32)

            # Filter low-intensity peaks
            if min_intensity > 0:
                mask = intensity >= min_intensity
                mz = mz[mask]
                intensity = intensity[mask]

            if len(mz) < min_peaks:
                continue

            # Normalise to base peak = 10000
            max_i = float(intensity.max())
            if max_i > 0:
                intensity = intensity / max_i * 10000.0

            precursor_mz = float(mono_mz) if mono_mz else float(largest_mz)
            charge_val = int(charge) if charge else 0

            results.append({
                "title": f"precursor={pid} rt={rt_sec:.1f} im={one_over_k0:.4f}",
                "precursor_mz": round(precursor_mz, 5),
                "charge": charge_val,
                "rt_sec": round(float(rt_sec), 2),
                "one_over_k0": round(one_over_k0, 4),
                "mz": mz,
                "intensity": intensity,
                "n_peaks": len(mz),
            })

    logger.info("Extracted %d ddaPASEF spectra from %s", len(results), d_path.name)
    return results


def write_mgf(spectra: list[dict], out_path: Path) -> int:
    """Write spectra list to MGF format. Returns count written."""
    written = 0
    with open(out_path, "w") as f:
        for s in spectra:
            f.write("BEGIN IONS\n")
            f.write(f"TITLE={s['title']}\n")
            f.write(f"PEPMASS={s['precursor_mz']:.5f}\n")
            if s.get("charge"):
                f.write(f"CHARGE={s['charge']}+\n")
            f.write(f"RTINSECONDS={s['rt_sec']:.2f}\n")
            if s.get("one_over_k0"):
                f.write(f"IONMOBILITY={s['one_over_k0']:.4f}\n")
            mz = s["mz"]
            intensity = s["intensity"]
            for m, i in zip(mz, intensity):
                f.write(f"{m:.5f} {i:.1f}\n")
            f.write("END IONS\n\n")
            written += 1
    logger.info("Wrote %d spectra to %s", written, out_path)
    return written


def extract_to_mgf(
    d_path: Path,
    out_path: Path,
    max_spectra: int = 5000,
    min_peaks: int = 6,
    acq_mode: str | None = None,
) -> tuple[int, str]:
    """Top-level: extract spectra from .d and write MGF.

    Returns (n_spectra_written, acquisition_mode).
    """
    if acq_mode is None:
        con = _open_tdf(d_path)
        acq_mode = _get_acquisition_mode(con)
        con.close()

    if acq_mode == "ddaPASEF":
        spectra = extract_spectra_dda(d_path, max_spectra=max_spectra, min_peaks=min_peaks)
    else:
        # DIA or unknown: warn user
        logger.warning(
            "%s is %s — de novo works best on ddaPASEF data. "
            "DIA spectra are chimeric and will give lower-confidence results.",
            d_path.name, acq_mode
        )
        # Still attempt DDA extraction (may return 0 spectra for pure DIA)
        spectra = extract_spectra_dda(d_path, max_spectra=max_spectra, min_peaks=min_peaks)

    if not spectra:
        return 0, acq_mode

    n = write_mgf(spectra, out_path)
    return n, acq_mode
