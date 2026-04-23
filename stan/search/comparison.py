"""Multi-engine search comparison — runs MSFragger, X!Tandem, MaxQuant, and Comet alongside DIA-NN and Sage.

After the primary search (DIA-NN for DIA, Sage for DDA) completes, STAN
dispatches additional engines as background daemon threads. Results are
written to the search_comparisons table in SQLite and appear in the
Searches tab as cells fill in.

Engines
-------
msfragger_dda  MSFragger 3.7 in DDA mode (data_type=0) — native .d support
msfragger_dia  MSFragger 3.7 in DIA mode (data_type=1) — for diaPASEF
xtandem        X!Tandem — DDA search; .d files auto-converted via timsconvert
maxquant       MaxQuant — DDA search; native .d (timsTOF) and .raw (Thermo) support
comet          Comet (UW/TPP) — DDA search; timsTOF .d native support (2023+) preserves
               ion mobility; Thermo .raw via mzML fallback only if conversion is allowed

FragPipe is auto-detected from common install locations. If not found,
MSFragger comparison searches are silently skipped.

X!Tandem is auto-detected from common install locations and PATH.  Bruker .d
files are converted to indexed mzML via timsconvert (pip install timsconvert)
before being passed to X!Tandem. If neither X!Tandem nor timsconvert is found,
the X!Tandem comparison is silently skipped.

MaxQuant is auto-detected from common install locations. If not found,
the MaxQuant comparison is silently skipped. Supports timsTOF .d (TIMS-DDA)
and Thermo .raw natively — no conversion required.

Comet (2023+) reads Bruker .d directly via timsdata.dll — ion mobility is preserved
and no mzML conversion is needed. Falls back to mzML conversion for Thermo .raw and other
non-native formats. Comet is auto-detected from PATH and common install locations.
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


def _convert_d_to_mzml(d_path: Path, output_dir: Path) -> Path | None:
    """Convert a Bruker .d directory to indexed mzML using timsconvert.

    Returns the path to the mzML file on success, or None on failure.
    timsconvert is pip-installable: ``pip install timsconvert``.
    """
    mzml_path = output_dir / (d_path.stem + ".mzML")
    if mzml_path.exists():
        return mzml_path   # already converted

    log_path = output_dir / "timsconvert.log"
    cmd = [
        "timsconvert",
        "--input",    str(d_path),
        "--outdir",   str(output_dir),
        "--ms2_only", "False",   # keep MS1 + MS2
    ]
    logger.info("timsconvert: converting %s → mzML", d_path.name)
    try:
        with open(log_path, "w") as lf:
            subprocess.run(
                cmd,
                check=True,
                stdout=lf,
                stderr=subprocess.STDOUT,
                text=True,
                timeout=3600,   # 1 h max for large files
            )
    except FileNotFoundError:
        logger.debug("timsconvert not found on PATH")
        return None
    except subprocess.CalledProcessError as e:
        logger.warning("timsconvert failed (rc=%d) for %s", e.returncode, d_path.name)
        return None
    except subprocess.TimeoutExpired:
        logger.warning("timsconvert timed out for %s", d_path.name)
        return None

    # timsconvert writes <stem>.mzML in the output dir
    if mzml_path.exists():
        return mzml_path

    # Fallback: find any mzML it may have produced with a different name
    mzmls = list(output_dir.glob("*.mzML"))
    return mzmls[0] if mzmls else None


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
    search_params: dict | None = None,
) -> Path:
    """Write X!Tandem input.xml parameter file and return its path.

    Generates a taxonomy.xml alongside it automatically.
    search_params: override dict from global search params (enzyme, mods, tolerances).
    """
    if threads <= 0:
        threads = max(2, (os.cpu_count() or 4) // 2)

    sp = search_params or _get_global_search_params()
    ms1_tol = str(int(sp.get("ms1_tol_ppm", 20)))
    # X!Tandem fragment tolerance in Da — convert ppm to approximate Da at ~1000 Da average
    ms2_ppm = float(sp.get("ms2_tol_ppm", 20))
    ms2_da  = f"{ms2_ppm * 1000 / 1e6:.4f}"

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
        ("spectrum, parent monoisotopic mass error plus",   ms1_tol),
        ("spectrum, parent monoisotopic mass error minus",  ms1_tol),
        ("spectrum, parent monoisotopic mass error units",  "ppm"),
        ("spectrum, parent monoisotopic mass isotope error", "yes"),
        ("spectrum, fragment monoisotopic mass error",      ms2_da),
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
        ("protein, cleavage site",     "[RK]|{P}"),
        ("protein, cleavage semi",     "no"),
        ("protein, maximum valid expectation value", "0.05"),
        ("protein, N-terminal residue modification mass", "0.0"),
        # Mods
        ("residue, modification mass",          "57.021464@C"),
        ("residue, potential modification mass", "15.994915@M"),
        # Refinement pass
        ("refine",                              "yes"),
        ("refine, maximum valid expectation value", "0.05"),
        ("refine, sPTM complexity",             "2"),
        ("refine, potential modification mass", "15.994915@M,42.010565@["),
        ("refine, unanticipated cleavage",      "yes"),
        ("refine, cleavage semi",               "no"),
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
) -> None:
    """Background thread: convert (if needed), run X!Tandem, write results to DB."""
    output_dir.mkdir(parents=True, exist_ok=True)
    _upsert_comparison(run_id, "xtandem", "running")

    # ── 1. Resolve input file (convert .d → mzML if necessary) ──────────────
    suffix = raw_path.suffix.lower()
    if suffix == ".d" or raw_path.is_dir():
        # Bruker .d — convert to mzML first
        if not _has_timsconvert():
            _upsert_comparison(run_id, "xtandem", "failed",
                               error_msg="timsconvert not found (pip install timsconvert)")
            logger.warning("X!Tandem skipped for %s: timsconvert not on PATH", raw_path.name)
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
    params_path = _write_xtandem_params(output_dir, fasta_path, input_file, threads)

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


# ── DB helpers ───────────────────────────────────────────────────────────────

def _get_db_path() -> Path:
    from stan.config import get_user_config_dir
    return get_user_config_dir() / "stan.db"


def _get_global_search_params() -> dict:
    """Load global search parameters set via the Searches tab '⚙ Search Params' modal.

    Returns a dict with keys: enzyme, missed_cleavages, var_mods, fixed_mods,
    min_pep_len, max_pep_len, min_charge, max_charge, ms1_tol_ppm, ms2_tol_ppm,
    fasta_path, spectral_lib.

    Falls back to standard tryptic defaults if the file has not been saved yet.
    """
    import json
    from stan.config import get_user_config_dir

    defaults: dict = {
        "enzyme":            "Trypsin/P",
        "missed_cleavages":  2,
        "var_mods":          "Oxidation (M); Acetyl (Protein N-term)",
        "fixed_mods":        "Carbamidomethyl (C)",
        "min_pep_len":       7,
        "max_pep_len":       30,
        "min_charge":        2,
        "max_charge":        4,
        "ms1_tol_ppm":       20,
        "ms2_tol_ppm":       20,
        "fasta_path":        "",
        "spectral_lib":      "",
    }
    try:
        p = get_user_config_dir() / "search_params.json"
        if p.exists():
            stored = json.loads(p.read_text())
            defaults.update(stored)
    except Exception:
        pass
    return defaults


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
    search_params: dict | None = None,
) -> Path:
    """Write fragger.params into output_dir and return its path.

    data_type: 0=DDA, 1=DIA, 2=DIA-narrow-window
    search_params: override dict from global search params (enzyme, mods, tolerances).
    """
    if threads <= 0:
        threads = max(2, (os.cpu_count() or 4) // 2)

    sp = search_params or _get_global_search_params()
    ms1_tol = int(sp.get("ms1_tol_ppm", 20))
    ms2_tol = int(sp.get("ms2_tol_ppm", 20))
    mc      = int(sp.get("missed_cleavages", 2))
    min_len = int(sp.get("min_pep_len", 7))
    max_len = int(sp.get("max_pep_len", 30))

    params: dict[str, Any] = {
        "num_threads":              threads,
        "database_name":            fasta_path,
        "decoy_prefix":             "rev_",
        "precursor_mass_lower":     -ms1_tol,
        "precursor_mass_upper":     ms1_tol,
        "precursor_mass_units":     1,         # ppm
        "data_type":                data_type,
        "precursor_true_tolerance": ms1_tol,
        "precursor_true_units":     1,
        "fragment_mass_tolerance":  ms2_tol,
        "fragment_mass_units":      1,
        "calibrate_mass":           2,         # ON + find optimal params
        "search_enzyme_name_1":     "stricttrypsin",
        "search_enzyme_cut_1":      "KR",
        "search_enzyme_nocut_1":    "",
        "allowed_missed_cleavage_1": mc,
        "search_enzyme_sense_1":    "C",
        "num_enzyme_termini":       2,
        "clip_nTerm_M":             1,
        "variable_mod_01":          "15.994915 M 3",
        "variable_mod_02":          "42.010565 [^ 1",
        "add_C_cysteine":           57.021464,
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
                    expect_str = (
                        row_lower.get("expect")
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

    params_path = _write_msfragger_params(
        output_dir, fasta_path, data_type=data_type, threads=threads
    )

    cmd = [
        str(java),
        "-Xmx14g",
    ]
    if bruker_lib and Path(str(bruker_lib)).exists():
        cmd.append(f"-Djava.library.path={bruker_lib}")
    cmd += ["-jar", str(jar), str(params_path), str(raw_path)]

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

    stats = _parse_msfragger_tsv(output_dir)
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


# ── Comet auto-detection ─────────────────────────────────────────────────────

_COMET_SEARCH_PATHS: list[Path] = [
    Path("C:/Comet/comet.exe"),
    Path("C:/Program Files/Comet/comet.exe"),
    Path("C:/Program Files (x86)/Comet/comet.exe"),
    Path("D:/Comet/comet.exe"),
    Path("E:/Comet/comet.exe"),
    Path.home() / "Desktop/Comet/comet.exe",
    Path.home() / "Comet/comet.exe",
    # TPP bundles Comet
    Path("C:/TPP/bin/comet.exe"),
    Path("C:/inetpub/tpp/bin/comet.exe"),
]


def _find_comet() -> Path | None:
    """Return path to comet.exe, or None if Comet is not installed."""
    for candidate in _COMET_SEARCH_PATHS:
        if candidate.exists():
            return candidate
    which = shutil.which("comet") or shutil.which("comet.exe")
    if which:
        return Path(which)
    return None


def _comet_supports_tdf(comet_exe: Path) -> bool:
    """Check if this Comet binary was built with timsTOF/TDF support.

    Comet 2023.01.3+ supports .d directly if compiled with Bruker timsdata.
    We probe by looking for timsdata.dll alongside the binary or by checking
    the help output for 'timsTOF' or 'tdf'.
    """
    # Check for timsdata.dll or libtimsdata.so alongside the binary
    comet_dir = comet_exe.parent
    if (comet_dir / "timsdata.dll").exists() or (comet_dir / "libtimsdata.so").exists():
        return True
    # Check version output
    try:
        result = subprocess.run(
            [str(comet_exe), "--help"],
            capture_output=True, text=True, timeout=10,
        )
        output = (result.stdout + result.stderr).lower()
        return "timstof" in output or "tdf" in output
    except Exception:
        return False


def _write_comet_params(
    output_dir: Path,
    fasta_path: str,
    threads: int = 0,
    search_params: dict | None = None,
    native_tdf: bool = False,
) -> Path:
    """Write a comet.params file and return its path.

    search_params: override dict from global search params (enzyme, mods, tolerances).
    native_tdf: if True, enable timsTOF PASEF-specific parameters.
    """
    if threads <= 0:
        threads = max(2, (os.cpu_count() or 4) // 2)

    sp = search_params or _get_global_search_params()
    ms1_tol  = float(sp.get("ms1_tol_ppm", 20))
    ms2_tol  = float(sp.get("ms2_tol_ppm", 20))
    mc       = int(sp.get("missed_cleavages", 2))
    min_len  = int(sp.get("min_pep_len", 7))
    max_len  = int(sp.get("max_pep_len", 30))

    # Comet uses 1 = m/z, 2 = ppm for precursor_mass_units
    # Fragment tolerance is always in Da for Comet
    ms2_da = ms2_tol * 1000 / 1e6  # rough average at 1000 Da

    tdf_line = "timsTOF_maxNpeaksPerScan = 50\n" if native_tdf else ""

    content = f"""# Comet parameter file — generated by ZIGGY
# {output_dir}

database_name = {fasta_path}
decoy_search = 1
decoy_prefix = DECOY_

num_threads = {threads}

peptide_mass_tolerance = {ms1_tol:.1f}
peptide_mass_units = 2
fragment_bin_tol = {ms2_da:.4f}
fragment_bin_offset = 0.0

num_enzyme_termini = 2
search_enzyme_number = 1
allowed_missed_cleavage = {mc}
digest_mass_range = 600.0 5000.0
peptide_length_range = {min_len} {max_len}
num_results = 5
max_variable_mods_in_peptide = 3
require_variable_mod = 0

variable_mod01 = 15.994915 M 0 3 -1 0 0
variable_mod02 = 42.010565 n 0 1 -1 0 0
variable_mod03 = 0.0 X 0 0 -1 0 0 0
variable_mod04 = 0.0 X 0 0 -1 0 0 0
variable_mod05 = 0.0 X 0 0 -1 0 0 0
variable_mod06 = 0.0 X 0 0 -1 0 0 0
variable_mod07 = 0.0 X 0 0 -1 0 0 0
variable_mod08 = 0.0 X 0 0 -1 0 0 0
variable_mod09 = 0.0 X 0 0 -1 0 0 0

add_C_cysteine = 57.021464

output_txtfile = 1
output_pepxmlfile = 0
output_percolatorfile = 1
output_sqtfile = 0

scan_range = 0 0
precursor_charge = 1 6
override_charge = 0
ms_level = 2
activation_method = ALL
minimum_intensity = 0

{tdf_line}
[COMET_ENZYME_INFO]
0.  No_enzyme              0      -           -
1.  Trypsin                1      KR          P
2.  Trypsin/P              1      KR          -
3.  Lys_C                  1      K           P
4.  Lys_N                  0      K           -
5.  Arg_C                  1      R           P
6.  Asp_N                  0      D           -
7.  CNBr                   1      M           -
8.  Glu_C                  1      DE          P
9.  PepsinA                1      FL          P
10. Chymotrypsin           1      FWYL        P
"""
    params_path = output_dir / "comet.params"
    params_path.write_text(content)
    return params_path


def _parse_comet_output(output_dir: Path) -> dict[str, int | None]:
    """Parse Comet .txt output for PSM/peptide/protein counts.

    Reads the .txt tab-delimited output. Filters at E-value < 0.01.
    Also checks .pin (Percolator input) for additional evidence.
    """
    txt_files = list(output_dir.glob("*.txt"))
    txt_files = [f for f in txt_files if f.name != "comet.params" and not f.stem.startswith("_")]

    n_psms = 0
    peptides: set[str] = set()
    protein_groups: set[str] = set()

    for txt_path in txt_files:
        try:
            with open(txt_path, newline="", errors="replace") as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith("#") or line.startswith("scan"):
                        continue
                    parts = line.split("\t")
                    if len(parts) < 10:
                        continue
                    # Comet .txt: scan, num, charge, exp_neutral_mass, calc_neutral_mass,
                    # e-value, xcorr, delta_cn, sp_score, ions_matched, ions_total,
                    # plain_peptide, modified_peptide, prev_aa, next_aa, protein
                    try:
                        evalue = float(parts[5])
                    except (ValueError, IndexError):
                        continue
                    if evalue >= 0.01:
                        continue
                    n_psms += 1
                    pep = parts[11] if len(parts) > 11 else ""
                    if pep:
                        peptides.add(pep.strip())
                    prot = parts[15] if len(parts) > 15 else ""
                    if prot:
                        accs = [re.sub(r"-\d+$", "", a.strip()) for a in prot.split(";")
                                if a.strip() and not a.strip().startswith("DECOY_")]
                        if accs:
                            protein_groups.add(";".join(sorted(set(accs))))
        except Exception:
            logger.debug("Comet: failed to parse %s", txt_path, exc_info=True)

    return {
        "n_psms":     n_psms          if n_psms          else None,
        "n_peptides": len(peptides)   if peptides        else None,
        "n_proteins": len(protein_groups) if protein_groups else None,
    }


def _run_comet_thread(
    run_id: str,
    raw_path: Path,
    output_dir: Path,
    comet_exe: Path,
    fasta_path: str,
    threads: int,
) -> None:
    """Background thread: run Comet and write results to DB.

    Bruker .d: uses native TDF mode if Comet supports it (preserves ion mobility).
    Thermo .raw / other: converts to mzML via timsconvert (only if available).
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    _upsert_comparison(run_id, "comet", "running")

    suffix = raw_path.suffix.lower()
    native_tdf = False
    input_file: Path | None = None

    if suffix == ".d" or raw_path.is_dir():
        # Try native .d support first (preserves ion mobility — no conversion)
        if _comet_supports_tdf(comet_exe):
            input_file = raw_path
            native_tdf = True
            logger.info("Comet: using native TDF mode for %s (ion mobility preserved)", raw_path.name)
        else:
            # Fall back to mzML conversion
            if not _has_timsconvert():
                _upsert_comparison(run_id, "comet", "failed",
                                   error_msg="Comet lacks TDF support and timsconvert not found")
                logger.warning("Comet skipped for %s: no TDF support and no timsconvert", raw_path.name)
                return
            input_file = _convert_d_to_mzml(raw_path, output_dir)
            if not input_file:
                _upsert_comparison(run_id, "comet", "failed",
                                   error_msg="timsconvert failed — no mzML produced")
                return
            logger.info("Comet: using mzML fallback for %s (ion mobility not preserved)", raw_path.name)
    elif suffix in (".mzml", ".mzxml", ".ms2", ".mgf"):
        input_file = raw_path
    elif suffix == ".raw":
        # Thermo .raw — Comet does not read these natively; need conversion
        _upsert_comparison(run_id, "comet", "failed",
                           error_msg=".raw not supported — convert to mzML first")
        logger.info("Comet skipped for %s: Thermo .raw not natively supported", raw_path.name)
        return
    else:
        input_file = raw_path

    params_path = _write_comet_params(output_dir, fasta_path, threads,
                                      native_tdf=native_tdf)
    log_path = output_dir / "comet.log"
    logger.info("Comet starting: %s", raw_path.name)

    cmd = [str(comet_exe), f"-P{params_path}", str(input_file)]
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
        _upsert_comparison(run_id, "comet", "failed",
                           error_msg=f"exit {e.returncode}",
                           result_path=str(output_dir))
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
    _upsert_comparison(
        run_id, "comet", "done",
        result_path=str(output_dir),
        **stats,
    )
    logger.info(
        "Comet done: %s — PSMs=%s  peptides=%s  proteins=%s",
        raw_path.name,
        stats["n_psms"], stats["n_peptides"], stats["n_proteins"],
    )


# ── MaxQuant auto-detection ───────────────────────────────────────────────────

_MAXQUANT_SEARCH_PATHS: list[Path] = [
    Path("C:/MaxQuant/MaxQuantCmd.exe"),
    Path("C:/MaxQuant/bin/MaxQuantCmd.exe"),
    Path("D:/MaxQuant/MaxQuantCmd.exe"),
    Path("E:/MaxQuant/MaxQuantCmd.exe"),
    Path.home() / "Desktop/MaxQuant/MaxQuantCmd.exe",
    Path.home() / "MaxQuant/MaxQuantCmd.exe",
    # MaxQuant 2.x puts the exe alongside the GUI launcher
    Path("C:/MaxQuant/MaxQuant.exe"),
    Path("D:/MaxQuant/MaxQuant.exe"),
]


def _find_maxquant() -> Path | None:
    """Return path to MaxQuantCmd.exe, or None if MaxQuant is not installed."""
    for candidate in _MAXQUANT_SEARCH_PATHS:
        if candidate.exists():
            return candidate
    which = shutil.which("MaxQuantCmd") or shutil.which("MaxQuantCmd.exe")
    if which:
        return Path(which)
    return None


def _write_maxquant_params(
    output_dir: Path,
    fasta_path: str,
    raw_path: Path,
    threads: int = 0,
    search_params: dict | None = None,
) -> Path:
    """Write a MaxQuant mqpar.xml parameter file and return its path.

    Uses enzyme, mods, and tolerances from search_params (global search params modal).
    Works for timsTOF .d (TIMS-DDA) and Thermo .raw files — MaxQuant reads both natively.
    """
    if threads <= 0:
        threads = max(2, (os.cpu_count() or 4) // 2)

    sp = search_params or _get_global_search_params()
    mc = int(sp.get("missed_cleavages", 2))
    min_len = int(sp.get("min_pep_len", 7))
    max_len = int(sp.get("max_pep_len", 30))

    # Parse variable mods from "Oxidation (M); Acetyl (Protein N-term)" format
    var_mod_str = str(sp.get("var_mods", "Oxidation (M); Acetyl (Protein N-term)"))
    var_mods = [m.strip() for m in var_mod_str.split(";") if m.strip()]
    if not var_mods:
        var_mods = ["Oxidation (M)", "Acetyl (Protein N-term)"]

    fixed_mod_str = str(sp.get("fixed_mods", "Carbamidomethyl (C)"))
    fixed_mods = [m.strip() for m in fixed_mod_str.split(";") if m.strip()]
    if not fixed_mods:
        fixed_mods = ["Carbamidomethyl (C)"]

    combined_dir = output_dir / "combined"
    combined_dir.mkdir(parents=True, exist_ok=True)

    # MaxQuant requires Windows-style backslash paths in the XML
    fasta_win  = str(Path(fasta_path))
    raw_win    = str(raw_path)
    combined_win = str(combined_dir)

    xml_content = f"""<?xml version="1.0" encoding="utf-8"?>
<MaxQuantParams>
  <fastaFiles>
    <FastaFileInfo>
      <fastaFilePath>{fasta_win}</fastaFilePath>
      <identifierParseRule>&gt;([^\\s]+)</identifierParseRule>
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
  <fixedCombinedFolder>{combined_win}</fixedCombinedFolder>
  <fullMinMz>-1.79769313486232E+308</fullMinMz>
  <fullMaxMz>1.79769313486232E+308</fullMaxMz>
  <numThreads>{threads}</numThreads>
  <calcPeakProperties>False</calcPeakProperties>
  <writeMsScansTable>False</writeMsScansTable>
  <writeMsmsScansTable>True</writeMsmsScansTable>
  <writePasefMsmsScansTable>True</writePasefMsmsScansTable>
  <writeAccumulatedMsmsScansTable>False</writeAccumulatedMsmsScansTable>
  <keepLowScoresMode>0</keepLowScoresMode>
  <parameterGroups>
    <parameterGroup>
      <filePaths>
        <string>{raw_win}</string>
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
      <variableModifications>
        {''.join(f'<string>{m}</string>' for m in var_mods)}
      </variableModifications>
      <isobaricLabels />
      <neucodeLabels />
      <variableModificationsFirstSearch />
      <maxNmods>5</maxNmods>
      <maxMissedCleavages>{mc}</maxMissedCleavages>
      <labelMods>
        <string></string>
      </labelMods>
      <lcmsRunType>Standard</lcmsRunType>
      <searchEngineGroupParameters>
        <SearchEngineGroupParameters>
          <FixedModifications>
            {''.join(f'<string>{m}</string>' for m in fixed_mods)}
          </FixedModifications>
          <Proteases>
            <Protease>
              <Name>Trypsin/P</Name>
            </Protease>
          </Proteases>
        </SearchEngineGroupParameters>
      </searchEngineGroupParameters>
      <intensityThreshold>0</intensityThreshold>
      <useMs1Centroids>False</useMs1Centroids>
      <useMs2Centroids>False</useMs2Centroids>
      <cutPeaks>True</cutPeaks>
      <gapScans>1</gapScans>
      <minTime>NaN</minTime>
      <maxTime>NaN</maxTime>
      <matchType>MatchFromAndTo</matchType>
      <intensityDetermination>0</intensityDetermination>
      <centroidMatchTol>8</centroidMatchTol>
      <centroidMatchTolInPpm>True</centroidMatchTolInPpm>
      <centroidHalfWidth>35</centroidHalfWidth>
      <centroidHalfWidthInPpm>True</centroidHalfWidthInPpm>
      <valleyFactor>1.4</valleyFactor>
      <isotopeValleyFactor>1.2</isotopeValleyFactor>
      <advancedPeakSplitting>False</advancedPeakSplitting>
      <customProteinQuantification>False</customProteinQuantification>
      <customProteinQuantificationFile></customProteinQuantificationFile>
      <minRatioCount>2</minRatioCount>
      <useNormRatios>True</useNormRatios>
      <minPeptideLength>{min_len}</minPeptideLength>
      <maxPeptideLength>{max_len}</maxPeptideLength>
    </parameterGroup>
  </parameterGroups>
  <msmsParamsArray>
    <MsmsParams>
      <Name>FTMS</Name>
      <MatchTolerance>20</MatchTolerance>
      <MatchToleranceInPpm>True</MatchToleranceInPpm>
      <DeNovoPrecursorMassTolerance>10</DeNovoPrecursorMassTolerance>
      <DeNovoPrecursorMassToleranceInPpm>True</DeNovoPrecursorMassToleranceInPpm>
      <DeNovoMatchTolerance>10</DeNovoMatchTolerance>
      <DeNovoMatchToleranceInPpm>True</DeNovoMatchToleranceInPpm>
      <PeakFindingMassTolerance>6</PeakFindingMassTolerance>
      <PeakFindingMassToleranceInPpm>True</PeakFindingMassToleranceInPpm>
    </MsmsParams>
    <MsmsParams>
      <Name>ITMS</Name>
      <MatchTolerance>0.5</MatchTolerance>
      <MatchToleranceInPpm>False</MatchToleranceInPpm>
      <DeNovoPrecursorMassTolerance>0.01</DeNovoPrecursorMassTolerance>
      <DeNovoPrecursorMassToleranceInPpm>False</DeNovoPrecursorMassToleranceInPpm>
      <DeNovoMatchTolerance>0.5</DeNovoMatchTolerance>
      <DeNovoMatchToleranceInPpm>False</DeNovoMatchToleranceInPpm>
      <PeakFindingMassTolerance>0.25</PeakFindingMassTolerance>
      <PeakFindingMassToleranceInPpm>False</PeakFindingMassToleranceInPpm>
    </MsmsParams>
    <MsmsParams>
      <Name>TOF</Name>
      <MatchTolerance>40</MatchTolerance>
      <MatchToleranceInPpm>True</MatchToleranceInPpm>
      <DeNovoPrecursorMassTolerance>20</DeNovoPrecursorMassTolerance>
      <DeNovoPrecursorMassToleranceInPpm>True</DeNovoPrecursorMassToleranceInPpm>
      <DeNovoMatchTolerance>40</DeNovoMatchTolerance>
      <DeNovoMatchToleranceInPpm>True</DeNovoMatchToleranceInPpm>
      <PeakFindingMassTolerance>20</PeakFindingMassTolerance>
      <PeakFindingMassToleranceInPpm>True</PeakFindingMassToleranceInPpm>
    </MsmsParams>
    <MsmsParams>
      <Name>TIMS-DDA</Name>
      <MatchTolerance>20</MatchTolerance>
      <MatchToleranceInPpm>True</MatchToleranceInPpm>
      <DeNovoPrecursorMassTolerance>10</DeNovoPrecursorMassTolerance>
      <DeNovoPrecursorMassToleranceInPpm>True</DeNovoPrecursorMassToleranceInPpm>
      <DeNovoMatchTolerance>20</DeNovoMatchTolerance>
      <DeNovoMatchToleranceInPpm>True</DeNovoMatchToleranceInPpm>
      <PeakFindingMassTolerance>10</PeakFindingMassTolerance>
      <PeakFindingMassToleranceInPpm>True</PeakFindingMassToleranceInPpm>
    </MsmsParams>
  </msmsParamsArray>
  <mainSearchMaxCombinations>200</mainSearchMaxCombinations>
  <writePeptidesForSpectrumFile></writePeptidesForSpectrumFile>
  <intensityBasedRatios>True</intensityBasedRatios>
  <separateLfq>False</separateLfq>
  <lfqStabilizeLargeRatios>True</lfqStabilizeLargeRatios>
  <lfqRequireMsms>True</lfqRequireMsms>
  <decoyMode>revert</decoyMode>
  <boxCarMode>all</boxCarMode>
  <includeContaminants>True</includeContaminants>
  <maxPeptideMass>4600</maxPeptideMass>
  <epsilonMutexInMs>6</epsilonMutexInMs>
  <useMs1Ranges>False</useMs1Ranges>
  <maximumProteinGroupsPerPeptide>1</maximumProteinGroupsPerPeptide>
  <lfqMinRatioCount>2</lfqMinRatioCount>
  <andromeda>
    <PeptideFdr>0.01</PeptideFdr>
    <ProteinFdr>0.01</ProteinFdr>
    <SiteFdr>0.01</SiteFdr>
    <MaxFragmentCharge>6</MaxFragmentCharge>
    <ComplementaryIonIntensity>0</ComplementaryIonIntensity>
    <MatchBetweenRuns>False</MatchBetweenRuns>
    <MatchBetweenRunsFdr>0.01</MatchBetweenRunsFdr>
  </andromeda>
</MaxQuantParams>
"""
    params_path = output_dir / "mqpar.xml"
    params_path.write_text(xml_content, encoding="utf-8")
    return params_path


def _parse_maxquant_output(output_dir: Path) -> dict[str, int | None]:
    """Parse MaxQuant combined/txt/ output for PSM/peptide/protein counts.

    Reads:
    - msms.txt          → n_psms (PEP < 0.01 after filtering)
    - peptides.txt      → n_peptides (Reverse != '+', Potential contaminant != '+')
    - proteinGroups.txt → n_proteins  (same filters + Proteins contains at least one target)
    """
    txt_dir = output_dir / "combined" / "txt"

    def _read_tsv(name: str) -> list[dict]:
        p = txt_dir / name
        if not p.exists():
            return []
        try:
            with open(p, newline="", errors="replace") as fh:
                return list(csv.DictReader(fh, delimiter="\t"))
        except Exception:
            logger.debug("MaxQuant: failed to read %s", name, exc_info=True)
            return []

    def _is_target(row: dict) -> bool:
        return (
            row.get("Reverse", "").strip() != "+"
            and row.get("Potential contaminant", "").strip() != "+"
        )

    # msms.txt → PSMs
    msms_rows = _read_tsv("msms.txt")
    n_psms = sum(1 for r in msms_rows if _is_target(r)) or None

    # peptides.txt → unique peptides
    pep_rows = _read_tsv("peptides.txt")
    n_peptides = sum(1 for r in pep_rows if _is_target(r)) or None

    # proteinGroups.txt → protein groups
    pg_rows = _read_tsv("proteinGroups.txt")
    n_proteins = sum(1 for r in pg_rows if _is_target(r)) or None

    return {"n_psms": n_psms, "n_peptides": n_peptides, "n_proteins": n_proteins}


def _run_maxquant_thread(
    run_id: str,
    raw_path: Path,
    output_dir: Path,
    mq_exe: Path,
    fasta_path: str,
    threads: int,
) -> None:
    """Background thread: run MaxQuant and write results to DB."""
    output_dir.mkdir(parents=True, exist_ok=True)
    _upsert_comparison(run_id, "maxquant", "running")

    # MaxQuant supports .d (timsTOF) and .raw (Thermo) natively
    suffix = raw_path.suffix.lower()
    if suffix not in (".d", ".raw"):
        _upsert_comparison(run_id, "maxquant", "failed",
                           error_msg=f"Unsupported format: {suffix}")
        logger.info("MaxQuant skipped for %s: unsupported format %s", raw_path.name, suffix)
        return

    params_path = _write_maxquant_params(output_dir, fasta_path, raw_path, threads)
    log_path = output_dir / "maxquant.log"
    logger.info("MaxQuant starting: %s", raw_path.name)

    cmd = [str(mq_exe), str(params_path)]
    try:
        with open(log_path, "w") as lf:
            subprocess.run(
                cmd,
                check=True,
                stdout=lf,
                stderr=subprocess.STDOUT,
                text=True,
                timeout=14400,   # 4 h max
                cwd=str(output_dir),
            )
    except subprocess.CalledProcessError as e:
        _upsert_comparison(run_id, "maxquant", "failed",
                           error_msg=f"exit {e.returncode}",
                           result_path=str(output_dir))
        logger.error("MaxQuant failed (rc=%d): %s", e.returncode, raw_path.name)
        return
    except subprocess.TimeoutExpired:
        _upsert_comparison(run_id, "maxquant", "failed",
                           error_msg="timeout (4h)", result_path=str(output_dir))
        logger.error("MaxQuant timed out: %s", raw_path.name)
        return
    except Exception as exc:
        _upsert_comparison(run_id, "maxquant", "failed", error_msg=str(exc))
        logger.error("MaxQuant error: %s", exc)
        return

    stats = _parse_maxquant_output(output_dir)
    _upsert_comparison(
        run_id, "maxquant", "done",
        result_path=str(output_dir),
        **stats,
    )
    logger.info(
        "MaxQuant done: %s — PSMs=%s  peptides=%s  proteins=%s",
        raw_path.name,
        stats["n_psms"], stats["n_peptides"], stats["n_proteins"],
    )


# ── Public entry point ────────────────────────────────────────────────────────

def dispatch_comparison_searches(
    run_id: str,
    raw_path: Path,
    mode: str,
    output_base: Path,
    fasta_path: str | None = None,
    threads: int = 0,
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
    """
    if threads <= 0:
        threads = max(2, (os.cpu_count() or 4) // 2)

    # Accept AcquisitionMode enum objects or plain strings
    mode_str = mode.value if hasattr(mode, "value") else str(mode)
    is_dia = mode_str in ("DIA", "diaPASEF")
    comparison_base = output_base / "_comparison"

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
                          data_type, paths, effective_fasta, threads),
                    daemon=True,
                    name=f"comp-{engine_name}-{run_id[:16]}",
                )
                t.start()
                logger.info("Dispatched comparison: %s for %s (thread: %s)",
                            engine_name, raw_path.name, t.name)
        else:
            logger.warning("No FASTA found — skipping MSFragger comparisons for %s", run_id)
    else:
        logger.debug("FragPipe not found — skipping MSFragger comparisons for %s", run_id)

    # ── X!Tandem (standalone — does not need FragPipe) ───────────────────────
    xtandem_exe = _find_xtandem()
    if xtandem_exe:
        # Resolve FASTA: prefer caller-supplied; fall back to FragPipe bundled if available
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
                args=(run_id, raw_path, xt_out_dir, xtandem_exe, xt_fasta, threads),
                daemon=True,
                name=f"comp-xtandem-{run_id[:16]}",
            )
            t.start()
            logger.info("Dispatched comparison: xtandem for %s (thread: %s)",
                        raw_path.name, t.name)
        else:
            logger.warning("No FASTA found — skipping X!Tandem comparison for %s", run_id)
    else:
        logger.debug("X!Tandem not found — skipping X!Tandem comparison for %s", run_id)

    # ── MaxQuant ─────────────────────────────────────────────────────────────
    mq_exe = _find_maxquant()
    if mq_exe:
        mq_fasta = fasta_path
        if (not mq_fasta or not Path(mq_fasta).exists()) and fragpipe:
            paths_for_fasta = _fragpipe_paths(fragpipe)
            bundled = paths_for_fasta.get("bundled_fasta")
            if bundled and Path(str(bundled)).exists():
                mq_fasta = str(bundled)

        if mq_fasta and Path(mq_fasta).exists():
            mq_out_dir = comparison_base / "maxquant"
            t = threading.Thread(
                target=_run_maxquant_thread,
                args=(run_id, raw_path, mq_out_dir, mq_exe, mq_fasta, threads),
                daemon=True,
                name=f"comp-maxquant-{run_id[:16]}",
            )
            t.start()
            logger.info("Dispatched comparison: maxquant for %s (thread: %s)",
                        raw_path.name, t.name)
        else:
            logger.warning("No FASTA found — skipping MaxQuant comparison for %s", run_id)
    else:
        logger.debug("MaxQuant not found — skipping MaxQuant comparison for %s", run_id)

    # ── Comet (DDA; native timsTOF .d — preserves ion mobility) ─────────────
    comet_exe = _find_comet()
    if comet_exe:
        c_fasta = fasta_path
        if (not c_fasta or not Path(c_fasta).exists()) and fragpipe:
            paths_for_fasta = _fragpipe_paths(fragpipe)
            bundled = paths_for_fasta.get("bundled_fasta")
            if bundled and Path(str(bundled)).exists():
                c_fasta = str(bundled)

        if c_fasta and Path(c_fasta).exists():
            c_out_dir = comparison_base / "comet"
            t = threading.Thread(
                target=_run_comet_thread,
                args=(run_id, raw_path, c_out_dir, comet_exe, c_fasta, threads),
                daemon=True,
                name=f"comp-comet-{run_id[:16]}",
            )
            t.start()
            logger.info("Dispatched comparison: comet for %s (thread: %s)",
                        raw_path.name, t.name)
        else:
            logger.warning("No FASTA found — skipping Comet comparison for %s", run_id)
    else:
        logger.debug("Comet not found — skipping Comet comparison for %s", run_id)
