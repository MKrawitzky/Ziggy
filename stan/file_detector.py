"""
Instrument vendor and file format detection for mass spectrometry raw data.

Supports detecting:
  Bruker       — .d/TDF (timsTOF PASEF), .d/TSF (timsTOF single-scan/MALDI),
                 .d/BAF (QTOF/impact/maXis/amazon), .d/YEP (legacy QTOF),
                 .baf standalone
  Thermo Fisher— .raw binary (Orbitrap, Fusion, Eclipse, Velos, Q Exactive…)
  Waters       — .raw directory (ACQUITY, Xevo, Synapt, SELECT SERIES)
  Agilent      — .d with AcqData/ (Q-TOF, 6xxx series)
  AB Sciex     — .wiff / .wiff2 (TripleTOF, ZenoTOF, QTRAP)
  Shimadzu     — .lcd (LCMS series)
  Open formats — .mzML, .mzXML, .mgf, .ms1/.ms2

Usage:
    from stan.file_detector import detect_format, format_label, format_badge_css

    info = detect_format("E:/data/run001.d")
    # {"vendor": "Bruker", "format": "Bruker timsTOF", "subformat": "TDF (PASEF)", ...}

    label = format_label(info)          # "Bruker timsTOF"
    color = format_badge_css(info)      # CSS color for UI badge
"""

from __future__ import annotations

import struct
from pathlib import Path

__all__ = ["detect_format", "format_label", "format_badge_css"]


# ── Internal helpers ─────────────────────────────────────────────────────────

def _r(vendor: str, format_name: str, subformat: str | None = None,
       instrument_family: str | None = None, confidence: str = "high") -> dict:
    return {
        "vendor": vendor,
        "format": format_name,
        "subformat": subformat,
        "instrument_family": instrument_family,
        "confidence": confidence,
    }

def _unknown(path: str) -> dict:
    ext = Path(path).suffix or "?"
    return _r("Unknown", f"Unknown ({ext})", confidence="low")


# ── Bruker .d directory ──────────────────────────────────────────────────────

def _detect_bruker_d(p: Path) -> dict:
    """Distinguish Bruker timsTOF/QTOF .d from Agilent .d."""
    has_tdf = (p / "analysis.tdf").exists()
    has_tsf = (p / "analysis.tsf").exists()
    has_baf = (p / "analysis.baf").exists()
    has_yep = (p / "analysis.yep").exists()
    has_acq = (p / "AcqData").is_dir()   # Agilent marker

    # Agilent: has AcqData/ but no Bruker analysis files
    if has_acq and not has_tdf and not has_baf and not has_tsf:
        return _r("Agilent", "Agilent .d",
                  instrument_family="QTOF / 6xxx series")

    # Bruker timsTOF — TDF (TIMS-based PASEF)
    if has_tdf:
        if has_tsf:
            return _r("Bruker", "Bruker timsTOF",
                      subformat="TSF/TDF (single-scan / MALDI)",
                      instrument_family="timsTOF")
        return _r("Bruker", "Bruker timsTOF",
                  subformat="TDF (PASEF)",
                  instrument_family="timsTOF")

    # Bruker QTOF / impact / maXis — BAF
    if has_baf:
        return _r("Bruker", "Bruker .d (BAF)",
                  subformat="BAF",
                  instrument_family="QTOF / impact / maXis / amazon")

    # Bruker legacy QTOF — YEP
    if has_yep:
        return _r("Bruker", "Bruker .d (YEP)",
                  subformat="YEP (legacy)",
                  instrument_family="QTOF (legacy)")

    # .d directory but nothing identifiable inside — could be Agilent without AcqData
    if has_acq:
        return _r("Agilent", "Agilent .d",
                  instrument_family="HPLC / QTOF",
                  confidence="medium")

    return _r("Unknown", "Unknown .d", confidence="low")


# ── Thermo vs Waters .raw ────────────────────────────────────────────────────

# Thermo RAW magic: first 2 bytes are 0x01 0xA1, then "Finnigan" at offset 8
_THERMO_MAGIC = b"\x01\xA1"

def _detect_thermo_raw(p: Path) -> dict:
    """Validate Thermo RAW magic header."""
    try:
        with p.open("rb") as fh:
            header = fh.read(18)
        if len(header) >= 2 and header[:2] == _THERMO_MAGIC:
            return _r("Thermo Fisher Scientific", "Thermo RAW",
                      instrument_family="Orbitrap / Fusion / Eclipse / Velos / Q Exactive")
        # File exists but magic doesn't match — lower confidence
        return _r("Thermo Fisher Scientific", "Thermo RAW",
                  instrument_family="Orbitrap / Fusion / Eclipse / Velos / Q Exactive",
                  confidence="medium")
    except OSError:
        return _r("Thermo Fisher Scientific", "Thermo RAW",
                  instrument_family="Orbitrap / Fusion / Eclipse / Velos / Q Exactive",
                  confidence="low")


_WATERS_MARKERS = (
    "_FUNC001.DAT", "_FUNC001.IDX",
    "_EXTERN.INF", "_INLET.INF",
    "_HEADER.TXT", "_CHRO.INF",
    "MSFUNCS.CMP",              # newer Waters
)

def _detect_waters_raw(p: Path) -> dict:
    """Waters .raw directories contain characteristic DAT/INF files."""
    for marker in _WATERS_MARKERS:
        if (p / marker).exists():
            return _r("Waters", "Waters .raw",
                      instrument_family="ACQUITY / Xevo / Synapt / SELECT SERIES")
    # .raw dir but no known markers — still probably Waters
    return _r("Waters", "Waters .raw",
              instrument_family="ACQUITY / Xevo / Synapt",
              confidence="medium")


# ── AB Sciex ─────────────────────────────────────────────────────────────────

def _detect_sciex(p: Path) -> dict:
    ext = p.suffix.lower()
    if ext == ".wiff2":
        return _r("AB Sciex", "AB Sciex WIFF2",
                  instrument_family="ZenoTOF 7600 / TripleTOF 7600+")
    return _r("AB Sciex", "AB Sciex WIFF",
              instrument_family="TripleTOF / QTRAP / Triple Quad")


# ── Public API ───────────────────────────────────────────────────────────────

def detect_format(path: str | Path) -> dict:
    """
    Detect vendor and file format of a mass spectrometry raw data path.

    Works with both files and directories.  Detection is based on:
    - Directory contents (analysis.tdf, analysis.baf, AcqData/, Waters markers)
    - File magic bytes (Thermo RAW header)
    - File extension as fallback

    Args:
        path: File or directory path (str or Path)

    Returns:
        dict with keys:
            vendor            — e.g. "Bruker", "Thermo Fisher Scientific"
            format            — e.g. "Bruker timsTOF", "Thermo RAW", "Waters .raw"
            subformat         — detail within format (e.g. "TDF (PASEF)") or None
            instrument_family — broad class (e.g. "timsTOF") or None
            confidence        — "high" | "medium" | "low" | "none"
            error             — only present if path not found
    """
    p = Path(path)

    if not p.exists():
        return {
            "vendor": None, "format": None, "subformat": None,
            "instrument_family": None, "confidence": "none",
            "error": "path_not_found",
        }

    ext = p.suffix.lower()

    # ── Directory-based formats ───────────────────────────────────────────────
    if p.is_dir():
        if ext == ".d":
            return _detect_bruker_d(p)
        if ext == ".raw":
            return _detect_waters_raw(p)
        # No extension but has analysis.tdf — treat as Bruker .d
        if (p / "analysis.tdf").exists() or (p / "analysis.baf").exists():
            return _detect_bruker_d(p)
        return _unknown(str(p))

    # ── File-based formats ────────────────────────────────────────────────────
    if ext == ".raw":
        # .raw as a file → Thermo
        return _detect_thermo_raw(p)

    if ext in (".wiff", ".wiff2"):
        return _detect_sciex(p)

    if ext == ".baf":
        return _r("Bruker", "Bruker BAF",
                  subformat="BAF (standalone)",
                  instrument_family="QTOF / impact / maXis")

    if ext == ".yep":
        return _r("Bruker", "Bruker YEP (legacy)",
                  subformat="YEP (standalone)",
                  instrument_family="QTOF (legacy)")

    if ext == ".lcd":
        return _r("Shimadzu", "Shimadzu LCD",
                  instrument_family="LCMS-8060 / LCMS-8045 / Nexera")

    if ext == ".mzml":
        return _r("Open Format", "mzML")

    if ext in (".mzxml", ".mzdata"):
        return _r("Open Format", ext.lstrip(".").upper())

    if ext == ".mgf":
        return _r("Open Format", "MGF (Mascot Generic Format)")

    if ext in (".ms1", ".ms2"):
        return _r("Open Format", f"MS{ext[3:]} (Crux/Sequest)")

    return _unknown(str(p))


def format_label(detection: dict) -> str:
    """Return a concise display label for the UI (≤ 20 chars)."""
    fmt = detection.get("format") or ""
    sf  = detection.get("subformat") or ""

    if fmt == "Bruker timsTOF":
        if "MALDI" in sf or "single" in sf:
            return "timsTOF (MALDI)"
        return "Bruker timsTOF"
    if fmt == "Bruker .d (BAF)":
        return "Bruker BAF"
    if fmt == "Bruker .d (YEP)":
        return "Bruker YEP"
    if fmt == "Bruker BAF":
        return "Bruker BAF"
    if fmt == "Thermo RAW":
        return "Thermo RAW"
    if fmt == "Waters .raw":
        return "Waters RAW"
    if fmt == "AB Sciex WIFF2":
        return "Sciex WIFF2"
    if fmt == "AB Sciex WIFF":
        return "Sciex WIFF"
    if fmt == "Agilent .d":
        return "Agilent .d"
    if fmt == "Shimadzu LCD":
        return "Shimadzu LCD"
    if fmt.startswith("mz") or fmt in ("MGF (Mascot Generic Format)",):
        return fmt.split()[0]
    return fmt or "Unknown"


def format_badge_css(detection: dict) -> str:
    """Return a CSS hex color for UI badge coloring by vendor."""
    vendor = (detection.get("vendor") or "").lower()
    if "bruker" in vendor:
        return "#22d3ee"    # cyan  — timsTOF brand
    if "thermo" in vendor:
        return "#f97316"    # orange — Thermo brand
    if "waters" in vendor:
        return "#a78bfa"    # violet — Waters
    if "agilent" in vendor:
        return "#34d399"    # green — Agilent
    if "sciex" in vendor or "ab sciex" in vendor:
        return "#fb7185"    # pink — Sciex
    if "shimadzu" in vendor:
        return "#fbbf24"    # amber — Shimadzu
    if "open" in vendor:
        return "#94a3b8"    # slate — open format
    return "#6b7280"        # gray — unknown
