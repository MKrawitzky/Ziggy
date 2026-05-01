"""Multi-engine search comparison — runs MSFragger and X!Tandem alongside DIA-NN and Sage.

After the primary search (DIA-NN for DIA, Sage for DDA) completes, STAN
dispatches additional engines as background daemon threads. Results are
written to the search_comparisons table in SQLite and appear in the
Searches tab as cells fill in.

Engines
-------
msfragger_dda  MSFragger 3.7 in DDA mode (data_type=0) — native .d support
msfragger_dia  MSFragger 3.7 in DIA mode (data_type=1) — for diaPASEF
xtandem        X!Tandem — DDA search; .d files auto-converted via timsconvert

FragPipe is auto-detected from common install locations. If not found,
MSFragger comparison searches are silently skipped.

X!Tandem is auto-detected from common install locations and PATH.  Bruker .d
files are converted to indexed mzML via timsconvert (pip install timsconvert)
before being passed to X!Tandem. If neither X!Tandem nor timsconvert is found,
the X!Tandem comparison is silently skipped.
"""

from __future__ import annotations

import csv
import logging
import os
import re
import shutil
import subprocess
import threading
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# ── Workflow presets ──────────────────────────────────────────────────────────
# Each preset defines enzyme, specificity, mods, length ranges and charge range.
# Workflows detected from run name (see server._detect_preset) override the
# hardcoded defaults inside every comparison engine param writer.
#
# Keys:
#   specificity  "specific" | "semi" | "non-specific"
#   enzyme       human-readable enzyme name (Trypsin/P, LysC, non-specific …)
#   missed_cleavages
#   fixed_mods   list of display-name strings  e.g. ["Carbamidomethyl (C)"]
#   var_mods     list of display-name strings  e.g. ["Oxidation (M)"]
#   min_len / max_len   peptide length range
#   min_charge / max_charge

_WORKFLOW_PRESETS: dict[str, dict] = {
    "hela_digest": {
        "specificity": "specific",
        "enzyme": "Trypsin/P",
        "missed_cleavages": 2,
        "fixed_mods": ["Carbamidomethyl (C)"],
        "var_mods": ["Oxidation (M)", "Acetyl (Protein N-term)"],
        "min_len": 7, "max_len": 30,
        "min_charge": 2, "max_charge": 4,
    },
    "phospho": {
        "specificity": "specific",
        "enzyme": "Trypsin/P",
        "missed_cleavages": 2,
        "fixed_mods": ["Carbamidomethyl (C)"],
        "var_mods": ["Oxidation (M)", "Phospho (STY)"],
        "min_len": 7, "max_len": 30,
        "min_charge": 2, "max_charge": 4,
    },
    "mhc_class_i_dda": {
        "specificity": "non-specific",
        "enzyme": "non-specific",
        "missed_cleavages": 0,
        "fixed_mods": [],
        "var_mods": ["Oxidation (M)"],
        "min_len": 8, "max_len": 12,
        "min_charge": 1, "max_charge": 3,
    },
    "mhc_class_i_dia": {
        "specificity": "non-specific",
        "enzyme": "non-specific",
        "missed_cleavages": 0,
        "fixed_mods": [],
        "var_mods": ["Oxidation (M)"],
        "min_len": 8, "max_len": 12,
        "min_charge": 1, "max_charge": 3,
    },
    "mhc_class_ii_dda": {
        "specificity": "semi",
        "enzyme": "Trypsin/P",
        "missed_cleavages": 2,
        "fixed_mods": [],
        "var_mods": ["Oxidation (M)", "Deamidation (NQ)"],
        "min_len": 13, "max_len": 25,
        "min_charge": 2, "max_charge": 4,
    },
    "mhc_class_ii_dia": {
        "specificity": "semi",
        "enzyme": "Trypsin/P",
        "missed_cleavages": 2,
        "fixed_mods": [],
        "var_mods": ["Oxidation (M)", "Deamidation (NQ)"],
        "min_len": 13, "max_len": 25,
        "min_charge": 2, "max_charge": 4,
    },
    "tmt": {
        "specificity": "specific",
        "enzyme": "Trypsin/P",
        "missed_cleavages": 2,
        "fixed_mods": ["Carbamidomethyl (C)", "TMT6plex (K)", "TMT6plex (N-term)"],
        "var_mods": ["Oxidation (M)"],
        "min_len": 7, "max_len": 30,
        "min_charge": 2, "max_charge": 4,
    },
    "single_cell": {
        "specificity": "specific",
        "enzyme": "Trypsin/P",
        "missed_cleavages": 1,
        "fixed_mods": ["Carbamidomethyl (C)"],
        "var_mods": ["Oxidation (M)"],
        "min_len": 6, "max_len": 30,
        "min_charge": 2, "max_charge": 4,
    },
}

_DEFAULT_WORKFLOW = "hela_digest"


def _resolve_search_config(
    workflow: str | None = None,
    override: dict | None = None,
) -> dict:
    """Return a merged search config dict.

    Priority: override > named preset > default (hela_digest).
    """
    base = dict(_WORKFLOW_PRESETS.get(workflow or _DEFAULT_WORKFLOW,
                                      _WORKFLOW_PRESETS[_DEFAULT_WORKFLOW]))
    if override:
        base.update(override)
    return base


# ── Mod mass tables for per-engine translation ────────────────────────────────

# MSFragger variable_mod format: "mass residues max_occ"
# Uses slot keys variable_mod_01 … variable_mod_07
_MSF_VAR_MOD_MAP: dict[str, str] = {
    "Oxidation (M)":            "15.994915 M 3",
    "Acetyl (Protein N-term)":  "42.010565 [^ 1",
    "Phospho (STY)":            "79.966331 STY 3",
    "Phospho (S)":              "79.966331 S 3",
    "Phospho (T)":              "79.966331 T 3",
    "Phospho (Y)":              "79.966331 Y 3",
    "Deamidation (NQ)":         "0.984016 NQ 3",
    "Deamidation (N)":          "0.984016 N 3",
    "Deamidation (Q)":          "0.984016 Q 3",
}

# MSFragger fixed mods → add_<RESIDUE> field + value
_MSF_FIXED_MOD_MAP: dict[str, tuple[str, float]] = {
    "Carbamidomethyl (C)":  ("add_C_cysteine",    57.021464),
    "TMT6plex (K)":         ("add_K_lysine",      229.162932),
    "TMT6plex (N-term)":    ("add_Nterm_peptide", 229.162932),
}

# X!Tandem fixed mods → "mass@residue" notation (residue, mod mass)
_XT_FIXED_MOD_MAP: dict[str, str] = {
    "Carbamidomethyl (C)": "57.021464@C",
    "TMT6plex (K)":        "229.162932@K",
    "TMT6plex (N-term)":   "229.162932@[",
}

# X!Tandem potential (variable) mods → "mass@residue" notation
_XT_VAR_MOD_MAP: dict[str, str] = {
    "Oxidation (M)":           "15.994915@M",
    "Acetyl (Protein N-term)": "42.010565@[",
    "Phospho (STY)":           "79.966331@S,79.966331@T,79.966331@Y",
    "Phospho (S)":             "79.966331@S",
    "Phospho (T)":             "79.966331@T",
    "Phospho (Y)":             "79.966331@Y",
    "Deamidation (NQ)":        "0.984016@N,0.984016@Q",
    "Deamidation (N)":         "0.984016@N",
    "Deamidation (Q)":         "0.984016@Q",
}

# MaxQuant display names (passed directly into mqpar.xml)
_MQ_FIXED_MODS: dict[str, str] = {
    "Carbamidomethyl (C)": "Carbamidomethyl (C)",
    "TMT6plex (K)":        "TMT6plex (K)",
    "TMT6plex (N-term)":   "TMT6plex (N-term)",
}
_MQ_VAR_MODS: dict[str, str] = {
    "Oxidation (M)":            "Oxidation (M)",
    "Acetyl (Protein N-term)":  "Acetyl (Protein N-term)",
    "Phospho (STY)":            "Phospho (STY)",
    "Phospho (S)":              "Phospho (STY)",
    "Phospho (T)":              "Phospho (STY)",
    "Phospho (Y)":              "Phospho (STY)",
    "Deamidation (NQ)":         "Deamidation (NQ)",
    "Deamidation (N)":          "Deamidation (N)",
    "Deamidation (Q)":          "Deamidation (Q)",
}

# Comet enzyme number lookup (0 = no enzyme / non-specific, 1 = trypsin)
_COMET_ENZYME_MAP: dict[str, int] = {
    "Trypsin":     1,
    "Trypsin/P":   1,
    "LysC":        5,
    "LysC/P":      5,
    "GluC":        8,
    "AspN":        9,
    "non-specific": 0,
}

# Comet variable mod format: "mass residues binary max_occ distance_from_terminus
#   which_terminus binarymod required_mod"  (simplified 8-field version)
_COMET_VAR_MOD_MAP: dict[str, str] = {
    "Oxidation (M)":            "15.994915 M 0 3 -1 0 0 0.0",
    "Acetyl (Protein N-term)":  "42.010565 n 0 1 -1 0 0 0.0",
    "Phospho (STY)":            "79.966331 STY 0 3 -1 0 0 0.0",
    "Phospho (S)":              "79.966331 S 0 3 -1 0 0 0.0",
    "Phospho (T)":              "79.966331 T 0 3 -1 0 0 0.0",
    "Phospho (Y)":              "79.966331 Y 0 3 -1 0 0 0.0",
    "Deamidation (NQ)":         "0.984016 NQ 0 3 -1 0 0 0.0",
    "Deamidation (N)":          "0.984016 N 0 3 -1 0 0 0.0",
    "Deamidation (Q)":          "0.984016 Q 0 3 -1 0 0 0.0",
}

# ── FragPipe auto-detection ──────────────────────────────────────────────────

_FRAGPIPE_SEARCH_PATHS: list[Path] = [
    Path.home() / "Desktop/Fragpipe/fragpipe",
    Path.home() / "Desktop/FragPipe/fragpipe",
    Path.home() / "FragPipe/fragpipe",
    Path("C:/FragPipe/fragpipe"),
    Path("D:/FragPipe/fragpipe"),
    Path("E:/FragPipe/fragpipe"),
]


def _find_fragpipe() -> Path | None:
    """Return the FragPipe base directory, or None if not installed."""
    for candidate in _FRAGPIPE_SEARCH_PATHS:
        if (candidate / "MSFragger").exists() and (candidate / "jre").exists():
            return candidate
    return None


def _fragpipe_paths(fragpipe_dir: Path) -> dict[str, Path | None]:
    """Resolve paths to all tools inside a FragPipe installation."""
    # Newest MSFragger jar wins (sorted lexicographically)
    jars = sorted((fragpipe_dir / "MSFragger").glob("*/MSFragger-*.jar"))
    msfragger_jar: Path | None = jars[-1] if jars else None
    bruker_lib: Path | None = msfragger_jar.parent / "ext/bruker" if msfragger_jar else None

    # FragPipe FASTA — already has rev_ decoys and pre-built pepindex
    bundled_fasta = fragpipe_dir / "FASTA/2023-05-26-decoys-reviewed-isoforms-contam-UP000005640.fas"

    return {
        "java":          fragpipe_dir / "jre/bin/java.exe",
        "msfragger_jar": msfragger_jar,
        "bruker_lib":    bruker_lib,
        "percolator":    fragpipe_dir / "tools/percolator-305/percolator.exe",
        "philosopher":   fragpipe_dir / "Philosopher/philosopher.exe",
        "bundled_fasta": bundled_fasta if bundled_fasta.exists() else None,
    }


# ── Comet auto-detection ────────────────────────────────────────────────────

_COMET_SEARCH_PATHS: list[Path] = [
    Path.home() / "Desktop/Comet/comet.exe",
    Path.home() / "Comet/comet.exe",
    Path("C:/Comet/comet.exe"),
    Path("C:/tools/Comet/comet.exe"),
    Path("D:/Comet/comet.exe"),
    Path("E:/Comet/comet.exe"),
    Path("E:/tools/comet/comet.exe"),
]


def _find_comet() -> Path | None:
    """Return path to comet.exe, or None if not installed."""
    for candidate in _COMET_SEARCH_PATHS:
        if candidate.exists():
            return candidate
    which = shutil.which("comet") or shutil.which("comet.exe")
    if which:
        return Path(which)
    return None


# ── X!Tandem auto-detection ─────────────────────────────────────────────────

_XTANDEM_SEARCH_PATHS: list[Path] = [
    Path.home() / "Desktop/XTandem/tandem.exe",
    Path.home() / "Desktop/xtandem/tandem.exe",
    Path.home() / "XTandem/tandem.exe",
    Path("C:/XTandem/tandem.exe"),
    Path("C:/Program Files/XTandem/tandem.exe"),
    Path("C:/Program Files (x86)/XTandem/tandem.exe"),
    Path("D:/XTandem/tandem.exe"),
    Path("E:/XTandem/tandem.exe"),
    # PAPPSO X!TandemPipeline bundles the tandem binary too
    Path.home() / "Desktop/XTandemPipeline/tandem.exe",
    Path("C:/XTandemPipeline/tandem.exe"),
]


def _find_xtandem() -> Path | None:
    """Return path to tandem.exe, or None if X!Tandem is not installed."""
    for candidate in _XTANDEM_SEARCH_PATHS:
        if candidate.exists():
            return candidate
    # Fall back to PATH
    which = shutil.which("tandem") or shutil.which("tandem.exe")
    if which:
        return Path(which)
    return None


def _has_timsconvert() -> bool:
    """Return True if timsconvert CLI is available on PATH."""
    return shutil.which("timsconvert") is not None


# ── Sage auto-detection ──────────────────────────────────────────────────────

_SAGE_SEARCH_PATHS: list[Path] = [
    Path.home() / "Desktop/sage/sage.exe",
    Path.home() / "sage/sage.exe",
    Path("C:/sage/sage.exe"),
    Path("C:/tools/sage/sage.exe"),
    Path("D:/sage/sage.exe"),
    Path("E:/sage/sage.exe"),
    Path("E:/tools/sage/sage.exe"),
    # Linux/macOS style (for cross-platform dev)
    Path.home() / "sage/sage",
    Path("/usr/local/bin/sage"),
]


def _find_sage_exe(hint: str | None = None) -> Path | None:
    """Return path to sage executable, or None if not found."""
    if hint and Path(hint).exists():
        return Path(hint)
    for candidate in _SAGE_SEARCH_PATHS:
        if candidate.exists():
            return candidate
    which = shutil.which("sage") or shutil.which("sage.exe")
    if which:
        return Path(which)
    return None


# ── DIA-NN auto-detection ────────────────────────────────────────────────────

_DIANN_SEARCH_PATHS: list[Path] = [
    Path("E:/DIANN/DiaNN.exe"),
    Path("E:/DIANN/diann-linux"),
    Path("C:/DIA-NN/DiaNN.exe"),
    Path("C:/Program Files/DIA-NN/DiaNN.exe"),
    Path("D:/DIANN/DiaNN.exe"),
    Path("D:/DIA-NN/DiaNN.exe"),
    Path.home() / "DIA-NN/DiaNN.exe",
    Path.home() / "Desktop/DIA-NN/DiaNN.exe",
]


def _find_diann_exe(hint: str | None = None) -> Path | None:
    """Return path to DiaNN.exe, or None if not found."""
    if hint and Path(hint).exists():
        return Path(hint)
    for candidate in _DIANN_SEARCH_PATHS:
        if candidate.exists():
            return candidate
    which = shutil.which("DiaNN") or shutil.which("diann") or shutil.which("DiaNN.exe")
    if which:
        return Path(which)
    return None


_MSCONVERT_SEARCH_PATHS: list[Path] = [
    Path("C:/ProteoWizard/msconvert.exe"),
    Path("C:/Program Files/ProteoWizard/msconvert.exe"),
    Path("C:/Program Files (x86)/ProteoWizard/msconvert.exe"),
    # Skyline ClickOnce deployment bundles msconvert
    *sorted(
        (Path.home() / "AppData/Local/Apps/2.0").glob("*/*/skyl*exe*/msconvert.exe")
        if (Path.home() / "AppData/Local/Apps/2.0").exists() else [],
        reverse=True,  # newest first
    ),
]


def _find_msconvert() -> Path | None:
    """Return path to msconvert.exe (ProteoWizard), or None if not found."""
    for candidate in _MSCONVERT_SEARCH_PATHS:
        if candidate.exists():
            return candidate
    which = shutil.which("msconvert") or shutil.which("msconvert.exe")
    if which:
        return Path(which)
    return None


def _convert_d_to_mzml(d_path: Path, output_dir: Path) -> Path | None:
    """Convert a Bruker .d directory to indexed mzML.

    Uses msconvert (ProteoWizard) if available, falling back to timsconvert.
    msconvert flags are optimized for timsTOF data: vendor peak picking,
    64-bit precision, zlib compression, MS1+MS2 included.

    Returns the path to the mzML file on success, or None on failure.
    """
    mzml_path = output_dir / (d_path.stem + ".mzML")
    if mzml_path.exists():
        return mzml_path   # already converted

    output_dir.mkdir(parents=True, exist_ok=True)

    # ── Prefer msconvert (ProteoWizard) ─────────────────────────────────────
    msconvert = _find_msconvert()
    if msconvert:
        log_path = output_dir / "msconvert.log"
        # CRITICAL for Bruker ddaPASEF: --ddaProcessing combines all ion-mobility
        # sub-scans for the same precursor into a single MS2 spectrum.
        # Without this flag every TIMS step writes as its own spectrum →
        # a 1 GB .d file expands to 14–18 GB mzML.  With it, output is ~1–3 GB.
        # --32 halves float array size (sufficient precision for peptide IDs).
        # --filter "msLevel 2" keeps MS2 only — DDA engines don't use MS1 from mzML.
        cmd = [
            str(msconvert),
            str(d_path),
            "--mzML",
            "--ddaProcessing",
            "--filter", "msLevel 2",
            "--filter", "zeroSamples removeExtra",
            "--zlib",
            "--32",
            "--outdir", str(output_dir),
        ]
        logger.info("msconvert: converting %s → mzML (timsTOF optimized)", d_path.name)
        try:
            with open(log_path, "w") as lf:
                subprocess.run(
                    cmd, check=True, stdout=lf, stderr=subprocess.STDOUT,
                    text=True, timeout=3600,
                )
        except subprocess.CalledProcessError as e:
            logger.warning("msconvert failed (rc=%d) for %s", e.returncode, d_path.name)
        except subprocess.TimeoutExpired:
            logger.warning("msconvert timed out for %s", d_path.name)
        except Exception as exc:
            logger.warning("msconvert error for %s: %s", d_path.name, exc)

        if mzml_path.exists():
            return mzml_path
        found = list(output_dir.glob("*.mzML"))
        if found:
            return found[0]
        logger.warning("msconvert produced no mzML for %s — falling back to timsconvert", d_path.name)

    # ── Fallback: timsconvert ────────────────────────────────────────────────
    if not shutil.which("timsconvert"):
        logger.debug("Neither msconvert nor timsconvert available")
        return None

    log_path = output_dir / "timsconvert.log"
    cmd = [
        "timsconvert",
        "--input",    str(d_path),
        "--outdir",   str(output_dir),
        "--ms2_only", "False",
    ]
    logger.info("timsconvert: converting %s → mzML", d_path.name)
    try:
        with open(log_path, "w") as lf:
            subprocess.run(
                cmd, check=True, stdout=lf, stderr=subprocess.STDOUT,
                text=True, timeout=3600,
            )
    except Exception as exc:
        logger.warning("timsconvert failed for %s: %s", d_path.name, exc)
        return None

    if mzml_path.exists():
        return mzml_path
    found = list(output_dir.glob("*.mzML"))
    return found[0] if found else None


# ── X!Tandem parameter writers ───────────────────────────────────────────────

def _write_xtandem_taxonomy(output_dir: Path, fasta_path: str) -> Path:
    """Write taxonomy.xml required by X!Tandem."""
    taxonomy_path = output_dir / "taxonomy.xml"
    # X!Tandem needs forward slashes even on Windows
    fasta_url = Path(fasta_path).as_posix()
    content = (
        '<?xml version="1.0"?>\n'
        '<bioml label="x! taxon-to-file matching list">\n'
        '  <taxon label="stan_search">\n'
        f'    <file format="peptide" URL="{fasta_url}" />\n'
        '  </taxon>\n'
        '</bioml>\n'
    )
    taxonomy_path.write_text(content, encoding="utf-8")
    return taxonomy_path


def _write_xtandem_params(
    output_dir: Path,
    fasta_path: str,
    input_file: Path,
    threads: int = 0,
    search_config: dict | None = None,
) -> Path:
    """Write X!Tandem input.xml parameter file and return its path.

    Generates a taxonomy.xml alongside it automatically.
    """
    if threads <= 0:
        threads = max(2, (os.cpu_count() or 4) // 2)

    sc = search_config or _WORKFLOW_PRESETS[_DEFAULT_WORKFLOW]
    specificity = sc.get("specificity", "specific")
    missed      = sc.get("missed_cleavages", 2)

    # Enzyme / cleavage
    if specificity == "non-specific":
        cleavage_site = ""
        cleavage_semi = "no"
    elif specificity == "semi":
        cleavage_site = "[RK]|{P}"
        cleavage_semi = "yes"
    else:
        cleavage_site = "[RK]|{P}"
        cleavage_semi = "no"

    # Fixed mods → "57.021464@C" format
    fixed_mod_strs = [_XT_FIXED_MOD_MAP[m] for m in sc.get("fixed_mods", [])
                      if m in _XT_FIXED_MOD_MAP]
    fixed_mod_val = ",".join(fixed_mod_strs) if fixed_mod_strs else ""

    # Variable mods — collect all tokens (some entries expand to multiple)
    var_tokens: list[str] = []
    for m in sc.get("var_mods", []):
        val = _XT_VAR_MOD_MAP.get(m)
        if val:
            var_tokens.extend(val.split(","))
    var_mod_val = ",".join(var_tokens) if var_tokens else ""

    taxonomy_path = _write_xtandem_taxonomy(output_dir, fasta_path)
    output_xml    = output_dir / "output.xml"

    # X!Tandem bioml parameter format — all values are <note> elements
    notes: list[tuple[str, str]] = [
        ("list path, taxonomy information",       str(taxonomy_path.as_posix())),
        ("list path, default parameters",         ""),
        ("protein, taxon",                        "stan_search"),
        ("spectrum, path",                        str(input_file.as_posix())),
        ("output, path",                          str(output_xml.as_posix())),
        ("output, results",                       "all"),
        ("output, maximum valid expectation value", "0.05"),
        ("output, spectra",                       "yes"),
        ("output, proteins",                      "yes"),
        ("output, sequences",                     "yes"),
        ("output, histograms",                    "no"),
        ("output, parameters",                    "no"),
        ("output, performance",                   "no"),
        # Mass tolerances — ppm for precursor, Da for fragment
        ("spectrum, parent monoisotopic mass error plus",   "20"),
        ("spectrum, parent monoisotopic mass error minus",  "20"),
        ("spectrum, parent monoisotopic mass error units",  "ppm"),
        ("spectrum, parent monoisotopic mass isotope error", "yes"),
        ("spectrum, fragment monoisotopic mass error",      "0.02"),
        ("spectrum, fragment monoisotopic mass error units", "Daltons"),
        # Ion scoring
        ("scoring, minimum ion count", "4"),
        ("scoring, y ions",            "yes"),
        ("scoring, b ions",            "yes"),
        ("scoring, a ions",            "no"),
        ("scoring, x ions",            "no"),
        ("scoring, z ions",            "no"),
        ("scoring, c ions",            "no"),
        # Enzyme
        ("protein, cleavage site",     cleavage_site),
        ("protein, cleavage semi",     cleavage_semi),
        ("protein, maximum valid expectation value", "0.05"),
        ("protein, N-terminal residue modification mass", "0.0"),
    ]

    if fixed_mod_val:
        notes.append(("residue, modification mass", fixed_mod_val))
    if var_mod_val:
        notes.append(("residue, potential modification mass", var_mod_val))

    # Refinement pass — always enabled; refine with N-term acetyl + unanticipated cleavage
    refine_var = var_mod_val
    if "42.010565@[" not in refine_var:
        refine_var = (refine_var + ",42.010565@[").lstrip(",")
    notes += [
        ("refine",                              "yes"),
        ("refine, maximum valid expectation value", "0.05"),
        ("refine, sPTM complexity",             "2"),
        ("refine, potential modification mass", refine_var),
        ("refine, unanticipated cleavage",      "yes"),
        ("refine, cleavage semi",               cleavage_semi),
        # Threading
        ("process, start condition",            "no"),
        ("spectrum, threads",                   str(threads)),
    ]

    lines: list[str] = ['<?xml version="1.0"?>\n', "<bioml>\n"]
    for label, value in notes:
        escaped = value.replace("&", "&amp;").replace("<", "&lt;").replace('"', "&quot;")
        lines.append(f'  <note type="input" label="{label}">{escaped}</note>\n')
    lines.append("</bioml>\n")

    params_path = output_dir / "input.xml"
    params_path.write_text("".join(lines), encoding="utf-8")
    return params_path


# ── X!Tandem result parsing ──────────────────────────────────────────────────

def _parse_xtandem_output(output_dir: Path) -> dict[str, int | None]:
    """Parse X!Tandem bioml XML output for PSM/peptide/protein counts.

    Filters at expect (E-value) < 0.01. Protein groups are unique canonical
    accession sets (decoys filtered by ``REVERSED_`` or ``rev_`` prefix).
    """
    output_xml = output_dir / "output.xml"
    if not output_xml.exists():
        # X!Tandem sometimes appends a timestamp suffix
        candidates = [f for f in output_dir.glob("output*.xml") if f.name != "input.xml"]
        if not candidates:
            return {"n_psms": None, "n_peptides": None, "n_proteins": None}
        output_xml = sorted(candidates)[-1]

    n_psms = 0
    peptides: set[str] = set()
    protein_groups: set[str] = set()

    try:
        tree = ET.parse(str(output_xml))
        root = tree.getroot()
    except ET.ParseError:
        logger.debug("X!Tandem XML parse error: %s", output_xml)
        return {"n_psms": None, "n_peptides": None, "n_proteins": None}

    # Iterate over top-level <group type="model"> elements — each is one PSM
    for group in root.iter("group"):
        if group.get("type") != "model":
            continue
        try:
            expect = float(group.get("expect", "1"))
        except (ValueError, TypeError):
            continue
        if expect >= 0.01:
            continue

        n_psms += 1

        # Collect peptide sequences from <domain seq="..."> inside this group
        for domain in group.iter("domain"):
            seq = domain.get("seq", "").strip()
            if seq:
                peptides.add(seq)

        # Collect protein accessions from <protein label="...">
        accs_in_group: list[str] = []
        for protein in group.iter("protein"):
            raw_label = protein.get("label", "").strip()
            if not raw_label:
                continue
            # Extract UniProt accession from labels like "sp|P12345|GENE_HUMAN"
            # or plain "P12345" — strip isoform suffix (-2, etc.)
            parts = raw_label.split("|")
            acc = parts[1] if len(parts) >= 3 else parts[0]
            acc = re.sub(r"-\d+$", "", acc.strip())
            # Skip decoys
            if acc.startswith("rev_") or acc.startswith("REVERSED_") or acc.startswith("decoy_"):
                continue
            if acc:
                accs_in_group.append(acc)

        if accs_in_group:
            group_key = ";".join(sorted(set(accs_in_group)))
            protein_groups.add(group_key)

    return {
        "n_psms":     n_psms              if n_psms          else None,
        "n_peptides": len(peptides)        if peptides        else None,
        "n_proteins": len(protein_groups)  if protein_groups  else None,
    }


# ── X!Tandem engine runner ────────────────────────────────────────────────────

def _run_xtandem_thread(
    run_id: str,
    raw_path: Path,
    output_dir: Path,
    xtandem_exe: Path,
    fasta_path: str,
    threads: int,
    search_config: dict | None = None,
) -> None:
    """Background thread: convert (if needed), run X!Tandem, write results to DB."""
    output_dir.mkdir(parents=True, exist_ok=True)
    _upsert_comparison(run_id, "xtandem", "running")

    # ── 1. Resolve input file (convert .d → mzML if necessary) ──────────────
    suffix = raw_path.suffix.lower()
    if suffix == ".d" or raw_path.is_dir():
        # Bruker .d — convert to mzML first
        if not _find_msconvert() and not _has_timsconvert():
            _upsert_comparison(run_id, "xtandem", "not_installed",
                               error_msg="msconvert or timsconvert required for .d files")
            logger.warning("X!Tandem skipped for %s: no mzML converter found", raw_path.name)
            return
        input_file = _convert_d_to_mzml(raw_path, output_dir)
        if not input_file:
            _upsert_comparison(run_id, "xtandem", "failed",
                               error_msg="timsconvert failed — no mzML produced")
            return
    elif suffix in (".mzml", ".mzxml"):
        input_file = raw_path
    elif suffix == ".raw":
        # Thermo .raw — X!Tandem cannot read these directly; skip gracefully
        _upsert_comparison(run_id, "xtandem", "failed",
                           error_msg=".raw not supported — convert to mzML first")
        logger.info("X!Tandem skipped for %s: Thermo .raw not directly supported", raw_path.name)
        return
    else:
        input_file = raw_path   # attempt anyway

    # ── 2. Write parameter files ─────────────────────────────────────────────
    params_path = _write_xtandem_params(output_dir, fasta_path, input_file, threads,
                                        search_config=search_config)

    # ── 3. Run X!Tandem ──────────────────────────────────────────────────────
    cmd = [str(xtandem_exe), str(params_path)]
    log_path = output_dir / "xtandem.log"
    logger.info("X!Tandem starting: %s", raw_path.name)

    try:
        with open(log_path, "w") as lf:
            subprocess.run(
                cmd,
                check=True,
                stdout=lf,
                stderr=subprocess.STDOUT,
                text=True,
                timeout=7200,   # 2 h max
                cwd=str(output_dir),
            )
    except subprocess.CalledProcessError as e:
        _upsert_comparison(run_id, "xtandem", "failed",
                           error_msg=f"exit {e.returncode}",
                           result_path=str(output_dir))
        logger.error("X!Tandem failed (rc=%d): %s", e.returncode, raw_path.name)
        return
    except subprocess.TimeoutExpired:
        _upsert_comparison(run_id, "xtandem", "failed",
                           error_msg="timeout (2h)", result_path=str(output_dir))
        logger.error("X!Tandem timed out: %s", raw_path.name)
        return
    except Exception as exc:
        _upsert_comparison(run_id, "xtandem", "failed", error_msg=str(exc))
        logger.error("X!Tandem error: %s", exc)
        return

    # ── 4. Parse results and store ───────────────────────────────────────────
    stats = _parse_xtandem_output(output_dir)
    _upsert_comparison(
        run_id, "xtandem", "done",
        result_path=str(output_dir),
        **stats,
    )
    logger.info(
        "X!Tandem done: %s — PSMs=%s  peptides=%s  proteins=%s",
        raw_path.name,
        stats["n_psms"], stats["n_peptides"], stats["n_proteins"],
    )


# ── Comet engine ─────────────────────────────────────────────────────────────

def _write_comet_params(
    output_dir: Path,
    fasta_path: str,
    threads: int,
    immuno_class: int = 0,
    search_config: dict | None = None,
) -> Path:
    """Write a comet.params file for a DDA search and return its path.

    If search_config is supplied it takes priority over immuno_class.
    """
    if search_config is not None:
        sc = search_config
        specificity = sc.get("specificity", "specific")
        enzyme_key  = sc.get("enzyme", "Trypsin/P")
        enzyme_num  = _COMET_ENZYME_MAP.get(enzyme_key, 1)
        missed      = sc.get("missed_cleavages", 2)
        min_len     = sc.get("min_len", 7)
        max_len     = sc.get("max_len", 30)
        min_charge  = sc.get("min_charge", 2)
        max_charge  = sc.get("max_charge", 4)
        if specificity == "non-specific":
            num_termini = 0
            enzyme_num = 0
        elif specificity == "semi":
            num_termini = 1
        else:
            num_termini = 2

        # Fixed mods
        add_C = 0.0
        add_K = 0.0
        add_nterm = 0.0
        for m in sc.get("fixed_mods", []):
            if "Carbamidomethyl" in m and "C" in m:
                add_C = 57.021464
            elif "TMT6plex (K)" in m:
                add_K = 229.162932
            elif "TMT6plex (N-term)" in m:
                add_nterm = 229.162932

        # Variable mods — up to 6 slots
        var_lines: list[str] = []
        for idx, m in enumerate(sc.get("var_mods", []), start=1):
            if idx > 6:
                break
            val = _COMET_VAR_MOD_MAP.get(m)
            if val:
                var_lines.append(f"variable_mod{idx:02d} = {val}")
        # Zero out remaining slots so Comet doesn't use stale values
        for idx in range(len(var_lines) + 1, 7):
            var_lines.append(f"variable_mod{idx:02d} = 0.0 X 0 3 -1 0 0 0.0")

    else:
        # Legacy immuno_class fallback
        if immuno_class == 1:
            enzyme_num, min_len, max_len, missed = 0, 8, 12, 0
            num_termini, min_charge, max_charge = 0, 1, 3
        elif immuno_class == 2:
            enzyme_num, min_len, max_len, missed = 0, 13, 25, 2
            num_termini, min_charge, max_charge = 1, 2, 4
        else:
            enzyme_num, min_len, max_len, missed = 1, 7, 30, 2
            num_termini, min_charge, max_charge = 2, 2, 4
        add_C, add_K, add_nterm = 57.021464, 0.0, 0.0
        var_lines = [
            "variable_mod01 = 15.9949146 M 0 3 -1 0 0 0.0",
            "variable_mod02 = 0.9840156 NQ 0 3 -1 0 0 0.0",
            "variable_mod03 = 0.0 X 0 3 -1 0 0 0.0",
            "variable_mod04 = 0.0 X 0 3 -1 0 0 0.0",
            "variable_mod05 = 0.0 X 0 3 -1 0 0 0.0",
            "variable_mod06 = 0.0 X 0 3 -1 0 0 0.0",
        ]

    var_block = "\n".join(var_lines)
    add_C_line    = f"add_C_cysteine = {add_C}" if add_C else ""
    add_K_line    = f"add_K_lysine = {add_K}" if add_K else ""
    add_nterm_line = f"add_Nterm_peptide = {add_nterm}" if add_nterm else ""
    extra_fixed = "\n".join(l for l in [add_C_line, add_K_line, add_nterm_line] if l)

    params = f"""\
# Comet params — auto-generated by ZIGGY
database_name = {fasta_path}
decoy_search = 1
num_threads = {threads}
peptide_mass_tolerance = 15
peptide_mass_units = 2
mass_type_parent = 1
mass_type_fragment = 1
precursor_charge = {min_charge} {max_charge}
max_fragment_charge = 3
ms_level = 2
search_enzyme_number = {enzyme_num}
num_enzyme_termini = {num_termini}
allowed_missed_cleavage = {missed}
fragment_bin_tol = 0.02
fragment_bin_offset = 0.0
digest_min_length = {min_len}
digest_max_length = {max_len}
digest_mass_range = 500.0 5000.0
max_variable_mods_in_peptide = 3
require_variable_mod = 0
{var_block}
{extra_fixed}
output_pepxmlfile = 1
output_txtfile = 1
output_sqtfile = 0
output_mzidentmlfile = 0
peff_format = 0
num_results = 5
max_duplicate_proteins = 0
"""
    output_dir.mkdir(parents=True, exist_ok=True)
    params_path = output_dir / "comet.params"
    params_path.write_text(params)
    return params_path


def _parse_comet_output(output_dir: Path) -> dict[str, int | None]:
    """Parse Comet .txt output for PSM/peptide/protein counts at 1% FDR."""
    # Comet txt output: tab-separated with columns including e-value
    counts = {"n_psms": None, "n_peptides": None, "n_proteins": None}
    txt_files = list(output_dir.glob("*.txt"))
    if not txt_files:
        return counts

    try:
        psms, peptides, proteins = set(), set(), set()
        for txt_path in txt_files:
            with open(txt_path, newline="", encoding="utf-8", errors="replace") as f:
                reader = csv.DictReader(f, delimiter="\t")
                for row in reader:
                    try:
                        evalue = float(row.get("e-value", row.get("xcorr_evalue", "1")))
                    except (ValueError, KeyError):
                        continue
                    if evalue > 0.01:
                        continue
                    seq = row.get("plain_peptide", row.get("sequence", ""))
                    prot = row.get("protein", "")
                    if seq:
                        psms.add(row.get("scan", "") + seq)
                        peptides.add(seq)
                    if prot:
                        proteins.add(prot.split("\t")[0].strip())
        counts["n_psms"] = len(psms)
        counts["n_peptides"] = len(peptides)
        counts["n_proteins"] = len(proteins)
    except Exception:
        logger.debug("_parse_comet_output failed", exc_info=True)
    return counts


def _run_comet_thread(
    run_id: str,
    raw_path: Path,
    output_dir: Path,
    comet_exe: Path,
    fasta_path: str,
    threads: int,
    search_config: dict | None = None,
) -> None:
    """Background thread: run Comet DDA search and write results to DB."""
    output_dir.mkdir(parents=True, exist_ok=True)
    _upsert_comparison(run_id, "comet", "running")

    # Convert .d to mzML if needed
    input_path = raw_path
    if raw_path.suffix.lower() == ".d":
        if not _find_msconvert() and not _has_timsconvert():
            _upsert_comparison(run_id, "comet", "not_installed",
                               error_msg="msconvert or timsconvert required for .d files")
            return
        converted = _convert_d_to_mzml(raw_path, output_dir)
        if not converted:
            _upsert_comparison(run_id, "comet", "failed",
                               error_msg="mzML conversion failed")
            return
        input_path = converted

    params_path = _write_comet_params(output_dir, fasta_path, threads,
                                      search_config=search_config)

    cmd = [str(comet_exe), f"-P{params_path}", str(input_path)]
    log_path = output_dir / "comet.log"
    logger.info("Comet starting: %s", raw_path.name)

    try:
        with open(log_path, "w") as lf:
            subprocess.run(
                cmd, check=True, stdout=lf, stderr=subprocess.STDOUT,
                text=True, timeout=7200, cwd=str(output_dir),
            )
    except subprocess.CalledProcessError as e:
        _upsert_comparison(run_id, "comet", "failed",
                           error_msg=f"exit {e.returncode}", result_path=str(output_dir))
        logger.error("Comet failed (rc=%d): %s", e.returncode, raw_path.name)
        return
    except subprocess.TimeoutExpired:
        _upsert_comparison(run_id, "comet", "failed",
                           error_msg="timeout (2h)", result_path=str(output_dir))
        return
    except Exception as exc:
        _upsert_comparison(run_id, "comet", "failed", error_msg=str(exc))
        return

    stats = _parse_comet_output(output_dir)
    _upsert_comparison(run_id, "comet", "done", result_path=str(output_dir), **stats)
    logger.info("Comet done: %s — PSMs=%s  peptides=%s  proteins=%s",
                raw_path.name, stats["n_psms"], stats["n_peptides"], stats["n_proteins"])


def _dispatch_comet(
    run_id: str,
    raw_path: Path,
    output_dir: Path,
    comet_exe: Path,
    fasta_path: str | None,
    fragpipe: Path | None,
    threads: int,
    search_config: dict | None = None,
) -> None:
    """Resolve FASTA and fire Comet in a background thread."""
    effective_fasta = fasta_path
    if not effective_fasta or not Path(effective_fasta).exists():
        if fragpipe:
            bundled = _fragpipe_paths(fragpipe).get("bundled_fasta")
            if bundled and Path(str(bundled)).exists():
                effective_fasta = str(bundled)
    if not effective_fasta or not Path(effective_fasta).exists():
        _upsert_comparison(run_id, "comet", "failed", error_msg="No FASTA available")
        return
    t = threading.Thread(
        target=_run_comet_thread,
        args=(run_id, raw_path, output_dir, comet_exe, effective_fasta, threads,
              search_config),
        daemon=True,
        name=f"comp-comet-{run_id[:16]}",
    )
    t.start()
    logger.info("Dispatched comparison: comet for %s", raw_path.name)


# ── DB helpers ───────────────────────────────────────────────────────────────

def _get_db_path() -> Path:
    from stan.config import get_user_config_dir
    return get_user_config_dir() / "stan.db"


# All comparison engines tracked in the UI, in display order.
_ALL_COMPARISON_ENGINES = (
    "msfragger_dia",
    "sage_dia",
    "diann_libfree",
    "msfragger_dda",
    "xtandem",
    "comet",
    "maxquant",
    "andromeda",
    "prolucid",
    "chimerys",
)

# Engines that only make sense for DIA data.
_DIA_ONLY_ENGINES = {"msfragger_dia", "sage_dia", "diann_libfree"}

# Engines that only make sense for DDA data.
_DDA_ONLY_ENGINES = {"msfragger_dda", "xtandem", "comet", "maxquant", "andromeda", "prolucid"}

# Engines that work on both DIA and DDA (cloud or external platforms).
_UNIVERSAL_ENGINES = {"chimerys"}


def init_run_comparison_statuses(run_id: str, mode: str) -> None:
    """Pre-populate search_comparisons rows for every engine before searching.

    Inserts rows with:
    - ``not_applicable`` — engine is incompatible with the acquisition mode
    - ``pending``        — engine is compatible (tool availability checked later)

    Uses INSERT OR IGNORE so existing rows (e.g. a previous ``done`` result)
    are never overwritten.
    """
    import sqlite3

    mode_str = mode.value if hasattr(mode, "value") else str(mode)
    is_dia = mode_str in ("DIA", "diaPASEF")

    rows = []
    for engine in _ALL_COMPARISON_ENGINES:
        if engine in _UNIVERSAL_ENGINES:
            status = "pending"
        elif is_dia and engine in _DDA_ONLY_ENGINES:
            status = "not_applicable"
        elif not is_dia and engine in _DIA_ONLY_ENGINES:
            status = "not_applicable"
        else:
            status = "pending"
        rows.append((run_id, engine, status))

    try:
        with sqlite3.connect(str(_get_db_path())) as con:
            con.executemany(
                "INSERT OR IGNORE INTO search_comparisons (run_id, engine, status) VALUES (?, ?, ?)",
                rows,
            )
    except Exception:
        logger.debug("init_run_comparison_statuses failed", exc_info=True)


def _upsert_comparison(run_id: str, engine: str, status: str, **kwargs: Any) -> None:
    """Insert or update a row in search_comparisons. Thread-safe (own connection)."""
    import sqlite3
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    fields: dict[str, Any] = {"run_id": run_id, "engine": engine, "status": status}

    if status == "running":
        fields["started_at"] = now
    elif status in ("done", "failed"):
        fields["finished_at"] = now

    fields.update(kwargs)

    cols        = ", ".join(fields.keys())
    placeholders = ", ".join("?" for _ in fields)
    updates     = ", ".join(
        f"{k}=excluded.{k}" for k in fields if k not in ("run_id", "engine")
    )

    try:
        with sqlite3.connect(str(_get_db_path())) as con:
            con.execute(
                f"INSERT INTO search_comparisons ({cols}) VALUES ({placeholders}) "
                f"ON CONFLICT(run_id, engine) DO UPDATE SET {updates}",
                list(fields.values()),
            )
    except Exception:
        logger.debug("_upsert_comparison failed", exc_info=True)


# ── MSFragger params ─────────────────────────────────────────────────────────

def _write_msfragger_params(
    output_dir: Path,
    fasta_path: str,
    data_type: int = 0,
    threads: int = 0,
    search_config: dict | None = None,
) -> Path:
    """Write fragger.params into output_dir and return its path.

    data_type: 0=DDA, 1=DIA, 2=DIA-narrow-window
    If search_config is supplied it overrides the hardcoded enzyme/mod defaults.
    """
    if threads <= 0:
        threads = max(2, (os.cpu_count() or 4) // 2)

    sc = search_config or _WORKFLOW_PRESETS[_DEFAULT_WORKFLOW]
    specificity = sc.get("specificity", "specific")
    missed      = sc.get("missed_cleavages", 2)
    min_len     = sc.get("min_len", 7)
    max_len     = sc.get("max_len", 50)

    # Enzyme
    if specificity == "non-specific":
        enzyme_name = "nonspecific"
        cut_1, nocut_1, sense_1 = "", "", "C"
        num_termini = 0
    elif specificity == "semi":
        enzyme_name = "stricttrypsin"
        cut_1, nocut_1, sense_1 = "KR", "", "C"
        num_termini = 1
    else:
        enzyme_name = "stricttrypsin"
        cut_1, nocut_1, sense_1 = "KR", "", "C"
        num_termini = 2

    # Variable mods — up to 7 MSFragger slots
    var_mods: dict[str, str] = {}
    for idx, m in enumerate(sc.get("var_mods", []), start=1):
        if idx > 7:
            break
        val = _MSF_VAR_MOD_MAP.get(m)
        if val:
            var_mods[f"variable_mod_{idx:02d}"] = val

    # Fixed mods
    fixed_mods: dict[str, float] = {}
    for m in sc.get("fixed_mods", []):
        entry = _MSF_FIXED_MOD_MAP.get(m)
        if entry:
            fixed_mods[entry[0]] = entry[1]

    params: dict[str, Any] = {
        "num_threads":              threads,
        "database_name":            fasta_path,
        "decoy_prefix":             "rev_",
        "precursor_mass_lower":     -20,
        "precursor_mass_upper":     20,
        "precursor_mass_units":     1,         # ppm
        "data_type":                data_type,
        "precursor_true_tolerance": 20,
        "precursor_true_units":     1,
        "fragment_mass_tolerance":  20,
        "fragment_mass_units":      1,
        "calibrate_mass":           2,         # ON + find optimal params
        "search_enzyme_name_1":     enzyme_name,
        "search_enzyme_cut_1":      cut_1,
        "search_enzyme_nocut_1":    nocut_1,
        "allowed_missed_cleavage_1": missed,
        "search_enzyme_sense_1":    sense_1,
        "num_enzyme_termini":       num_termini,
        "clip_nTerm_M":             1,
        "output_format":            "tsv",
        "output_report_topN":       1,
        "output_max_expect":        50,
        "digest_min_length":        min_len,
        "digest_max_length":        max_len,
        "digest_mass_range":        "500.0 5000.0",
        "max_fragment_charge":      2,
        "min_matched_fragments":    4,
        "minimum_ratio":            0.01,
        "remove_precursor_peak":    1,
        "remove_precursor_range":   "-1.5,1.5",
        "intensity_transform":      0,
        "max_variable_mods_per_peptide": 3,
        "report_alternative_proteins": 0,
    }
    params.update(var_mods)
    params.update(fixed_mods)

    output_dir.mkdir(parents=True, exist_ok=True)
    lines = [f"{k} = {v}\n" for k, v in params.items()]
    params_path = output_dir / "fragger.params"
    params_path.write_text("".join(lines))
    return params_path


# ── Result parsing ────────────────────────────────────────────────────────────

def _parse_msfragger_tsv(output_dir: Path) -> dict[str, int | None]:
    """Parse MSFragger TSV output for PSM/peptide/protein-group counts.

    Filters at E-value < 0.01.  Protein groups are the unique sorted
    canonical accessions from the (possibly semicolon-delimited) protein
    column — one group = one unique set of co-identified proteins.

    MSFragger writes one TSV per input file; column names vary slightly
    between versions so headers are matched case-insensitively.
    """
    tsv_files = [
        f for f in output_dir.glob("*.tsv")
        if f.stem not in ("fragger",) and not f.stem.startswith("_")
    ]
    if not tsv_files:
        return {"n_psms": None, "n_peptides": None, "n_proteins": None}

    n_psms = 0
    peptides: set[str] = set()
    protein_groups: set[str] = set()

    for tsv_path in tsv_files:
        try:
            with open(tsv_path, newline="", errors="replace") as fh:
                reader = csv.DictReader(fh, delimiter="\t")
                for row in reader:
                    row_lower = {k.strip().lower(): v for k, v in row.items()}

                    # E-value / expect score filtering at 1 %
                    # MSFragger uses "expectscore"; X!Tandem/Comet use "expect"/"e-value"
                    expect_str = (
                        row_lower.get("expectscore")
                        or row_lower.get("expect")
                        or row_lower.get("e-value")
                        or row_lower.get("expectation")
                        or ""
                    )
                    try:
                        expect = float(expect_str)
                    except (ValueError, TypeError):
                        continue
                    if expect >= 0.01:
                        continue

                    n_psms += 1

                    # Unique stripped peptide sequences
                    pep_raw = (
                        row_lower.get("peptide")
                        or row_lower.get("modified_peptide")
                        or row_lower.get("sequence")
                        or ""
                    )
                    if pep_raw:
                        clean = re.sub(r"\[.*?\]|n\[.*?\]", "", pep_raw).strip()
                        if clean:
                            peptides.add(clean)

                    # Protein group = sorted canonical accession set so that
                    # "sp|P00001;sp|P00002" and "sp|P00002;sp|P00001" are the same group.
                    prot_raw = (
                        row_lower.get("protein")
                        or row_lower.get("proteins")
                        or ""
                    )
                    if prot_raw:
                        # Strip isoform suffixes (e.g. sp|P12345-2 → sp|P12345)
                        accs = [
                            re.sub(r"-\d+$", "", a.strip())
                            for a in prot_raw.split(";")
                            if a.strip() and not a.strip().startswith("rev_")
                        ]
                        if accs:
                            group_key = ";".join(sorted(set(accs)))
                            protein_groups.add(group_key)

        except Exception:
            logger.debug("Error parsing MSFragger TSV %s", tsv_path, exc_info=True)

    return {
        "n_psms":     n_psms          if n_psms          else None,
        "n_peptides": len(peptides)   if peptides        else None,
        "n_proteins": len(protein_groups) if protein_groups else None,
    }


# ── Engine runner ─────────────────────────────────────────────────────────────

def _run_msfragger_thread(
    run_id: str,
    raw_path: Path,
    output_dir: Path,
    engine_name: str,
    data_type: int,
    paths: dict[str, Path | None],
    fasta_path: str,
    threads: int,
    search_config: dict | None = None,
) -> None:
    """Background thread: run MSFragger and write results to DB."""
    output_dir.mkdir(parents=True, exist_ok=True)
    _upsert_comparison(run_id, engine_name, "running")

    java        = paths.get("java")
    jar         = paths.get("msfragger_jar")
    bruker_lib  = paths.get("bruker_lib")

    if not jar or not Path(str(jar)).exists():
        _upsert_comparison(run_id, engine_name, "failed",
                           error_msg="MSFragger jar not found")
        return
    if not java or not Path(str(java)).exists():
        _upsert_comparison(run_id, engine_name, "failed",
                           error_msg="Java (FragPipe JRE) not found")
        return

    # MSFragger DIA mode cannot read Bruker diaPASEF .d files directly —
    # it needs mzML.  Convert first; DDA mode handles .d natively via timsdata.
    input_path = raw_path
    if data_type == 1 and (raw_path.suffix.lower() == ".d" or raw_path.is_dir()):
        if not _find_msconvert() and not _has_timsconvert():
            _upsert_comparison(run_id, engine_name, "not_installed",
                               error_msg="msconvert or timsconvert required for diaPASEF .d → mzML")
            logger.warning("MSFragger-DIA skipped for %s: no mzML converter found", raw_path.name)
            return
        # Include MS1 + MS2 for DIA (no --filter "msLevel 2" and no --ddaProcessing)
        mzml_out_dir = output_dir / "mzml"
        mzml_out_dir.mkdir(parents=True, exist_ok=True)
        mzml_path = mzml_out_dir / (raw_path.stem + ".mzML")
        if not mzml_path.exists():
            msconvert = _find_msconvert()
            if msconvert:
                log_mz = mzml_out_dir / "msconvert.log"
                cmd_mz = [
                    str(msconvert), str(raw_path), "--mzML",
                    "--filter", "zeroSamples removeExtra",
                    "--zlib", "--32",
                    "--outdir", str(mzml_out_dir),
                ]
                logger.info("MSFragger-DIA: converting %s → mzML", raw_path.name)
                try:
                    with open(log_mz, "w") as lf:
                        subprocess.run(cmd_mz, check=True, stdout=lf,
                                       stderr=subprocess.STDOUT, text=True, timeout=3600)
                except Exception as exc:
                    logger.warning("msconvert for MSFragger-DIA failed: %s", exc)
            if not mzml_path.exists():
                found = list(mzml_out_dir.glob("*.mzML"))
                if found:
                    mzml_path = found[0]
                else:
                    converted = _convert_d_to_mzml(raw_path, mzml_out_dir)
                    if not converted:
                        _upsert_comparison(run_id, engine_name, "failed",
                                           error_msg="mzML conversion failed for diaPASEF")
                        return
                    mzml_path = converted
        input_path = mzml_path

    params_path = _write_msfragger_params(
        output_dir, fasta_path, data_type=data_type, threads=threads,
        search_config=search_config,
    )

    # Use D: for MSFragger temp files — avoids filling the E: data drive with
    # multi-GB peptide index shards.  Create the dir if needed.
    msf_tmp = Path("D:/msfragger_tmp")
    try:
        msf_tmp.mkdir(parents=True, exist_ok=True)
    except Exception:
        msf_tmp = output_dir  # fallback: same dir as output
    cmd = [
        str(java),
        "-Xmx8g",                           # 14g left no room for native heap (pepindex mmap)
        f"-Djava.io.tmpdir={msf_tmp}",
    ]
    if bruker_lib and Path(str(bruker_lib)).exists():
        cmd.append(f"-Djava.library.path={bruker_lib}")
    cmd += ["-jar", str(jar), str(params_path), str(input_path)]

    log_path = output_dir / "msfragger.log"
    logger.info("MSFragger %s starting: %s", engine_name, raw_path.name)

    try:
        with open(log_path, "w") as lf:
            subprocess.run(
                cmd,
                check=True,
                stdout=lf,
                stderr=subprocess.STDOUT,
                text=True,
                timeout=7200,   # 2 h max
                cwd=str(output_dir),
            )
    except subprocess.CalledProcessError as e:
        _upsert_comparison(
            run_id, engine_name, "failed",
            error_msg=f"exit {e.returncode}",
            result_path=str(output_dir),
        )
        logger.error("MSFragger %s failed (rc=%d): %s",
                     engine_name, e.returncode, raw_path.name)
        return
    except subprocess.TimeoutExpired:
        _upsert_comparison(run_id, engine_name, "failed",
                           error_msg="timeout (2h)", result_path=str(output_dir))
        logger.error("MSFragger %s timed out: %s", engine_name, raw_path.name)
        return
    except Exception as exc:
        _upsert_comparison(run_id, engine_name, "failed", error_msg=str(exc))
        logger.error("MSFragger %s error: %s", engine_name, exc)
        return

    # MSFragger writes TSV output alongside the INPUT FILE, not in output_dir.
    # Copy any TSVs from the input file's parent into output_dir so the parser finds them.
    input_parent = input_path.parent
    for tsv in input_parent.glob(f"{input_path.stem}*.tsv"):
        dest = output_dir / tsv.name
        if not dest.exists():
            try:
                shutil.copy2(str(tsv), str(dest))
            except Exception:
                pass

    stats = _parse_msfragger_tsv(output_dir)
    # If output_dir still has no TSVs, fall back to parsing directly from input_parent
    if stats.get("n_psms") is None:
        stats = _parse_msfragger_tsv(input_parent)

    _upsert_comparison(
        run_id, engine_name, "done",
        result_path=str(output_dir),
        **stats,
    )
    logger.info(
        "MSFragger %s done: %s — PSMs=%s  peptides=%s  proteins=%s",
        engine_name, raw_path.name,
        stats["n_psms"], stats["n_peptides"], stats["n_proteins"],
    )


# ── MaxQuant ─────────────────────────────────────────────────────────────────

_MAXQUANT_SEARCH_PATHS: list[Path] = [
    Path("C:/MaxQuant/bin/MaxQuantCmd.exe"),
    Path("D:/MaxQuant/bin/MaxQuantCmd.exe"),
    Path("E:/MaxQuant/bin/MaxQuantCmd.exe"),
    Path.home() / "MaxQuant/bin/MaxQuantCmd.exe",
    Path("C:/Program Files/MaxQuant/bin/MaxQuantCmd.exe"),
    Path("C:/tools/MaxQuant/bin/MaxQuantCmd.exe"),
]


def _find_maxquant() -> Path | None:
    """Return path to MaxQuantCmd.exe if found."""
    for p in _MAXQUANT_SEARCH_PATHS:
        if p.is_file():
            return p
    found = shutil.which("MaxQuantCmd.exe")
    if found:
        return Path(found)
    return None


_MAXQUANT_PARAM_TEMPLATE = """\
<?xml version="1.0" encoding="utf-8"?>
<MaxQuantParams>
  <fastaFiles>
    <FastaFileInfo>
      <fastaFilePath>{fasta_path}</fastaFilePath>
      <identifierParseRule>&gt;(.+?) </identifierParseRule>
      <descriptionParseRule>&gt;(.*)</descriptionParseRule>
      <taxonomyParseRule></taxonomyParseRule>
      <variationParseRule></variationParseRule>
      <modificationParseRule></modificationParseRule>
      <taxonomyId></taxonomyId>
    </FastaFileInfo>
  </fastaFiles>
  <fastaFilesProteogenomics>
  </fastaFilesProteogenomics>
  <fastaFilesFirstSearch>
  </fastaFilesFirstSearch>
  <fixedSearchFolder>{output_dir}</fixedSearchFolder>
  <andromedaCacheSize>350000</andromedaCacheSize>
  <advancedRatios>True</advancedRatios>
  <pValueThres>0.005</pValueThres>
  <neucodeRatioBasedQuantification>False</neucodeRatioBasedQuantification>
  <neucodeStabilizeLargeRatios>False</neucodeStabilizeLargeRatios>
  <neucodeRequireMsMs>False</neucodeRequireMsMs>
  <minRatioCount>2</minRatioCount>
  <lfqMode>1</lfqMode>
  <lfqSkipNorm>False</lfqSkipNorm>
  <lfqMinEdgesPerNode>3</lfqMinEdgesPerNode>
  <lfqAvEdgesPerNode>6</lfqAvEdgesPerNode>
  <lfqMaxFeatures>100000</lfqMaxFeatures>
  <decoyMode>revert</decoyMode>
  <includeContaminants>True</includeContaminants>
  <maxPeptideMass>4600</maxPeptideMass>
  <epsilonMutantScore>0</epsilonMutantScore>
  <multipleProteinGroupsFromOneSpectrum>False</multipleProteinGroupsFromOneSpectrum>
  <msInstrument>0</msInstrument>
  <globalMolweightCutoff>0</globalMolweightCutoff>
  <goldenRatio>False</goldenRatio>
  <scoreThres>40</scoreThres>
  <deltaScoreThres>6</deltaScoreThres>
  <histogramType>Unknown</histogramType>
  <intensityThres>0</intensityThres>
  <useNormRatiosForHybridStatTest>True</useNormRatiosForHybridStatTest>
  <maxQuantVersion>1.6.11.0</maxQuantVersion>
  <minUniquePeptides>0</minUniquePeptides>
  <minRazorPeptides>1</minRazorPeptides>
  <minPeptides>1</minPeptides>
  <ibaq>False</ibaq>
  <top3>False</top3>
  <ibaqLogFit>False</ibaqLogFit>
  <separateLfq>False</separateLfq>
  <ibaqMatchBetweenRuns>False</ibaqMatchBetweenRuns>
  <weightedNormalization>False</weightedNormalization>
  <referenceChannel></referenceChannel>
  <numThreads>{threads}</numThreads>
  <calcPeakProperties>False</calcPeakProperties>
  <writeMsScansTable>False</writeMsScansTable>
  <writeMsmsScansTable>True</writeMsmsScansTable>
  <writePasefMsmsScansTable>True</writePasefMsmsScansTable>
  <writeAccumulatedMsmsScansTable>False</writeAccumulatedMsmsScansTable>
  <writeMsnScansTable>False</writeMsnScansTable>
  <writeBoxCarScansTable>False</writeBoxCarScansTable>
  <keepLowScoresMode>0</keepLowScoresMode>
  <proteinGroupsForSorting>1</proteinGroupsForSorting>
  <showCategoryNames>False</showCategoryNames>
  <showDenovoScores>False</showDenovoScores>
  <standardProteinGroupsForSorting>True</standardProteinGroupsForSorting>
  <fixedModifications>
{fixed_mods_xml}  </fixedModifications>
  <paramGroupIndices>
    <int>0</int>
  </paramGroupIndices>
  <msmsParamsIndices>
    <int>0</int>
  </msmsParamsIndices>
  <fragmentationParamsIndices>
    <int>0</int>
  </fragmentationParamsIndices>
  <parameterGroups>
    <parameterGroup>
      <msInstrument>0</msInstrument>
      <maxCharge>5</maxCharge>
      <minPeakLen>2</minPeakLen>
      <diaMinPeakLen>2</diaMinPeakLen>
      <useMs1Centroids>False</useMs1Centroids>
      <useMs2Centroids>False</useMs2Centroids>
      <cutPeaks>True</cutPeaks>
      <gapScans>1</gapScans>
      <minTime>NaN</minTime>
      <maxTime>NaN</maxTime>
      <matchType>MatchFromAndTo</matchType>
      <intensityDetermination>0</intensityDetermination>
      <centroidMatchTol>8</centroidMatchTol>
      <centroidHalfWidth>35</centroidHalfWidth>
      <valleyFactor>1.4</valleyFactor>
      <isotopeValleyFactor>1.2</isotopeValleyFactor>
      <advancedPeakSplitting>False</advancedPeakSplitting>
      <intensityThreshold>0</intensityThreshold>
      <labelMods>
        <string></string>
      </labelMods>
      <lcmsRunType>Standard</lcmsRunType>
      <reQuantify>False</reQuantify>
      <lfqMode>1</lfqMode>
      <lfqSkipNorm>False</lfqSkipNorm>
      <lfqMinEdgesPerNode>3</lfqMinEdgesPerNode>
      <lfqAvEdgesPerNode>6</lfqAvEdgesPerNode>
      <lfqMaxFeatures>100000</lfqMaxFeatures>
      <neucodeMaxPpm>0</neucodeMaxPpm>
      <neucodeResolution>0</neucodeResolution>
      <neucodeResolutionInMda>False</neucodeResolutionInMda>
      <neucodeInSilicoLowRes>False</neucodeInSilicoLowRes>
      <variableModifications>
{var_mods_xml}      </variableModifications>
      <maxNmods>5</maxNmods>
      <maxMissedCleavages>{missed_cleavages}</maxMissedCleavages>
      <multiplicity>1</multiplicity>
      <enzymeMode>{enzyme_mode}</enzymeMode>
      <complementaryReporterType>0</complementaryReporterType>
      <reporterNormalization>0</reporterNormalization>
      <neucodeIntensityMode>0</neucodeIntensityMode>
      <enzymes>
        <string>{enzyme_name}</string>
      </enzymes>
      <enzymesFirstSearch>
        <string>Trypsin/P</string>
      </enzymesFirstSearch>
      <useEnzymeFirstSearch>False</useEnzymeFirstSearch>
      <useVariableModificationsFirstSearch>False</useVariableModificationsFirstSearch>
      <variableModificationsFirstSearch>
      </variableModificationsFirstSearch>
      <hasAdditionalVariableModifications>False</hasAdditionalVariableModifications>
      <additionalVariableModifications>
      </additionalVariableModifications>
      <additionalVariableModificationProteins>
      </additionalVariableModificationProteins>
      <doMassFiltering>True</doMassFiltering>
      <firstSearchTol>20</firstSearchTol>
      <mainSearchTol>4.5</mainSearchTol>
      <searchTolInPpm>True</searchTolInPpm>
      <isotopeMatchTol>2</isotopeMatchTol>
      <isotopeMatchTolInPpm>True</isotopeMatchTolInPpm>
      <isotopeTimeCorrelation>0.6</isotopeTimeCorrelation>
      <theorIsotopeCorrelation>0.6</theorIsotopeCorrelation>
      <checkMassDeficit>True</checkMassDeficit>
      <recalibrationInPpm>True</recalibrationInPpm>
      <intensityThreshold>0</intensityThreshold>
      <precursorMassTolerance>20</precursorMassTolerance>
      <precursorMassToleranceInPpm>True</precursorMassToleranceInPpm>
      <filePaths>
        <string>{raw_path}</string>
      </filePaths>
      <experiments>
        <string></string>
      </experiments>
      <fractions>
        <short>32767</short>
      </fractions>
      <ptms>
        <boolean>False</boolean>
      </ptms>
      <paramGroupIndices>
        <int>0</int>
      </paramGroupIndices>
      <referenceChannel></referenceChannel>
      <bframeSliceSize>1</bframeSliceSize>
      <bframeOffset>0</bframeOffset>
    </parameterGroup>
  </parameterGroups>
  <msmsParams>
    <MsmsParams>
      <Name>FTMS</Name>
      <MatchTolerance>20</MatchTolerance>
      <MatchToleranceInPpm>True</MatchToleranceInPpm>
      <DeisotopeTolerance>7</DeisotopeTolerance>
      <DeisotopeToleranceInPpm>True</DeisotopeToleranceInPpm>
      <DeNovoTolerance>10</DeNovoTolerance>
      <DeNovoToleranceInPpm>True</DeNovoToleranceInPpm>
      <Deisotope>True</Deisotope>
      <Topx>12</Topx>
      <MaxPeakCount>300</MaxPeakCount>
      <report>False</report>
    </MsmsParams>
  </msmsParams>
  <outputFolder>{output_dir}</outputFolder>
</MaxQuantParams>
"""


_MQ_ENZYME_MAP: dict[str, str] = {
    "Trypsin/P":    "Trypsin/P",
    "Trypsin":      "Trypsin",
    "LysC":         "LysC",
    "LysC/P":       "LysC/P",
    "GluC":         "GluC",
    "AspN":         "Asp-N",
    "non-specific": "Unspecific",
}


def _write_maxquant_params(
    output_dir: Path,
    raw_path: Path,
    fasta_path: str,
    threads: int,
    search_config: dict | None = None,
) -> Path:
    """Write mqpar.xml into output_dir and return its path."""
    output_dir.mkdir(parents=True, exist_ok=True)

    sc = search_config or _WORKFLOW_PRESETS[_DEFAULT_WORKFLOW]
    specificity = sc.get("specificity", "specific")
    missed      = sc.get("missed_cleavages", 2)
    enzyme_key  = sc.get("enzyme", "Trypsin/P")
    enzyme_name = _MQ_ENZYME_MAP.get(enzyme_key, "Trypsin/P")
    if specificity == "non-specific":
        enzyme_mode = 2
        enzyme_name = "Unspecific"
    elif specificity == "semi":
        enzyme_mode = 1
    else:
        enzyme_mode = 0

    # Build fixed mods XML block
    fixed_strs = [_MQ_FIXED_MODS[m] for m in sc.get("fixed_mods", []) if m in _MQ_FIXED_MODS]
    if fixed_strs:
        fixed_mods_xml = "".join(f"    <string>{m}</string>\n" for m in fixed_strs)
    else:
        fixed_mods_xml = ""

    # Build variable mods XML block (de-duplicate via dict to preserve order)
    seen: dict[str, None] = {}
    for m in sc.get("var_mods", []):
        mapped = _MQ_VAR_MODS.get(m)
        if mapped and mapped not in seen:
            seen[mapped] = None
    if seen:
        var_mods_xml = "".join(f"        <string>{m}</string>\n" for m in seen)
    else:
        var_mods_xml = ""

    # MaxQuant requires absolute Windows paths with forward slashes
    mqpar_path = output_dir / "mqpar.xml"
    content = _MAXQUANT_PARAM_TEMPLATE.format(
        fasta_path=str(fasta_path).replace("\\", "/"),
        raw_path=str(raw_path).replace("\\", "/"),
        output_dir=str(output_dir).replace("\\", "/"),
        threads=threads,
        fixed_mods_xml=fixed_mods_xml,
        var_mods_xml=var_mods_xml,
        missed_cleavages=missed,
        enzyme_mode=enzyme_mode,
        enzyme_name=enzyme_name,
    )
    mqpar_path.write_text(content, encoding="utf-8")
    return mqpar_path


def _parse_maxquant_output(output_dir: Path) -> dict[str, Any]:
    """Parse MaxQuant combined/txt outputs for PSM / peptide / protein counts."""
    combined = output_dir / "combined" / "txt"

    n_psms = 0
    n_peptides = 0
    n_proteins = 0

    # msms.txt — one row per PSM
    msms_file = combined / "msms.txt"
    if msms_file.exists():
        try:
            with open(msms_file, newline="", encoding="utf-8", errors="replace") as fh:
                reader = csv.DictReader(fh, delimiter="\t")
                for row in reader:
                    score = float(row.get("Score", 0) or 0)
                    if score > 0:
                        n_psms += 1
        except Exception:
            pass

    # peptides.txt — unique peptides
    pep_file = combined / "peptides.txt"
    if pep_file.exists():
        try:
            with open(pep_file, newline="", encoding="utf-8", errors="replace") as fh:
                reader = csv.DictReader(fh, delimiter="\t")
                for row in reader:
                    seq = row.get("Sequence", "").strip()
                    rev = row.get("Reverse", "").strip()
                    cont = row.get("Potential contaminant", "").strip()
                    if seq and rev != "+" and cont != "+":
                        n_peptides += 1
        except Exception:
            pass

    # proteinGroups.txt — protein groups (non-decoy, non-contaminant)
    pg_file = combined / "proteinGroups.txt"
    if pg_file.exists():
        try:
            with open(pg_file, newline="", encoding="utf-8", errors="replace") as fh:
                reader = csv.DictReader(fh, delimiter="\t")
                for row in reader:
                    rev = row.get("Reverse", "").strip()
                    cont = row.get("Potential contaminant", "").strip()
                    only_id = row.get("Only identified by site", "").strip()
                    if rev != "+" and cont != "+" and only_id != "+":
                        n_proteins += 1
        except Exception:
            pass

    return {"n_psms": n_psms or None, "n_peptides": n_peptides or None,
            "n_proteins": n_proteins or None}


def _run_maxquant_thread(
    run_id: str,
    raw_path: Path,
    output_dir: Path,
    maxquant_cmd: Path,
    fasta_path: str,
    threads: int,
    search_config: dict | None = None,
) -> None:
    """Run MaxQuantCmd.exe and record results — called in a daemon thread."""
    output_dir.mkdir(parents=True, exist_ok=True)
    _upsert_comparison(run_id, "maxquant", "running")

    mqpar_path = _write_maxquant_params(output_dir, raw_path, fasta_path, threads,
                                        search_config=search_config)
    log_path = output_dir / "maxquant.log"
    cmd = [str(maxquant_cmd), str(mqpar_path)]
    logger.info("MaxQuant starting: %s", raw_path.name)

    try:
        with open(log_path, "w") as lf:
            subprocess.run(
                cmd, check=True, stdout=lf, stderr=subprocess.STDOUT,
                text=True, timeout=14400,  # 4h max
                cwd=str(output_dir),
            )
    except subprocess.CalledProcessError as e:
        _upsert_comparison(run_id, "maxquant", "failed",
                           error_msg=f"exit {e.returncode}", result_path=str(output_dir))
        logger.error("MaxQuant failed (rc=%d): %s", e.returncode, raw_path.name)
        return
    except subprocess.TimeoutExpired:
        _upsert_comparison(run_id, "maxquant", "failed",
                           error_msg="timeout (4h)", result_path=str(output_dir))
        return
    except Exception as exc:
        _upsert_comparison(run_id, "maxquant", "failed", error_msg=str(exc))
        return

    stats = _parse_maxquant_output(output_dir)
    _upsert_comparison(run_id, "maxquant", "done", result_path=str(output_dir), **stats)
    logger.info("MaxQuant done: %s — PSMs=%s  peptides=%s  proteins=%s",
                raw_path.name, stats["n_psms"], stats["n_peptides"], stats["n_proteins"])


def _dispatch_maxquant(
    run_id: str,
    raw_path: Path,
    output_dir: Path,
    maxquant_cmd: Path,
    fasta_path: str | None,
    fragpipe: Path | None,
    threads: int,
    search_config: dict | None = None,
) -> None:
    """Resolve FASTA and fire MaxQuant in a background thread."""
    effective_fasta = fasta_path
    if not effective_fasta or not Path(effective_fasta).exists():
        if fragpipe:
            bundled = _fragpipe_paths(fragpipe).get("bundled_fasta")
            if bundled and Path(str(bundled)).exists():
                effective_fasta = str(bundled)
    if not effective_fasta or not Path(effective_fasta).exists():
        _upsert_comparison(run_id, "maxquant", "failed", error_msg="No FASTA available")
        return
    t = threading.Thread(
        target=_run_maxquant_thread,
        args=(run_id, raw_path, output_dir, maxquant_cmd, effective_fasta, threads,
              search_config),
        daemon=True,
        name=f"comp-maxquant-{run_id[:16]}",
    )
    t.start()
    logger.info("Dispatched comparison: maxquant for %s", raw_path.name)


# ── Sage DIA engine ───────────────────────────────────────────────────────────

import json as _json


def _build_sage_dia_config(
    fasta_path: str,
    mzml_path: Path,
    output_dir: Path,
    search_config: dict | None = None,
) -> Path:
    """Write a Sage JSON config for DIA-mode searching and return its path.

    Key DIA settings:
    - ``wide_window: true``   — enables data-independent acquisition mode
    - precursor_tol ppm ±50  — wide window to catch all isolation windows
    - fragment_tol ppm 20    — standard timsTOF MS/MS accuracy
    """
    sc = search_config or _WORKFLOW_PRESETS[_DEFAULT_WORKFLOW]
    specificity = sc.get("specificity", "specific")
    missed      = sc.get("missed_cleavages", 2)
    min_len     = sc.get("min_len", 7)
    max_len     = sc.get("max_len", 30)
    min_charge  = sc.get("min_charge", 2)
    max_charge  = sc.get("max_charge", 4)

    enzyme_key  = sc.get("enzyme", "Trypsin/P")
    cleave_at   = "KR" if enzyme_key.startswith("Trypsin") else \
                  "K"  if "LysC" in enzyme_key else \
                  ""
    restrict    = "P"  if enzyme_key.endswith("/P") else ""

    if specificity == "non-specific":
        cleave_at = ""; restrict = ""
        semi = False
    elif specificity == "semi":
        semi = True
    else:
        semi = False

    # Fixed mods
    static_mods: dict[str, float] = {}
    for m in sc.get("fixed_mods", []):
        if "Carbamidomethyl" in m and "C" in m:
            static_mods["C"] = 57.021464
        elif "TMT6plex (K)" in m:
            static_mods["K"] = 229.162932
        elif "TMT6plex (N-term)" in m:
            static_mods["^"] = 229.162932

    # Variable mods
    var_mods: list[dict] = []
    for m in sc.get("var_mods", []):
        if "Oxidation (M)" in m:
            var_mods.append({"name": "Oxidation", "mass": 15.994915, "targets": ["M"], "position": "Anywhere", "max_mods": 3})
        elif "Acetyl (Protein N-term)" in m:
            var_mods.append({"name": "Acetyl", "mass": 42.010565, "targets": ["$"], "position": "ProteinN-term", "max_mods": 1})
        elif "Phospho (STY)" in m:
            var_mods.append({"name": "Phospho", "mass": 79.966331, "targets": ["S", "T", "Y"], "position": "Anywhere", "max_mods": 3})
        elif "Deamidation (NQ)" in m:
            var_mods.append({"name": "Deamidation", "mass": 0.984016, "targets": ["N", "Q"], "position": "Anywhere", "max_mods": 3})

    config: dict = {
        "database": {
            "bucket_size": 32768,
            "enzyme": {
                "missed_cleavages": missed,
                "min_len": min_len,
                "max_len": max_len,
                "cleave_at": cleave_at,
                "restrict": restrict,
                "semi_enzymatic": semi,
                "c_terminal": True,
            },
            "peptide_min_mass": 500.0,
            "peptide_max_mass": 5000.0,
            "ion_kinds": ["b", "y"],
            "min_ion_index": 2,
            "static_mods": static_mods,
            "variable_mods": var_mods,
            "generate_decoys": True,
            "fasta": str(fasta_path),
        },
        "precursor_tol": {"ppm": [-50, 50]},
        "fragment_tol": {"ppm": [-20, 20]},
        "isotope_errors": [-1, 3],
        "deisotope": True,
        "chimera": False,
        "wide_window": True,
        "min_peaks": 6,
        "max_peaks": 150,
        "min_matched_peaks": 4,
        "max_fragment_charge": 2,
        "report_psms": 1,
        "predict_rt": True,
        "min_precursor_charge": min_charge,
        "max_precursor_charge": max_charge,
        "mzml_paths": [str(mzml_path)],
        "output_directory": str(output_dir),
    }

    config_path = output_dir / "sage_dia_config.json"
    output_dir.mkdir(parents=True, exist_ok=True)
    config_path.write_text(_json.dumps(config, indent=2))
    return config_path


def _parse_sage_dia_tsv(output_dir: Path) -> dict[str, int | None]:
    """Parse Sage TSV output (results.sage.tsv) at q_value < 0.01.

    Sage DIA writes results.sage.tsv (not .parquet when --parquet is omitted).
    Counts unique stripped peptide sequences and unique protein groups.
    """
    tsv = output_dir / "results.sage.tsv"
    if not tsv.exists():
        candidates = list(output_dir.glob("*.sage.tsv")) + list(output_dir.glob("results*.tsv"))
        if not candidates:
            return {"n_psms": None, "n_peptides": None, "n_proteins": None}
        tsv = candidates[0]

    n_psms = 0
    peptides: set[str] = set()
    proteins: set[str] = set()

    try:
        with open(tsv, newline="", encoding="utf-8", errors="replace") as fh:
            reader = csv.DictReader(fh, delimiter="\t")
            for row in reader:
                try:
                    q = float(row.get("spectrum_q", row.get("q_value", "1")) or 1)
                except ValueError:
                    q = 1.0
                if q >= 0.01:
                    continue
                seq = row.get("peptide", row.get("stripped_peptide", "")).strip()
                prot = row.get("proteins", "").strip()
                # Sage uses '.' as a decoy prefix marker in protein names
                if prot.startswith("rev_") or prot.startswith("DECOY_"):
                    continue
                n_psms += 1
                if seq:
                    # Strip modification brackets to get bare sequence
                    bare = re.sub(r"\[[\d.+-]+\]", "", seq)
                    peptides.add(bare)
                if prot:
                    proteins.add(prot.split(";")[0].strip())
    except Exception:
        logger.debug("_parse_sage_dia_tsv parse error", exc_info=True)
        return {"n_psms": None, "n_peptides": None, "n_proteins": None}

    return {
        "n_psms":     n_psms          or None,
        "n_peptides": len(peptides)   or None,
        "n_proteins": len(proteins)   or None,
    }


def _run_sage_dia_thread(
    run_id: str,
    raw_path: Path,
    output_dir: Path,
    sage_exe: Path,
    fasta_path: str,
    threads: int,
    search_config: dict | None = None,
) -> None:
    """Background thread: convert .d → mzML if needed, run Sage in DIA mode, write results."""
    output_dir.mkdir(parents=True, exist_ok=True)
    _upsert_comparison(run_id, "sage_dia", "running")

    # ── 1. Resolve input file ────────────────────────────────────────────────
    suffix = raw_path.suffix.lower()
    if suffix == ".d" or raw_path.is_dir():
        if not _find_msconvert() and not _has_timsconvert():
            _upsert_comparison(run_id, "sage_dia", "not_installed",
                               error_msg="msconvert or timsconvert required for .d files")
            return
        # DIA mzML: keep both MS1 and MS2 (Sage DIA needs MS1 for precursor matching)
        mzml_path = output_dir / (raw_path.stem + ".mzML")
        if not mzml_path.exists():
            output_dir.mkdir(parents=True, exist_ok=True)
            msconvert = _find_msconvert()
            if msconvert:
                log_path = output_dir / "msconvert_dia.log"
                cmd = [
                    str(msconvert), str(raw_path), "--mzML",
                    "--filter", "zeroSamples removeExtra",
                    "--zlib", "--32",
                    "--outdir", str(output_dir),
                ]
                try:
                    with open(log_path, "w") as lf:
                        subprocess.run(cmd, check=True, stdout=lf, stderr=subprocess.STDOUT,
                                       text=True, timeout=3600)
                except Exception as exc:
                    logger.warning("sage_dia msconvert failed: %s", exc)
                found = list(output_dir.glob("*.mzML"))
                if found:
                    mzml_path = found[0]
            if not mzml_path.exists():
                converted = _convert_d_to_mzml(raw_path, output_dir)
                if not converted:
                    _upsert_comparison(run_id, "sage_dia", "failed",
                                       error_msg="mzML conversion failed")
                    return
                mzml_path = converted
        input_file = mzml_path
    elif suffix in (".mzml", ".mzxml"):
        input_file = raw_path
    elif suffix == ".raw":
        # Thermo .raw — attempt direct (Sage ≥0.14 can read .raw on Windows)
        input_file = raw_path
    else:
        input_file = raw_path

    # ── 2. Write Sage DIA config ─────────────────────────────────────────────
    config_path = _build_sage_dia_config(fasta_path, input_file, output_dir, search_config)

    # ── 3. Run Sage (no --parquet — we parse the TSV) ────────────────────────
    cmd = [str(sage_exe), str(config_path)]
    if threads > 0:
        cmd += ["--threads", str(threads)]
    log_path = output_dir / "sage_dia.log"
    logger.info("Sage-DIA starting: %s", raw_path.name)

    try:
        with open(log_path, "w") as lf:
            subprocess.run(
                cmd, check=True, stdout=lf, stderr=subprocess.STDOUT,
                text=True, timeout=7200, cwd=str(output_dir),
            )
    except subprocess.CalledProcessError as e:
        _upsert_comparison(run_id, "sage_dia", "failed",
                           error_msg=f"exit {e.returncode}", result_path=str(output_dir))
        logger.error("Sage-DIA failed (rc=%d): %s", e.returncode, raw_path.name)
        return
    except subprocess.TimeoutExpired:
        _upsert_comparison(run_id, "sage_dia", "failed",
                           error_msg="timeout (2h)", result_path=str(output_dir))
        return
    except Exception as exc:
        _upsert_comparison(run_id, "sage_dia", "failed", error_msg=str(exc))
        return

    # ── 4. Parse and store results ───────────────────────────────────────────
    stats = _parse_sage_dia_tsv(output_dir)
    _upsert_comparison(run_id, "sage_dia", "done",
                       result_path=str(output_dir), **stats)
    logger.info("Sage-DIA done: %s — PSMs=%s  peptides=%s  proteins=%s",
                raw_path.name, stats["n_psms"], stats["n_peptides"], stats["n_proteins"])


# ── DIA-NN library-free engine ────────────────────────────────────────────────

def _parse_diann_libfree_tsv(output_dir: Path) -> dict[str, int | None]:
    """Parse DIA-NN library-free report.tsv at Q.Value < 0.01.

    Counts unique Stripped.Sequence and unique Protein.Group values.
    n_psms is reported as precursor count (unique peptide + charge combos).
    """
    report = output_dir / "report.tsv"
    if not report.exists():
        candidates = list(output_dir.glob("report*.tsv"))
        if not candidates:
            return {"n_psms": None, "n_peptides": None, "n_proteins": None}
        report = candidates[0]

    n_psms = 0
    peptides: set[str] = set()
    proteins: set[str] = set()

    try:
        with open(report, newline="", encoding="utf-8", errors="replace") as fh:
            reader = csv.DictReader(fh, delimiter="\t")
            for row in reader:
                try:
                    q = float(row.get("Q.Value", "1") or 1)
                except ValueError:
                    q = 1.0
                if q >= 0.01:
                    continue
                seq  = row.get("Stripped.Sequence", "").strip()
                prot = row.get("Protein.Group", "").strip()
                if not seq:
                    continue
                n_psms += 1
                peptides.add(seq)
                if prot:
                    proteins.add(prot)
    except Exception:
        logger.debug("_parse_diann_libfree_tsv parse error", exc_info=True)
        return {"n_psms": None, "n_peptides": None, "n_proteins": None}

    return {
        "n_psms":     n_psms          or None,
        "n_peptides": len(peptides)   or None,
        "n_proteins": len(proteins)   or None,
    }


def _run_diann_libfree_thread(
    run_id: str,
    raw_path: Path,
    output_dir: Path,
    diann_exe: Path,
    fasta_path: str,
    threads: int,
    search_config: dict | None = None,
) -> None:
    """Background thread: run DIA-NN in library-free mode (FASTA only, no --lib).

    DIA-NN performs in silico spectral prediction internally when no library
    is provided. Output is report.tsv in the output directory.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    _upsert_comparison(run_id, "diann_libfree", "running")

    sc = search_config or _WORKFLOW_PRESETS[_DEFAULT_WORKFLOW]
    missed   = sc.get("missed_cleavages", 2)
    min_len  = sc.get("min_len", 7)
    max_len  = sc.get("max_len", 30)

    report_path = output_dir / "report.tsv"

    # Build DIA-NN command — no --lib flag means library-free mode
    cmd = [
        str(diann_exe),
        "--f", str(raw_path),
        "--fasta", fasta_path,
        "--out", str(report_path),
        "--threads", str(max(2, threads)),
        "--missed-cleavages", str(missed),
        "--min-pep-len", str(min_len),
        "--max-pep-len", str(max_len),
        "--cut", "K*,R*",       # tryptic cleavage
        "--var-mods", "1",
        "--unimod4",            # Carbamidomethyl (C) fixed
        "--verbose", "1",
        "--qvalue", "0.01",
        "--matrices",           # generate peptide/protein matrices
        "--no-prot-inf",        # skip protein inference (faster, use Protein.Group)
    ]
    if threads > 0:
        pass  # already added above

    log_path = output_dir / "diann_libfree.log"
    logger.info("DIA-NN lib-free starting: %s", raw_path.name)

    try:
        with open(log_path, "w") as lf:
            subprocess.run(
                cmd, check=True, stdout=lf, stderr=subprocess.STDOUT,
                text=True, timeout=14400,  # 4h — lib-free is slow (in silico library build)
                cwd=str(output_dir),
            )
    except subprocess.CalledProcessError as e:
        _upsert_comparison(run_id, "diann_libfree", "failed",
                           error_msg=f"exit {e.returncode}", result_path=str(output_dir))
        logger.error("DIA-NN lib-free failed (rc=%d): %s", e.returncode, raw_path.name)
        return
    except subprocess.TimeoutExpired:
        _upsert_comparison(run_id, "diann_libfree", "failed",
                           error_msg="timeout (4h)", result_path=str(output_dir))
        return
    except Exception as exc:
        _upsert_comparison(run_id, "diann_libfree", "failed", error_msg=str(exc))
        return

    stats = _parse_diann_libfree_tsv(output_dir)
    _upsert_comparison(run_id, "diann_libfree", "done",
                       result_path=str(output_dir), **stats)
    logger.info("DIA-NN lib-free done: %s — precursors=%s  peptides=%s  proteins=%s",
                raw_path.name, stats["n_psms"], stats["n_peptides"], stats["n_proteins"])


# ── Public entry point ────────────────────────────────────────────────────────

def dispatch_comparison_searches(
    run_id: str,
    raw_path: Path,
    mode: str,
    output_base: Path,
    fasta_path: str | None = None,
    threads: int = 0,
    workflow: str | None = None,
) -> None:
    """Fire comparison search engines as background daemon threads.

    Called from dispatcher.py after the primary search completes. Returns
    immediately; each engine runs in its own thread and writes results to
    the search_comparisons table when done.

    Args:
        run_id:      Unique run identifier (raw_path.stem).
        raw_path:    Path to .d directory or .raw file.
        mode:        Acquisition mode string ("DIA", "diaPASEF", "DDA", …).
        output_base: Directory where _comparison/ subdirectories are created.
        fasta_path:  FASTA for search. Falls back to FragPipe bundled FASTA.
        threads:     CPU threads per engine (0 = half of available CPUs).
        workflow:    Preset key e.g. "phospho", "mhc_class_i_dda", "hela_digest".
                     All engines inherit enzyme/mod settings from this preset.
                     Falls back to "hela_digest" if None or unrecognised.
    """
    if threads <= 0:
        threads = max(2, (os.cpu_count() or 4) // 2)

    # Build the search config that all engines will use.
    # For comparison searches we intentionally use a STANDARD tryptic preset
    # regardless of the run's workflow.  This keeps all engines on a level
    # playing field (HLA semi-specific generates ~109M peptides and OOMs MSFragger),
    # and the primary DIA-NN/Sage result already captures workflow-specific IDs.
    search_config = _WORKFLOW_PRESETS.get("hela_digest") or _WORKFLOW_PRESETS[_DEFAULT_WORKFLOW]
    logger.info("dispatch_comparison_searches: workflow=%s (comparison locked to hela_digest)",
                workflow or "default")

    # Accept AcquisitionMode enum objects or plain strings
    mode_str = mode.value if hasattr(mode, "value") else str(mode)
    is_dia = mode_str in ("DIA", "diaPASEF")

    # Use D: drive for comparison output — E: is the data drive and fills up fast
    comparison_base = Path("D:/ziggy_comparison")

    # ── MSFragger (requires FragPipe) ────────────────────────────────────────
    fragpipe = _find_fragpipe()
    if fragpipe:
        paths = _fragpipe_paths(fragpipe)

        # Resolve FASTA — prefer caller-supplied, fall back to FragPipe bundled
        effective_fasta = fasta_path
        if not effective_fasta or not Path(effective_fasta).exists():
            bundled = paths.get("bundled_fasta")
            if bundled and Path(str(bundled)).exists():
                effective_fasta = str(bundled)

        if effective_fasta and Path(effective_fasta).exists():
            # Always run MSFragger DDA — gives PSM comparison on any file type
            msf_engines: list[tuple[str, Path, int]] = [
                ("msfragger_dda", comparison_base / "msfragger_dda", 0),
            ]
            # For DIA/diaPASEF also run MSFragger in DIA mode
            if is_dia:
                msf_engines.append(("msfragger_dia", comparison_base / "msfragger_dia", 1))

            for engine_name, out_dir, data_type in msf_engines:
                t = threading.Thread(
                    target=_run_msfragger_thread,
                    args=(run_id, raw_path, out_dir, engine_name,
                          data_type, paths, effective_fasta, threads,
                          search_config),
                    daemon=True,
                    name=f"comp-{engine_name}-{run_id[:16]}",
                )
                t.start()
                logger.info("Dispatched comparison: %s for %s (thread: %s)",
                            engine_name, raw_path.name, t.name)
        else:
            logger.warning("No FASTA found — skipping MSFragger comparisons for %s", run_id)
            for eng in ("msfragger_dda", "msfragger_dia"):
                if is_dia and eng == "msfragger_dda":
                    continue  # already not_applicable
                if not is_dia and eng == "msfragger_dia":
                    continue
                _upsert_comparison(run_id, eng, "failed", error_msg="No FASTA available")
    else:
        logger.debug("FragPipe not found — skipping MSFragger comparisons for %s", run_id)
        for eng in ("msfragger_dda", "msfragger_dia"):
            if is_dia and eng == "msfragger_dda":
                continue
            if not is_dia and eng == "msfragger_dia":
                continue
            _upsert_comparison(run_id, eng, "not_installed", error_msg="FragPipe not found")

    # ── Sage DIA (standalone — already installed for primary DDA searches) ────
    if is_dia:
        sage_exe = _find_sage_exe()
        if sage_exe:
            sage_fasta = fasta_path
            if (not sage_fasta or not Path(sage_fasta).exists()) and fragpipe:
                bundled = _fragpipe_paths(fragpipe).get("bundled_fasta")
                if bundled and Path(str(bundled)).exists():
                    sage_fasta = str(bundled)
            if sage_fasta and Path(sage_fasta).exists():
                t = threading.Thread(
                    target=_run_sage_dia_thread,
                    args=(run_id, raw_path, comparison_base / "sage_dia",
                          sage_exe, sage_fasta, threads, search_config),
                    daemon=True,
                    name=f"comp-sage_dia-{run_id[:16]}",
                )
                t.start()
                logger.info("Dispatched comparison: sage_dia for %s (thread: %s)",
                            raw_path.name, t.name)
            else:
                logger.warning("No FASTA found — skipping Sage-DIA comparison for %s", run_id)
                _upsert_comparison(run_id, "sage_dia", "failed", error_msg="No FASTA available")
        else:
            logger.debug("Sage not found — marking not_installed for %s", run_id)
            _upsert_comparison(run_id, "sage_dia", "not_installed",
                               error_msg="sage executable not found")

    # ── DIA-NN library-free (same binary as primary DIA-NN search) ───────────
    if is_dia:
        diann_exe = _find_diann_exe()
        if diann_exe:
            diann_fasta = fasta_path
            if (not diann_fasta or not Path(diann_fasta).exists()) and fragpipe:
                bundled = _fragpipe_paths(fragpipe).get("bundled_fasta")
                if bundled and Path(str(bundled)).exists():
                    diann_fasta = str(bundled)
            if diann_fasta and Path(diann_fasta).exists():
                t = threading.Thread(
                    target=_run_diann_libfree_thread,
                    args=(run_id, raw_path, comparison_base / "diann_libfree",
                          diann_exe, diann_fasta, threads, search_config),
                    daemon=True,
                    name=f"comp-diann_libfree-{run_id[:16]}",
                )
                t.start()
                logger.info("Dispatched comparison: diann_libfree for %s (thread: %s)",
                            raw_path.name, t.name)
            else:
                logger.warning("No FASTA found — skipping DIA-NN lib-free comparison for %s", run_id)
                _upsert_comparison(run_id, "diann_libfree", "failed",
                                   error_msg="No FASTA available")
        else:
            logger.debug("DIA-NN not found — marking not_installed for %s", run_id)
            _upsert_comparison(run_id, "diann_libfree", "not_installed",
                               error_msg="DiaNN.exe not found")

    # ── X!Tandem (standalone — does not need FragPipe) ───────────────────────
    if not is_dia:
        xtandem_exe = _find_xtandem()
        if xtandem_exe:
            xt_fasta = fasta_path
            if (not xt_fasta or not Path(xt_fasta).exists()) and fragpipe:
                paths_for_fasta = _fragpipe_paths(fragpipe)
                bundled = paths_for_fasta.get("bundled_fasta")
                if bundled and Path(str(bundled)).exists():
                    xt_fasta = str(bundled)

            if xt_fasta and Path(xt_fasta).exists():
                xt_out_dir = comparison_base / "xtandem"
                t = threading.Thread(
                    target=_run_xtandem_thread,
                    args=(run_id, raw_path, xt_out_dir, xtandem_exe, xt_fasta, threads,
                          search_config),
                    daemon=True,
                    name=f"comp-xtandem-{run_id[:16]}",
                )
                t.start()
                logger.info("Dispatched comparison: xtandem for %s (thread: %s)",
                            raw_path.name, t.name)
            else:
                logger.warning("No FASTA found — skipping X!Tandem comparison for %s", run_id)
                _upsert_comparison(run_id, "xtandem", "failed", error_msg="No FASTA available")
        else:
            logger.debug("X!Tandem not found — marking not_installed for %s", run_id)
            _upsert_comparison(run_id, "xtandem", "not_installed", error_msg="tandem.exe not found")

    # ── Comet ────────────────────────────────────────────────────────────────
    if not is_dia:
        comet_exe = _find_comet()
        if comet_exe:
            _dispatch_comet(run_id, raw_path, comparison_base / "comet",
                            comet_exe, fasta_path, fragpipe, threads,
                            search_config=search_config)
        else:
            logger.debug("Comet not found — marking not_installed for %s", run_id)
            _upsert_comparison(run_id, "comet", "not_installed", error_msg="comet.exe not found")

    # ── MaxQuant ─────────────────────────────────────────────────────────────
    if not is_dia:
        maxquant_cmd = _find_maxquant()
        if maxquant_cmd:
            _dispatch_maxquant(run_id, raw_path, comparison_base / "maxquant",
                               maxquant_cmd, fasta_path, fragpipe, threads,
                               search_config=search_config)
        else:
            logger.debug("MaxQuant not found — marking not_installed for %s", run_id)
            _upsert_comparison(run_id, "maxquant", "not_installed",
                               error_msg="MaxQuantCmd.exe not found")

    # ── Andromeda (standalone — MaxQuant 2.x ships standalone Andromeda CLI) ──
    if not is_dia:
        andromeda_exe = _find_andromeda()
        if andromeda_exe:
            andro_fasta = fasta_path
            if (not andro_fasta or not Path(andro_fasta).exists()) and fragpipe:
                bundled = _fragpipe_paths(fragpipe).get("bundled_fasta")
                if bundled and Path(str(bundled)).exists():
                    andro_fasta = str(bundled)
            if andro_fasta and Path(andro_fasta).exists():
                t = threading.Thread(
                    target=_run_andromeda_thread,
                    args=(run_id, raw_path, comparison_base / "andromeda",
                          andromeda_exe, andro_fasta, threads, search_config),
                    daemon=True,
                    name=f"comp-andromeda-{run_id[:16]}",
                )
                t.start()
                logger.info("Dispatched comparison: andromeda for %s", raw_path.name)
            else:
                _upsert_comparison(run_id, "andromeda", "failed", error_msg="No FASTA available")
        else:
            logger.debug("Andromeda not found — marking not_installed for %s", run_id)
            _upsert_comparison(run_id, "andromeda", "not_installed",
                               error_msg="Andromeda.exe not found")

    # ── PrOLuCID ─────────────────────────────────────────────────────────────
    if not is_dia:
        prolucid_jar = _find_prolucid()
        if prolucid_jar:
            pl_fasta = fasta_path
            if (not pl_fasta or not Path(pl_fasta).exists()) and fragpipe:
                bundled = _fragpipe_paths(fragpipe).get("bundled_fasta")
                if bundled and Path(str(bundled)).exists():
                    pl_fasta = str(bundled)
            if pl_fasta and Path(pl_fasta).exists():
                t = threading.Thread(
                    target=_run_prolucid_thread,
                    args=(run_id, raw_path, comparison_base / "prolucid",
                          prolucid_jar, pl_fasta, threads, search_config),
                    daemon=True,
                    name=f"comp-prolucid-{run_id[:16]}",
                )
                t.start()
                logger.info("Dispatched comparison: prolucid for %s", raw_path.name)
            else:
                _upsert_comparison(run_id, "prolucid", "failed", error_msg="No FASTA available")
        else:
            logger.debug("PrOLuCID not found — marking not_installed for %s", run_id)
            _upsert_comparison(run_id, "prolucid", "not_installed",
                               error_msg="prolucid.jar not found — download from github.com/Yates-lab")


# ── Andromeda (standalone) ─────────────────────────────────────────────────────

_ANDROMEDA_SEARCH_PATHS: list[Path] = [
    # MaxQuant 2.x ships a standalone Andromeda under its bin directory
    Path("C:/MaxQuant/bin/Andromeda.exe"),
    Path("D:/MaxQuant/bin/Andromeda.exe"),
    Path("E:/MaxQuant/bin/Andromeda.exe"),
    Path.home() / "MaxQuant/bin/Andromeda.exe",
    Path("C:/tools/Andromeda/Andromeda.exe"),
    Path("C:/Andromeda/Andromeda.exe"),
    Path("D:/Andromeda/Andromeda.exe"),
    Path("E:/Andromeda/Andromeda.exe"),
    Path.home() / "Desktop/Andromeda/Andromeda.exe",
    # MaxQuant also installs under Program Files
    Path("C:/Program Files/MaxQuant/bin/Andromeda.exe"),
    Path("C:/Program Files (x86)/MaxQuant/bin/Andromeda.exe"),
]


def _find_andromeda() -> Path | None:
    """Return path to standalone Andromeda.exe, or MaxQuantCmd.exe as fallback.

    MaxQuant 1.x does not ship a standalone Andromeda executable; only MaxQuant
    2.x does.  When the standalone binary is absent we fall back to MaxQuantCmd
    and run a full MaxQuant job — Andromeda is MaxQuant's internal search
    engine, so the PSM/peptide/protein counts are identical.  The caller
    detects the fallback by checking whether the returned path ends with
    'MaxQuantCmd.exe'.
    """
    for p in _ANDROMEDA_SEARCH_PATHS:
        if p.is_file():
            return p
    found = shutil.which("Andromeda.exe") or shutil.which("Andromeda")
    if found:
        return Path(found)
    # Fallback: MaxQuantCmd.exe (MaxQuant uses Andromeda internally)
    mq = _find_maxquant()
    if mq:
        logger.info("Andromeda.exe not found — will route through MaxQuantCmd.exe (%s)", mq)
        return mq
    return None


# Andromeda enzyme notation (used in apar XML params)
_ANDROMEDA_ENZYME_MAP: dict[str, str] = {
    "Trypsin/P":    "Trypsin/P",
    "Trypsin":      "Trypsin",
    "LysC":         "LysC",
    "LysC/P":       "LysC/P",
    "GluC":         "GluC",
    "AspN":         "Asp-N",
    "non-specific": "Unspecific",
}


def _write_andromeda_params(
    output_dir: Path,
    raw_path: Path,
    fasta_path: str,
    threads: int,
    search_config: dict | None = None,
) -> Path:
    """Write Andromeda standalone parameter XML (apar format) and return path."""
    output_dir.mkdir(parents=True, exist_ok=True)

    sc = search_config or _WORKFLOW_PRESETS[_DEFAULT_WORKFLOW]
    specificity = sc.get("specificity", "specific")
    missed      = sc.get("missed_cleavages", 2)
    min_len     = sc.get("min_len", 7)
    max_len     = sc.get("max_len", 30)
    enzyme_key  = sc.get("enzyme", "Trypsin/P")
    enzyme_name = _ANDROMEDA_ENZYME_MAP.get(enzyme_key, "Trypsin/P")

    if specificity == "non-specific":
        enzyme_mode = "Unspecific"
        enzyme_name = "Unspecific"
        num_termini = "0"
    elif specificity == "semi":
        enzyme_mode = "SemiSpecific"
        num_termini = "1"
    else:
        enzyme_mode = "Specific"
        num_termini = "2"

    # Fixed mods
    fixed_xml = ""
    for m in sc.get("fixed_mods", []):
        if "Carbamidomethyl" in m:
            fixed_xml += '    <string>Carbamidomethyl (C)</string>\n'
        elif "TMT6plex (K)" in m:
            fixed_xml += '    <string>TMT6plex (K)</string>\n'
        elif "TMT6plex (N-term)" in m:
            fixed_xml += '    <string>TMT6plex (N-term)</string>\n'

    # Variable mods
    var_xml = ""
    for m in sc.get("var_mods", []):
        mapped = _MQ_VAR_MODS.get(m)
        if mapped:
            var_xml += f'    <string>{mapped}</string>\n'

    # Andromeda standalone uses .apar XML format
    content = f"""\
<?xml version="1.0" encoding="utf-8"?>
<AndromedaParams>
  <fastaFile>{fasta_path.replace(chr(92), '/')}</fastaFile>
  <rawFile>{str(raw_path).replace(chr(92), '/')}</rawFile>
  <outputFolder>{str(output_dir).replace(chr(92), '/')}</outputFolder>
  <enzyme>{enzyme_name}</enzyme>
  <enzymeMode>{enzyme_mode}</enzymeMode>
  <numEnzymeTermini>{num_termini}</numEnzymeTermini>
  <maxMissedCleavages>{missed}</maxMissedCleavages>
  <minPeptideLen>{min_len}</minPeptideLen>
  <maxPeptideLen>{max_len}</maxPeptideLen>
  <precursorMassTolerancePpm>20</precursorMassTolerancePpm>
  <fragmentMassToleranceDa>0.02</fragmentMassToleranceDa>
  <maxModificationsPerPeptide>5</maxModificationsPerPeptide>
  <numThreads>{threads}</numThreads>
  <fixedModifications>
{fixed_xml}  </fixedModifications>
  <variableModifications>
{var_xml}  </variableModifications>
  <andromeda>
    <topX>12</topX>
    <deNovo>false</deNovo>
    <deNovoScoreThreshold>0</deNovoScoreThreshold>
    <ionSeries>b y</ionSeries>
  </andromeda>
</AndromedaParams>
"""
    apar_path = output_dir / "andromeda.apar"
    apar_path.write_text(content, encoding="utf-8")
    return apar_path


def _parse_andromeda_output(output_dir: Path) -> dict[str, int | None]:
    """Parse Andromeda standalone text output for PSM/peptide/protein counts."""
    # Andromeda standalone writes tab-delimited results to 'msms.txt' and 'evidence.txt'
    counts = {"n_psms": None, "n_peptides": None, "n_proteins": None}

    # Try msms.txt (PSM-level)
    msms = output_dir / "msms.txt"
    pep_file = output_dir / "peptides.txt"
    pg_file  = output_dir / "proteinGroups.txt"

    n_psms, peptides, proteins = 0, set(), set()

    if msms.exists():
        try:
            with open(msms, newline="", encoding="utf-8", errors="replace") as f:
                reader = csv.DictReader(f, delimiter="\t")
                for row in reader:
                    score = float(row.get("Score", 0) or 0)
                    if score > 0:
                        n_psms += 1
                        seq = row.get("Sequence", "").strip()
                        prot = row.get("Proteins", "").strip()
                        if seq:
                            peptides.add(seq)
                        if prot:
                            proteins.add(prot.split(";")[0].strip())
        except Exception:
            pass

    if pep_file.exists():
        try:
            with open(pep_file, newline="", encoding="utf-8", errors="replace") as f:
                reader = csv.DictReader(f, delimiter="\t")
                peptides_from_file: set[str] = set()
                for row in reader:
                    seq = row.get("Sequence", "").strip()
                    rev = row.get("Reverse", "").strip()
                    if seq and rev != "+":
                        peptides_from_file.add(seq)
                if peptides_from_file:
                    peptides = peptides_from_file
        except Exception:
            pass

    if pg_file.exists():
        try:
            with open(pg_file, newline="", encoding="utf-8", errors="replace") as f:
                reader = csv.DictReader(f, delimiter="\t")
                pg_from_file: set[str] = set()
                for row in reader:
                    rev  = row.get("Reverse", "").strip()
                    cont = row.get("Potential contaminant", "").strip()
                    if rev != "+" and cont != "+":
                        pg_from_file.add(row.get("Majority protein IDs", "").strip())
                if pg_from_file:
                    proteins = pg_from_file
        except Exception:
            pass

    if n_psms or peptides:
        counts["n_psms"]     = n_psms or None
        counts["n_peptides"] = len(peptides) or None
        counts["n_proteins"] = len(proteins) or None
    return counts


def _run_andromeda_thread(
    run_id: str,
    raw_path: Path,
    output_dir: Path,
    andromeda_exe: Path,
    fasta_path: str,
    threads: int,
    search_config: dict | None = None,
) -> None:
    """Background thread: run standalone Andromeda (or MaxQuantCmd fallback) and write results."""
    output_dir.mkdir(parents=True, exist_ok=True)
    _upsert_comparison(run_id, "andromeda", "running")

    # Detect whether we're using the MaxQuantCmd fallback (MaxQuant 1.x, no standalone Andromeda).
    # MaxQuant uses Andromeda internally so results are equivalent.
    using_maxquant_fallback = andromeda_exe.name.lower() == "maxquantcmd.exe"

    if using_maxquant_fallback:
        # ── MaxQuant fallback path ───────────────────────────────────────────
        logger.info("Andromeda (via MaxQuantCmd fallback) starting: %s", raw_path.name)
        mqpar_path = _write_maxquant_params(output_dir, raw_path, fasta_path, threads,
                                            search_config=search_config)
        log_path = output_dir / "andromeda_mq.log"
        cmd = [str(andromeda_exe), str(mqpar_path)]
        try:
            with open(log_path, "w") as lf:
                subprocess.run(
                    cmd, check=True, stdout=lf, stderr=subprocess.STDOUT,
                    text=True, timeout=14400, cwd=str(output_dir),
                )
        except subprocess.CalledProcessError as e:
            _upsert_comparison(run_id, "andromeda", "failed",
                               error_msg=f"exit {e.returncode} (via MaxQuantCmd)",
                               result_path=str(output_dir))
            logger.error("Andromeda/MaxQuantCmd failed (rc=%d): %s", e.returncode, raw_path.name)
            return
        except subprocess.TimeoutExpired:
            _upsert_comparison(run_id, "andromeda", "failed",
                               error_msg="timeout (4h)", result_path=str(output_dir))
            return
        except Exception as exc:
            _upsert_comparison(run_id, "andromeda", "failed", error_msg=str(exc))
            return
        stats = _parse_maxquant_output(output_dir)
        _upsert_comparison(run_id, "andromeda", "done", result_path=str(output_dir), **stats)
        logger.info("Andromeda/MaxQuant done: %s — PSMs=%s  pep=%s  pg=%s",
                    raw_path.name, stats["n_psms"], stats["n_peptides"], stats["n_proteins"])
        return

    # ── Standalone Andromeda.exe path ────────────────────────────────────────
    # Convert .d to mzML if needed (Andromeda prefers mzML/mzXML)
    input_path = raw_path
    if raw_path.suffix.lower() == ".d":
        if not _find_msconvert() and not _has_timsconvert():
            _upsert_comparison(run_id, "andromeda", "not_installed",
                               error_msg="msconvert or timsconvert required for .d files")
            return
        converted = _convert_d_to_mzml(raw_path, output_dir)
        if not converted:
            _upsert_comparison(run_id, "andromeda", "failed",
                               error_msg="mzML conversion failed")
            return
        input_path = converted

    apar_path = _write_andromeda_params(output_dir, input_path, fasta_path, threads,
                                         search_config=search_config)
    log_path = output_dir / "andromeda.log"
    cmd = [str(andromeda_exe), str(apar_path)]
    logger.info("Andromeda starting: %s", raw_path.name)

    try:
        with open(log_path, "w") as lf:
            subprocess.run(
                cmd, check=True, stdout=lf, stderr=subprocess.STDOUT,
                text=True, timeout=7200, cwd=str(output_dir),
            )
    except subprocess.CalledProcessError as e:
        _upsert_comparison(run_id, "andromeda", "failed",
                           error_msg=f"exit {e.returncode}", result_path=str(output_dir))
        logger.error("Andromeda failed (rc=%d): %s", e.returncode, raw_path.name)
        return
    except subprocess.TimeoutExpired:
        _upsert_comparison(run_id, "andromeda", "failed",
                           error_msg="timeout (2h)", result_path=str(output_dir))
        return
    except Exception as exc:
        _upsert_comparison(run_id, "andromeda", "failed", error_msg=str(exc))
        return

    stats = _parse_andromeda_output(output_dir)
    _upsert_comparison(run_id, "andromeda", "done", result_path=str(output_dir), **stats)
    logger.info("Andromeda done: %s — PSMs=%s  pep=%s  pg=%s",
                raw_path.name, stats["n_psms"], stats["n_peptides"], stats["n_proteins"])


# ── PrOLuCID ──────────────────────────────────────────────────────────────────
# Yates-lab Java-based search engine, part of IP2 (Integrated Proteomics Pipeline).
# Accepts .ms2 files; outputs .sqt.  Requires Java and a prolucid.jar.

_PROLUCID_SEARCH_PATHS: list[Path] = [
    # IP2 standard install
    Path("C:/IP2/ip2_binaries/bin/prolucid.jar"),
    Path("C:/IP2/bin/prolucid.jar"),
    Path("D:/IP2/ip2_binaries/bin/prolucid.jar"),
    Path("E:/IP2/ip2_binaries/bin/prolucid.jar"),
    # Standalone distribution
    Path("C:/prolucid/prolucid.jar"),
    Path("C:/tools/prolucid/prolucid.jar"),
    Path("D:/prolucid/prolucid.jar"),
    Path("E:/prolucid/prolucid.jar"),
    Path.home() / "prolucid/prolucid.jar",
    Path.home() / "Desktop/prolucid/prolucid.jar",
    # Windows native EXE variants
    Path("C:/prolucid/ProLuCID.exe"),
    Path("C:/IP2/ip2_binaries/bin/ProLuCID.exe"),
    Path("E:/tools/prolucid/ProLuCID.exe"),
]


def _find_prolucid() -> Path | None:
    """Return path to prolucid.jar or ProLuCID.exe, or None if not found."""
    for p in _PROLUCID_SEARCH_PATHS:
        if p.is_file():
            return p
    found = shutil.which("prolucid") or shutil.which("ProLuCID")
    if found:
        return Path(found)
    return None


def _find_java() -> Path | None:
    """Return path to java.exe for running JAR files."""
    # Try FragPipe JRE first (already known to work for MSFragger)
    fragpipe = _find_fragpipe()
    if fragpipe:
        java = fragpipe / "jre/bin/java.exe"
        if java.exists():
            return java
    # Try system Java
    found = shutil.which("java") or shutil.which("java.exe")
    if found:
        return Path(found)
    # Common install paths
    for candidate in [
        Path("C:/Program Files/Java/jre/bin/java.exe"),
        Path("C:/Program Files/Eclipse Adoptium/jre-17.0.0+35/bin/java.exe"),
        Path("C:/Program Files/Microsoft/jdk-17.0.0.35-hotspot/bin/java.exe"),
    ]:
        if candidate.exists():
            return candidate
    return None


# PrOLuCID enzyme → numeric code used in params XML
_PROLUCID_ENZYME_MAP: dict[str, int] = {
    "Trypsin/P":    1,
    "Trypsin":      1,
    "LysC":         7,
    "LysC/P":       7,
    "GluC":        15,
    "AspN":        11,
    "non-specific": 0,
}


def _write_prolucid_params(
    output_dir: Path,
    fasta_path: str,
    ms2_path: Path,
    threads: int,
    search_config: dict | None = None,
) -> Path:
    """Write PrOLuCID params.xml and return its path."""
    output_dir.mkdir(parents=True, exist_ok=True)

    sc = search_config or _WORKFLOW_PRESETS[_DEFAULT_WORKFLOW]
    specificity = sc.get("specificity", "specific")
    enzyme_key  = sc.get("enzyme", "Trypsin/P")
    enzyme_num  = _PROLUCID_ENZYME_MAP.get(enzyme_key, 1)
    missed      = sc.get("missed_cleavages", 2)
    min_len     = sc.get("min_len", 7)
    max_len     = sc.get("max_len", 30)

    # 0 = non-specific, 1 = semi, 2 = specific
    if specificity == "non-specific":
        num_termini = 0
        enzyme_num  = 0
    elif specificity == "semi":
        num_termini = 1
    else:
        num_termini = 2

    # Static modifications
    static_mods = ""
    for m in sc.get("fixed_mods", []):
        if "Carbamidomethyl" in m and "C" in m:
            static_mods += '  <staticModification residue="C" offset="57.021464"/>\n'
        elif "TMT6plex (K)" in m:
            static_mods += '  <staticModification residue="K" offset="229.162932"/>\n'
        elif "TMT6plex (N-term)" in m:
            static_mods += '  <staticModification residue="n" offset="229.162932"/>\n'

    # Dynamic modifications
    dyn_mods = ""
    for m in sc.get("var_mods", []):
        if "Oxidation (M)" in m:
            dyn_mods += '  <dynamicModification residue="M" offset="15.994915"/>\n'
        elif "Phospho (STY)" in m:
            dyn_mods += '  <dynamicModification residue="S" offset="79.966331"/>\n'
            dyn_mods += '  <dynamicModification residue="T" offset="79.966331"/>\n'
            dyn_mods += '  <dynamicModification residue="Y" offset="79.966331"/>\n'
        elif "Deamidation" in m:
            dyn_mods += '  <dynamicModification residue="N" offset="0.984016"/>\n'
            dyn_mods += '  <dynamicModification residue="Q" offset="0.984016"/>\n'
        elif "Acetyl (Protein N-term)" in m:
            dyn_mods += '  <dynamicModification residue="n" offset="42.010565"/>\n'

    output_sqt = output_dir / (ms2_path.stem + ".sqt")

    content = f"""\
<?xml version="1.0" encoding="UTF-8"?>
<ProLuCID_Params>
  <dbFilePath>{fasta_path.replace(chr(92), '/')}</dbFilePath>
  <ms2FilePath>{str(ms2_path).replace(chr(92), '/')}</ms2FilePath>
  <outputFilePath>{str(output_sqt).replace(chr(92), '/')}</outputFilePath>
  <useMonoIsoMass>true</useMonoIsoMass>
  <ESI_type>{enzyme_num}</ESI_type>
  <numOfMissedCleavageSite>{missed}</numOfMissedCleavageSite>
  <numEnzymeTermini>{num_termini}</numEnzymeTermini>
  <isotopeType>MONO</isotopeType>
  <precursorTolerance>15</precursorTolerance>
  <precursorToleranceUnit>ppm</precursorToleranceUnit>
  <fragmentTolerance>20</fragmentTolerance>
  <fragmentToleranceUnit>ppm</fragmentToleranceUnit>
  <XcorrCutoff>1.0</XcorrCutoff>
  <deltaCNcutoff>0.08</deltaCNcutoff>
  <minPeptideLen>{min_len}</minPeptideLen>
  <maxPeptideLen>{max_len}</maxPeptideLen>
  <maximumNumberOfDynamicModification>3</maximumNumberOfDynamicModification>
  <numProcessingThreads>{threads}</numProcessingThreads>
  <printDecoy>false</printDecoy>
  <checkShiftTerminal>true</checkShiftTerminal>
{static_mods}{dyn_mods}</ProLuCID_Params>
"""
    params_path = output_dir / "params.xml"
    params_path.write_text(content, encoding="utf-8")
    return params_path


def _convert_d_to_ms2(d_path: Path, output_dir: Path) -> Path | None:
    """Convert a Bruker .d directory to .ms2 format via msconvert.

    MS2 format is PrOLuCID's native input.  Falls back to mzXML if msconvert
    does not support --ms2 (older ProteoWizard versions).
    """
    ms2_path  = output_dir / (d_path.stem + ".ms2")
    mzxml_path = output_dir / (d_path.stem + ".mzXML")

    for p in (ms2_path, mzxml_path):
        if p.exists():
            return p

    output_dir.mkdir(parents=True, exist_ok=True)
    msconvert = _find_msconvert()
    if not msconvert:
        logger.debug("msconvert not found — cannot convert .d to ms2 for PrOLuCID")
        return None

    # Try MS2 format first (compact, PrOLuCID-native)
    log_path = output_dir / "msconvert_ms2.log"
    cmd = [
        str(msconvert), str(d_path),
        "--ms2",
        "--filter", "msLevel 2",
        "--filter", "zeroSamples removeExtra",
        "--outdir", str(output_dir),
    ]
    try:
        with open(log_path, "w") as lf:
            subprocess.run(cmd, check=True, stdout=lf, stderr=subprocess.STDOUT,
                           text=True, timeout=3600)
        if ms2_path.exists():
            return ms2_path
    except Exception:
        pass

    # Fallback: mzXML (PrOLuCID also accepts mzXML)
    log_path2 = output_dir / "msconvert_mzxml.log"
    cmd2 = [
        str(msconvert), str(d_path),
        "--mzXML",
        "--ddaProcessing",
        "--filter", "msLevel 2",
        "--filter", "zeroSamples removeExtra",
        "--zlib", "--32",
        "--outdir", str(output_dir),
    ]
    try:
        with open(log_path2, "w") as lf:
            subprocess.run(cmd2, check=True, stdout=lf, stderr=subprocess.STDOUT,
                           text=True, timeout=3600)
        found = list(output_dir.glob("*.mzXML"))
        return found[0] if found else None
    except Exception as exc:
        logger.warning("msconvert mzXML fallback failed: %s", exc)
        return None


def _parse_prolucid_sqt(output_dir: Path) -> dict[str, int | None]:
    """Parse PrOLuCID SQT output for PSM / peptide / protein counts.

    Filters PSMs at Xcorr thresholds appropriate for each charge state:
      +1: Xcorr > 1.5
      +2: Xcorr > 2.0
      +3+: Xcorr > 2.5

    SQT format rows:
      S  scan_start scan_end charge ... (spectrum header)
      M  rank ... xcorr deltaCN ... sequence (PSM match)
      L  locus (protein accession)
    """
    sqt_files = list(output_dir.glob("*.sqt"))
    if not sqt_files:
        return {"n_psms": None, "n_peptides": None, "n_proteins": None}

    # Xcorr cutoffs by charge
    xcorr_cut = {1: 1.5, 2: 2.0}   # default for z≥3: 2.5

    n_psms = 0
    peptides: set[str] = set()
    proteins: set[str] = set()

    for sqt_path in sqt_files:
        try:
            current_charge = 2
            current_xcorr  = 0.0
            current_seq    = ""
            current_prots: list[str] = []

            with open(sqt_path, encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    line = line.rstrip()
                    if not line:
                        continue
                    parts = line.split("\t")
                    tag = parts[0].strip()

                    if tag == "S":
                        # Flush previous PSM if it passed threshold
                        cut = xcorr_cut.get(current_charge, 2.5)
                        if current_seq and current_xcorr >= cut:
                            n_psms += 1
                            # Strip modifications: [mass] or *
                            clean = re.sub(r"\[[\d.+-]+\]|\*", "", current_seq).strip(".")
                            if clean:
                                peptides.add(clean)
                            for p in current_prots:
                                if p and not p.startswith("Reverse_") and not p.startswith("Rev_"):
                                    proteins.add(p.split(" ")[0])
                        # Reset for new spectrum
                        try:
                            current_charge = int(parts[3]) if len(parts) > 3 else 2
                        except (ValueError, IndexError):
                            current_charge = 2
                        current_xcorr  = 0.0
                        current_seq    = ""
                        current_prots  = []

                    elif tag == "M" and len(parts) >= 10:
                        rank = int(parts[1]) if parts[1].isdigit() else 99
                        if rank == 1:  # top-ranked match only
                            try:
                                current_xcorr = float(parts[5])
                                current_seq   = parts[9].strip()
                            except (ValueError, IndexError):
                                pass
                            current_prots = []

                    elif tag == "L" and len(parts) >= 2:
                        current_prots.append(parts[1].strip())

                # Flush last PSM
                cut = xcorr_cut.get(current_charge, 2.5)
                if current_seq and current_xcorr >= cut:
                    n_psms += 1
                    clean = re.sub(r"\[[\d.+-]+\]|\*", "", current_seq).strip(".")
                    if clean:
                        peptides.add(clean)
                    for p in current_prots:
                        if p and not p.startswith("Reverse_") and not p.startswith("Rev_"):
                            proteins.add(p.split(" ")[0])

        except Exception:
            logger.debug("_parse_prolucid_sqt error on %s", sqt_path, exc_info=True)

    return {
        "n_psms":     n_psms     or None,
        "n_peptides": len(peptides)  or None,
        "n_proteins": len(proteins)  or None,
    }


def _run_prolucid_thread(
    run_id: str,
    raw_path: Path,
    output_dir: Path,
    prolucid_jar: Path,
    fasta_path: str,
    threads: int,
    search_config: dict | None = None,
) -> None:
    """Background thread: convert if needed, run PrOLuCID, write results."""
    output_dir.mkdir(parents=True, exist_ok=True)
    _upsert_comparison(run_id, "prolucid", "running")

    # ── 1. Convert .d to MS2 / mzXML ─────────────────────────────────────────
    input_path = raw_path
    if raw_path.suffix.lower() == ".d" or raw_path.is_dir():
        if not _find_msconvert():
            _upsert_comparison(run_id, "prolucid", "not_installed",
                               error_msg="msconvert required for .d → ms2 conversion")
            return
        converted = _convert_d_to_ms2(raw_path, output_dir)
        if not converted:
            _upsert_comparison(run_id, "prolucid", "failed",
                               error_msg="Conversion to ms2/mzXML failed")
            return
        input_path = converted

    # ── 2. Write params ───────────────────────────────────────────────────────
    params_path = _write_prolucid_params(output_dir, fasta_path, input_path, threads,
                                         search_config=search_config)

    # ── 3. Build command ──────────────────────────────────────────────────────
    jar_suffix = prolucid_jar.suffix.lower()
    if jar_suffix == ".jar":
        java = _find_java()
        if not java:
            _upsert_comparison(run_id, "prolucid", "failed", error_msg="Java not found")
            return
        cmd = [str(java), "-Xmx8g", "-jar", str(prolucid_jar), str(params_path)]
    else:
        # Native EXE
        cmd = [str(prolucid_jar), str(params_path)]

    log_path = output_dir / "prolucid.log"
    logger.info("PrOLuCID starting: %s", raw_path.name)

    try:
        with open(log_path, "w") as lf:
            subprocess.run(
                cmd, check=True, stdout=lf, stderr=subprocess.STDOUT,
                text=True, timeout=7200, cwd=str(output_dir),
            )
    except subprocess.CalledProcessError as e:
        _upsert_comparison(run_id, "prolucid", "failed",
                           error_msg=f"exit {e.returncode}", result_path=str(output_dir))
        logger.error("PrOLuCID failed (rc=%d): %s", e.returncode, raw_path.name)
        return
    except subprocess.TimeoutExpired:
        _upsert_comparison(run_id, "prolucid", "failed",
                           error_msg="timeout (2h)", result_path=str(output_dir))
        return
    except Exception as exc:
        _upsert_comparison(run_id, "prolucid", "failed", error_msg=str(exc))
        return

    # ── 4. Parse SQT results ──────────────────────────────────────────────────
    stats = _parse_prolucid_sqt(output_dir)
    _upsert_comparison(run_id, "prolucid", "done", result_path=str(output_dir), **stats)
    logger.info("PrOLuCID done: %s — PSMs=%s  pep=%s  pg=%s",
                raw_path.name, stats["n_psms"], stats["n_peptides"], stats["n_proteins"])


# ── Chimerys (MSAID cloud platform — read locally cached parquet) ─────────────

def ingest_chimerys_results(run_id: str, parquet_path) -> bool:
    """Extract stats from a locally-cached Chimerys PSM parquet and write to DB.

    Called when a Chimerys parquet is available (either just downloaded via the
    MSAID platform connector, or found on disk by _resolve_chimerys_path).

    Returns True on success.  The comparison row is written with engine="chimerys".
    n_proteins is not available from PSM-level parquets — it is stored as None.
    """
    from pathlib import Path as _Path
    parquet_path = _Path(parquet_path)

    try:
        from stan.metrics.mobility_chimerys import get_peptide_stats_chimerys
        stats = get_peptide_stats_chimerys(parquet_path)
    except Exception as exc:
        logger.warning("ingest_chimerys_results: could not parse %s — %s", parquet_path, exc)
        _upsert_comparison(run_id, "chimerys", "failed", error_msg=str(exc)[:200])
        return False

    if not stats or not stats.get("n_psms"):
        _upsert_comparison(run_id, "chimerys", "failed",
                           error_msg="No PSMs in parquet after FDR filter")
        return False

    _upsert_comparison(
        run_id, "chimerys", "done",
        result_path=str(parquet_path),
        n_psms=stats.get("n_psms"),
        n_peptides=stats.get("n_unique_seqs"),
        n_proteins=None,
        n_precursors=None,
    )
    logger.info(
        "Chimerys ingested for %s — PSMs=%s  unique_peptides=%s",
        run_id, stats.get("n_psms"), stats.get("n_unique_seqs"),
    )
    return True
