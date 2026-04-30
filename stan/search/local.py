"""Local search execution — runs DIA-NN and Sage directly on this machine.

This is the default execution mode. DIA-NN and Sage run as local subprocesses
on the instrument workstation. No SLURM cluster required.

Two search modes:
  - "local" (default): User provides their own FASTA via fasta_path in
    instruments.yml. DIA-NN runs library-free (predicted from FASTA) unless
    the user also provides a lib_path.
  - "community": Uses frozen community search assets from the HF Dataset.
    Requires assets to be cached locally.

Conversion pipeline for Thermo DDA:
  .raw → ThermoRawFileParser → .mzML → Sage

No conversion needed for:
  - DIA (any vendor): DIA-NN reads .raw and .d natively
  - Bruker DDA: Sage reads .d natively
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
from pathlib import Path

from stan.search.convert import get_mzml_path


def _mirror_log_to_hive(log_file: Path, run_stem: str, engine: str) -> None:
    """Copy a failed search log to the Hive mirror directory.

    Silently does nothing if Y:\\STAN (or configured mirror) isn't mounted.
    Writes to a per-instrument subdirectory to avoid collisions.
    """
    try:
        from stan.config import get_hive_mirror_dir
        hive_dir = get_hive_mirror_dir()
        if not hive_dir or not log_file.exists():
            return
        failures_dir = hive_dir / "failures"
        failures_dir.mkdir(parents=True, exist_ok=True)
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        dest = failures_dir / f"{timestamp}_{engine}_{run_stem}.log"
        shutil.copy2(str(log_file), str(dest))
        logger.info("Mirrored log to Hive: %s", dest)
    except Exception:
        logger.debug("Could not mirror log to Hive", exc_info=True)

logger = logging.getLogger(__name__)


def _build_local_diann_params(
    fasta_path: str,
    lib_path: str | None = None,
    vendor: str = "bruker",
) -> dict:
    """Build DIA-NN parameters for local mode with user-provided FASTA.

    Requires a spectral library — library-free mode is too slow for QC
    and produces non-comparable results for the community benchmark.
    """
    if not lib_path:
        raise ValueError(
            "DIA-NN requires a spectral library for QC searches. "
            "Library-free mode is too slow and produces non-comparable results. "
            "Run `stan baseline` again to download the community library."
        )

    # Fixed mass accuracy skips auto-optimization (saves 2-5 min per file).
    # Vendor-specific values from DE-LIMP confirmed settings.
    if vendor == "thermo":
        ms2_acc = 20   # Orbitrap MS2
        ms1_acc = 10   # Orbitrap MS1
    else:
        ms2_acc = 15   # timsTOF MS2
        ms1_acc = 15   # timsTOF MS1

    params: dict = {
        "fasta": fasta_path,
        "lib": lib_path,
        "qvalue": 0.01,
        "min-pep-len": 7,
        "max-pep-len": 30,
        "missed-cleavages": 1,
        "min-pr-charge": 2,
        "max-pr-charge": 4,
        "cut": "K*,R*",
        "mass-acc": ms2_acc,
        "mass-acc-ms1": ms1_acc,
    }

    return params


def _build_local_sage_params(
    fasta_path: str,
    immuno_class: int = 0,
) -> dict:
    """Build Sage JSON config for local mode with user-provided FASTA.

    immuno_class:
        0 = standard tryptic search
        1 = MHC-I non-specific (8–12 aa, z 1–3, non-specific enzyme)
        2 = MHC-II non-specific (13–25 aa, z 2–4, non-specific enzyme)
    """
    if immuno_class == 1:
        # MHC-I: 8–12 aa, z=+1–3, semi-tryptic.
        # Fully non-specific search against a full proteome generates billions of
        # 8-12 aa candidates and crashes Sage with OOM regardless of available RAM.
        # Semi-enzymatic (one tryptic terminus) recovers >95% of true HLA-I ligands
        # while keeping the search space manageable.
        # Deamidation (N,Q) is a relevant mod in immunopeptidomics.
        enzyme    = {"cleave_at": "KR", "missed_cleavages": 2, "semi_enzymatic": True}
        min_len   = 8
        max_len   = 12
        charges   = [1, 3]
        var_mods  = {"M": [15.9949], "N": [0.9840], "Q": [0.9840]}
    elif immuno_class == 2:
        # MHC-II: 13–25 aa, z 2–4, semi-tryptic.
        # Semi-enzymatic (one tryptic end) is the standard for HLA-II ligands —
        # fully non-specific digestion of a full proteome creates an enormous
        # search space that crashes Sage with OOM on typical instrument PCs.
        enzyme    = {"cleave_at": "KR", "missed_cleavages": 2, "semi_enzymatic": True}
        min_len   = 13
        max_len   = 25
        charges   = [2, 4]
        var_mods  = {"M": [15.9949], "N": [0.9840], "Q": [0.9840]}
    else:
        enzyme    = {"cleave_at": "KR", "restrict": "P", "missed_cleavages": 1}
        min_len   = 7
        max_len   = 30
        charges   = [2, 4]
        var_mods  = {"M": [15.9949]}

    return {
        "database": {
            "fasta": fasta_path,
            "enzyme": enzyme,
            "min_len": min_len,
            "max_len": max_len,
            "static_mods": {"C": 57.0215},
            "variable_mods": var_mods,
        },
        "precursor_tol": {"ppm": [-15, 15]},
        "fragment_tol": {"ppm": [-20, 20]},
        "precursor_charge": charges,
        "min_peaks": 6 if immuno_class else 8,
        "max_peaks": 150,
        "report_psms": 1,
        "wide_window": False,
    }


def _sanitize_path_for_diann(raw_path: Path, staging_dir: Path) -> Path:
    """Return a DIA-NN-safe path, creating a junction/symlink if needed.

    DIA-NN mis-parses filenames containing double-dashes on Windows —
    it splits the name at each ``--`` and treats every fragment as a
    separate CLI flag. A file named
    ``hela__100spd--toGgBps--C43-tf9d0c24.d`` produces:

        WARNING: unrecognised option [--toGgBps]
        WARNING: unrecognised option [--C43-tf9d0c24.d]
        WARNING: skipping ...hela__100spd - invalid raw MS data format
        0 files will be processed

    Passing the name as a single quoted argv entry does not help because
    DIA-NN does its own argv rescan after Windows tokenization.

    Workaround: for any filename containing ``--`` or other problematic
    characters, create a directory junction (Bruker ``.d``) or hardlink
    (Thermo ``.raw``) with a hash-derived safe name in the per-run
    staging directory, and return that junction path. The original raw
    file is never modified. Returns ``raw_path`` unchanged when
    sanitization isn't needed.
    """
    name = raw_path.name
    if "--" not in name:
        return raw_path

    import hashlib
    import sys

    # Hash of the full absolute path so different files with the same
    # basename can't collide in the staging dir.
    digest = hashlib.md5(str(raw_path.resolve()).encode("utf-8")).hexdigest()[:12]
    safe_name = f"stan_{digest}{raw_path.suffix}"
    junction = staging_dir / safe_name

    if junction.exists():
        return junction

    try:
        staging_dir.mkdir(parents=True, exist_ok=True)
        if sys.platform == "win32":
            if raw_path.is_dir():
                # Directory junction — no admin privs needed on NTFS.
                # Junctions work on the same volume only; if staging and
                # raw are on different drives we fall back to copytree.
                result = subprocess.run(
                    ["cmd", "/c", "mklink", "/J", str(junction), str(raw_path)],
                    capture_output=True, text=True, check=False,
                )
                if result.returncode != 0:
                    logger.warning(
                        "mklink /J failed for %s: %s — falling back to copytree",
                        raw_path.name, result.stderr.strip() or result.stdout.strip(),
                    )
                    import shutil
                    shutil.copytree(str(raw_path), str(junction))
            else:
                import os
                try:
                    os.link(str(raw_path), str(junction))
                except OSError:
                    # Hardlink failed (cross-volume?) — fall back to copy.
                    import shutil
                    shutil.copy2(str(raw_path), str(junction))
        else:
            import os
            os.symlink(str(raw_path), str(junction))
    except Exception:
        logger.warning(
            "Could not create sanitized alias for %s; DIA-NN may fail "
            "to parse the filename.", raw_path.name, exc_info=True,
        )
        return raw_path

    logger.info(
        "DIA-NN filename sanitized: %s -> %s "
        "(filename contained '--' which DIA-NN misparses)",
        raw_path.name, safe_name,
    )
    return junction


def run_diann_local(
    raw_path: Path,
    output_dir: Path,
    vendor: str,
    diann_exe: str = "diann",
    threads: int = 0,
    fasta_path: str | None = None,
    lib_path: str | None = None,
    search_mode: str = "local",
) -> Path | None:
    """Run DIA-NN locally as a subprocess.

    Args:
        raw_path: Path to .d directory or .raw file.
        output_dir: Output directory for results.
        vendor: "bruker" or "thermo".
        diann_exe: Path to diann executable (or just "diann" if on PATH).
        threads: Number of threads (0 = let DIA-NN decide).
        fasta_path: Path to FASTA file (required for local mode).
        lib_path: Path to spectral library (optional — DIA-NN runs library-free if omitted).
        search_mode: "local" (user FASTA) or "community" (frozen HF assets).

    Returns:
        Path to report.parquet, or None on failure.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    if search_mode == "community":
        from stan.search.community_params import ensure_community_assets, get_community_diann_params
        cache_dir = output_dir.parent / "_community_assets"
        ensure_community_assets(vendor, cache_dir)  # download FASTA + speclib if missing
        params = get_community_diann_params(vendor, cache_dir=str(cache_dir))
    else:
        if not fasta_path:
            logger.error(
                "No fasta_path configured for instrument. "
                "Set fasta_path in instruments.yml or run `stan setup`."
            )
            return None
        if not Path(fasta_path).exists():
            logger.error("FASTA file not found: %s", fasta_path)
            return None
        params = _build_local_diann_params(fasta_path, lib_path, vendor=vendor)

    report_path = output_dir / "report.parquet"

    # Work around DIA-NN's double-dash filename parsing bug by creating
    # a junction/symlink with a safe name when necessary.
    staging_dir = output_dir.parent / "_stan_diann_staging"
    raw_for_diann = _sanitize_path_for_diann(raw_path, staging_dir)

    cmd = [diann_exe, "--f", str(raw_for_diann), "--out", str(report_path)]

    for key, val in params.items():
        if val == "":
            cmd.append(f"--{key}")  # flag-only params like --fasta-search
        else:
            cmd.extend([f"--{key}", str(val)])

    # Default to half available cores — instrument PCs need headroom for acquisition
    if threads <= 0:
        import os
        threads = max(2, (os.cpu_count() or 4) // 2)
    cmd.extend(["--threads", str(threads)])

    logger.info("Running DIA-NN locally: %s", raw_path.name)
    logger.info("Command: %s", " ".join(cmd))

    # Write DIA-NN output to log file so we can diagnose issues
    log_file = output_dir / "diann.log"

    def _run_diann(run_cmd: list, log_path: Path) -> None:
        """Run DIA-NN; raises CalledProcessError / TimeoutExpired on failure."""
        with open(log_path, "w") as lf:
            subprocess.run(
                run_cmd,
                check=True,
                stdout=lf,
                stderr=subprocess.STDOUT,
                text=True,
                timeout=14400,
            )

    try:
        _run_diann(cmd, log_file)
        logger.info("DIA-NN complete: %s", raw_path.name)
    except FileNotFoundError as e:
        logger.error(
            "DIA-NN executable not found: %s. "
            "Install DIA-NN or add it to PATH.",
            diann_exe,
        )
        from stan.telemetry import report_error
        report_error(e, {"search_engine": "diann", "vendor": vendor})
        return None
    except subprocess.TimeoutExpired as e:
        logger.error("DIA-NN timed out after 4 hours: %s", raw_path.name)
        from stan.telemetry import report_error
        report_error(e, {"search_engine": "diann", "vendor": vendor})
        _mirror_log_to_hive(log_file, raw_path.stem, "diann")
        return None
    except subprocess.CalledProcessError as e:
        # Exit code 0xC0000005 (-1073741819) = Windows access violation —
        # DIA-NN crashed while reading Bruker .tdf_bin frame data.
        # Retry with half the threads, which resolves memory mapping races
        # seen with older timsTOF firmware / larger .d files.
        ACCESS_VIOLATION = -1073741819
        if e.returncode == ACCESS_VIOLATION and vendor == "bruker":
            retry_threads = max(1, threads // 2)
            logger.warning(
                "DIA-NN crashed (access violation, rc=%d) on %s. "
                "Retrying with %d threads (was %d)...",
                e.returncode, raw_path.name, retry_threads, threads,
            )
            retry_cmd = [c for c in cmd if c != str(threads)]
            # Replace --threads value
            try:
                ti = retry_cmd.index("--threads")
                retry_cmd[ti + 1] = str(retry_threads)
            except ValueError:
                retry_cmd.extend(["--threads", str(retry_threads)])
            retry_log = output_dir / "diann_retry.log"
            try:
                _run_diann(retry_cmd, retry_log)
                # Merge retry log into main log
                with open(log_file, "a") as lf:
                    lf.write(f"\n\n--- RETRY with {retry_threads} threads ---\n")
                    lf.write(retry_log.read_text(errors="replace"))
                retry_log.unlink(missing_ok=True)
                logger.info("DIA-NN retry complete: %s", raw_path.name)
            except subprocess.CalledProcessError as e2:
                logger.error(
                    "DIA-NN retry also failed (rc=%d): %s",
                    e2.returncode, raw_path.name,
                )
                from stan.telemetry import report_error
                report_error(e2, {"search_engine": "diann", "vendor": vendor, "retry": True})
                _mirror_log_to_hive(log_file, raw_path.stem, "diann")
                return None
        else:
            logger.error("DIA-NN failed (rc=%d): %s", e.returncode, raw_path.name)
            from stan.telemetry import report_error
            report_error(e, {"search_engine": "diann", "vendor": vendor})
            _mirror_log_to_hive(log_file, raw_path.stem, "diann")
            return None

    report = output_dir / "report.parquet"
    if report.exists():
        return report

    # DIA-NN exits with rc=0 even when it processed zero files (e.g. when
    # the filename confused its argv parser). Scan the log and surface a
    # clear error message + mirror the log to Hive for remote debugging.
    diagnosis = "output file missing"
    try:
        log_text = log_file.read_text(errors="replace")
        if "0 files will be processed" in log_text:
            diagnosis = "DIA-NN processed 0 files — filename parsing error?"
        elif "invalid raw MS data format" in log_text:
            diagnosis = "DIA-NN rejected the raw file (invalid format or unreadable)"
        elif "unrecognised option" in log_text:
            diagnosis = "DIA-NN rejected one or more CLI options"
        elif "Library does not contain" in log_text or "Spectral library" in log_text and "loaded" not in log_text:
            diagnosis = "Spectral library problem"
    except Exception:
        pass

    logger.error("DIA-NN failed: %s — %s", raw_path.name, diagnosis)
    _mirror_log_to_hive(log_file, raw_path.stem, "diann")
    return None


def run_sage_local(
    raw_path: Path,
    output_dir: Path,
    vendor: str,
    sage_exe: str = "sage",
    trfp_exe: str | None = None,
    keep_mzml: bool = False,
    threads: int = 0,
    fasta_path: str | None = None,
    search_mode: str = "local",
    immuno_class: int = 0,
) -> Path | None:
    """Run Sage locally as a subprocess.

    For Thermo DDA: converts .raw → mzML via ThermoRawFileParser first.
    For Bruker DDA: passes .d directly to Sage (reads natively).

    Args:
        raw_path: Path to .d directory or .raw file.
        output_dir: Output directory for results.
        vendor: "bruker" or "thermo".
        sage_exe: Path to sage executable (or just "sage" if on PATH).
        trfp_exe: Path to ThermoRawFileParser.exe (needed for Thermo DDA only).
        keep_mzml: Keep converted mzML files after search.
        threads: Number of threads (0 = let Sage decide).
        fasta_path: Path to FASTA file (required for local mode).
        search_mode: "local" (user FASTA) or "community" (frozen HF assets).

    Returns:
        Path to results.sage.parquet, or None on failure.
    """
    output_dir.mkdir(parents=True, exist_ok=True)

    # Determine input path.
    # Thermo .raw → mzML via ThermoRawFileParser (required).
    # Bruker .d → mzML via msconvert when available.
    #   Sage 0.14.x reads .d natively via timsrust, but crashes with
    #   STATUS_STACK_BUFFER_OVERRUN on files with large tdf_bin (≥ ~3 GB).
    #   msconvert at C:/ProteoWizard/msconvert.exe is more robust and avoids
    #   this Sage/timsrust bug entirely.  Fall back to direct .d if msconvert
    #   is not available (e.g., instrument PC without ProteoWizard).
    if vendor == "thermo":
        mzml_path = _convert_raw_to_mzml(raw_path, output_dir, trfp_exe)
        if mzml_path is None:
            return None
        input_path = str(mzml_path)
    else:
        mzml_path = _convert_bruker_to_mzml(raw_path, output_dir)
        if mzml_path is not None:
            input_path = str(mzml_path)
            logger.info("Using msconvert mzML output for Sage: %s", mzml_path.name)
        else:
            # msconvert not available — pass .d directly (works for smaller files)
            logger.info(
                "msconvert not found — passing .d directly to Sage. "
                "Install ProteoWizard at C:/ProteoWizard to improve reliability on large files."
            )
            input_path = str(raw_path)

    # Build Sage JSON config
    if search_mode == "community":
        from stan.search.community_params import ensure_community_assets, get_community_sage_params
        cache_dir = output_dir.parent / "_community_assets"
        ensure_community_assets("bruker" if vendor == "bruker" else "thermo", cache_dir)
        params = get_community_sage_params(cache_dir=str(cache_dir), immuno_class=immuno_class)
    else:
        if not fasta_path:
            logger.error(
                "No fasta_path configured for instrument. "
                "Set fasta_path in instruments.yml or run `stan setup`."
            )
            return None
        if not Path(fasta_path).exists():
            logger.error("FASTA file not found: %s", fasta_path)
            return None
        params = _build_local_sage_params(fasta_path, immuno_class=immuno_class)

    params["mzml_paths"] = [input_path]
    params["output_directory"] = str(output_dir)

    config_path = output_dir / "sage_config.json"
    config_path.write_text(json.dumps(params, indent=2))

    # --parquet: write results.sage.parquet instead of results.sage.tsv
    # (STAN's extractor reads parquet, not TSV)
    cmd = [sage_exe, "--parquet", str(config_path)]

    logger.info("Running Sage locally: %s", raw_path.name)
    logger.info("Command: %s", " ".join(cmd))

    log_file = output_dir / "sage.log"
    try:
        with open(log_file, "w") as lf:
            subprocess.run(
                cmd,
                check=True,
                stdout=lf,
                stderr=subprocess.STDOUT,
                text=True,
                timeout=14400,
            )
        logger.info("Sage complete: %s", raw_path.name)
    except FileNotFoundError as e:
        logger.error(
            "Sage executable not found: %s. Install Sage or add it to PATH.",
            sage_exe,
        )
        from stan.telemetry import report_error
        report_error(e, {"search_engine": "sage", "vendor": vendor})
        return None
    except subprocess.TimeoutExpired as e:
        logger.error("Sage timed out after 4 hours: %s", raw_path.name)
        from stan.telemetry import report_error
        report_error(e, {"search_engine": "sage", "vendor": vendor})
        _mirror_log_to_hive(log_file, raw_path.stem, "sage")
        return None
    except subprocess.CalledProcessError as e:
        logger.error("Sage failed: %s\nstderr:\n%s", raw_path.name, e.stderr)
        from stan.telemetry import report_error
        report_error(e, {"search_engine": "sage", "vendor": vendor})
        _mirror_log_to_hive(log_file, raw_path.stem, "sage")
        return None
    finally:
        # Clean up mzML if requested
        if vendor == "thermo" and not keep_mzml:
            mzml = get_mzml_path(raw_path, output_dir)
            if mzml.exists():
                mzml.unlink()
                logger.debug("Cleaned up: %s", mzml)

    results = output_dir / "results.sage.parquet"
    if results.exists():
        return results

    # Sage may write output with a different prefix or at a parent level
    # Search for any .sage.parquet file in the output directory
    sage_files = list(output_dir.glob("*.sage.parquet"))
    if sage_files:
        logger.info("Found Sage output at: %s", sage_files[0])
        return sage_files[0]

    # Also check if Sage wrote to current working directory instead
    cwd_results = Path("results.sage.parquet")
    if cwd_results.exists():
        dest = output_dir / "results.sage.parquet"
        cwd_results.rename(dest)
        logger.info("Moved Sage output from cwd to: %s", dest)
        return dest

    logger.error("Sage output not found in: %s", output_dir)
    # Mirror the sage.log + directory listing so we can diagnose from Hive
    _mirror_log_to_hive(log_file, raw_path.stem, "sage")
    return None


def _convert_raw_to_mzml(
    raw_path: Path,
    output_dir: Path,
    trfp_exe: str | None,
) -> Path | None:
    """Convert a Thermo .raw file to indexed mzML using ThermoRawFileParser.

    Args:
        raw_path: Path to .raw file.
        output_dir: Output directory for .mzML file.
        trfp_exe: Path to ThermoRawFileParser.exe.

    Returns:
        Path to the generated .mzML file, or None on failure.
    """
    if trfp_exe is None:
        # Try the auto-installed TRFP first
        try:
            from stan.tools.trfp import ensure_installed, _build_command
            trfp_path = ensure_installed()
            # _build_command returns ["dotnet", "path/to/dll"] or ["path/to/exe"]
            trfp_cmd_parts = _build_command(trfp_path)
            trfp_exe = trfp_cmd_parts  # store as list for subprocess
        except Exception:
            # Fall back to PATH
            trfp_exe = shutil.which("ThermoRawFileParser") or shutil.which("ThermoRawFileParser.exe")

    if trfp_exe is None:
        logger.error(
            "ThermoRawFileParser not found. Required for Thermo DDA (.raw → mzML). "
            "Install it or set trfp_path in instruments.yml."
        )
        return None

    mzml_path = get_mzml_path(raw_path, output_dir)

    logger.info("Converting %s → mzML...", raw_path.name)

    # trfp_exe can be a string ("path/to/exe") or list (["dotnet", "path/to/dll"])
    if isinstance(trfp_exe, list):
        cmd = list(trfp_exe)
    else:
        cmd = [str(trfp_exe)]
    cmd += [
        f"-i={raw_path}",
        f"-o={output_dir}/",
        "-f=2",   # indexed mzML
        "-m=0",   # JSON metadata
    ]

    try:
        subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
            timeout=600,  # 10 min timeout for conversion
        )
    except FileNotFoundError:
        logger.error("ThermoRawFileParser not found at: %s", trfp_exe)
        return None
    except subprocess.CalledProcessError as e:
        logger.error("Conversion failed: %s\nstderr: %s", raw_path.name, e.stderr[-500:])
        return None

    if mzml_path.exists():
        logger.info("Converted: %s → %s", raw_path.name, mzml_path.name)
        return mzml_path

    logger.error("mzML not found after conversion: %s", mzml_path)
    return None


def _find_msconvert() -> str | None:
    """Find ProteoWizard msconvert.exe — checks PATH and common install dirs."""
    import shutil
    if exe := shutil.which("msconvert"):
        return exe
    candidates = [
        r"C:\ProteoWizard\msconvert.exe",
        r"C:\Program Files\ProteoWizard\msconvert.exe",
        r"C:\Program Files (x86)\ProteoWizard\msconvert.exe",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    return None


def _find_msfragger() -> str | None:
    """Find MSFragger jar — checks FragPipe install and common locations."""
    # Known FragPipe installation path on this machine
    candidates = [
        r"C:\Users\Admin\Desktop\Fragpipe\fragpipe\MSFragger\MSFragger-3.7\MSFragger-3.7.jar",
        r"C:\FragPipe\MSFragger-4.1\MSFragger-4.1.jar",
        r"C:\FragPipe\MSFragger-3.8\MSFragger-3.8.jar",
        r"C:\FragPipe\MSFragger-3.7\MSFragger-3.7.jar",
        r"C:\tools\MSFragger\MSFragger.jar",
    ]
    for c in candidates:
        if Path(c).exists():
            return c

    # Broad search under Desktop and common tool dirs
    import glob as _glob
    for base in [
        r"C:\Users\Admin\Desktop",
        r"C:\Users\Admin\AppData\Local\FragPipe",
        r"C:\FragPipe",
        r"C:\tools",
    ]:
        for jar in _glob.glob(f"{base}/**/MSFragger*.jar", recursive=True):
            return jar

    return None


def _find_bruker_lib_for_msfragger() -> str | None:
    """Return the directory containing Bruker timsdata*.dll for MSFragger.

    FragPipe ships timsdata*.dll in <jar_dir>/ext/bruker/.
    We also check the DIA-NN tools folder as a fallback.
    """
    jar = _find_msfragger()
    if jar is None:
        return None

    jar_dir = Path(jar).parent

    # Primary: <jar_dir>/ext/bruker/ — standard FragPipe layout
    ext_bruker = jar_dir / "ext" / "bruker"
    if any(ext_bruker.glob("timsdata*.dll")):
        return str(ext_bruker)

    # Legacy: timsdata.dll directly next to the jar
    if any(jar_dir.glob("timsdata*.dll")):
        return str(jar_dir)

    # FragPipe root sibling: tools/diann/*/win/  (FragPipe sometimes puts it there)
    fragpipe_root = jar_dir.parent.parent.parent  # …/fragpipe/
    for dll in fragpipe_root.rglob("timsdata*.dll"):
        return str(dll.parent)

    return None


def _find_fragpipe_java() -> str | None:
    """Return Java executable bundled with FragPipe, or None."""
    jar = _find_msfragger()
    if jar is None:
        return None
    # FragPipe JRE is at <fragpipe_root>/jre/bin/java.exe
    fragpipe_root = Path(jar).parent.parent.parent.parent  # .../fragpipe/
    candidate = fragpipe_root / "jre" / "bin" / "java.exe"
    if candidate.exists():
        return str(candidate)
    # Also check parent of MSFragger-x.y dir (older layout)
    for rel in ["jre/bin/java.exe", "../jre/bin/java.exe", "../../jre/bin/java.exe"]:
        c = (Path(jar).parent / rel).resolve()
        if c.exists():
            return str(c)
    return None


def _build_msfragger_params(
    fasta_path: str,
    output_dir: Path,
    vendor: str,
    immuno_class: int = 0,
    threads: int = 0,
) -> dict:
    """Return MSFragger params-file key-value pairs for a standard search."""
    import os
    if threads <= 0:
        threads = max(2, (os.cpu_count() or 4) // 2)

    # Tolerances: timsTOF 15/15 ppm; Thermo 20/10 ppm
    if vendor == "bruker":
        pre_lo, pre_hi, frag_tol = -15, 15, 20
    else:
        pre_lo, pre_hi, frag_tol = -20, 20, 20

    base: dict = {
        "database_name":            fasta_path,
        "num_threads":              threads,
        "output_location":          str(output_dir),
        "output_format":            "tsv_pin",  # writes both .tsv (targets) and .pin (targets+decoys for TDA FDR)
        "output_report_topN":       1,
        # Tolerances
        "precursor_mass_lower":     pre_lo,
        "precursor_mass_upper":     pre_hi,
        "precursor_mass_units":     1,          # 1 = ppm
        "fragment_mass_tolerance":  frag_tol,
        "fragment_mass_units":      1,          # 1 = ppm
        # Spectrum processing
        "use_topN_peaks":           300,
        "minimum_peaks":            6,
        "max_fragment_charge":      2,
        # Modifications
        "variable_mod_01":          "15.9949 M 3",
        "add_C_cysteine":           57.02146,
        # MS2 deisotoping
        "deisotope":                1,
    }

    if immuno_class == 1:
        # MHC-I: semi-tryptic, 8–12 aa, z 1–3
        base.update({
            "search_enzyme_name_1":     "stricttrypsin",
            "search_enzyme_cut_1":      "KR",
            "search_enzyme_nocut_1":    "P",
            "num_enzyme_termini":       1,
            "num_missed_cleavages":     2,
            "min_peptide_length":       8,
            "max_peptide_length":       12,
            "precursor_charge":         "1 3",
            "override_charge":          0,
            "variable_mod_02":          "0.984016 N 3",
            "variable_mod_03":          "0.984016 Q 3",
        })
    elif immuno_class == 2:
        # MHC-II: semi-tryptic, 13–25 aa, z 2–4
        base.update({
            "search_enzyme_name_1":     "stricttrypsin",
            "search_enzyme_cut_1":      "KR",
            "search_enzyme_nocut_1":    "P",
            "num_enzyme_termini":       1,
            "num_missed_cleavages":     2,
            "min_peptide_length":       13,
            "max_peptide_length":       25,
            "precursor_charge":         "2 4",
            "override_charge":          0,
            "variable_mod_02":          "0.984016 N 3",
            "variable_mod_03":          "0.984016 Q 3",
        })
    else:
        base.update({
            "search_enzyme_name_1":     "stricttrypsin",
            "search_enzyme_cut_1":      "KR",
            "search_enzyme_nocut_1":    "P",
            "num_enzyme_termini":       2,
            "num_missed_cleavages":     1,
            "min_peptide_length":       7,
            "max_peptide_length":       30,
            "precursor_charge":         "2 4",
        })

    return base


def _msfragger_tsv_to_sage_parquet(tsv_path: Path, output_path: Path) -> Path | None:
    """Convert MSFragger TSV + PIN output to Sage-compatible parquet with TDA q-values.

    MSFragger writes target-only PSMs to .tsv.  The .pin (Percolator Input)
    file contains both target (Label=1) and decoy (Label=-1) PSMs needed for
    proper target-decoy competition FDR.

    Strategy:
      1. Read PIN for TDA q-value computation (hyperscore + Label columns).
      2. Read TSV for full PSM annotations (peptide, protein, RT, mass error).
      3. Map q-values onto TSV rows by scan number.
      4. Write Sage-compatible parquet (targets at ≤1% FDR).
    """
    try:
        import polars as pl
        import numpy as np
    except ImportError as e:
        logger.error("polars/numpy not available for MSFragger conversion: %s", e)
        return None

    # ── 1. Read PIN for TDA FDR ───────────────────────────────────────────────
    pin_path = tsv_path.with_suffix(".pin")
    q_by_scan: dict[int, float] = {}

    if pin_path.exists():
        try:
            pin = pl.read_csv(str(pin_path), separator="\t", infer_schema_length=5000)
            label_col = next((c for c in pin.columns if c.lower() == "label"), None)
            scan_col  = next((c for c in pin.columns if c.lower() == "scannr"), None)
            score_col = next((c for c in pin.columns if c.lower() in ("hyperscore", "score")), None)

            if label_col and scan_col and score_col:
                pin = pin.sort(score_col, descending=True)
                is_dec  = (pin[label_col] == -1).to_numpy()
                cum_dec = is_dec.cumsum().astype(float)
                cum_tgt = (~is_dec).cumsum().astype(float)
                fdr     = cum_dec / np.maximum(cum_tgt, 1.0)
                q_arr   = np.minimum.accumulate(fdr[::-1])[::-1]
                for scan, q, decoy in zip(pin[scan_col].to_numpy(), q_arr, is_dec):
                    if not decoy:
                        q_by_scan[int(scan)] = float(q)
                n_pass = sum(1 for q in q_by_scan.values() if q <= 0.01)
                logger.info(
                    "PIN TDA FDR: %d target PSMs total, %d pass 1%% FDR",
                    len(q_by_scan), n_pass,
                )
            else:
                logger.warning(
                    "PIN missing columns (label=%s scan=%s score=%s) — "
                    "falling back to expectscore",
                    label_col, scan_col, score_col,
                )
        except Exception as e:
            logger.warning("Could not read PIN %s: %s — using expectscore fallback", pin_path.name, e)

    # ── 2. Read TSV for annotations ───────────────────────────────────────────
    try:
        df = pl.read_csv(str(tsv_path), separator="\t", infer_schema_length=5000)
    except Exception as e:
        logger.error("Could not read MSFragger TSV %s: %s", tsv_path.name, e)
        return None

    if df.height == 0:
        logger.warning("MSFragger TSV has no rows: %s", tsv_path.name)
        return None

    # ── 3. Normalise column names to Sage-compatible names ────────────────────
    rename: dict[str, str] = {}
    for col in df.columns:
        lc = col.lower()
        if lc == "peptide":             rename[col] = "peptide"
        elif lc == "charge":            rename[col] = "charge"
        elif lc == "retention_time":    rename[col] = "retention_time"
        elif lc == "hyperscore":        rename[col] = "hyperscore"
        elif lc == "massdiff":          rename[col] = "delta_mass"
        elif lc in ("protein", "protein_id"):
                                        rename[col] = "protein"
        elif lc == "ion_mobility":      rename[col] = "ion_mobility"
        elif lc == "num_missed_cleavages":
                                        rename[col] = "missed_cleavages"
        elif lc == "scannum":           rename[col] = "scannum"

    df = df.rename({k: v for k, v in rename.items() if k != v})

    # ── 4. Assign q-values ───────────────────────────────────────────────────
    if q_by_scan and "scannum" in df.columns:
        scan_arr = df["scannum"].to_numpy()
        q_vals   = np.array([q_by_scan.get(int(s), 1.0) for s in scan_arr])
        df = df.with_columns(pl.Series("spectrum_q", q_vals))
    elif "expectscore" in df.columns:
        # Fallback: expectscore ≈ E-value; treat as FDR proxy
        df = df.with_columns(pl.col("expectscore").alias("spectrum_q"))
        logger.info("Using expectscore as FDR proxy (no PIN decoys available)")
    else:
        df = df.with_columns(pl.lit(1.0).alias("spectrum_q"))

    # ── 5. Filter to 1% FDR and write ────────────────────────────────────────
    result = df.filter(pl.col("spectrum_q") <= 0.01)
    if result.height == 0:
        logger.warning(
            "MSFragger: 0 PSMs pass 1%% FDR for %s — writing all target PSMs",
            tsv_path.name,
        )
        result = df

    try:
        result.write_parquet(str(output_path))
        logger.info(
            "MSFragger: %d target PSMs at 1%% FDR written to %s",
            result.height, output_path.name,
        )
        return output_path
    except Exception as e:
        logger.error("Failed to write MSFragger parquet: %s", e)
        return None


def run_msfragger_local(
    raw_path: Path,
    output_dir: Path,
    vendor: str,
    threads: int = 0,
    fasta_path: str | None = None,
    search_mode: str = "community",
    immuno_class: int = 0,
) -> Path | None:
    """Run MSFragger on a Bruker .d file and return results as Sage-like parquet.

    MSFragger reads Bruker timsTOF .d directories natively via timsdata.dll —
    no mzML conversion needed.  Output is a TSV which is converted in-process
    to a results.sage.parquet-compatible file so the existing extractor works
    without changes.

    Args:
        raw_path: Path to .d directory.
        output_dir: Output directory for results + intermediate files.
        vendor: "bruker" (only Bruker supported here).
        threads: Number of threads (0 = auto).
        fasta_path: Path to FASTA (required for local mode).
        search_mode: "local" or "community".
        immuno_class: 0 = tryptic, 1 = MHC-I, 2 = MHC-II.

    Returns:
        Path to results.sage.parquet (Sage-compatible), or None on failure.
    """
    jar = _find_msfragger()
    if jar is None:
        logger.warning(
            "MSFragger jar not found — cannot run MSFragger for %s. "
            "Install FragPipe or set msfragger_path in instruments.yml.",
            raw_path.name,
        )
        return None

    output_dir.mkdir(parents=True, exist_ok=True)

    # ── Resolve FASTA ─────────────────────────────────────────────────────────
    if search_mode == "community":
        from stan.search.community_params import ensure_community_assets
        cache_dir = output_dir.parent / "_community_assets"
        ensure_community_assets(vendor, cache_dir)
        # Community FASTA: human_hela_202604.fasta (already contains targets;
        # MSFragger appends rev_ decoys automatically)
        import glob as _glob
        fastas = list(cache_dir.glob("*.fasta"))
        if not fastas:
            logger.error("Community FASTA not found in %s", cache_dir)
            return None
        fasta_path = str(fastas[0])
    else:
        if not fasta_path:
            logger.error("No fasta_path for MSFragger local search")
            return None
        if not Path(fasta_path).exists():
            logger.error("FASTA not found: %s", fasta_path)
            return None

    # ── Build params file ─────────────────────────────────────────────────────
    import os
    if threads <= 0:
        threads = max(2, (os.cpu_count() or 4) // 2)

    params = _build_msfragger_params(
        fasta_path=fasta_path,
        output_dir=output_dir,
        vendor=vendor,
        immuno_class=immuno_class,
        threads=threads,
    )

    params_path = output_dir / "msfragger.params"
    with open(params_path, "w") as fh:
        for k, v in params.items():
            fh.write(f"{k} = {v}\n")

    # ── Find Java ─────────────────────────────────────────────────────────────
    java_exe = _find_fragpipe_java() or shutil.which("java")
    if java_exe is None:
        logger.error(
            "Java not found on PATH and no FragPipe-bundled JRE found. "
            "Install Java 8+ or FragPipe.",
        )
        return None

    # ── Build command ─────────────────────────────────────────────────────────
    cmd = [java_exe, "-Xmx32g"]

    # Add Bruker timsdata.dll directory to java.library.path
    bruker_lib = _find_bruker_lib_for_msfragger()
    if bruker_lib:
        cmd.append(f"-Djava.library.path={bruker_lib}")
        logger.debug("MSFragger bruker_lib: %s", bruker_lib)
    else:
        logger.warning(
            "timsdata.dll not found near MSFragger jar — timsTOF native "
            "reading may fail.  Copy timsdata.dll next to %s.",
            jar,
        )

    cmd += ["-jar", jar, str(params_path), str(raw_path)]

    logger.info("Running MSFragger on: %s", raw_path.name)
    logger.info("Command: %s", " ".join(cmd))

    log_file = output_dir / "msfragger.log"
    try:
        with open(log_file, "w") as lf:
            subprocess.run(
                cmd,
                check=True,
                stdout=lf,
                stderr=subprocess.STDOUT,
                text=True,
                timeout=14400,
            )
        logger.info("MSFragger complete: %s", raw_path.name)
    except FileNotFoundError as e:
        logger.error("Java not found at: %s", java_exe)
        from stan.telemetry import report_error
        report_error(e, {"search_engine": "msfragger", "vendor": vendor})
        return None
    except subprocess.TimeoutExpired as e:
        logger.error("MSFragger timed out after 4 hours: %s", raw_path.name)
        from stan.telemetry import report_error
        report_error(e, {"search_engine": "msfragger", "vendor": vendor})
        _mirror_log_to_hive(log_file, raw_path.stem, "msfragger")
        return None
    except subprocess.CalledProcessError as e:
        logger.error("MSFragger failed (rc=%d): %s", e.returncode, raw_path.name)
        from stan.telemetry import report_error
        report_error(e, {"search_engine": "msfragger", "vendor": vendor})
        _mirror_log_to_hive(log_file, raw_path.stem, "msfragger")
        return None

    # ── Locate TSV output ─────────────────────────────────────────────────────
    # MSFragger writes <stem>.tsv to output_location (or next to input file)
    raw_stem = raw_path.stem  # e.g. "run.d" stem = "run" (Path.stem strips .d)
    # Actually raw_path is a .d dir so raw_path.stem already strips .d
    tsv_candidates = [
        output_dir / f"{raw_stem}.tsv",
        output_dir / f"{raw_path.name}.tsv",
        raw_path.parent / f"{raw_stem}.tsv",
        raw_path.parent / f"{raw_path.name}.tsv",
    ]

    tsv_path: Path | None = None
    for c in tsv_candidates:
        if c.exists():
            tsv_path = c
            break

    if tsv_path is None:
        # Broad search in both directories
        for search_dir in [output_dir, raw_path.parent]:
            found = list(search_dir.glob("*.tsv"))
            if found:
                tsv_path = found[0]
                logger.info("Found MSFragger TSV at: %s", tsv_path)
                break

    if tsv_path is None:
        logger.error(
            "MSFragger TSV not found for %s (searched %s and %s)",
            raw_path.name, output_dir, raw_path.parent,
        )
        _mirror_log_to_hive(log_file, raw_path.stem, "msfragger")
        return None

    # Move TSV (and matching .pin) to output_dir if they landed next to the raw file
    if tsv_path.parent != output_dir:
        dest = output_dir / tsv_path.name
        tsv_path.rename(dest)
        tsv_path = dest
        # Move matching .pin if present
        src_pin = tsv_path.with_suffix(".pin")
        if src_pin.exists():
            src_pin.rename(output_dir / src_pin.name)
    # Also move .pin when TSV is already in output_dir but pin is beside raw file
    pin_beside_raw = raw_path.parent / tsv_path.with_suffix(".pin").name
    if pin_beside_raw.exists() and pin_beside_raw.parent != output_dir:
        pin_beside_raw.rename(output_dir / pin_beside_raw.name)

    # ── Convert TSV → Sage-compatible parquet ─────────────────────────────────
    parquet_out = output_dir / "results.sage.parquet"
    result = _msfragger_tsv_to_sage_parquet(tsv_path, parquet_out)
    if result is None:
        logger.error(
            "MSFragger TSV conversion failed for %s", raw_path.name,
        )
        return None

    return result


def _convert_bruker_to_mzml(raw_path: Path, output_dir: Path) -> Path | None:
    """Convert a Bruker .d directory to mzML using ProteoWizard msconvert.

    This avoids the Sage timsrust stack-buffer-overrun crash that occurs when
    reading large (.d files with tdf_bin ≥ ~3 GB) files directly.

    Returns Path to the generated .mzML file, or None if msconvert is not
    available or conversion fails (caller falls back to direct .d input).
    """
    msconvert = _find_msconvert()
    if msconvert is None:
        return None

    stem = raw_path.stem  # e.g. "run_name.d" stem = "run_name.d" but Path.stem strips last ext
    # raw_path is a directory like "foo.d", so Path("foo.d").stem = "foo"
    mzml_path = output_dir / f"{raw_path.name}.mzML"  # e.g. run.d.mzML

    if mzml_path.exists():
        logger.info("Re-using existing mzML: %s", mzml_path.name)
        return mzml_path

    logger.info("Converting %s → mzML via msconvert…", raw_path.name)

    cmd = [
        msconvert,
        str(raw_path),
        "--mzML",
        "--ddaProcessing",                 # CRITICAL for Bruker ddaPASEF: combines all
                                           # ion-mobility sub-scans for the same precursor
                                           # into a single MS2 spectrum.  Without this flag
                                           # every TIMS step becomes its own spectrum and
                                           # a 1 GB .d file expands to 30–50 GB mzML.
        "--filter", "msLevel 2",           # MS2 only — Sage doesn't use MS1
        "--filter", "zeroSamples removeExtra",
        "--zlib",                          # zlib compression — ~50% size reduction
        "--32",                            # 32-bit floats — sufficient for peptide IDs,
                                           # halves float array size vs default 64-bit
        "--outdir", str(output_dir),
        "--outfile", mzml_path.name,
    ]

    try:
        result = subprocess.run(
            cmd,
            check=True,
            capture_output=True,
            text=True,
            timeout=3600,  # 1 hour — large files can be slow
        )
        logger.debug("msconvert stdout: %s", result.stdout[-500:])
    except FileNotFoundError:
        logger.warning("msconvert not found at: %s", msconvert)
        return None
    except subprocess.CalledProcessError as e:
        logger.error("msconvert failed for %s: %s", raw_path.name, e.stderr[-500:])
        return None
    except subprocess.TimeoutExpired:
        logger.error("msconvert timed out after 1 hour for %s", raw_path.name)
        return None

    if mzml_path.exists():
        logger.info("Converted: %s → %s (%.1f MB)",
                    raw_path.name, mzml_path.name, mzml_path.stat().st_size / 1e6)
        return mzml_path

    # msconvert sometimes names the output differently — search for any .mzML in output_dir
    for candidate in output_dir.glob("*.mzML"):
        logger.info("Found mzML output: %s", candidate.name)
        return candidate

    logger.error("mzML not found after msconvert for: %s", raw_path.name)
    return None
