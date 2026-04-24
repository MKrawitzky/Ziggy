"""De novo peptide sequencing runner.

Supports two engines:
  - casanovo: transformer-based, GPU-accelerated, best accuracy
              Requires a dedicated Python 3.12 venv at E:\ziggy\tools\casanovo_env\
  - novor:    Java-based, fast, no GPU needed
              Requires novor.jar at E:\ziggy\tools\novor\novor.jar

Both engines accept MGF input and return a list of result dicts.
"""

from __future__ import annotations

import csv
import json
import logging
import re
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)

# Paths for the two engines
_ZIGGY_DIR = Path(__file__).parent.parent.parent  # E:\ziggy
_CASANOVO_PYTHON = _ZIGGY_DIR / "tools" / "casanovo_env" / "Scripts" / "python.exe"
_CASANOVO_EXE   = _ZIGGY_DIR / "tools" / "casanovo_env" / "Scripts" / "casanovo.exe"
_NOVOR_JAR      = _ZIGGY_DIR / "tools" / "novor" / "novor.jar"


def casanovo_available() -> bool:
    return _CASANOVO_EXE.exists() or _CASANOVO_PYTHON.exists()


def novor_available() -> bool:
    import shutil
    return _NOVOR_JAR.exists() or (shutil.which("novor") is not None)


def list_available_engines() -> list[str]:
    engines = []
    if casanovo_available():
        engines.append("casanovo")
    if novor_available():
        engines.append("novor")
    return engines


def run_casanovo(
    input_path: Path,
    output_dir: Path,
    model: str = "auto",
) -> list[dict]:
    """Run Casanovo 5.x de novo sequencing.

    Args:
        input_path: Input file — either a Bruker .d directory (preferred, reads
                    natively via TdfParser with ion mobility) or a .mgf file.
                    Casanovo's depthcharge library auto-selects the parser.
        output_dir: Directory to write results.
        model: Path to .ckpt model weights, URL, or "auto" (download default).

    Returns list of dicts with keys:
        sequence, score, precursor_mz, charge, rt_sec, one_over_k0, n_aa

    Note: When passing a .d file, m/z values are not temperature-corrected
    (a known timsrust_pyo3 limitation). For QC de novo this is acceptable.
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    out_root = "casanovo_results"

    # Build command — casanovo 5.x uses --output_dir / --output_root
    if _CASANOVO_EXE.exists():
        cmd_base = [str(_CASANOVO_EXE)]
    else:
        cmd_base = [str(_CASANOVO_PYTHON), "-c", "from casanovo.casanovo import main; main()"]

    cmd = cmd_base + [
        "sequence",
        str(input_path),
        "--output_dir", str(output_dir),
        "--output_root", out_root,
        "--force_overwrite",
    ]

    # Add model flag if not auto
    if model and model not in ("auto", "nontryptic"):
        cmd += ["--model", model]

    # Alias mgf_path for parsers below
    mgf_path = input_path

    logger.info("Running Casanovo: %s", " ".join(str(x) for x in cmd))
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=3600,
        )
        if result.returncode != 0:
            logger.error("Casanovo failed (rc=%d):\nSTDOUT:\n%s\nSTDERR:\n%s",
                         result.returncode, result.stdout[-3000:], result.stderr[-3000:])
            return []
        logger.debug("Casanovo stdout:\n%s", result.stdout[-2000:])
    except subprocess.TimeoutExpired:
        logger.error("Casanovo timed out after 1 hour")
        return []
    except FileNotFoundError:
        logger.error("Casanovo executable not found at %s", _CASANOVO_EXE)
        return []

    # Casanovo 5.x outputs a .mztab file by default
    out_mztab = output_dir / f"{out_root}.mztab"
    if not out_mztab.exists():
        # Try .csv fallback (some versions output CSV)
        out_csv = output_dir / f"{out_root}.csv"
        if out_csv.exists():
            return _parse_casanovo_csv(out_csv, mgf_path)
        logger.warning("Casanovo output not found. Files in %s: %s",
                       output_dir, list(output_dir.iterdir()))
        return []

    return _parse_casanovo_mztab(out_mztab, mgf_path)


def _parse_casanovo_mztab(mztab_path: Path, mgf_path: Path) -> list[dict]:
    """Parse Casanovo mzTab output into a list of result dicts."""
    if not mztab_path.exists():
        logger.warning("Casanovo output not found: %s", mztab_path)
        return []

    # Build title→RT/IM map from the MGF
    title_meta: dict[str, dict] = {}
    with open(mgf_path) as f:
        cur: dict = {}
        for line in f:
            line = line.strip()
            if line == "BEGIN IONS":
                cur = {}
            elif line.startswith("TITLE="):
                cur["title"] = line[6:]
            elif line.startswith("RTINSECONDS="):
                cur["rt"] = float(line[12:])
            elif line.startswith("IONMOBILITY="):
                cur["im"] = float(line[12:])
            elif line == "END IONS" and "title" in cur:
                title_meta[cur["title"]] = cur.copy()

    results = []
    psm_section = False
    with open(mztab_path) as f:
        for line in f:
            line = line.rstrip()
            if line.startswith("PSH"):
                psm_section = True
                headers = line.split("\t")
                continue
            if psm_section and line.startswith("PSM"):
                parts = line.split("\t")
                row = dict(zip(headers, parts))
                seq = row.get("sequence", "")
                score_str = row.get("search_engine_score[1]", "0")
                try:
                    score = float(score_str)
                except ValueError:
                    score = 0.0
                prec_mz = float(row.get("exp_mass_to_charge", "0") or 0)
                charge = int(float(row.get("charge", "0") or 0))
                spectra_ref = row.get("spectra_ref", "")
                title = row.get("PSM_ID", "")

                # Look up RT and IM from MGF title
                meta = title_meta.get(title, {})
                rt_sec = meta.get("rt", 0.0)
                im = meta.get("im", 0.0)

                # Parse IM from spectra_ref if not in title_meta
                if not im:
                    m = re.search(r"im=([\d.]+)", spectra_ref)
                    if m:
                        im = float(m.group(1))

                clean_seq = re.sub(r"[+\-][\d.]+", "", seq)  # strip modifications
                results.append({
                    "sequence":     seq,
                    "sequence_clean": clean_seq,
                    "score":        round(score, 4),
                    "precursor_mz": round(prec_mz, 5),
                    "charge":       charge,
                    "rt_sec":       round(rt_sec, 2),
                    "one_over_k0":  round(im, 4),
                    "length":       len(clean_seq),
                    "engine":       "casanovo",
                })

    logger.info("Casanovo: parsed %d PSMs from %s", len(results), mztab_path)
    return results


def _parse_casanovo_csv(csv_path: Path, mgf_path: Path) -> list[dict]:
    """Parse Casanovo CSV output (some versions output CSV instead of mzTab)."""
    # Build title→meta map from MGF
    title_meta: dict[str, dict] = {}
    with open(mgf_path) as f:
        cur: dict = {}
        for line in f:
            line = line.strip()
            if line == "BEGIN IONS":
                cur = {}
            elif line.startswith("TITLE="):
                cur["title"] = line[6:]
            elif line.startswith("RTINSECONDS="):
                cur["rt"] = float(line[12:])
            elif line.startswith("IONMOBILITY="):
                cur["im"] = float(line[12:])
            elif line == "END IONS" and "title" in cur:
                title_meta[cur["title"]] = cur.copy()

    results = []
    with open(csv_path, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            try:
                seq = row.get("sequence", row.get("peptide", "")).strip()
                score = float(row.get("score", row.get("search_engine_score", "0")) or 0)
                prec_mz = float(row.get("precursor_mz", row.get("exp_mass_to_charge", "0")) or 0)
                charge = int(float(row.get("charge", "0") or 0))
                title = row.get("spectrum_id", row.get("title", ""))
                meta = title_meta.get(title, {})
                clean_seq = re.sub(r"[+\-][\d.]+", "", seq)
                results.append({
                    "sequence": seq,
                    "sequence_clean": clean_seq,
                    "score": round(score, 4),
                    "precursor_mz": round(prec_mz, 5),
                    "charge": charge,
                    "rt_sec": round(meta.get("rt", 0.0), 2),
                    "one_over_k0": round(meta.get("im", 0.0), 4),
                    "length": len(clean_seq),
                    "engine": "casanovo",
                })
            except (ValueError, KeyError):
                continue
    logger.info("Casanovo CSV: parsed %d PSMs", len(results))
    return results


def run_novor(
    mgf_path: Path,
    output_dir: Path,
    enzyme: str = "none",
    fragmentation: str = "HCD",
    mass_error_ms2_ppm: float = 20.0,
    mass_error_ms1_da: float = 0.02,
) -> list[dict]:
    """Run Novor de novo on an MGF file.

    Args:
        enzyme: "none" for non-tryptic (immunopeptidomics), "Trypsin" for standard.
        fragmentation: "HCD" for timsTOF (CID/HCD PASEF).

    Returns list of result dicts.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    # Write Novor params file
    params_path = output_dir / "novor_params.txt"
    out_csv = output_dir / "novor_results.csv"
    params_content = f"""# Novor parameters for ZIGGY de novo
fragmentation = {fragmentation}
massAnalyzer = TOF
enzyme = {enzyme}
fixedModifications = Carbamidomethylation of C
variableModifications = Oxidation of M
massErrMs2 = {mass_error_ms2_ppm} ppm
massErrMs1 = {mass_error_ms1_da} Da
outputFolder = {output_dir}
"""
    params_path.write_text(params_content)

    jar = str(_NOVOR_JAR) if _NOVOR_JAR.exists() else "novor.jar"
    cmd = [
        "java", "-Xmx2g", "-jar", jar,
        "-p", str(params_path),
        "-f", str(mgf_path),
        "-o", str(out_csv),
    ]

    logger.info("Running Novor: %s", " ".join(cmd))
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=1800)
        if result.returncode != 0:
            logger.error("Novor failed:\n%s", result.stderr[-2000:])
            return []
    except subprocess.TimeoutExpired:
        logger.error("Novor timed out")
        return []
    except FileNotFoundError:
        logger.error("Novor JAR not found: %s", jar)
        return []

    return _parse_novor_csv(out_csv, mgf_path)


def _parse_novor_csv(csv_path: Path, mgf_path: Path) -> list[dict]:
    """Parse Novor CSV output."""
    if not csv_path.exists():
        logger.warning("Novor output not found: %s", csv_path)
        return []

    # Build id→RT/IM map from the MGF
    id_meta: dict[str, dict] = {}
    with open(mgf_path) as f:
        cur: dict = {}
        scan_num = 0
        for line in f:
            line = line.strip()
            if line == "BEGIN IONS":
                cur = {}
                scan_num += 1
                cur["scan"] = scan_num
            elif line.startswith("RTINSECONDS="):
                cur["rt"] = float(line[12:])
            elif line.startswith("IONMOBILITY="):
                cur["im"] = float(line[12:])
            elif line == "END IONS":
                id_meta[str(scan_num)] = cur.copy()

    results = []
    with open(csv_path, newline="") as f:
        # Skip header comment lines starting with #
        lines = [l for l in f if not l.startswith("#")]

    if not lines:
        return []

    reader = csv.DictReader(lines)
    for row in reader:
        try:
            scan = row.get("# id", row.get("id", "")).strip()
            seq = row.get("peptide", row.get("sequence", "")).strip()
            score_str = row.get("score", "0").strip()
            score = float(score_str) / 100.0 if score_str else 0.0  # Novor 0-100 → 0-1
            prec_mz = float(row.get("mz", row.get("precursorMz", "0")).strip() or 0)
            charge = int(float(row.get("z", row.get("charge", "0")).strip() or 0))
            clean_seq = re.sub(r"\([^)]*\)", "", seq)

            meta = id_meta.get(scan, {})
            rt_sec = meta.get("rt", 0.0)
            im = meta.get("im", 0.0)

            results.append({
                "sequence":       seq,
                "sequence_clean": clean_seq,
                "score":          round(score, 4),
                "precursor_mz":   round(prec_mz, 5),
                "charge":         charge,
                "rt_sec":         round(rt_sec, 2),
                "one_over_k0":    round(im, 4),
                "length":         len(clean_seq),
                "engine":         "novor",
            })
        except (ValueError, KeyError):
            continue

    logger.info("Novor: parsed %d PSMs from %s", len(results), csv_path)
    return results


def run_denovo(
    input_path: Path,
    output_dir: Path,
    engine: str = "auto",
    immuno_mode: bool = False,
) -> tuple[list[dict], str]:
    """Run de novo sequencing with the best available engine.

    Args:
        input_path: Bruker .d directory OR .mgf file.
                    Casanovo reads .d natively (preferred — preserves ion mobility).
                    Novor always requires MGF; if a .d is passed, caller must extract first.
        engine: "casanovo", "novor", or "auto" (prefers casanovo).
        immuno_mode: Use non-tryptic settings and non-tryptic Casanovo model.

    Returns (results_list, engine_used).
    """
    if engine == "auto":
        engine = "casanovo" if casanovo_available() else "novor"

    logger.info("De novo engine: %s (input=%s, immuno_mode=%s)", engine, input_path, immuno_mode)

    if engine == "casanovo":
        model = "nontryptic" if immuno_mode else "auto"
        results = run_casanovo(input_path, output_dir, model=model)
        return results, "casanovo"

    if engine == "novor":
        # Novor needs MGF — if a .d was passed, it's an error on the caller's part
        if input_path.suffix.lower() != ".mgf":
            logger.error("Novor requires MGF input; got %s", input_path.suffix)
            return [], "novor"
        enzyme = "none" if immuno_mode else "Trypsin"
        results = run_novor(input_path, output_dir, enzyme=enzyme)
        return results, "novor"

    logger.error("Unknown de novo engine: %s", engine)
    return [], engine
