"""Frozen community-standardized search parameters for benchmark submissions.

The community search uses small HeLa-specific predicted spectral libraries —
one for timsTOF (TIMS-CID fragmentation) and one for Orbitrap (HCD fragmentation).
These are hosted in the HF Dataset repo and downloaded to a local cache on Hive.

CRITICAL: These libraries and FASTA are NOT user-configurable for community
benchmark submissions. Changing them would invalidate cross-lab comparisons.
The whole point of STAN's benchmark is that every lab searches the same library
with the same parameters — precursor counts are only comparable when everything
upstream is identical.

Do not change any value below without:
  1. Incrementing SEARCH_PARAMS_VERSION
  2. Uploading the new library/FASTA to the HF Dataset repo
  3. Migrating or versioning old submissions
"""

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

SEARCH_PARAMS_VERSION = "v1.0.0"

# Pinned search engine versions for community benchmark reproducibility.
# Submissions that did not use these exact versions are rejected by the
# community relay. This is the only way to ensure cross-lab comparability —
# different DIA-NN versions produce meaningfully different results.
#
# For commercial users who cannot use DIA-NN 2.x (which requires a paid
# license for commercial use), STAN still works for local QC with any
# DIA-NN version — only community benchmark submission requires the
# pinned version.
#
# Do not upgrade these without also incrementing SEARCH_PARAMS_VERSION
# and rebuilding/re-uploading the community libraries.
PINNED_TOOL_VERSIONS = {
    "diann": "2.3.0",   # used to build hela_orbitrap_202604.parquet and hela_timstof_202604.parquet
    "sage": "0.14.7",
    "thermorawfileparser": "1.4.5",
}


def check_diann_version_compatible(version: str | None) -> tuple[bool, str]:
    """Check if a DIA-NN version matches the pinned community version.

    Returns (is_compatible, message).
    """
    if not version:
        return False, "DIA-NN version could not be detected"

    required = PINNED_TOOL_VERSIONS["diann"]

    # Match major.minor at minimum — allow patch differences within same minor
    req_parts = required.split(".")
    ver_parts = version.split(".")

    if len(req_parts) < 2 or len(ver_parts) < 2:
        return False, f"Invalid version format: {version}"

    if req_parts[0] != ver_parts[0] or req_parts[1] != ver_parts[1]:
        return False, (
            f"DIA-NN version mismatch: submission used {version}, "
            f"community benchmark requires {required}. "
            f"Different DIA-NN versions produce different results and cannot be "
            f"compared. Use DIA-NN {required} for community submissions."
        )

    return True, f"DIA-NN {version} matches pinned version {required}"

# HF Dataset repo where frozen community assets live
HF_DATASET_REPO = "brettsp/stan-benchmark"

# ── Frozen community FASTA (shared by both tracks) ────────────────────

COMMUNITY_FASTA_HF_PATH = "community_fasta/human_hela_202604.fasta"

# ── Frozen HeLa-specific empirical spectral libraries (Track B, DIA) ──
# Built from real HeLa DIA runs — empirical RTs, fragment intensities, and
# (for timsTOF) ion mobility values. HeLa-only (~45k precursors), not full
# human proteome. This keeps search fast (minutes, not hours).
#
# Format: .parquet (DIA-NN 2.0+ empirical library format, also accepted
# by --lib for searching). NOT .predicted.speclib (binary predicted format).

COMMUNITY_SPECLIB = {
    "bruker": {
        "hf_path": "community_library/hela_timstof_202604.parquet",
        "description": "HeLa empirical library for timsTOF (TIMS-CID, with IM)",
    },
    "thermo": {
        "hf_path": "community_library/hela_orbitrap_202604.parquet",
        "description": "HeLa empirical library for Orbitrap/Astral (HCD)",
    },
}

# Local cache directory on Hive for downloaded community assets
# This gets created by the SLURM job if it doesn't exist
COMMUNITY_CACHE_DIR = "/hive/data/stan_community_assets"

# ── DIA-NN parameters (Track B) ──────────────────────────────────────
# The --lib flag is set dynamically based on instrument vendor.
# The --fasta flag points to the shared community FASTA.
# Neither can be overridden for community benchmark submissions.

COMMUNITY_DIANN_PARAMS_FROZEN: dict = {
    # lib and fasta are set dynamically — see get_community_diann_params()
    "qvalue": 0.01,
    # Note: --protein-q is unrecognised in DIA-NN 2.3.x (just a warning, but remove
    # to keep logs clean).  Protein-level FDR is controlled by --fasta-search + --qvalue.
    "min-pep-len": 7,
    "max-pep-len": 30,
    "missed-cleavages": 1,
    "min-pr-charge": 2,
    "max-pr-charge": 4,
    "cut": "K*,R*",
    # Note: do NOT put "threads" here — run_diann_local adds --threads dynamically
    # to use half the available CPU cores (instrument PCs need headroom for acquisition).
}

COMMUNITY_DIANN_SLURM: dict = {
    "partition": "{hive_partition}",
    "account": "{hive_account}",
    "mem": "32G",
    "cpus-per-task": 8,
    "time": "02:00:00",
    "job-name": "stan-diann-{run_name}",
}


def get_community_diann_params(vendor: str, cache_dir: str | None = None) -> dict:
    """Get the full frozen DIA-NN parameters for a given instrument vendor.

    Args:
        vendor: "bruker" or "thermo" — determines which speclib to use.
        cache_dir: Override for the local cache directory on Hive.

    Returns:
        Complete DIA-NN parameter dict with lib and fasta paths resolved.
    """
    cache = cache_dir or COMMUNITY_CACHE_DIR

    speclib_info = COMMUNITY_SPECLIB.get(vendor)
    if speclib_info is None:
        raise ValueError(
            f"No community speclib for vendor '{vendor}'. "
            f"Supported: {list(COMMUNITY_SPECLIB.keys())}"
        )

    # Paths point to the local cache on Hive (downloaded by SLURM job)
    speclib_filename = speclib_info["hf_path"].split("/")[-1]
    fasta_filename = COMMUNITY_FASTA_HF_PATH.split("/")[-1]

    params = dict(COMMUNITY_DIANN_PARAMS_FROZEN)
    params["lib"] = f"{cache}/{speclib_filename}"
    params["fasta"] = f"{cache}/{fasta_filename}"

    # Fixed mass accuracy prevents DIA-NN auto-optimization mode, which can crash
    # on certain timsTOF files. Vendor-specific values follow DE-LIMP guidelines.
    if vendor == "thermo":
        params["mass-acc"] = 20   # Orbitrap MS2 (HCD)
        params["mass-acc-ms1"] = 10  # Orbitrap MS1
    else:
        params["mass-acc"] = 15   # timsTOF MS2
        params["mass-acc-ms1"] = 15  # timsTOF MS1

    return params


# ── Sage parameters (Track A) ────────────────────────────────────────
# Sage uses the community FASTA directly (no speclib needed for DDA).

COMMUNITY_SAGE_PARAMS: dict = {
    "database": {
        # fasta path set dynamically — see get_community_sage_params()
        "enzyme": {
            "missed_cleavages": 1,
            "min_len": 7,
            "max_len": 30,
            "cleave_at": "KR",
            "restrict": "P",
        },
        "static_mods": {"C": 57.0215},
        "variable_mods": {"M": [15.9949]},
        "max_variable_mods": 2,
    },
    "precursor_tol": {"ppm": [-10, 10]},
    "fragment_tol": {"ppm": [-20, 20]},
    "min_peaks": 8,
    "max_peaks": 150,
    "min_matched_peaks": 4,
    "target_fdr": 0.01,
    "deisotope": True,
}

COMMUNITY_SAGE_SLURM: dict = {
    "partition": "{hive_partition}",
    "account": "{hive_account}",
    "mem": "32G",
    "cpus-per-task": 8,
    "time": "02:00:00",
    "job-name": "stan-sage-{run_name}",
}


def get_community_sage_params(
    cache_dir: str | None = None,
    immuno_class: int = 0,
) -> dict:
    """Get the full frozen Sage parameters with FASTA path resolved.

    Args:
        cache_dir: Override for the local cache directory on Hive.
        immuno_class: 0=tryptic, 1=MHC-I non-specific, 2=MHC-II non-specific.

    Returns:
        Complete Sage parameter dict.
    """
    import copy

    cache = cache_dir or COMMUNITY_CACHE_DIR
    fasta_filename = COMMUNITY_FASTA_HF_PATH.split("/")[-1]

    params = copy.deepcopy(COMMUNITY_SAGE_PARAMS)
    params["database"]["fasta"] = f"{cache}/{fasta_filename}"

    if immuno_class == 1:
        # MHC-I: semi-enzymatic to avoid OOM. Fully non-specific against a full
        # proteome generates billions of 8-12 aa candidates and crashes Sage.
        params["database"]["enzyme"] = {"cleave_at": "KR", "missed_cleavages": 2, "semi_enzymatic": True}
        params["database"]["min_len"] = 8
        params["database"]["max_len"] = 12
        params["database"]["variable_mods"] = {"M": [15.9949], "N": [0.9840], "Q": [0.9840]}
        params["precursor_charge"] = [1, 3]
        params["min_peaks"] = 6
    elif immuno_class == 2:
        # MHC-II: semi-enzymatic for the same reason as MHC-I above.
        params["database"]["enzyme"] = {"cleave_at": "KR", "missed_cleavages": 2, "semi_enzymatic": True}
        params["database"]["min_len"] = 13
        params["database"]["max_len"] = 25
        params["database"]["variable_mods"] = {"M": [15.9949], "N": [0.9840], "Q": [0.9840]}
        params["precursor_charge"] = [2, 4]
        params["min_peaks"] = 6

    return params


def ensure_community_assets(vendor: str, cache_dir: str | Path) -> tuple[Path, Path]:
    """Ensure the community FASTA and spectral library are present in cache_dir.

    Resolution order for each file:
    1. Already present in cache_dir  →  use as-is
    2. FASTA only: bundled in the stan package (community_fasta/ directory)  →  copy
    3. Download from HuggingFace Dataset (brettsp/stan-benchmark)  →  place in cache_dir

    Args:
        vendor: "bruker" or "thermo"
        cache_dir: Local directory to store / look for the assets

    Returns:
        (fasta_path, speclib_path) — both guaranteed to exist on return.

    Raises:
        RuntimeError: if assets cannot be obtained (no internet, HF unavailable, etc.)
        ValueError: if vendor is not supported
    """
    import shutil

    cache = Path(cache_dir)
    cache.mkdir(parents=True, exist_ok=True)

    speclib_info = COMMUNITY_SPECLIB.get(vendor)
    if speclib_info is None:
        raise ValueError(
            f"No community speclib for vendor '{vendor}'. "
            f"Supported: {list(COMMUNITY_SPECLIB.keys())}"
        )

    fasta_filename = COMMUNITY_FASTA_HF_PATH.split("/")[-1]
    speclib_filename = speclib_info["hf_path"].split("/")[-1]

    fasta_dest = cache / fasta_filename
    speclib_dest = cache / speclib_filename

    # ── FASTA ─────────────────────────────────────────────────────────────
    if not fasta_dest.exists():
        # Try the bundled copy in the stan package first (no internet needed)
        try:
            import stan as _stan_pkg
            bundled = Path(_stan_pkg.__file__).parent.parent / "community_fasta" / fasta_filename
            if bundled.exists():
                shutil.copy2(str(bundled), str(fasta_dest))
                logger.info("Copied bundled FASTA to cache: %s", fasta_dest)
            else:
                raise FileNotFoundError(f"Bundled FASTA not at {bundled}")
        except Exception as bundle_err:
            logger.debug("Bundled FASTA not available (%s); trying HuggingFace...", bundle_err)
            try:
                from huggingface_hub import hf_hub_download
                logger.info("Downloading community FASTA from HuggingFace (~10 MB)…")
                dl = hf_hub_download(
                    repo_id=HF_DATASET_REPO,
                    filename=COMMUNITY_FASTA_HF_PATH,
                    repo_type="dataset",
                )
                shutil.copy2(dl, str(fasta_dest))
                logger.info("Downloaded community FASTA → %s", fasta_dest)
            except Exception as hf_err:
                raise RuntimeError(
                    f"Community FASTA '{fasta_filename}' is missing and could not be obtained.\n"
                    f"  Cache dir: {cache}\n"
                    f"  HuggingFace error: {hf_err}\n"
                    f"Fix: place the FASTA file at {fasta_dest} "
                    f"or set fasta_path in instruments.yml to use your own FASTA."
                ) from hf_err

    # ── Spectral library ──────────────────────────────────────────────────
    if not speclib_dest.exists():
        try:
            from huggingface_hub import hf_hub_download
            logger.info(
                "Downloading community spectral library for %s (~100–200 MB, first run only)…",
                vendor,
            )
            dl = hf_hub_download(
                repo_id=HF_DATASET_REPO,
                filename=speclib_info["hf_path"],
                repo_type="dataset",
            )
            shutil.copy2(dl, str(speclib_dest))
            logger.info("Downloaded community speclib → %s", speclib_dest)
        except Exception as hf_err:
            raise RuntimeError(
                f"Community spectral library '{speclib_filename}' is missing and could not be "
                f"downloaded from HuggingFace.\n"
                f"  Cache dir: {cache}\n"
                f"  HuggingFace error: {hf_err}\n"
                f"Fix options:\n"
                f"  1. Ensure internet access and re-run (one-time download ~100–200 MB)\n"
                f"  2. Manually place '{speclib_filename}' at {speclib_dest}\n"
                f"  3. Switch to local mode in instruments.yml:\n"
                f"       search_mode: local\n"
                f"       lib_path: /path/to/your/library.parquet\n"
                f"       fasta_path: /path/to/your/database.fasta"
            ) from hf_err

    return fasta_dest, speclib_dest


def build_asset_download_script(vendor: str, cache_dir: str | None = None) -> str:
    """Build shell commands to download frozen community assets from HF Dataset.

    This block goes at the top of the SLURM job script, before the search.
    Uses huggingface-cli to download the speclib and FASTA if not already cached.

    Args:
        vendor: "bruker" or "thermo".
        cache_dir: Override for cache directory.

    Returns:
        Shell script fragment for embedding in SLURM scripts.
    """
    cache = cache_dir or COMMUNITY_CACHE_DIR
    speclib_info = COMMUNITY_SPECLIB.get(vendor, {})
    speclib_hf_path = speclib_info.get("hf_path", "")
    speclib_filename = speclib_hf_path.split("/")[-1] if speclib_hf_path else ""
    fasta_filename = COMMUNITY_FASTA_HF_PATH.split("/")[-1]

    lines = [
        "# Download frozen community search assets (if not cached)",
        f"mkdir -p {cache}",
        "",
    ]

    # FASTA
    lines.append(f"if [ ! -f {cache}/{fasta_filename} ]; then")
    lines.append("  echo 'Downloading community FASTA...'")
    lines.append(
        f"  huggingface-cli download {HF_DATASET_REPO} "
        f"{COMMUNITY_FASTA_HF_PATH} "
        f"--repo-type dataset "
        f"--local-dir {cache}"
    )
    lines.append("  # Flatten: move from subdir to cache root")
    lines.append(f"  mv {cache}/{COMMUNITY_FASTA_HF_PATH} {cache}/{fasta_filename} 2>/dev/null || true")
    lines.append("fi")
    lines.append("")

    # Speclib (DIA only)
    if speclib_hf_path:
        lines.append(f"if [ ! -f {cache}/{speclib_filename} ]; then")
        lines.append(f"  echo 'Downloading community speclib ({vendor})...'")
        lines.append(
            f"  huggingface-cli download {HF_DATASET_REPO} "
            f"{speclib_hf_path} "
            f"--repo-type dataset "
            f"--local-dir {cache}"
        )
        lines.append(f"  mv {cache}/{speclib_hf_path} {cache}/{speclib_filename} 2>/dev/null || true")
        lines.append("fi")
        lines.append("")

    lines.append(f"echo 'Community assets ready in {cache}'")
    lines.append(f"ls -lh {cache}/")
    lines.append("")

    return "\n".join(lines)
