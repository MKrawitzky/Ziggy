"""Extract real instrument model name from a Bruker .d acquisition folder.

Bruker timsTOF instruments embed the model name in two places:

1. ``analysis.tdf`` SQLite → GlobalMetadata table (preferred, works for all models
   including timsTOF Ultra AIP and instruments that lack a .m subfolder).
   Tries keys: InstrumentName, InstrumentType, DeviceName, InstrumentModel,
   DeviceType, AcquisitionSoftware.

2. ``.m`` subfolder → ``microTOFQImpacTemAcquisition.method`` XML file
   (legacy fallback for older acquisitions).

3. Run directory name heuristic (last resort — extracts "timsTOF ..." tokens
   from the .d folder name itself, common when files are named by the operator).
"""

from __future__ import annotations

import re
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Matches any Bruker timsTOF model token — the name is always a single
# whitespace-delimited word in the configuration string, e.g.:
#   timsTOF_SCP, timsTOF_Ultra, timsTOF_Pro, timsTOF_flex, timsTOF_HT,
#   timsTOF_Ultra_AIP, timsTOF_SCP_2, timsTOF (plain original)
# \S* matches any non-whitespace after "timsTOF" so we never bleed into
# the numeric fields that follow in the config line.
_MODEL_RE = re.compile(r"(timsTOF\S*)", re.IGNORECASE)
_CONFIG_RE = re.compile(r"<configuration>(.*?)</configuration>", re.DOTALL)
_SERIAL_RE = re.compile(r"\b(AQ\d{8})\b")

# GlobalMetadata keys that may hold the instrument name, in priority order.
_TDF_INSTRUMENT_KEYS = (
    "InstrumentName",
    "InstrumentType",
    "DeviceName",
    "InstrumentModel",
    "DeviceType",
    "AcquisitionSoftware",   # sometimes contains "timsTOF" for newer firmware
    "SourceType",
)


def read_instrument_name_from_d(d_path: str | Path) -> str | None:
    """Return the instrument model name encoded in a Bruker .d directory.

    Resolution order:
    1. ``.m/microTOFQImpacTemAcquisition.method`` — the <configuration> line
       in the first 20 rows contains the hard-coded instrument token, e.g.:
       ``<configuration>V0.0 2617 ... timsTOF_SCP 25087 ...``
       This is the most direct source and works for all timsTOF models.
    2. Any other ``*.method`` file in the ``.m`` subfolder (same search).
    3. ``analysis.tdf`` GlobalMetadata — InstrumentName / InstrumentType keys,
       then a full-scan of all values for a timsTOF token.
    4. The .d folder name itself — heuristic (e.g. contains "timsTOF_Ultra").

    Args:
        d_path: Path to the ``.d`` acquisition directory.

    Returns:
        Model string with underscores → spaces, e.g. ``"timsTOF SCP"``,
        or ``None`` if the name cannot be determined.
    """
    import sqlite3

    d_path = Path(d_path)
    if not d_path.is_dir():
        return None

    def _extract_from_method_text(text: str) -> str | None:
        """Search up to 30 lines for a timsTOF token in or near <configuration>."""
        lines = text.splitlines()[:30]
        head  = "\n".join(lines)
        # Try inside <configuration>...</configuration> first
        cfg = _CONFIG_RE.search(head)
        if cfg:
            m = _MODEL_RE.search(cfg.group(1))
            if m:
                return m.group(1).strip().replace("_", " ")
        # Fall back: search raw lines for any timsTOF token
        m = _MODEL_RE.search(head)
        if m:
            return m.group(1).strip().replace("_", " ")
        # Last resort: search the full file text (handles configs split over many lines)
        m = _MODEL_RE.search(text)
        if m:
            return m.group(1).strip().replace("_", " ")
        return None

    # ── 1 & 2. .m subfolder method files ────────────────────────────────
    # microTOFQImpacTemAcquisition.method checked first (known to contain
    # the hard-wired instrument token in the first ~15 lines).
    try:
        for entry in d_path.iterdir():
            if not entry.is_dir() or entry.suffix.lower() != ".m":
                continue
            # Primary: the canonical Bruker acquisition method file
            primary = entry / "microTOFQImpacTemAcquisition.method"
            candidates = ([primary] if primary.is_file() else []) + [
                f for f in entry.iterdir()
                if f.is_file() and f.suffix.lower() == ".method" and f != primary
            ]
            for method_file in candidates:
                try:
                    text = method_file.read_text(encoding="iso-8859-1", errors="replace")
                except OSError:
                    logger.debug("Cannot read %s", method_file)
                    continue
                result = _extract_from_method_text(text)
                if result:
                    logger.debug("Instrument from method file %s: %s", method_file.name, result)
                    return result
    except OSError:
        logger.debug("Cannot iterate .d directory: %s", d_path)

    # ── 3. analysis.tdf GlobalMetadata ──────────────────────────────────
    tdf = d_path / "analysis.tdf"
    if tdf.exists():
        try:
            with sqlite3.connect(str(tdf)) as con:
                all_meta = dict(con.execute(
                    "SELECT Key, Value FROM GlobalMetadata"
                ).fetchall())

            # Keys that explicitly store the instrument name
            for key in ("InstrumentName", "InstrumentType") + _TDF_INSTRUMENT_KEYS:
                val = (all_meta.get(key) or "").strip()
                if not val or val.lower() in ("", "none", "unknown", "n/a"):
                    continue
                m = _MODEL_RE.search(val)
                if m:
                    return m.group(1).strip().replace("_", " ")
                # Return raw value for InstrumentName/InstrumentType even without
                # "timsTOF" — handles future instrument families
                if key in ("InstrumentName", "InstrumentType"):
                    return val.replace("_", " ")

            # Scan every metadata value for a timsTOF token
            for val in all_meta.values():
                if not val:
                    continue
                m = _MODEL_RE.search(str(val))
                if m:
                    return m.group(1).strip().replace("_", " ")

        except Exception:
            logger.debug("Cannot read GlobalMetadata from %s", tdf, exc_info=True)

    # ── 4. Folder name heuristic ─────────────────────────────────────────
    m = _MODEL_RE.search(d_path.name)
    if m:
        return m.group(1).strip().replace("_", " ")

    return None


def read_serial_from_d(d_path: str | Path) -> str | None:
    """Return the instrument serial number from a Bruker .d directory.

    Args:
        d_path: Path to the ``.d`` acquisition directory.

    Returns:
        Serial string (e.g. ``"AQ00075094"``) or ``None``.
    """
    d_path = Path(d_path)
    if not d_path.is_dir():
        return None

    try:
        for entry in d_path.iterdir():
            if not entry.is_dir() or entry.suffix != ".m":
                continue
            method_file = entry / "microTOFQImpacTemAcquisition.method"
            if not method_file.is_file():
                continue
            try:
                text = method_file.read_text(encoding="iso-8859-1", errors="replace")
            except OSError:
                continue

            cfg_match = _CONFIG_RE.search(text)
            if not cfg_match:
                continue

            serial_match = _SERIAL_RE.search(cfg_match.group(1))
            if serial_match:
                return serial_match.group(1)

    except OSError:
        pass

    return None
