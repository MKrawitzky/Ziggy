"""Extract real instrument model name from a Bruker .d acquisition folder.

Bruker timsTOF instruments embed the model name and serial number inside the
.m subfolder of every .d acquisition directory. The file
``microTOFQImpacTemAcquisition.method`` contains a ``<configuration>`` XML
element whose text is a space-separated token string that includes the model
identifier (e.g. ``timsTOF_Ultra``, ``timsTOF_Pro``, ``timsTOF_SCP``) and the
serial number (e.g. ``AQ00075094``).

Example configuration string::

    V0.0 2617 -1162349316 77262851 11 22 1813116 00090 timsTOF_Ultra 25087 7
    31 130951 415 AQ00075094 3943

Known model tokens (case-insensitive prefix match on ``timsTOF``):
    timsTOF_Ultra, timsTOF_Pro, timsTOF_SCP, timsTOF_flex, timsTOF_HT,
    timsTOF (plain — the original 2017 instrument)
"""

from __future__ import annotations

import re
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# Matches Bruker model identifiers embedded in the configuration string.
# The token always starts with "timsTOF" (case-insensitive) followed by
# optional underscore + variant name.
_MODEL_RE = re.compile(r"(timsTOF[\w.]*)", re.IGNORECASE)
_CONFIG_RE = re.compile(r"<configuration>(.*?)</configuration>", re.DOTALL)

# Serial numbers follow the pattern AQ + 8 digits (Bruker convention).
_SERIAL_RE = re.compile(r"\b(AQ\d{8})\b")


def read_instrument_name_from_d(d_path: str | Path) -> str | None:
    """Return the instrument model name encoded in a Bruker .d directory.

    Searches the ``.m`` subfolder for ``microTOFQImpacTemAcquisition.method``
    and extracts the model token from the ``<configuration>`` element.

    Args:
        d_path: Path to the ``.d`` acquisition directory.

    Returns:
        Model string with underscores replaced by spaces, e.g.
        ``"timsTOF Ultra"``, or ``None`` if the name cannot be determined.
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
                logger.debug("Cannot read method file: %s", method_file)
                continue

            cfg_match = _CONFIG_RE.search(text)
            if not cfg_match:
                continue

            model_match = _MODEL_RE.search(cfg_match.group(1))
            if model_match:
                return model_match.group(1).replace("_", " ")

    except OSError:
        logger.debug("Cannot iterate .d directory: %s", d_path)

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
