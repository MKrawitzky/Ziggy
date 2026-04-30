"""FastAPI dashboard backend — serves QC data and instrument config.

Runs on http://localhost:8421. Serves both API routes and the static React frontend.
"""

from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timezone
from pathlib import Path

import yaml
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from stan import __version__
from stan.config import (
    ConfigWatcher,
    resolve_config_path,
)
from stan.db import (
    get_db_path, get_run, get_runs, get_tic_trace, get_tic_traces_for_instrument,
    get_trends, init_db,
    get_columns_catalog, upsert_column, delete_column,
    get_lc_catalog, upsert_lc, delete_lc,
    update_run_setup,
)
from stan.file_detector import detect_format, format_label, format_badge_css

logger = logging.getLogger(__name__)

app = FastAPI(title="STAN Dashboard", version=__version__)


# ── File watcher — auto-search files dropped into watch folders ──────────────

_watcher_daemon = None

@app.on_event("startup")
async def _start_watcher() -> None:
    """Start the instrument folder watcher when the server starts."""
    global _watcher_daemon
    import threading
    try:
        from stan.watcher.daemon import WatcherDaemon
        _watcher_daemon = WatcherDaemon()
        t = threading.Thread(
            target=_watcher_daemon.run,
            name="watcher-daemon",
            daemon=True,
        )
        t.start()
        logger.info("File watcher started — monitoring instrument folders")
    except Exception:
        logger.warning("File watcher could not start", exc_info=True)


@app.on_event("shutdown")
async def _stop_watcher() -> None:
    global _watcher_daemon
    if _watcher_daemon is not None:
        try:
            _watcher_daemon.stop()
        except Exception:
            pass


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Mode helpers ─────────────────────────────────────────────────────
# Bruker files were historically labelled "DIA"/"DDA" by early baseline
# versions; modern watcher uses "diaPASEF"/"ddaPASEF".  Always use these
# helpers for mode comparisons so both labels are handled correctly.
#
# Search engine routing:
#   DIA (diaPASEF)  → DIA-NN   (library-based)
#   DDA (ddaPASEF)  → Sage     (native .d, non-specific for immuno)
#   DDA (Thermo)    → Sage     (.raw → mzML conversion)
#   DDA (ddaPASEF)  → MSFragger if FragPipe installed (preferred for DDA)
#
# DIA-NN is ONLY used for DIA data.  DDA searches go to MSFragger/Sage.

def _is_dia(mode: str) -> bool:
    """True for any DIA acquisition mode → route to DIA-NN library search."""
    return mode in ("DIA", "diaPASEF")


def _is_dda(mode: str) -> bool:
    """True for any DDA acquisition mode (all vendors)."""
    return mode in ("DDA", "ddaPASEF", "ddaMS2", "ddaMRM")


def _is_bruker_dda(mode: str) -> bool:
    """True for Bruker ddaPASEF — routes to Sage (or MSFragger if available)."""
    return mode == "ddaPASEF"


def _is_thermo_dda(mode: str) -> bool:
    """True for Thermo DDA → route to Sage with mzML conversion."""
    return mode in ("DDA", "ddaMS2", "ddaMRM")


# ── Immunopeptidomics auto-detection ─────────────────────────────────
_IMMUNO_KEYWORDS = frozenset([
    "hla", "mhc", "immuno", "immunopep", "peptidome", "ligandome",
    "hla1", "hla2", "mhci", "mhcii", "mhc1", "mhc2",
    "immunopeptidomics", "hla_pool", "hlapool",
])
_MHC2_KEYWORDS = frozenset([
    "hla2", "mhc2", "mhcii", "hla_ii", "hla-ii", "classii", "class_ii",
    "hla2pool", "mhcii", "drb", "dp", "dq",
])


def _is_immuno_run(run_name: str) -> bool:
    """Return True if the run name looks like an immunopeptidomics sample."""
    lower = run_name.lower()
    return any(kw in lower for kw in _IMMUNO_KEYWORDS)


def _immuno_class(run_name: str) -> int:
    """Return 1 (MHC-I), 2 (MHC-II), or 0 (unknown/mixed) for HLA samples."""
    lower = run_name.lower()
    if any(kw in lower for kw in _MHC2_KEYWORDS):
        return 2
    # 'hla1', 'mhci', 'mhc1', 'class_i' → MHC-I
    if any(kw in lower for kw in ["hla1", "mhc1", "mhci", "classi", "class_i", "hla1pool"]):
        return 1
    # Generic 'hla' or 'mhc' without class marker → treat as MHC-I (more common)
    return 1


def _suggest_preset(run: dict) -> str:
    """Return the best search preset key for a run based on name + mode.

    Priority order (highest → lowest):
    1. Immunopeptidomics (HLA / MHC keywords) — very distinctive workflow
    2. Phospho enrichment  — Trypsin + Phospho(STY)
    3. TMT / iTRAQ labelling — fixed TMT mods required
    4. Single-cell keywords — relaxed settings
    5. HeLa / K562 alone — standard tryptic digest (fallback for these cell lines)
    6. Everything else — standard tryptic digest
    """
    name = run.get("run_name", "")
    mode = run.get("mode", "")
    name_lower = name.lower()

    # 1. Immunopeptidomics — always trumps everything else
    if _is_immuno_run(name):
        cls = _immuno_class(name)
        if _is_dia(mode):
            return "mhc_class_i_dia" if cls == 1 else "mhc_class_ii_dia"
        else:
            return "mhc_class_i_dda" if cls == 1 else "mhc_class_ii_dda"

    # 2. Phospho enrichment — check before generic cell-line names so that
    #    "HeLa_phospho_TiO2" correctly gets the phospho preset, not hela_digest
    if any(k in name_lower for k in ["phospho", "phos", "sty", "timsphos"]):
        return "phospho"

    # 3. Quantitative labelling
    if any(k in name_lower for k in ["tmt", "itraq"]):
        return "tmt"

    # 4. Single-cell / ultra-low input
    if any(k in name_lower for k in ["sc_", "singlecell", "single_cell", "1cell",
                                      "1pg", "8pg", "40pg", "200pg"]):
        return "single_cell"

    # 5 & 6. Standard digest — HeLa, K562, or any other sample
    return "hela_digest"


def _detect_mode_from_tdf(d_path) -> str:
    """Read MsmsType from a Bruker .d/analysis.tdf and return mode string.

    Returns 'ddaPASEF', 'diaPASEF', or 'diaPASEF' as default.
    """
    tdf = Path(d_path) / "analysis.tdf"
    if not tdf.exists():
        return "diaPASEF"
    try:
        with _sqlite3_sa.connect(str(tdf)) as con:
            type_rows = con.execute(
                "SELECT MsmsType FROM Frames GROUP BY MsmsType"
            ).fetchall()
            types = {r[0] for r in type_rows}
            # MsmsType 8 = ddaPASEF, 9 = diaPASEF, 0 = MS1-only
            if 8 in types and 9 not in types:
                return "ddaPASEF"
    except Exception:
        pass
    return "diaPASEF"


# Config watchers — hot-reload on API access
_instruments_watcher: ConfigWatcher | None = None
_thresholds_watcher: ConfigWatcher | None = None


def _get_instruments_watcher() -> ConfigWatcher | None:
    global _instruments_watcher
    if _instruments_watcher is None:
        try:
            _instruments_watcher = ConfigWatcher(resolve_config_path("instruments.yml"))
        except FileNotFoundError:
            return None
    elif _instruments_watcher.is_stale():
        _instruments_watcher.reload()
    return _instruments_watcher


def _get_thresholds_watcher() -> ConfigWatcher | None:
    global _thresholds_watcher
    if _thresholds_watcher is None:
        try:
            _thresholds_watcher = ConfigWatcher(resolve_config_path("thresholds.yml"))
        except FileNotFoundError:
            return None
    elif _thresholds_watcher.is_stale():
        _thresholds_watcher.reload()
    return _thresholds_watcher


# ── Startup ──────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup() -> None:
    """Initialize database on startup."""
    init_db()


# ── API Routes ───────────────────────────────────────────────────────

@app.get("/api/version")
async def api_version() -> dict:
    return {"version": __version__}


@app.get("/api/runs")
async def api_runs(
    instrument: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Fetch recent QC runs, optionally filtered by instrument."""
    return get_runs(instrument=instrument, limit=limit, offset=offset)


@app.get("/api/runs/{run_id}")
async def api_run_detail(run_id: str) -> dict:
    """Fetch a single run with all metrics."""
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    # Parse JSON fields
    if run.get("failed_gates"):
        try:
            run["failed_gates"] = json.loads(run["failed_gates"])
        except (json.JSONDecodeError, TypeError):
            pass
    return run


@app.get("/api/instruments")
async def api_instruments() -> dict:
    """List instruments from instruments.yml (hot-reloaded)."""
    watcher = _get_instruments_watcher()
    if watcher is None:
        return {"instruments": []}
    return watcher.data


class InstrumentsUpdate(BaseModel):
    yaml_content: str


@app.post("/api/instruments")
async def api_update_instruments(body: InstrumentsUpdate) -> dict:
    """Update instruments.yml from the dashboard UI."""
    try:
        data = yaml.safe_load(body.yaml_content)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")

    if not isinstance(data, dict) or "instruments" not in data:
        raise HTTPException(status_code=400, detail="YAML must contain 'instruments' key")

    config_path = resolve_config_path("instruments.yml")
    config_path.write_text(body.yaml_content)

    # Force reload
    watcher = _get_instruments_watcher()
    watcher.reload()

    return {"status": "ok", "instruments": len(data.get("instruments", []))}


@app.delete("/api/instruments/{index}")
async def api_delete_instrument(index: int) -> dict:
    """Delete an instrument by its index in the instruments list."""
    config_path = resolve_config_path("instruments.yml")
    data = yaml.safe_load(config_path.read_text()) or {}
    instruments = data.get("instruments", [])

    if index < 0 or index >= len(instruments):
        raise HTTPException(status_code=404, detail="Instrument index out of range")

    removed = instruments.pop(index)
    data["instruments"] = instruments
    config_path.write_text(yaml.dump(data, default_flow_style=False, sort_keys=False))

    watcher = _get_instruments_watcher()
    watcher.reload()

    return {"status": "ok", "removed": removed.get("name", "unknown"), "remaining": len(instruments)}


@app.get("/api/trends/{instrument}")
async def api_trends(instrument: str, limit: int = 100) -> list[dict]:
    """Fetch time-series metrics for trend charts."""
    return get_trends(instrument=instrument, limit=limit)


@app.get("/api/thresholds")
async def api_thresholds() -> dict:
    """Get current QC thresholds (hot-reloaded)."""
    watcher = _get_thresholds_watcher()
    if watcher is None:
        return {}
    return watcher.data


class ThresholdsUpdate(BaseModel):
    yaml_content: str


@app.post("/api/thresholds")
async def api_update_thresholds(body: ThresholdsUpdate) -> dict:
    """Update thresholds.yml from the dashboard UI."""
    try:
        yaml.safe_load(body.yaml_content)
    except yaml.YAMLError as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")

    config_path = resolve_config_path("thresholds.yml")
    config_path.write_text(body.yaml_content)

    watcher = _get_thresholds_watcher()
    watcher.reload()

    return {"status": "ok"}


# ── FASTA & spectral library management ─────────────────────────────────────

# Organisms available for one-click UniProt download.
# proteome = UniProt reference proteome ID, n_reviewed = approx Swiss-Prot count.
UNIPROT_ORGANISMS: dict[str, dict] = {
    "human":       {"label": "Human",       "taxon": "Homo sapiens",             "proteome": "UP000005640", "n_reviewed": 20_400},
    "mouse":       {"label": "Mouse",       "taxon": "Mus musculus",              "proteome": "UP000000589", "n_reviewed": 17_100},
    "yeast":       {"label": "Yeast",       "taxon": "Saccharomyces cerevisiae",  "proteome": "UP000002311", "n_reviewed":  6_000},
    "ecoli":       {"label": "E. coli",     "taxon": "Escherichia coli K-12",     "proteome": "UP000000625", "n_reviewed":  4_400},
    "zebrafish":   {"label": "Zebrafish",   "taxon": "Danio rerio",               "proteome": "UP000000437", "n_reviewed":  3_500},
    "celegans":    {"label": "C. elegans",  "taxon": "Caenorhabditis elegans",    "proteome": "UP000001940", "n_reviewed":  4_000},
    "arabidopsis": {"label": "Arabidopsis", "taxon": "Arabidopsis thaliana",      "proteome": "UP000006548", "n_reviewed": 15_800},
    "plasma":      {"label": "Plasma",      "taxon": "Homo sapiens (+ isoforms)", "proteome": "UP000005640", "n_reviewed": 20_400, "isoforms": True},
}

# In-memory job registry — these are one-time setup operations so memory is fine.
_download_jobs: dict[str, dict] = {}


def _fasta_dir() -> Path:
    from stan.config import get_user_config_dir
    d = get_user_config_dir() / "fasta"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _library_dir() -> Path:
    from stan.config import get_user_config_dir
    d = get_user_config_dir() / "libraries"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _file_entry(p: Path) -> dict:
    """Return metadata dict for a stored file."""
    stat = p.stat()
    return {
        "name":      p.name,
        "path":      str(p),
        "size_mb":   round(stat.st_size / 1_048_576, 2),
        "uploaded":  datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
    }


@app.get("/api/fasta")
async def api_list_fasta() -> list[dict]:
    """List uploaded FASTA databases."""
    return sorted(
        [_file_entry(f) for f in _fasta_dir().iterdir() if f.is_file()],
        key=lambda x: x["uploaded"], reverse=True,
    )


@app.post("/api/fasta")
async def api_upload_fasta(file: UploadFile = File(...)) -> dict:
    """Upload a FASTA database file (.fasta / .fa / .fas)."""
    name = Path(file.filename).name
    if not name:
        raise HTTPException(status_code=400, detail="No filename provided")
    allowed = {".fasta", ".fa", ".fas", ".faa"}
    if Path(name).suffix.lower() not in allowed:
        raise HTTPException(status_code=400, detail=f"Allowed extensions: {', '.join(sorted(allowed))}")

    dest = _fasta_dir() / name
    content = await file.read()
    dest.write_bytes(content)
    logger.info("FASTA uploaded: %s (%d bytes)", name, len(content))
    return _file_entry(dest)


@app.delete("/api/fasta/{filename}")
async def api_delete_fasta(filename: str) -> dict:
    """Delete a FASTA database file."""
    # Prevent path traversal
    name = Path(filename).name
    target = _fasta_dir() / name
    if not target.exists():
        raise HTTPException(status_code=404, detail="File not found")
    target.unlink()
    logger.info("FASTA deleted: %s", name)
    return {"status": "deleted", "name": name}


@app.get("/api/libraries")
async def api_list_libraries() -> list[dict]:
    """List uploaded spectral libraries."""
    return sorted(
        [_file_entry(f) for f in _library_dir().iterdir() if f.is_file()],
        key=lambda x: x["uploaded"], reverse=True,
    )


@app.post("/api/libraries")
async def api_upload_library(file: UploadFile = File(...)) -> dict:
    """Upload a spectral library (.parquet / .speclib / .tsv / .csv)."""
    name = Path(file.filename).name
    if not name:
        raise HTTPException(status_code=400, detail="No filename provided")
    allowed = {".parquet", ".speclib", ".tsv", ".csv", ".txt"}
    if Path(name).suffix.lower() not in allowed:
        raise HTTPException(status_code=400, detail=f"Allowed extensions: {', '.join(sorted(allowed))}")

    dest = _library_dir() / name
    content = await file.read()
    dest.write_bytes(content)
    logger.info("Library uploaded: %s (%d bytes)", name, len(content))
    return _file_entry(dest)


@app.delete("/api/libraries/{filename}")
async def api_delete_library(filename: str) -> dict:
    """Delete a spectral library file."""
    name = Path(filename).name
    target = _library_dir() / name
    if not target.exists():
        raise HTTPException(status_code=404, detail="File not found")
    target.unlink()
    logger.info("Library deleted: %s", name)
    return {"status": "deleted", "name": name}


class AssignLibraryRequest(BaseModel):
    instrument_index: int
    fasta_path: str | None = None
    lib_path: str | None = None


@app.post("/api/config/assign")
async def api_assign_library(body: AssignLibraryRequest) -> dict:
    """Assign a FASTA and/or spectral library to an instrument in instruments.yml."""
    config_path = resolve_config_path("instruments.yml")
    data = yaml.safe_load(config_path.read_text()) or {}
    instruments = data.get("instruments", [])

    if body.instrument_index < 0 or body.instrument_index >= len(instruments):
        raise HTTPException(status_code=404, detail="Instrument index out of range")

    inst = instruments[body.instrument_index]
    if body.fasta_path is not None:
        if body.fasta_path:
            # Resolve bare filename → full path inside the managed fasta dir
            p = Path(body.fasta_path)
            if not p.is_absolute():
                p = _fasta_dir() / p.name
            inst["fasta_path"] = str(p)
        else:
            inst.pop("fasta_path", None)
    if body.lib_path is not None:
        if body.lib_path:
            p = Path(body.lib_path)
            if not p.is_absolute():
                p = _library_dir() / p.name
            inst["lib_path"] = str(p)
        else:
            inst.pop("lib_path", None)

    data["instruments"] = instruments
    config_path.write_text(yaml.dump(data, default_flow_style=False, sort_keys=False))

    watcher = _get_instruments_watcher()
    if watcher:
        watcher.reload()

    return {"status": "ok", "instrument": inst.get("name", str(body.instrument_index))}


# ── Global search parameters (mods, enzyme, FASTA defaults) ─────────────────

_DEFAULT_SEARCH_PARAMS: dict = {
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

def _search_params_path() -> Path:
    from stan.config import get_user_config_dir
    return get_user_config_dir() / "search_params.json"


def get_search_params() -> dict:
    """Load global search params, falling back to defaults for missing keys."""
    import json
    p = _search_params_path()
    stored: dict = {}
    if p.exists():
        try:
            stored = json.loads(p.read_text())
        except Exception:
            pass
    return {**_DEFAULT_SEARCH_PARAMS, **stored}


@app.get("/api/search-params")
async def api_get_search_params() -> dict:
    """Return the global search parameter defaults used by comparison engines."""
    return get_search_params()


@app.post("/api/search-params")
async def api_set_search_params(body: dict) -> dict:
    """Persist global search parameters (enzyme, mods, tolerances, FASTA path)."""
    import json
    current = get_search_params()
    merged = {**current, **{k: v for k, v in body.items() if k in _DEFAULT_SEARCH_PARAMS}}
    _search_params_path().write_text(json.dumps(merged, indent=2))
    return merged


# ── UniProt FASTA download ────────────────────────────────────────────────────

@app.get("/api/fasta/organisms")
async def api_fasta_organisms() -> dict:
    """Return the list of downloadable organisms with their UniProt proteome IDs."""
    return UNIPROT_ORGANISMS


class FastaDownloadRequest(BaseModel):
    organism: str
    reviewed_only: bool = True


@app.post("/api/fasta/download")
async def api_start_fasta_download(body: FastaDownloadRequest) -> dict:
    """Start a background FASTA download from UniProt. Returns a job_id to poll."""
    if body.organism not in UNIPROT_ORGANISMS:
        raise HTTPException(status_code=400, detail=f"Unknown organism: {body.organism}")

    job_id = str(__import__("uuid").uuid4())[:12]
    _download_jobs[job_id] = {
        "status":   "queued",
        "organism": body.organism,
        "progress": 0,
        "filename": None,
        "error":    None,
    }
    t = threading.Thread(
        target=_do_fasta_download,
        args=(job_id, body.organism, body.reviewed_only),
        daemon=True,
        name=f"fasta-dl-{body.organism}",
    )
    t.start()
    return {"job_id": job_id, "status": "queued"}


@app.get("/api/fasta/download/{job_id}")
async def api_poll_fasta_download(job_id: str) -> dict:
    """Poll the status of a FASTA download job."""
    job = _download_jobs.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _append_decoys(text: str) -> str:
    """Parse FASTA text, append reversed decoy entries with rev_ prefix.

    Each target sequence is reversed (not scrambled) and prefixed with rev_.
    Matches the convention used by MSFragger (rev_), DIA-NN (rev_), and X!Tandem.
    """
    entries: list[tuple[str, str]] = []
    header: str | None = None
    seq_parts: list[str] = []

    for line in text.splitlines():
        if line.startswith(">"):
            if header is not None:
                entries.append((header, "".join(seq_parts)))
            header = line[1:]   # strip >
            seq_parts = []
        elif line.strip():
            seq_parts.append(line.strip())
    if header is not None:
        entries.append((header, "".join(seq_parts)))

    decoy_lines: list[str] = []
    for hdr, seq in entries:
        decoy_lines.append(f">rev_{hdr}")
        rev = seq[::-1]
        for i in range(0, len(rev), 60):
            decoy_lines.append(rev[i:i+60])

    return text.rstrip("\n") + "\n" + "\n".join(decoy_lines) + "\n"


def _do_fasta_download(job_id: str, organism_key: str, reviewed_only: bool) -> None:
    """Background thread: download FASTA from UniProt REST API, add rev_ decoys, save."""
    import httpx

    job = _download_jobs[job_id]
    org = UNIPROT_ORGANISMS[organism_key]
    proteome = org["proteome"]
    include_isoforms = org.get("isoforms", False)

    query_parts = [f"proteome:{proteome}"]
    if reviewed_only:
        query_parts.insert(0, "reviewed:true")
    query = " AND ".join(query_parts)

    url = (
        "https://rest.uniprot.org/uniprotkb/stream"
        f"?format=fasta&query={query}&compressed=false"
        + ("&includeIsoform=true" if include_isoforms else "")
    )

    slug = "reviewed" if reviewed_only else "all"
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    filename = f"{organism_key}_{slug}_decoys_{today}.fasta"
    dest = _fasta_dir() / filename

    job.update({"status": "downloading", "filename": filename, "progress": 5})
    logger.info("UniProt FASTA download starting: %s → %s", organism_key, filename)

    try:
        chunks: list[bytes] = []
        downloaded = 0
        content_length = 0

        with httpx.Client(timeout=httpx.Timeout(10.0, read=300.0), follow_redirects=True) as client:
            with client.stream("GET", url) as resp:
                resp.raise_for_status()
                content_length = int(resp.headers.get("content-length", 0))
                for chunk in resp.iter_bytes(chunk_size=65_536):
                    chunks.append(chunk)
                    downloaded += len(chunk)
                    if content_length:
                        job["progress"] = 5 + int(downloaded * 75 / content_length)

        raw_text = b"".join(chunks).decode("utf-8", errors="replace")

        if not raw_text.strip().startswith(">"):
            job.update({"status": "failed", "error": "UniProt returned non-FASTA content"})
            return

        n_targets = raw_text.count("\n>") + (1 if raw_text.startswith(">") else 0)
        job.update({"status": "adding_decoys", "progress": 82})
        logger.info("Adding rev_ decoys to %s (%d target sequences)", filename, n_targets)

        with_decoys = _append_decoys(raw_text)

        job.update({"status": "saving", "progress": 95})
        dest.write_text(with_decoys, encoding="utf-8")

        size_mb = round(dest.stat().st_size / 1_048_576, 2)
        job.update({
            "status":    "done",
            "filename":  filename,
            "progress":  100,
            "n_targets": n_targets,
            "n_total":   n_targets * 2,
            "size_mb":   size_mb,
            "uploaded":  datetime.now(timezone.utc).isoformat(),
        })
        logger.info("FASTA download complete: %s — %d proteins + decoys, %.1f MB",
                    filename, n_targets, size_mb)

    except Exception as exc:
        job.update({"status": "failed", "error": str(exc)})
        logger.error("FASTA download failed for %s: %s", organism_key, exc, exc_info=True)
        if dest.exists():
            dest.unlink(missing_ok=True)


# ── Spectral library presets / links ─────────────────────────────────────────

@app.get("/api/libraries/presets")
async def api_library_presets() -> list[dict]:
    """Return known spectral library sources for common organisms and instruments."""
    return [
        {
            "source":      "Bruker (ProteoScape)",
            "description": "timsTOF-optimized .parquet libraries for diaPASEF — HeLa, plasma, and more.",
            "url":         "https://help.proteoscape.io",
            "url_label":   "help.proteoscape.io → Additional Resources",
            "format":      ".parquet",
            "engines":     ["diann"],
            "instrument":  "timsTOF",
            "how_to_get":  "browser_download",
        },
        {
            "source":      "STAN built-in (community benchmark)",
            "description": "Frozen HeLa libraries for benchmark reproducibility. Installed by `stan baseline`.",
            "url":         None,
            "url_label":   "run: stan baseline",
            "format":      ".parquet / .speclib",
            "engines":     ["diann"],
            "instrument":  "timsTOF / Orbitrap",
            "how_to_get":  "stan_baseline",
        },
        {
            "source":      "PeptideAtlas",
            "description": "Public DIA libraries for human, mouse, yeast and more (OpenSWATH .tsv format).",
            "url":         "https://peptideatlas.org/speclib/",
            "url_label":   "peptideatlas.org/speclib",
            "format":      ".tsv",
            "engines":     ["diann"],
            "instrument":  "Orbitrap / generic",
            "how_to_get":  "browser_download",
        },
        {
            "source":      "ProteomeTools",
            "description": "Synthetic human spectral libraries (PXD004732). High sequence coverage.",
            "url":         "https://www.proteomicsdb.org/proteometools/",
            "url_label":   "proteomicsdb.org/proteometools",
            "format":      ".tsv / .blib",
            "engines":     ["diann"],
            "instrument":  "Orbitrap",
            "how_to_get":  "browser_download",
        },
    ]


@app.get("/api/instruments/{instrument}/events")
async def api_events(instrument: str, limit: int = 50) -> list[dict]:
    """Fetch maintenance events for an instrument."""
    from stan.db import get_events
    return get_events(instrument=instrument, limit=limit)


class LogEventRequest(BaseModel):
    event_type: str
    notes: str = ""
    operator: str = ""
    column_vendor: str | None = None
    column_model: str | None = None


@app.post("/api/instruments/{instrument}/events")
async def api_log_event(instrument: str, body: LogEventRequest) -> dict:
    """Log a maintenance event from the dashboard UI."""
    from stan.db import log_event, EVENT_TYPES
    if body.event_type not in EVENT_TYPES:
        raise HTTPException(status_code=400, detail=f"Invalid event type. Valid: {EVENT_TYPES}")
    event_id = log_event(
        instrument=instrument,
        event_type=body.event_type,
        notes=body.notes,
        operator=body.operator,
        column_vendor=body.column_vendor,
        column_model=body.column_model,
    )
    return {"event_id": event_id, "status": "logged"}


@app.get("/api/instruments/{instrument}/column-life")
async def api_column_life(instrument: str) -> dict:
    """Column lifetime stats since last column change."""
    from stan.db import get_column_lifetime
    return get_column_lifetime(instrument=instrument)


@app.get("/api/instruments/{instrument}/last-qc")
async def api_last_qc(instrument: str) -> dict:
    """Time since last QC run on this instrument."""
    from stan.db import time_since_last_qc
    return time_since_last_qc(instrument=instrument)


def _resolve_features_path(run: dict):
    """Return the Path to the .features file for a run, or None.

    Priority:
      1. features_path column in DB (set by auto 4DFF after watcher processes the run)
      2. Filesystem search via find_features_file (for pre-existing .features files)
    Returns None if no .features file is found — callers should then fall
    back to DIA-NN report.parquet via _resolve_report_path.
    """
    from stan.metrics.mobility_viz import find_features_file

    stored = run.get("features_path", "")
    if stored:
        p = Path(stored)
        if p.exists():
            return p

    raw_path = run.get("raw_path", "")
    if not raw_path:
        return None
    return find_features_file(raw_path)


def _resolve_report_path(run: dict) -> Path | None:
    """Return the DIA-NN report.parquet path for a run, or None.

    Returns None immediately for DDA runs — DIA-NN cannot search DDA/ddaPASEF
    data and its output will be empty.  Callers should use _resolve_sage_path
    for DDA modes instead.

    Priority (DIA runs only):
      1. result_path column in DB — only if it points to report.parquet
         (DDA runs store results.sage.parquet there; those are handled by
         _resolve_sage_path instead)
      2. Disk fallback: <raw_parent>/stan_results/<run_stem>/report.parquet
      3. Disk fallback: report.parquet directly next to the .d directory
    """
    mode = run.get("mode", "")
    if mode in ("DDA", "ddaPASEF", "ddaMS2", "ddaMRM"):
        return None  # DDA: skip DIA-NN entirely — use _resolve_sage_path

    stored = run.get("result_path", "")
    if stored and Path(stored).name == "report.parquet":
        p = Path(stored)
        if p.exists():
            return p

    raw_path = run.get("raw_path", "")
    if not raw_path:
        return None

    raw = Path(raw_path)
    stem = raw.stem  # e.g. "Run01" from "Run01.d"

    # Convention 1: <parent>/stan_results/<stem>/report.parquet
    candidate = raw.parent / "stan_results" / stem / "report.parquet"
    if candidate.exists():
        return candidate

    # Convention 2: report.parquet sitting directly next to the .d directory
    candidate2 = raw.parent / "report.parquet"
    if candidate2.exists():
        return candidate2

    return None


def _resolve_sage_path(run: dict) -> Path | None:
    """Return the Sage results.sage.parquet path for a run, or None.

    Used as a fallback for DDA/ddaPASEF runs that went through Sage instead
    of DIA-NN.  Mirrors the same priority order as _resolve_report_path.
    """
    stored = run.get("result_path", "")
    if stored and Path(stored).name == "results.sage.parquet":
        p = Path(stored)
        if p.exists():
            return p

    raw_path = run.get("raw_path", "")
    if not raw_path:
        return None

    raw  = Path(raw_path)
    stem = raw.stem

    candidate = raw.parent / "stan_results" / stem / "results.sage.parquet"
    if candidate.exists():
        return candidate

    candidate2 = raw.parent / "results.sage.parquet"
    if candidate2.exists():
        return candidate2

    return None


def _resolve_chimerys_path(run: dict) -> Path | None:
    """Return path to a locally-cached Chimerys PSM parquet for this run, or None.

    Chimerys results are downloaded from the MSAID Platform and cached at
    ~/.stan/chimerys_cache/<experiment_uuid>_PSMS.parquet.
    The run record may store the experiment UUID in the 'chimerys_experiment_uuid'
    column, or a direct parquet path in 'chimerys_path'.

    Disk fallback: <stan_results>/<stem>/chimerys_psms.parquet
    """
    # 1. Direct path stored on run record
    stored = run.get("chimerys_path", "")
    if stored:
        p = Path(stored)
        if p.exists():
            return p

    # 2. Cached download via experiment UUID
    exp_uuid = run.get("chimerys_experiment_uuid", "")
    if exp_uuid:
        cache = Path.home() / ".stan" / "chimerys_cache" / f"{exp_uuid}_PSMS.parquet"
        if cache.exists():
            return cache

    # 3. Disk fallback next to stan_results output
    raw_path = run.get("raw_path", "")
    if raw_path:
        raw = Path(raw_path)
        for name in ("chimerys_psms.parquet", "chimerys_PSMS.parquet"):
            candidate = raw.parent / "stan_results" / raw.stem / name
            if candidate.exists():
                return candidate

    return None


@app.get("/api/runs/{run_id}/tic")
async def api_tic_trace(run_id: str) -> dict:
    """Fetch TIC trace for a single run.

    Checks the tic_traces DB table first; if missing, falls back to
    extracting directly from the raw file (Bruker .d or DIA-NN report.parquet)
    and caches the result in the DB for future requests.
    """
    trace = get_tic_trace(run_id)
    if trace:
        return trace

    # Not in DB — try to extract on-the-fly and cache it
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    from stan.metrics.tic import (
        downsample_trace,
        extract_tic_bruker,
        extract_tic_from_report,
    )
    from stan.db import insert_tic_trace
    from stan.config import get_user_config_dir

    raw_path_str = run.get("raw_path", "") or ""
    run_name = run.get("run_name", "") or ""
    live_trace = None

    # 1. Bruker .d raw TIC
    if raw_path_str.endswith(".d"):
        raw_path = Path(raw_path_str)
        if raw_path.exists():
            try:
                live_trace = extract_tic_bruker(raw_path)
            except Exception:
                pass

    # 2. Identified TIC from DIA-NN report.parquet
    if live_trace is None:
        output_dir = get_user_config_dir() / "baseline_output"
        stem = Path(raw_path_str).stem if raw_path_str else run_name
        for variant in (stem, run_name):
            if not variant:
                continue
            candidate = output_dir / variant / "report.parquet"
            if candidate.exists():
                try:
                    live_trace = extract_tic_from_report(candidate)
                    break
                except Exception:
                    pass

    if live_trace is None:
        raise HTTPException(status_code=404, detail="No TIC trace for this run")

    live_trace = downsample_trace(live_trace, n_bins=128)
    try:
        insert_tic_trace(run_id, live_trace.rt_min, live_trace.intensity)
    except Exception:
        pass  # cache failure is non-fatal

    return {
        "run_id": run_id,
        "rt_min": live_trace.rt_min,
        "intensity": live_trace.intensity,
        "n_frames": len(live_trace.rt_min),
    }


@app.get("/api/runs/{run_id}/rawmeat")
async def api_rawmeat(run_id: str) -> dict:
    """RawMeat-style identification-free QC metrics from analysis.tdf.

    Reads the Bruker .d directory directly — no search results needed.
    Returns TIC by MS level, spray stability, accumulation times,
    pressure trace, frame-count summary, and instrument metadata.
    Returns empty dict if no .d path is stored or the file is missing.
    """
    from stan.metrics.rawmeat import extract_rawmeat_metrics

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    raw_path = run.get("raw_path", "")
    if not raw_path or not raw_path.endswith(".d"):
        return {}

    return extract_rawmeat_metrics(raw_path)


@app.get("/api/runs/{run_id}/lc-traces")
async def api_lc_traces(run_id: str) -> dict:
    """LC system traces from chromatography-data.sqlite inside the .d directory.

    Returns pump pressure, gradient, flow rate, column temperature, TIC, and BPC
    traces recorded by HyStar/nanoElute. Returns empty dict if unavailable.
    """
    from stan.metrics.chromatography_lc import get_lc_traces

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    raw_path = run.get("raw_path", "")
    if not raw_path or not raw_path.endswith(".d"):
        return {}

    return get_lc_traces(raw_path)


@app.get("/api/runs/{run_id}/mobility-map")
async def api_mobility_map(run_id: str, rt_bins: int = 60, mob_bins: int = 50) -> dict:
    """2D RT × 1/K0 density grid. Source: 4DFF .features > DIA-NN > Sage."""
    from stan.metrics.mobility_viz import get_mobility_map
    from stan.metrics.mobility_diann import get_mobility_map_diann
    from stan.metrics.mobility_sage import get_mobility_map_sage

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    features_path = _resolve_features_path(run)
    if features_path:
        return get_mobility_map(features_path, rt_bins=rt_bins, mobility_bins=mob_bins)

    report_path = _resolve_report_path(run)  # returns None for DDA runs
    if report_path:
        result = get_mobility_map_diann(report_path, run_name=run.get("run_name"), rt_bins=rt_bins, mobility_bins=mob_bins)
        if result:
            return result

    sage_path = _resolve_sage_path(run)
    if sage_path:
        return get_mobility_map_sage(sage_path, rt_bins=rt_bins, mobility_bins=mob_bins)

    chimerys_path = _resolve_chimerys_path(run)
    if chimerys_path:
        from stan.metrics.mobility_chimerys import get_mobility_map_chimerys
        return get_mobility_map_chimerys(chimerys_path, rt_bins=rt_bins, mobility_bins=mob_bins)

    return {}


@app.get("/api/runs/{run_id}/dia-windows")
async def api_dia_windows(run_id: str) -> dict:
    """diaPASEF isolation window layout from analysis.tdf.

    Returns the m/z × 1/K0 window grid for visualizing the DIA method.
    Returns empty dict if not a diaPASEF acquisition or .d path unavailable.
    """
    from stan.metrics.mobility_windows import extract_dia_windows

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    raw_path = run.get("raw_path", "")
    if not raw_path or not raw_path.endswith(".d"):
        return {}

    layout = extract_dia_windows(Path(raw_path))
    if layout is None:
        return {}

    return {
        "n_window_groups": layout.n_window_groups,
        "mz_range": list(layout.mz_range),
        "mobility_range": list(layout.mobility_range),
        "rt_range": list(layout.rt_range),
        "run_name": layout.run_name,
        "windows": [
            {
                "window_group": w.window_group,
                "mz_lower": w.mz_lower,
                "mz_upper": w.mz_upper,
                "scan_num_begin": w.scan_num_begin,
                "scan_num_end": w.scan_num_end,
                "oneoverk0_lower": round(w.oneoverk0_lower, 4),
                "oneoverk0_upper": round(w.oneoverk0_upper, 4),
                "rt_begin_sec": round(w.rt_begin_sec, 2),
                "rt_end_sec": round(w.rt_end_sec, 2),
            }
            for w in layout.windows
        ],
    }


@app.get("/api/runs/{run_id}/pasef-windows")
async def api_pasef_windows(run_id: str, max_events: int = 5000) -> dict:
    """ddaPASEF precursor isolation events from analysis.tdf.

    Returns individual precursor isolation boxes (RT × m/z × 1/K₀) for
    visualizing ddaPASEF coverage. Returns empty dict if not ddaPASEF.
    """
    from stan.metrics.mobility_windows import extract_pasef_windows

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    raw_path = run.get("raw_path", "")
    if not raw_path or not raw_path.endswith(".d"):
        return {}

    events = extract_pasef_windows(Path(raw_path), max_events=max_events)
    if not events:
        return {}

    return {
        "n_events": len(events),
        "events": [
            {
                "rt_sec": round(e.rt_sec, 2),
                "mz_lower": round(e.mz_lower, 3),
                "mz_upper": round(e.mz_upper, 3),
                "isolation_mz": round(e.isolation_mz, 3),
                "isolation_width": round(e.isolation_width, 3),
                "oneoverk0_lower": e.oneoverk0_lower,
                "oneoverk0_upper": e.oneoverk0_upper,
                "collision_energy": round(e.collision_energy, 1),
            }
            for e in events
        ],
    }


@app.get("/api/runs/{run_id}/mobility-3d")
async def api_mobility_3d(run_id: str, max_features: int = 5000) -> dict:
    """3D feature point cloud (RT × m/z × 1/K0). Source: 4DFF > DIA-NN > Sage."""
    from stan.metrics.mobility_viz import get_feature_3d_data
    from stan.metrics.mobility_diann import get_feature_3d_data_diann
    from stan.metrics.mobility_sage import get_feature_3d_data_sage

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    cap = min(max_features, 20_000)
    features_path = _resolve_features_path(run)
    if features_path:
        return get_feature_3d_data(features_path, max_features=cap)

    report_path = _resolve_report_path(run)  # returns None for DDA runs
    if report_path:
        result = get_feature_3d_data_diann(report_path, run_name=run.get("run_name"), max_features=cap)
        if result:
            return result

    sage_path = _resolve_sage_path(run)
    if sage_path:
        return get_feature_3d_data_sage(sage_path, max_features=cap)

    chimerys_path = _resolve_chimerys_path(run)
    if chimerys_path:
        from stan.metrics.mobility_chimerys import get_feature_3d_data_chimerys
        return get_feature_3d_data_chimerys(chimerys_path, max_features=cap)

    return {}


@app.get("/api/runs/{run_id}/mobility-stats")
async def api_mobility_stats(run_id: str) -> dict:
    """Charge distribution + FWHM + intensity histograms. Source: 4DFF > DIA-NN > Sage."""
    from stan.metrics.mobility_viz import (
        get_charge_distribution,
        get_intensity_histogram,
        get_mobility_fwhm_histogram,
    )
    from stan.metrics.mobility_diann import (
        get_charge_distribution_diann,
        get_fwhm_histogram_diann,
        get_intensity_histogram_diann,
    )
    from stan.metrics.mobility_sage import get_charge_distribution_sage

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    features_path = _resolve_features_path(run)
    if features_path:
        return {
            "charge_dist": get_charge_distribution(features_path),
            "fwhm_hist":   get_mobility_fwhm_histogram(features_path),
            "intensity_hist": get_intensity_histogram(features_path),
        }

    report_path = _resolve_report_path(run)  # returns None for DDA runs
    if report_path:
        run_name = run.get("run_name")
        result = {
            "charge_dist": get_charge_distribution_diann(report_path, run_name),
            "fwhm_hist":   get_fwhm_histogram_diann(report_path, run_name),
            "intensity_hist": get_intensity_histogram_diann(report_path, run_name),
        }
        if any(result.values()):
            return result

    sage_path = _resolve_sage_path(run)
    if sage_path:
        # Sage PSMs have no FWHM or quantity — charge dist is what's useful
        return {
            "charge_dist":   get_charge_distribution_sage(sage_path),
            "fwhm_hist":     {},
            "intensity_hist":{},
        }

    return {}


@app.get("/api/runs/{run_id}/peptides")
async def api_peptide_search(
    run_id: str,
    q: str = "",
    mz: float = 0.0,
    mz_ppm: float = 10.0,
    limit: int = 60,
) -> list:
    """Search peptides in a run's report.parquet.

    Returns up to `limit` unique precursors matching query string `q`
    (substring of stripped sequence) and/or `mz` (precursor m/z ± mz_ppm),
    sorted by intensity descending.
    """
    from stan.metrics.spectrum import search_peptides

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    report_path = _resolve_report_path(run)
    if not report_path:
        return []

    return search_peptides(
        report_path,
        run_name=run.get("run_name"),
        query=q,
        limit=min(limit, 500),
        mz=mz,
        mz_ppm=mz_ppm,
    )


@app.get("/api/mia/compare")
async def api_mia_compare(
    run_ids: str,
    q: str = "",
    mz: float = 0.0,
    mz_ppm: float = 10.0,
    limit: int = 150,
) -> dict:
    """MIA — Mobility Ion Analysis: cross-run ion mobility library lookup.

    Returns per-run peptide data (IM, RT, intensity, Best.Fr.Mz) for all
    runs matching run_ids (comma-separated). Results are keyed by run_id.
    """
    from stan.metrics.spectrum import search_peptides

    ids = [x.strip() for x in run_ids.split(",") if x.strip()]
    results: dict = {}

    for run_id in ids:
        run = get_run(run_id)
        if not run:
            continue
        report_path = _resolve_report_path(run)
        if not report_path:
            results[run_id] = {"run_name": run.get("run_name", f"Run {run_id}"), "peptides": []}
            continue
        peptides = search_peptides(
            report_path,
            run_name=run.get("run_name"),
            query=q,
            limit=min(limit, 500),
            mz=mz,
            mz_ppm=mz_ppm,
        )
        results[run_id] = {
            "run_name": run.get("run_name", f"Run {run_id}"),
            "peptides": peptides,
        }

    return results


@app.post("/api/fix-instrument-names")
async def api_fix_instrument_names() -> dict:
    """Retroactively resolve 'auto' instrument names from Bruker .d directories.

    Scans all runs in the database whose instrument field is a placeholder value
    ('auto', 'unknown', '', None) and tries to read the real model name from:
      1. analysis.tdf GlobalMetadata.InstrumentName
      2. .m/microTOFQImpacTemAcquisition.method (legacy fallback)

    Returns a summary with per-run details for debugging.
    """
    from stan.db import get_db_path
    from stan.watcher.instrument_name import read_instrument_name_from_d
    from pathlib import Path
    import sqlite3

    db_path = get_db_path()
    if not db_path.exists():
        return {"updated": 0, "skipped": 0, "errors": 0, "detail": "No database found"}

    updated = skipped = errors = 0
    details: list[dict] = []

    _PLACEHOLDERS = {'auto', 'unknown', 'instrument', '', 'none', 'timstof', 'timstof pro', 'timstof flex'}

    try:
        with sqlite3.connect(str(db_path)) as con:
            con.row_factory = sqlite3.Row
            # Fetch all runs — we'll filter in Python to catch edge cases
            rows = con.execute(
                "SELECT id, run_name, raw_path, instrument FROM runs"
            ).fetchall()

            for row in rows:
                inst = (row["instrument"] or "").strip().lower()
                looks_like_xml = '>' in inst or '<' in inst
                if inst not in _PLACEHOLDERS and not looks_like_xml:
                    continue  # already has a real name

                raw_path = (row["raw_path"] or "").strip()
                # Accept .d and .D (case-insensitive on Windows)
                if not raw_path or not raw_path.lower().endswith(".d"):
                    skipped += 1
                    details.append({"id": row["id"], "run": row["run_name"],
                                    "result": "skipped", "reason": f"raw_path not .d: {raw_path!r}"})
                    continue

                d_path = Path(raw_path)
                if not d_path.exists():
                    skipped += 1
                    details.append({"id": row["id"], "run": row["run_name"],
                                    "result": "skipped", "reason": f"path not found: {raw_path}"})
                    continue

                try:
                    name = read_instrument_name_from_d(d_path)
                    if name:
                        con.execute(
                            "UPDATE runs SET instrument = ? WHERE id = ?",
                            (name, row["id"]),
                        )
                        updated += 1
                        logger.info("Fixed instrument for run %s (%s): %s", row["id"], row["run_name"], name)
                        details.append({"id": row["id"], "run": row["run_name"],
                                        "result": "updated", "name": name})
                    else:
                        skipped += 1
                        details.append({"id": row["id"], "run": row["run_name"],
                                        "result": "skipped", "reason": "read_instrument_name_from_d returned None"})
                except Exception as exc:
                    errors += 1
                    details.append({"id": row["id"], "run": row["run_name"],
                                    "result": "error", "reason": str(exc)})
                    logger.warning("Error reading instrument name for run %s: %s", row["id"], exc)

            con.commit()

    except sqlite3.OperationalError as exc:
        return {"updated": 0, "skipped": 0, "errors": 1, "detail": str(exc)}

    return {"updated": updated, "skipped": skipped, "errors": errors, "runs": details}


@app.get("/api/runs/{run_id}/tdf-debug")
async def api_tdf_debug(run_id: str) -> dict:
    """Dump all GlobalMetadata key/value pairs from analysis.tdf for a run.

    Use this to diagnose why instrument name resolution fails — shows every
    key Bruker wrote into the TDF so we can find the right key for new models.
    """
    import sqlite3
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    raw_path = run.get("raw_path", "")
    if not raw_path or not raw_path.lower().endswith(".d"):
        return {"error": "not_bruker", "raw_path": raw_path}

    from pathlib import Path
    d_path = Path(raw_path)
    tdf = d_path / "analysis.tdf"
    if not tdf.exists():
        return {"error": "no_tdf", "path": str(tdf)}

    try:
        with sqlite3.connect(str(tdf)) as con:
            rows = con.execute("SELECT Key, Value FROM GlobalMetadata ORDER BY Key").fetchall()
            meta = {r[0]: r[1] for r in rows}

            # Also try to list tables
            tables = [r[0] for r in con.execute(
                "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
            ).fetchall()]

        return {
            "raw_path": raw_path,
            "tdf_path": str(tdf),
            "global_metadata": meta,
            "tables": tables,
        }
    except Exception as exc:
        return {"error": str(exc), "tdf_path": str(tdf)}


@app.patch("/api/runs/{run_id}/instrument")
async def api_set_instrument(run_id: str, body: dict) -> dict:
    """Manually set the instrument name for a run."""
    import sqlite3
    from stan.db import get_db_path
    name = (body.get("instrument") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="instrument name required")
    db_path = get_db_path()
    with sqlite3.connect(str(db_path)) as con:
        con.execute("UPDATE runs SET instrument = ? WHERE id = ?", (name, run_id))
        con.commit()
    return {"ok": True, "run_id": run_id, "instrument": name}


@app.get("/api/runs/{run_id}/phosphoisomer")
async def api_phosphoisomer(
    run_id: str,
    sequence: str,           # bare AA sequence, e.g. ATAAETASEPAESK
    charge: int | None = None,
    mz_tol_ppm: float = 20.0,
) -> dict:
    """Return 1/K₀ distributions for all phosphoisomers of a bare peptide sequence.

    Works with both Sage results.sage.parquet (column: peptide, ion_mobility)
    and DIA-NN report.parquet (columns: Modified.Sequence, IM).

    Returns groups keyed by modified sequence with histogram-ready IM lists,
    medians, standard deviations, and a pairwise resolution matrix so the
    frontend can reproduce the Oliinyk et al. 2023 phosphoisomer resolution plot.
    """
    import math as _math
    import re as _re

    try:
        import polars as pl
    except ImportError:
        raise HTTPException(status_code=500, detail="polars required")

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    report_path = _resolve_report_path(run)
    sage_path   = _resolve_sage_path(run)
    is_sage     = False
    if report_path is None and sage_path is not None:
        report_path = sage_path
        is_sage     = True
    elif report_path is None:
        return {"groups": [], "n_total": 0, "error": "No search results for this run"}
    else:
        is_sage = "sage" in str(report_path).lower() or "results.sage" in str(report_path).lower()

    seq_upper = sequence.upper().strip()

    try:
        schema_cols = set(pl.read_parquet_schema(str(report_path)).keys())
    except Exception as e:
        return {"groups": [], "n_total": 0, "error": str(e)}

    # ── Sage path ────────────────────────────────────────────────────────
    if is_sage or ("peptide" in schema_cols and "ion_mobility" in schema_cols):
        if "peptide" not in schema_cols or "ion_mobility" not in schema_cols:
            return {"groups": [], "n_total": 0, "error": "No peptide/ion_mobility columns in Sage output"}

        q_col     = next((c for c in ("spectrum_q","q_value","posterior_error") if c in schema_cols), None)
        chg_col   = "charge" if "charge" in schema_cols else None
        want      = [c for c in ["peptide","ion_mobility","charge","retention_time","calcmass",q_col] if c]
        df        = pl.read_parquet(str(report_path), columns=want)

        # strip bracket mods: PEPTIDE[+79.966]SEQ → PEPTIDESEQ
        df = df.with_columns(
            pl.col("peptide").map_elements(
                lambda p: _re.sub(r"\[.*?\]", "", p or "").upper(),
                return_dtype=pl.String
            ).alias("_bare")
        )
        df = df.filter(pl.col("_bare") == seq_upper)
        df = df.filter(pl.col("ion_mobility") > 0)
        if q_col:
            df = df.filter(pl.col(q_col) <= 0.01)
        if charge is not None and chg_col:
            df = df.filter(pl.col(chg_col) == charge)

        mod_seq_col = "peptide"
        im_col      = "ion_mobility"

    # ── DIA-NN path ──────────────────────────────────────────────────────
    else:
        mod_col  = next((c for c in ("Modified.Sequence","Sequence") if c in schema_cols), None)
        str_col  = next((c for c in ("Stripped.Sequence",) if c in schema_cols), None)
        im_c     = next((c for c in ("IM","Precursor.IonMobility","ion_mobility") if c in schema_cols), None)
        qv_col   = next((c for c in ("Q.Value","q_value") if c in schema_cols), None)
        chg_col  = next((c for c in ("Precursor.Charge","charge") if c in schema_cols), None)

        if not mod_col or not im_c:
            return {"groups": [], "n_total": 0,
                    "error": f"Missing sequence/IM columns (found: {sorted(schema_cols)[:20]})"}

        want = [c for c in [mod_col, str_col, im_c, qv_col, chg_col] if c]
        df = pl.read_parquet(str(report_path), columns=want)

        # build bare sequence from stripped col or strip mods from modified
        # DIA-NN pads with underscores (_PEPTIDE_) — strip them so matching works
        if str_col:
            df = df.with_columns(
                pl.col(str_col).str.strip_chars("_").str.to_uppercase().alias("_bare")
            )
        else:
            df = df.with_columns(
                pl.col(mod_col).map_elements(
                    lambda p: _re.sub(r"\(.*?\)|\[.*?\]", "", p or "").strip("_").upper(),
                    return_dtype=pl.String
                ).alias("_bare")
            )

        df = df.filter(pl.col("_bare") == seq_upper)
        df = df.filter(pl.col(im_c) > 0)
        if qv_col:
            df = df.filter(pl.col(qv_col) <= 0.01)
        if charge is not None and chg_col:
            df = df.filter(pl.col(chg_col) == charge)

        mod_seq_col = mod_col
        im_col      = im_c

    if df.height == 0:
        return {"groups": [], "n_total": 0, "sequence": seq_upper}

    # ── Group by modified sequence ───────────────────────────────────────
    groups_raw: dict[str, list[float]] = {}
    for row in df.iter_rows(named=True):
        key = str(row[mod_seq_col] or "")
        val = float(row[im_col])
        groups_raw.setdefault(key, []).append(val)

    def _stats(vals: list[float]) -> dict:
        n    = len(vals)
        mu   = sum(vals) / n
        med  = sorted(vals)[n // 2]
        std  = (_math.sqrt(sum((v - mu)**2 for v in vals) / n)) if n > 1 else 0.0
        fwhm = 2.3548 * std
        return {"n": n, "mean": round(mu, 4), "median": round(med, 4),
                "std": round(std, 4), "fwhm": round(fwhm, 4)}

    groups = []
    for mod_seq, ims in sorted(groups_raw.items(), key=lambda x: -len(x[1])):
        s = _stats(ims)
        # 50-bin histogram for frontend rendering
        lo, hi = min(ims), max(ims)
        span = hi - lo or 0.01
        bins = 50
        step = span / bins
        hist = [0] * bins
        for v in ims:
            i = min(int((v - lo) / step), bins - 1)
            hist[i] += 1
        bin_centers = [round(lo + (i + 0.5) * step, 4) for i in range(bins)]
        groups.append({
            "modified_sequence": mod_seq,
            **s,
            "im_values": [round(v, 4) for v in sorted(ims)],
            "hist_x": bin_centers,
            "hist_y": hist,
        })

    # ── Pairwise resolution ──────────────────────────────────────────────
    resolution = []
    for i in range(len(groups)):
        for j in range(i + 1, len(groups)):
            g1, g2 = groups[i], groups[j]
            delta  = abs(g1["median"] - g2["median"])
            fwhm_avg = (g1["fwhm"] + g2["fwhm"]) / 2
            R = round(delta / fwhm_avg, 3) if fwhm_avg > 0 else 0.0
            resolution.append({
                "seq_a": g1["modified_sequence"],
                "seq_b": g2["modified_sequence"],
                "delta_im": round(delta, 4),
                "fwhm_avg": round(fwhm_avg, 4),
                "resolution": R,
                "baseline_resolved": R >= 1.0,
            })

    return {
        "sequence":   seq_upper,
        "groups":     groups,
        "n_total":    sum(g["n"] for g in groups),
        "resolution": resolution,
        "source":     "sage" if is_sage else "diann",
    }


@app.get("/api/runs/{run_id}/phospho-landscape")
async def api_phospho_landscape(run_id: str) -> dict:
    """Return all phosphopeptide identifications for scatter plotting.

    Returns compact lists (im, mz, n_isomers, n_psms, bare_seq) suitable for
    the IM vs m/z landscape scatter. Multi-isomer entries are flagged so the
    frontend can highlight them.
    """
    import math as _math
    import re as _re

    try:
        import polars as pl
    except ImportError:
        raise HTTPException(status_code=500, detail="polars required")

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    report_path = _resolve_report_path(run)
    sage_path   = _resolve_sage_path(run)
    is_sage     = False
    if report_path is None and sage_path is not None:
        report_path = sage_path
        is_sage     = True
    elif report_path is None:
        return {"peptides": [], "n_phospho": 0, "n_multi_isomer": 0}
    else:
        is_sage = "sage" in str(report_path).lower() or "results.sage" in str(report_path).lower()

    try:
        schema_cols = set(pl.read_parquet_schema(str(report_path)).keys())
    except Exception as e:
        return {"peptides": [], "n_phospho": 0, "n_multi_isomer": 0, "error": str(e)}

    # ── Sage path ────────────────────────────────────────────────────────
    if is_sage or ("peptide" in schema_cols and "ion_mobility" in schema_cols):
        q_col   = next((c for c in ("spectrum_q", "q_value", "posterior_error") if c in schema_cols), None)
        chg_col = "charge" if "charge" in schema_cols else None
        want    = [c for c in ["peptide", "ion_mobility", "charge", "calcmass", q_col] if c]
        df      = pl.read_parquet(str(report_path), columns=want)

        # keep only phospho peptides
        df = df.filter(pl.col("peptide").str.contains(r"\["))
        df = df.filter(pl.col("ion_mobility") > 0)
        if q_col:
            df = df.filter(pl.col(q_col) <= 0.01)

        # compute m/z
        if chg_col and "calcmass" in schema_cols:
            df = df.with_columns(
                ((pl.col("calcmass") + pl.col(chg_col) * 1.007276) / pl.col(chg_col)).alias("_mz")
            )
        else:
            df = df.with_columns(pl.lit(0.0).alias("_mz"))

        df = df.with_columns(
            pl.col("peptide").map_elements(
                lambda p: _re.sub(r"\[.*?\]", "", p or "").upper(),
                return_dtype=pl.String
            ).alias("_bare")
        )
        mod_col_l, im_col_l, mz_col_l = "peptide", "ion_mobility", "_mz"

    # ── DIA-NN path ──────────────────────────────────────────────────────
    else:
        mod_col_l = next((c for c in ("Modified.Sequence", "Sequence") if c in schema_cols), None)
        str_col   = next((c for c in ("Stripped.Sequence",) if c in schema_cols), None)
        im_c      = next((c for c in ("IM", "Precursor.IonMobility", "ion_mobility") if c in schema_cols), None)
        mz_c      = next((c for c in ("Precursor.Mz",) if c in schema_cols), None)
        qv_col    = next((c for c in ("Q.Value", "q_value") if c in schema_cols), None)

        if not mod_col_l or not im_c:
            return {"peptides": [], "n_phospho": 0, "n_multi_isomer": 0,
                    "error": f"Missing columns (found: {sorted(schema_cols)[:20]})"}

        want = [c for c in [mod_col_l, str_col, im_c, mz_c, qv_col] if c]
        df   = pl.read_parquet(str(report_path), columns=want)

        # phospho filter — covers UniMod:21, (Phospho), +79.966, (ph)
        df = df.filter(
            pl.col(mod_col_l).str.contains(r"(?i)UniMod:21|[Pp]hospho|\+79\.9|\(ph\)")
        )
        df = df.filter(pl.col(im_c) > 0)
        if qv_col:
            df = df.filter(pl.col(qv_col) <= 0.01)

        if str_col:
            df = df.with_columns(
                pl.col(str_col).str.strip_chars("_").str.to_uppercase().alias("_bare")
            )
        else:
            df = df.with_columns(
                pl.col(mod_col_l).map_elements(
                    lambda p: _re.sub(r"\(.*?\)|\[.*?\]", "", p or "").strip("_").upper(),
                    return_dtype=pl.String
                ).alias("_bare")
            )

        if mz_c:
            df = df.rename({mz_c: "_mz"})
        else:
            df = df.with_columns(pl.lit(0.0).alias("_mz"))

        mod_col_l, im_col_l, mz_col_l = mod_col_l, im_c, "_mz"

    if df.height == 0:
        return {"peptides": [], "n_phospho": 0, "n_multi_isomer": 0}

    # ── Group by bare sequence ──────────────────────────────────────────
    groups: dict[str, dict] = {}
    for row in df.iter_rows(named=True):
        bare = str(row["_bare"] or "")
        mod  = str(row[mod_col_l] or "")
        im   = float(row[im_col_l])
        mz   = float(row.get(mz_col_l) or 0)
        if bare not in groups:
            groups[bare] = {"mods": set(), "ims": [], "mzs": []}
        groups[bare]["mods"].add(mod)
        groups[bare]["ims"].append(im)
        if mz > 0:
            groups[bare]["mzs"].append(mz)

    peptides = []
    for bare, g in groups.items():
        ims = g["ims"]
        mzs = g["mzs"]
        n   = len(ims)
        med_im = sorted(ims)[n // 2]
        med_mz = sorted(mzs)[len(mzs) // 2] if mzs else 0
        peptides.append({
            "bare_seq":   bare,
            "n_isomers":  len(g["mods"]),
            "n_psms":     n,
            "median_im":  round(med_im, 4),
            "median_mz":  round(med_mz, 4),
        })

    peptides.sort(key=lambda x: (-x["n_isomers"], -x["n_psms"]))
    n_multi = sum(1 for p in peptides if p["n_isomers"] > 1)

    return {
        "peptides":       peptides[:2000],
        "n_phospho":      len(peptides),
        "n_multi_isomer": n_multi,
    }


# ── Catalog: columns ────────────────────────────────────────────────────────

@app.get("/api/catalog/columns")
async def api_catalog_columns_list() -> list:
    return get_columns_catalog()


@app.post("/api/catalog/columns")
async def api_catalog_columns_create(data: dict) -> dict:
    new_id = upsert_column(data)
    if new_id < 0:
        raise HTTPException(status_code=500, detail="Failed to insert column")
    return {"id": new_id}


@app.put("/api/catalog/columns/{col_id}")
async def api_catalog_columns_update(col_id: int, data: dict) -> dict:
    data["id"] = col_id
    upsert_column(data)
    return {"ok": True}


@app.delete("/api/catalog/columns/{col_id}")
async def api_catalog_columns_delete(col_id: int) -> dict:
    delete_column(col_id)
    return {"ok": True}


# ── Catalog: LC systems ──────────────────────────────────────────────────────

@app.get("/api/catalog/lc")
async def api_catalog_lc_list() -> list:
    return get_lc_catalog()


@app.post("/api/catalog/lc")
async def api_catalog_lc_create(data: dict) -> dict:
    new_id = upsert_lc(data)
    if new_id < 0:
        raise HTTPException(status_code=500, detail="Failed to insert LC")
    return {"id": new_id}


@app.put("/api/catalog/lc/{lc_id}")
async def api_catalog_lc_update(lc_id: int, data: dict) -> dict:
    data["id"] = lc_id
    upsert_lc(data)
    return {"ok": True}


@app.delete("/api/catalog/lc/{lc_id}")
async def api_catalog_lc_delete(lc_id: int) -> dict:
    delete_lc(lc_id)
    return {"ok": True}


# ── Run instrument setup ─────────────────────────────────────────────────────

@app.patch("/api/runs/{run_id}/setup")
async def api_run_setup(run_id: str, data: dict) -> dict:
    """Assign column_id and/or lc_id to a run."""
    column_id = data.get("column_id")  # None clears the assignment
    lc_id     = data.get("lc_id")
    ok = update_run_setup(run_id, column_id, lc_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Run not found")
    return {"ok": True}


@app.get("/api/runs/{run_id}/spectrum")
async def api_spectrum(run_id: str, sequence: str, charge: int = 2) -> dict:
    """Compute theoretical b/y fragment ions for a Modified.Sequence string.

    sequence: URL-encoded DIA-NN Modified.Sequence (e.g. PEPTM(UniMod:21)IDE)
    charge:   precursor charge state (controls whether z=2 fragment ions are included)
    """
    from stan.metrics.spectrum import compute_fragment_ions

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    if not sequence:
        raise HTTPException(status_code=400, detail="sequence is required")

    return compute_fragment_ions(sequence, charge=charge)


@app.get("/api/runs/{run_id}/spectrum-experimental")
async def api_spectrum_experimental(run_id: str, sequence: str, charge: int = 2) -> dict:
    """Return experimental context for a peptide from DIA-NN report.parquet.

    Full fragment intensities require the Bruker SDK (not available here), so
    this returns what DIA-NN 2.x does report: Best.Fr.Mz, RT window, 1/K0,
    and precursor intensity — useful for confirming identification context.
    """
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    report_path = _resolve_report_path(run)
    if not report_path:
        return {"available": False, "message": "No report.parquet linked to this run"}

    try:
        import polars as pl
        schema = pl.read_parquet_schema(str(report_path))
        available = set(schema.keys())
        file_col = "Run" if "Run" in available else "File.Name"

        want = [c for c in [
            "Modified.Sequence", "Stripped.Sequence", "Q.Value",
            "Best.Fr.Mz", "Best.Fr.Mz.Delta",
            "Precursor.Mz", "Precursor.Charge", "Precursor.Quantity",
            "Precursor.Normalised", "RT", "RT.Start", "RT.Stop",
            "IM", "iIM", "Predicted.RT", "Predicted.IM", file_col,
        ] if c in available]

        df = pl.read_parquet(str(report_path), columns=want)
        df = df.filter(pl.col("Q.Value") <= 0.01)

        # Match by sequence (try Modified.Sequence first, then Stripped.Sequence)
        seq_stripped = sequence.split("(")[0] if "(" not in sequence else None
        mask = pl.col("Modified.Sequence") == sequence
        match = df.filter(mask)
        if match.height == 0 and "Stripped.Sequence" in df.columns:
            # Try stripped
            stripped = __import__("re").sub(r"\(UniMod:\d+\)", "", sequence)
            match = df.filter(pl.col("Stripped.Sequence") == stripped)

        if match.height == 0:
            return {"available": False, "message": f"Peptide not found at Q≤1%: {sequence}"}

        row = match.sort("Precursor.Quantity" if "Precursor.Quantity" in match.columns else "Q.Value",
                         descending="Precursor.Quantity" in match.columns).head(1)

        def g(col, default=None):
            if col in row.columns and row.height > 0:
                v = row[col][0]
                return None if v is None else (round(float(v), 5) if isinstance(v, float) else v)
            return default

        return {
            "available": True,
            "best_fr_mz":       g("Best.Fr.Mz"),
            "best_fr_mz_delta": g("Best.Fr.Mz.Delta"),
            "precursor_mz":     g("Precursor.Mz"),
            "charge":           int(g("Precursor.Charge") or charge),
            "rt":               g("RT"),
            "rt_start":         g("RT.Start"),
            "rt_stop":          g("RT.Stop"),
            "mobility":         g("IM"),
            "mobility_indexed": g("iIM"),
            "predicted_rt":     g("Predicted.RT"),
            "predicted_im":     g("Predicted.IM"),
            "intensity":        g("Precursor.Quantity"),
            "intensity_norm":   g("Precursor.Normalised"),
            "n_obs":            match.height,
            "message": (
                "DIA-NN 2.x: Best.Fr.Mz is the single highest-scoring fragment. "
                "Full fragment intensities require Bruker TDF SDK (timsrust). "
                "Theoretical b/y ions are shown at equal height."
            ),
        }
    except Exception as e:
        logger.exception("spectrum-experimental failed")
        return {"available": False, "message": str(e)}


def _immunopeptidomics_from_sage(run: dict, sage_path: "Path") -> dict:
    """Build the immunopeptidomics response dict from Sage results.sage.parquet.

    Matches the structure returned by the DIA-NN path so the frontend works
    identically for DDA runs.
    """
    import re as _re
    import math as _math
    from stan.metrics.mobility_sage import load_immuno_psms_sage

    _KD: dict[str, float] = {
        "A": 1.8,  "R": -4.5, "N": -3.5, "D": -3.5, "C": 2.5,
        "Q": -3.5, "E": -3.5, "G": -0.4, "H": -3.2, "I": 4.5,
        "L": 3.8,  "K": -3.9, "M": 1.9,  "F": 2.8,  "P": -1.6,
        "S": -0.8, "T": -0.7, "W": -0.9, "Y": -1.3, "V": 4.2,
    }
    _AMINO_ACIDS = list("ACDEFGHIKLMNPQRSTVWY")
    _AA_IDX      = {aa: i for i, aa in enumerate(_AMINO_ACIDS)}

    # Sage mass-shift → human-readable mod name
    _SAGE_MODS = {
        "15.9949": "Oxidation",   "+15.9949": "Oxidation",
        "57.0215": "CAM",         "+57.0215": "CAM",
        "57.021":  "CAM",         "+57.021":  "CAM",
        "79.9663": "Phospho",     "+79.9663": "Phospho",
        "42.0106": "Acetyl",      "+42.0106": "Acetyl",
        "-17.026": "Deamidation", "17.0265": "Deamidation",
        "-18.010": "Water loss",
        "0.9840":  "Deamidated",  "+0.9840": "Deamidated",
    }

    try:
        rows = load_immuno_psms_sage(sage_path)
        if not rows:
            return {}

        n_total = len(rows)
        len_counts: dict[int, int] = {}
        charge_counts: dict[int, int] = {}
        im_by_len: dict[int, list[float]] = {}
        gravy_cloud: list[dict] = []
        motif_seqs: dict[int, list[str]] = {8: [], 9: [], 10: [], 11: []}
        mod_counts: dict[str, int] = {}
        top_peptides: list[dict] = []

        for r in rows:
            seq  = r["seq"]
            plen = r["pep_len"]
            im   = r["im"]
            prot = r["protein"]

            len_counts[plen] = len_counts.get(plen, 0) + 1

            if im and im > 0:
                im_by_len.setdefault(plen, []).append(im)

            if plen <= 500:
                top_peptides.append({
                    "sequence":  seq,
                    "length":    plen,
                    "charge":    0,
                    "mz":        0.0,
                    "rt":        0.0,
                    "mobility":  round(im, 4) if im else None,
                    "intensity": round(r["intensity"], 1),
                })

            if plen in motif_seqs:
                motif_seqs[plen].append(seq)

            # GRAVY
            if im and im > 0 and len(gravy_cloud) < 600:
                vals = [_KD[aa] for aa in seq if aa in _KD]
                if vals:
                    g = round(sum(vals) / len(vals), 3)
                    gravy_cloud.append({"gravy": g, "im": round(im, 4), "length": plen, "charge": 0, "seq": seq[:16]})

        # Charge dist — Sage has charge per PSM
        try:
            import polars as pl
            schema = pl.read_parquet_schema(str(sage_path))
            if "charge" in schema:
                q_col = next((c for c in ("spectrum_q", "q_value") if c in schema), None)
                if q_col:
                    ch_df = pl.read_parquet(str(sage_path), columns=[q_col, "charge"])
                    ch_df = ch_df.filter(pl.col(q_col) <= 0.01)
                    for row in ch_df.group_by("charge").agg(pl.len().alias("n")).iter_rows(named=True):
                        charge_counts[int(row["charge"])] = int(row["n"])
        except Exception:
            pass

        # Mod frequencies from Sage notation
        try:
            import polars as pl
            schema = pl.read_parquet_schema(str(sage_path))
            pep_col = next((c for c in ("peptide", "sequence") if c in schema), None)
            q_col   = next((c for c in ("spectrum_q", "q_value") if c in schema), None)
            if pep_col and q_col:
                mod_pat = _re.compile(r"\[([\+\-][\d\.]+)\]")
                raw_df  = pl.read_parquet(str(sage_path), columns=[q_col, pep_col])
                raw_df  = raw_df.filter(pl.col(q_col) <= 0.01)
                for seq_raw in raw_df[pep_col].drop_nulls().to_list():
                    for shift in mod_pat.findall(seq_raw):
                        lbl = _SAGE_MODS.get(shift, f"[{shift}]")
                        mod_counts[lbl] = mod_counts.get(lbl, 0) + 1
        except Exception:
            pass

        mhc1  = sum(v for k, v in len_counts.items() if 8  <= k <= 14)
        mhc2  = sum(v for k, v in len_counts.items() if 13 <= k <= 25)
        short = sum(v for k, v in len_counts.items() if k < 8)
        long_ = sum(v for k, v in len_counts.items() if k > 25)

        lens = [k for k, v in len_counts.items() for _ in range(v)]
        lens.sort()
        length_stats = {
            "min":    min(lens),
            "max":    max(lens),
            "median": float(lens[len(lens)//2]),
            "mean":   round(sum(lens)/len(lens), 1),
        } if lens else {}

        # length × mobility aggregation
        length_mobility_agg: dict = {}
        for plen, ims in im_by_len.items():
            ims_s = sorted(ims)
            n = len(ims_s)
            mean_im = sum(ims_s) / n
            var     = sum((v - mean_im)**2 for v in ims_s) / max(n - 1, 1)
            std_im  = var ** 0.5
            q1      = ims_s[n // 4]
            q3      = ims_s[3 * n // 4]
            med     = ims_s[n // 2]
            length_mobility_agg[plen] = {
                "mean_im":   round(mean_im, 4), "std_im":    round(std_im, 4),
                "median_im": round(med,     4), "q25_im":    round(q1, 4),
                "q75_im":    round(q3,      4), "n":         n,
            }

        # motif matrix
        motif_matrix: dict = {}
        for ml, seqs in motif_seqs.items():
            if len(seqs) < 10:
                continue
            pos_counts = [[0] * 20 for _ in range(ml)]
            for seq in seqs:
                if len(seq) != ml:
                    continue
                for pos, aa in enumerate(seq):
                    ai = _AA_IDX.get(aa)
                    if ai is not None:
                        pos_counts[pos][ai] += 1
            freq: list[list[float]] = []
            for ai in range(20):
                row_f: list[float] = []
                for pos in range(ml):
                    tot = sum(pos_counts[pos])
                    row_f.append(round(pos_counts[pos][ai] / max(1, tot), 4))
                freq.append(row_f)
            motif_matrix[str(ml)] = {"n": len(seqs), "aas": _AMINO_ACIDS, "freq": freq}

        sorted_mods  = sorted(mod_counts.items(), key=lambda x: x[1], reverse=True)[:12]
        mods_out     = [{"name": n, "count": c, "pct": round(c / n_total * 100, 2)} for n, c in sorted_mods]

        top_peptides_out = sorted(top_peptides, key=lambda r: r["intensity"], reverse=True)[:500]

        acq_mode = run.get("mode", "")
        pct_z1 = round(charge_counts.get(1, 0) / max(n_total, 1) * 100, 1)
        mhc1_n = sum(v for k, v in len_counts.items() if 8 <= k <= 14)
        mhc1_9 = len_counts.get(9, 0)
        all_ims = [im for ims in im_by_len.values() for im in ims]
        mob_cv: float | None = None
        if len(all_ims) > 1:
            mean_im = sum(all_ims) / len(all_ims)
            mob_cv  = round((_math.sqrt(sum((v - mean_im)**2 for v in all_ims) / max(len(all_ims)-1, 1)) / max(mean_im, 1e-6)) * 100, 2)

        radar = {
            "pct_mhc1":      round(mhc1 / n_total * 100, 1) if n_total else 0.0,
            "pct_z1":        pct_z1,
            "pct_9mer_mhc1": round(mhc1_9 / max(mhc1_n, 1) * 100, 1),
            "mobility_cv":   mob_cv,
            "dyn_range_db":  None,
        }

        return {
            "n_total":             n_total,
            "n_mhc1":              mhc1,
            "n_mhc2":              mhc2,
            "n_short":             short,
            "n_long":              long_,
            "pct_mhc1":            round(mhc1 / n_total * 100, 1) if n_total else 0,
            "pct_mhc2":            round(mhc2 / n_total * 100, 1) if n_total else 0,
            "length_dist":         len_counts,
            "charge_dist":         charge_counts,
            "length_stats":        length_stats,
            "top_peptides":        top_peptides_out,
            "modifications":       mods_out,
            "length_mobility_agg": length_mobility_agg,
            "gravy_cloud":         gravy_cloud,
            "radar":               radar,
            "motif_matrix":        motif_matrix,
            "top_source_proteins": [],
            "acq_mode":            acq_mode,
            "is_dia_immuno":       False,
            "is_dda_immuno":       True,
            "source":              "sage",
        }
    except Exception:
        logger.exception("_immunopeptidomics_from_sage failed")
        return {}


@app.get("/api/runs/{run_id}/immunopeptidomics")
async def api_immunopeptidomics(run_id: str) -> dict:
    """Immunopeptidomics analysis from DIA-NN report.parquet or Sage results.

    Computes peptide length distribution, MHC Class I (8-14aa) and
    Class II (13-25aa) counts, charge distribution, top peptides,
    and modification frequencies — all at 1% FDR.
    """
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    report_path = _resolve_report_path(run)
    sage_path   = _resolve_sage_path(run) if not report_path else None

    if not report_path and sage_path:
        return _immunopeptidomics_from_sage(run, sage_path)

    if not report_path:
        return {}

    try:
        import polars as pl
        schema = pl.read_parquet_schema(str(report_path))
        available = set(schema.keys())
        file_col = "Run" if "Run" in available else "File.Name"

        want = [c for c in [
            "Modified.Sequence", "Stripped.Sequence", "Precursor.Charge",
            "Precursor.Mz", "Precursor.Quantity", "Q.Value",
            "RT", "IM", "Protein.Group", "Protein.Names", file_col,
        ] if c in available]

        df = pl.read_parquet(str(report_path), columns=want)
        df = df.filter(pl.col("Q.Value") <= 0.01)

        if df.height == 0:
            return {}

        # Peptide lengths from Stripped.Sequence
        seq_col = "Stripped.Sequence" if "Stripped.Sequence" in df.columns else "Modified.Sequence"
        df = df.with_columns(
            pl.col(seq_col).str.replace_all(r"\(UniMod:\d+\)", "").str.len_chars().alias("pep_len")
        )

        # Length distribution (bins 6–30+)
        len_counts = {}
        for row in df.group_by("pep_len").agg(pl.len().alias("n")).iter_rows(named=True):
            len_counts[int(row["pep_len"])] = int(row["n"])

        n_total = df.height
        mhc1 = df.filter((pl.col("pep_len") >= 8) & (pl.col("pep_len") <= 14)).height
        mhc2 = df.filter((pl.col("pep_len") >= 13) & (pl.col("pep_len") <= 25)).height
        short = df.filter(pl.col("pep_len") < 8).height
        long_ = df.filter(pl.col("pep_len") > 25).height

        # Charge distribution
        charge_dist = {}
        if "Precursor.Charge" in df.columns:
            for row in df.group_by("Precursor.Charge").agg(pl.len().alias("n")).iter_rows(named=True):
                charge_dist[int(row["Precursor.Charge"])] = int(row["n"])

        # Length stats
        lens = df["pep_len"].drop_nulls()
        length_stats = {
            "min": int(lens.min()),
            "max": int(lens.max()),
            "median": float(lens.median()),
            "mean": round(float(lens.mean()), 1),
        } if len(lens) > 0 else {}

        # sort_col used later for top_peptides (expanded version built below)
        sort_col = "Precursor.Quantity" if "Precursor.Quantity" in df.columns else "Q.Value"

        # Modification frequencies
        import re as _re
        mod_pat = _re.compile(r"\(UniMod:(\d+)\)")
        mod_labels = {
            "1": "Acetyl", "4": "CAM", "5": "Carbamyl", "7": "Deamidated",
            "21": "Oxidation", "35": "Hydroxyl", "56": "Acetyl(K)",
            "80": "Phospho", "259": "Trimethyl", "28": "Methyl",
        }
        mod_counts: dict[str, int] = {}
        if "Modified.Sequence" in df.columns:
            for seq in df["Modified.Sequence"].drop_nulls().to_list():
                for uid in mod_pat.findall(seq):
                    lbl = mod_labels.get(uid, f"UniMod:{uid}")
                    mod_counts[lbl] = mod_counts.get(lbl, 0) + 1

        sorted_mods = sorted(mod_counts.items(), key=lambda x: x[1], reverse=True)[:12]
        mods_out = [{"name": n, "count": c, "pct": round(c / n_total * 100, 2)} for n, c in sorted_mods]

        # ── Length × Mobility aggregation (View 1: Ridge chart) ──────────
        # Per peptide-length: median, Q1, Q3, mean, std of 1/K₀.
        # Returned as dict keyed by length so the frontend can sort/filter.
        length_mobility_agg: dict = {}
        if "IM" in df.columns:
            try:
                lm_df = (
                    df.filter(pl.col("IM") > 0)
                    .group_by("pep_len")
                    .agg([
                        pl.col("IM").mean().alias("mean_im"),
                        pl.col("IM").std().alias("std_im"),
                        pl.col("IM").median().alias("median_im"),
                        pl.col("IM").quantile(0.25).alias("q25_im"),
                        pl.col("IM").quantile(0.75).alias("q75_im"),
                        pl.len().alias("n"),
                    ])
                    .sort("pep_len")
                )
                for row in lm_df.iter_rows(named=True):
                    length_mobility_agg[int(row["pep_len"])] = {
                        k: round(float(row[k]), 4) if row[k] is not None else None
                        for k in ["mean_im", "std_im", "median_im", "q25_im", "q75_im", "n"]
                    }
            except Exception:
                logger.debug("length_mobility_agg failed", exc_info=True)

        # ── GRAVY × Mobility cloud (View 2: Hydrophobicity landscape) ────
        # Kyte-Doolittle GRAVY score per peptide, paired with 1/K₀.
        # Sample up to 600 peptides with IM data to keep payload small.
        _KD: dict[str, float] = {
            "A": 1.8,  "R": -4.5, "N": -3.5, "D": -3.5, "C": 2.5,
            "Q": -3.5, "E": -3.5, "G": -0.4, "H": -3.2, "I": 4.5,
            "L": 3.8,  "K": -3.9, "M": 1.9,  "F": 2.8,  "P": -1.6,
            "S": -0.8, "T": -0.7, "W": -0.9, "Y": -1.3, "V": 4.2,
        }

        gravy_cloud: list[dict] = []
        if "IM" in df.columns:
            try:
                im_df = df.filter(pl.col("IM") > 0)
                n_samp = min(600, im_df.height)
                if n_samp > 0:
                    sdf = im_df.sample(n=n_samp, shuffle=True, seed=42) if im_df.height > n_samp else im_df
                    for row in sdf.iter_rows(named=True):
                        raw_seq = row.get(seq_col, "") or ""
                        clean = _re.sub(r"\(UniMod:\d+\)", "", raw_seq).upper()
                        if not clean:
                            continue
                        vals = [_KD[aa] for aa in clean if aa in _KD]
                        if not vals:
                            continue
                        g = round(sum(vals) / len(vals), 3)
                        gravy_cloud.append({
                            "gravy":  g,
                            "im":     round(float(row.get("IM", 0) or 0), 4),
                            "length": int(row.get("pep_len", 0) or 0),
                            "charge": int(row.get("Precursor.Charge", 0) or 0),
                            "seq":    clean[:16],
                        })
            except Exception:
                logger.debug("gravy_cloud failed", exc_info=True)

        # ── Immunopeptidome fingerprint scores (View 2 radar) ─────────────
        try:
            pct_z1 = (
                round(df.filter(pl.col("Precursor.Charge") == 1).height / n_total * 100, 1)
                if "Precursor.Charge" in df.columns and n_total else 0.0
            )
            mhc1_df = df.filter((pl.col("pep_len") >= 8) & (pl.col("pep_len") <= 14))
            pct_9mer_mhc1 = round(
                mhc1_df.filter(pl.col("pep_len") == 9).height / max(1, mhc1_df.height) * 100, 1
            )
            mob_cv: float | None = None
            if "IM" in df.columns:
                im_s = df.filter(pl.col("IM") > 0)["IM"]
                if len(im_s) > 1:
                    mob_cv = round(float(im_s.std()) / max(float(im_s.mean()), 1e-6) * 100, 2)
            dyn_range_db: float | None = None
            if "Precursor.Quantity" in df.columns:
                q_s = df.filter(pl.col("Precursor.Quantity") > 0)["Precursor.Quantity"]
                if len(q_s) > 1:
                    import math as _math
                    dyn_range_db = round(_math.log10(float(q_s.max()) / float(q_s.min()) + 1) * 20, 1)
            radar = {
                "pct_mhc1":       round(mhc1 / n_total * 100, 1) if n_total else 0.0,
                "pct_z1":         pct_z1,
                "pct_9mer_mhc1":  pct_9mer_mhc1,
                "mobility_cv":    mob_cv,
                "dyn_range_db":   dyn_range_db,
            }
        except Exception:
            logger.debug("radar scores failed", exc_info=True)
            radar = {}

        # ── Sequence motif matrix (MHC-I lengths 8–11) ──────────────────────
        # Per-position amino acid frequencies for HLA binding motif analysis.
        # Returns a 20×length matrix (row=AA, col=position) normalised per column.
        _AMINO_ACIDS = list("ACDEFGHIKLMNPQRSTVWY")
        _AA_IDX = {aa: i for i, aa in enumerate(_AMINO_ACIDS)}
        motif_matrix: dict = {}
        try:
            _mhc1_range = df.filter((pl.col("pep_len") >= 8) & (pl.col("pep_len") <= 11))
            for _ml in [8, 9, 10, 11]:
                _len_df = _mhc1_range.filter(pl.col("pep_len") == _ml)
                _n = _len_df.height
                if _n < 10:
                    continue
                _pos_counts = [[0] * 20 for _ in range(_ml)]
                for _seq_raw in _len_df[seq_col].drop_nulls().to_list():
                    _clean = _re.sub(r"\(UniMod:\d+\)", "", _seq_raw).upper()
                    if len(_clean) != _ml:
                        continue
                    for _pos, _aa in enumerate(_clean):
                        _ai = _AA_IDX.get(_aa)
                        if _ai is not None:
                            _pos_counts[_pos][_ai] += 1
                # Build 20×length frequency matrix (row=AA, col=position)
                _freq: list[list[float]] = []
                for _ai in range(20):
                    _row: list[float] = []
                    for _pos in range(_ml):
                        _tot = sum(_pos_counts[_pos])
                        _row.append(round(_pos_counts[_pos][_ai] / max(1, _tot), 4))
                    _freq.append(_row)
                motif_matrix[str(_ml)] = {"n": _n, "aas": _AMINO_ACIDS, "freq": _freq}
        except Exception:
            logger.debug("motif_matrix failed", exc_info=True)

        # ── Top source proteins ──────────────────────────────────────────────
        # Which proteins present the most peptides in the immunopeptidome.
        top_source_proteins: list[dict] = []
        try:
            prot_col = "Protein.Group" if "Protein.Group" in df.columns else (
                "Protein.Names" if "Protein.Names" in df.columns else None
            )
            if prot_col:
                # Count unique stripped sequences per protein group
                prot_df = (
                    df.select([prot_col, seq_col])
                    .unique()
                    .group_by(prot_col)
                    .agg(pl.len().alias("n_peptides"))
                    .sort("n_peptides", descending=True)
                    .limit(25)
                )
                total_unique_peps = df.select(seq_col).unique().height
                for row in prot_df.iter_rows(named=True):
                    pg = str(row.get(prot_col) or "").strip()
                    if not pg:
                        continue
                    # Take first group member, strip isoform suffix
                    gene = pg.split(";")[0].strip()
                    # DIA-NN Protein.Group is often "GENENAME_HUMAN" or accession
                    gene = gene.split("_")[0] if "_" in gene and len(gene.split("_")[0]) <= 10 else gene
                    top_source_proteins.append({
                        "protein": gene[:30],
                        "full_name": pg[:60],
                        "n_peptides": int(row["n_peptides"]),
                        "pct": round(row["n_peptides"] / max(1, total_unique_peps) * 100, 1),
                    })
        except Exception:
            logger.debug("top_source_proteins failed", exc_info=True)

        # Expand top_peptides to 500 (was 50)
        top_peptides = []
        for row in df.sort(sort_col, descending="Precursor.Quantity" in df.columns).iter_rows(named=True):
            top_peptides.append({
                "sequence":  row.get(seq_col, ""),
                "length":    int(row.get("pep_len", 0)),
                "charge":    int(row.get("Precursor.Charge", 0) or 0),
                "mz":        round(float(row.get("Precursor.Mz", 0) or 0), 4),
                "rt":        round(float(row.get("RT", 0) or 0), 3),
                "mobility":  round(float(row.get("IM", 0) or 0), 4) if "IM" in df.columns else None,
                "intensity": float(row.get("Precursor.Quantity", 0) or 0),
            })
            if len(top_peptides) >= 500:
                break

        acq_mode = run.get("mode", "")
        # DDA immunopeptidomics: ddaPASEF (timsTOF) or ddaMS2 (Thermo)
        # DIA immunopeptidomics: diaPASEF — needs MHC-specific speclib (not tryptic)
        is_dia_immuno = acq_mode in ("diaPASEF", "DIA")
        is_dda_immuno = acq_mode in ("ddaPASEF", "DDA", "ddaMS2")

        return {
            "n_total":              n_total,
            "n_mhc1":               mhc1,
            "n_mhc2":               mhc2,
            "n_short":              short,
            "n_long":               long_,
            "pct_mhc1":             round(mhc1 / n_total * 100, 1) if n_total else 0,
            "pct_mhc2":             round(mhc2 / n_total * 100, 1) if n_total else 0,
            "length_dist":          len_counts,
            "charge_dist":          charge_dist,
            "length_stats":         length_stats,
            "top_peptides":         top_peptides,
            "modifications":        mods_out,
            "length_mobility_agg":  length_mobility_agg,
            "gravy_cloud":          gravy_cloud,
            "radar":                radar,
            "motif_matrix":         motif_matrix,
            "top_source_proteins":  top_source_proteins,
            "acq_mode":             acq_mode,
            "is_dia_immuno":        is_dia_immuno,
            "is_dda_immuno":        is_dda_immuno,
        }
    except Exception as e:
        logger.exception("immunopeptidomics endpoint failed")
        return {}


@app.get("/api/immuno/compare")
async def api_immuno_compare(
    run_a: str,
    run_b: str = "",
    mhc_class: int = 0,   # 0=all, 1=MHC-I, 2=MHC-II
) -> dict:
    """Compare immunopeptidomics from two runs (run_b optional for single-run mode).

    When run_b is omitted, returns single-run atlas novelty analysis — no fold
    change, all peptides are classified as novel_A or atlas_known.

    Supports both DIA-NN report.parquet and Sage results.sage.parquet.

    Response:
        {
          "peptides": [{ seq, log2fc, intensity_a, intensity_b, status, protein, length, im_a, im_b }],
          "stats":    { n_a, n_b, n_shared, n_novel_a, n_novel_b, n_atlas_known, single_run }
        }
    """
    import math
    import re as _re2

    run_a_rec = get_run(run_a)
    if not run_a_rec:
        raise HTTPException(status_code=404, detail="Run A not found")

    run_b_rec = get_run(run_b) if run_b else None
    single_run = run_b_rec is None

    def _resolve_any_path(rec: dict) -> "Path | None":
        """Return first available search result path (DIA-NN or Sage)."""
        p = _resolve_report_path(rec)
        if p:
            return p
        return _resolve_sage_path(rec)

    def _is_sage(path: "Path") -> bool:
        return path.name == "results.sage.parquet"

    def _load_immuno_diann(path: "Path", mhc_cls: int) -> list[dict]:
        """Load DIA-NN precursors as {seq, pep_len, intensity, im, protein_group}."""
        import polars as pl
        schema = pl.read_parquet_schema(str(path))
        avail  = set(schema.keys())
        want   = [c for c in [
            "Stripped.Sequence", "Modified.Sequence",
            "Precursor.Quantity", "Q.Value",
            "IM", "Protein.Group", "Protein.Names",
        ] if c in avail]
        df = pl.read_parquet(str(path), columns=want)
        df = df.filter(pl.col("Q.Value") <= 0.01)
        seq_col = "Stripped.Sequence" if "Stripped.Sequence" in df.columns else "Modified.Sequence"
        df = df.with_columns(
            pl.col(seq_col).str.replace_all(r"\(UniMod:\d+\)", "").alias("seq"),
            pl.col(seq_col).str.replace_all(r"\(UniMod:\d+\)", "").str.len_chars().alias("pep_len"),
        )
        df = df.filter(pl.col("pep_len").is_between(8, 25))
        if mhc_cls == 1:
            df = df.filter(pl.col("pep_len").is_between(8, 14))
        elif mhc_cls == 2:
            df = df.filter(pl.col("pep_len").is_between(13, 25))

        grp = ["seq"]
        agg = [pl.col("pep_len").first().alias("pep_len")]
        if "Precursor.Quantity" in df.columns:
            agg.append(pl.col("Precursor.Quantity").max().alias("intensity"))
        else:
            agg.append(pl.lit(0.0).alias("intensity"))
        agg.append(pl.col("IM").median().alias("im") if "IM" in df.columns else pl.lit(None).alias("im"))
        if "Protein.Group" in df.columns:
            agg.append(pl.col("Protein.Group").first().alias("protein_group"))
        else:
            agg.append(pl.lit("").alias("protein_group"))

        rows = df.group_by(grp).agg(agg).iter_rows(named=True)
        return [{"seq": r["seq"], "pep_len": r["pep_len"], "intensity": r["intensity"] or 0.0,
                 "im": r["im"], "protein_group": r["protein_group"] or ""} for r in rows]

    def _load_immuno_sage_compare(path: "Path", mhc_cls: int) -> list[dict]:
        """Load Sage PSMs as {seq, pep_len, intensity, im, protein_group}."""
        from stan.metrics.mobility_sage import load_immuno_psms_sage
        rows = load_immuno_psms_sage(path, mhc_class=mhc_cls)
        # Aggregate to unique sequences
        agg: dict[str, dict] = {}
        for r in rows:
            seq = r["seq"]
            if seq not in agg:
                agg[seq] = {"seq": seq, "pep_len": r["pep_len"], "intensity": r["intensity"],
                            "im": r["im"], "protein_group": r["protein"]}
            else:
                if (r["intensity"] or 0) > (agg[seq]["intensity"] or 0):
                    agg[seq]["intensity"] = r["intensity"]
                if r["im"] and not agg[seq]["im"]:
                    agg[seq]["im"] = r["im"]
        return list(agg.values())

    def _load_for_compare(path: "Path", mhc_cls: int) -> list[dict]:
        if _is_sage(path):
            return _load_immuno_sage_compare(path, mhc_cls)
        return _load_immuno_diann(path, mhc_cls)

    try:
        path_a = _resolve_any_path(run_a_rec)
        if not path_a:
            raise HTTPException(status_code=422, detail="Run A has no search results")

        rows_a = _load_for_compare(path_a, mhc_class)
        rows_b = _load_for_compare(_resolve_any_path(run_b_rec), mhc_class) if run_b_rec else []

        path_b = _resolve_any_path(run_b_rec) if run_b_rec else None
        if run_b_rec and not path_b:
            raise HTTPException(status_code=422, detail="Run B has no search results")

        import math as _math

        seqs_a = set(r["seq"] for r in rows_a)
        seqs_b = set(r["seq"] for r in rows_b)

        int_a  = {r["seq"]: r["intensity"]     for r in rows_a}
        int_b  = {r["seq"]: r["intensity"]     for r in rows_b}
        im_a   = {r["seq"]: r["im"]            for r in rows_a}
        im_b   = {r["seq"]: r["im"]            for r in rows_b}
        len_d  = {r["seq"]: r["pep_len"]       for r in rows_a}
        len_d.update({r["seq"]: r["pep_len"]   for r in rows_b})
        prot_d = {r["seq"]: r["protein_group"] for r in rows_a}
        prot_d.update({r["seq"]: r["protein_group"] for r in rows_b})

        all_seqs = seqs_a | seqs_b
        shared   = seqs_a & seqs_b

        # Median normalization using shared peptides (two-run mode only)
        if not single_run and len(shared) > 5:
            shared_list = list(shared)
            ratios = [int_a[s] / int_b[s] for s in shared_list
                      if int_a.get(s, 0) > 0 and int_b.get(s, 0) > 0]
            if ratios:
                ratios.sort()
                median_ratio = ratios[len(ratios) // 2]
            else:
                median_ratio = 1.0
        else:
            median_ratio = 1.0

        # Atlas lookup
        atlas_known: set[str] = set()
        try:
            from stan.search.hla_atlas import AtlasManager
            result = AtlasManager().coverage(list(all_seqs))
            atlas_known = set(result.get("matched_seqs", []))
        except Exception:
            pass

        # Build output
        _LOG2_MIN = _math.log2(0.01)
        _LOG2_MAX = -_LOG2_MIN
        MAX_PEPS  = 2000

        peptides = []
        for seq in all_seqs:
            ia = int_a.get(seq, 0.0) or 0.0
            ib = int_b.get(seq, 0.0) or 0.0
            ib_norm = ib * median_ratio

            if single_run:
                # Single-run: all peptides are "in A", no fold change
                log2fc = 0.0
                status = "known" if seq in atlas_known else "novel_A"
            elif seq in shared:
                log2fc = _math.log2(ia / ib_norm) if ia > 0 and ib_norm > 0 else 0.0
                status = "known" if seq in atlas_known else "novel_shared"
            elif seq in seqs_a:
                log2fc  = _LOG2_MAX
                status  = "known" if seq in atlas_known else "novel_A"
                ib_norm = ia * 0.01
            else:
                log2fc = _LOG2_MIN
                status = "known" if seq in atlas_known else "novel_B"
                ia     = ib_norm * 0.01

            peptides.append({
                "seq":         seq,
                "length":      len_d.get(seq, len(seq)),
                "log2fc":      round(log2fc, 3),
                "intensity_a": round(ia, 0),
                "intensity_b": round(ib_norm, 0),
                "status":      status,
                "protein":     (prot_d.get(seq, "") or "")[:40],
                "im_a":        round(im_a.get(seq) or 0, 4) if im_a.get(seq) else None,
                "im_b":        round(im_b.get(seq) or 0, 4) if im_b.get(seq) else None,
                "in_atlas":    seq in atlas_known,
            })

        if single_run:
            peptides.sort(key=lambda p: p["intensity_a"], reverse=True)
        else:
            peptides.sort(key=lambda p: abs(p["log2fc"]), reverse=True)
        peptides_out = peptides[:MAX_PEPS]

        n_novel_a      = sum(1 for p in peptides if p["status"] == "novel_A")
        n_novel_b      = sum(1 for p in peptides if p["status"] == "novel_B")
        n_novel_shared = sum(1 for p in peptides if p["status"] == "novel_shared")
        n_known        = sum(1 for p in peptides if p["in_atlas"])

        return {
            "peptides": peptides_out,
            "stats": {
                "n_a":              len(seqs_a),
                "n_b":              len(seqs_b),
                "n_shared":         len(shared),
                "n_total":          len(all_seqs),
                "n_novel_a":        n_novel_a,
                "n_novel_b":        n_novel_b,
                "n_novel_shared":   n_novel_shared,
                "n_atlas_known":    n_known,
                "median_norm_ratio": round(median_ratio, 4),
                "atlas_available":  len(atlas_known) > 0,
                "single_run":       single_run,
            },
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("immuno/compare failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{run_id}/immuno-landscape")
async def api_immuno_landscape(run_id: str) -> dict:
    """Raw MHC ion landscape from timsdata — View 3 of the Immunopeptidomics tab.

    Reads ~20 sampled MS1 frames from the middle 60% of the run, bins ALL
    detected ions in the MHC-I window (m/z 400–950, 1/K₀ 0.60–1.05) into an
    80 × 40 (m/z × 1/K₀) density grid, and overlays DIA-NN identified
    immunopeptides on top.  Requires the Bruker timsdata DLL.

    Returns:
        {grid, mz_centers, im_centers, identified, n_frames_sampled}
        or {} if the DLL is unavailable or the run is not a .d file.
    """
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    raw_path = run.get("raw_path", "")
    if not raw_path or not raw_path.endswith(".d"):
        return {}

    try:
        import numpy as np
        from stan.tools.timsdata.timsdata import TimsData
    except Exception:
        logger.warning("timsdata DLL unavailable — immuno-landscape skipped")
        return {}

    _MZ_LO, _MZ_HI = 400.0, 950.0
    _IM_LO, _IM_HI = 0.60, 1.05
    _MZ_BINS, _IM_BINS = 80, 40
    _N_FRAMES = 20   # sample this many MS1 frames from mid-run

    d_path = Path(raw_path)
    if not d_path.is_dir():
        return {}

    try:
        with TimsData(str(d_path)) as td:
            # ── All MS1 frames ──────────────────────────────────────────────
            rows = td.conn.execute(
                "SELECT Id, NumScans, Time FROM Frames WHERE MsMsType=0 ORDER BY Id"
            ).fetchall()
            if not rows:
                rows = td.conn.execute(
                    "SELECT Id, NumScans, Time FROM Frames ORDER BY Id"
                ).fetchall()
            if not rows:
                return {}

            fids = [int(r[0]) for r in rows]
            n_scans_map = {int(r[0]): int(r[1]) for r in rows}

            # Sample from the middle 60% of the RT range
            lo_i = len(fids) // 5
            hi_i = len(fids) - len(fids) // 5
            mid_fids = fids[lo_i:hi_i]
            step = max(1, len(mid_fids) // _N_FRAMES)
            sampled = mid_fids[::step][:_N_FRAMES]

            # ── TOF index pre-filter bounds (from reference frame) ──────────
            ref_fid = fids[len(fids) // 2]
            tof_bounds = td.mzToIndex(ref_fid, np.array([_MZ_LO, _MZ_HI]))
            tof_lo_i = int(min(tof_bounds)) - 10
            tof_hi_i = int(max(tof_bounds)) + 10

            # ── Accumulate 2D grid ──────────────────────────────────────────
            grid = np.zeros((_IM_BINS, _MZ_BINS), dtype=np.float64)

            for fid in sampled:
                n_sc = n_scans_map[fid]
                if n_sc == 0:
                    continue
                scan_nums = np.arange(n_sc, dtype=np.float64)
                ook0_vals = td.scanNumToOneOverK0(fid, scan_nums)

                scans = td.readScans(fid, 0, n_sc)

                all_tof_list, all_sc_list, all_int_list = [], [], []
                for scan_i, (idx_arr, int_arr) in enumerate(scans):
                    if len(idx_arr) == 0:
                        continue
                    mask = (idx_arr >= tof_lo_i) & (idx_arr <= tof_hi_i)
                    if not mask.any():
                        continue
                    all_tof_list.append(idx_arr[mask])
                    all_sc_list.append(np.full(int(mask.sum()), scan_i, dtype=np.int32))
                    all_int_list.append(int_arr[mask])

                if not all_tof_list:
                    continue

                all_tof = np.concatenate(all_tof_list).astype(np.float64)
                all_sc  = np.concatenate(all_sc_list)
                all_int = np.concatenate(all_int_list).astype(np.float64)

                mz_vals = td.indexToMz(fid, all_tof)
                im_vals = ook0_vals[all_sc]

                keep = (
                    (mz_vals >= _MZ_LO) & (mz_vals <= _MZ_HI) &
                    (im_vals >= _IM_LO) & (im_vals <= _IM_HI)
                )
                if not keep.any():
                    continue

                mz_f = mz_vals[keep]
                im_f = im_vals[keep]
                int_f = all_int[keep]

                mz_bin = np.clip(
                    ((mz_f - _MZ_LO) / (_MZ_HI - _MZ_LO) * _MZ_BINS).astype(int),
                    0, _MZ_BINS - 1,
                )
                im_bin = np.clip(
                    ((im_f - _IM_LO) / (_IM_HI - _IM_LO) * _IM_BINS).astype(int),
                    0, _IM_BINS - 1,
                )
                np.add.at(grid, (im_bin, mz_bin), int_f)

            # Log-compress and normalise to 0–1
            grid = np.log1p(grid)
            gmax = float(grid.max())
            if gmax > 0:
                grid /= gmax

            mz_step = (_MZ_HI - _MZ_LO) / _MZ_BINS
            im_step = (_IM_HI - _IM_LO) / _IM_BINS
            mz_centers = [round(_MZ_LO + (i + 0.5) * mz_step, 2) for i in range(_MZ_BINS)]
            im_centers  = [round(_IM_LO + (i + 0.5) * im_step, 4) for i in range(_IM_BINS)]

            # ── DIA-NN identified overlay ───────────────────────────────────
            identified: list[dict] = []
            report_path = _resolve_report_path(run)
            if report_path:
                try:
                    import polars as pl
                    schema = pl.read_parquet_schema(str(report_path))
                    avail = set(schema.keys())
                    file_col = "Run" if "Run" in avail else "File.Name"
                    want_id = [c for c in [
                        "Stripped.Sequence", "Modified.Sequence",
                        "Precursor.Mz", "IM", "Precursor.Charge",
                        "Q.Value", file_col,
                    ] if c in avail]
                    if "Precursor.Mz" in avail and "IM" in avail:
                        idf = (
                            pl.read_parquet(str(report_path), columns=want_id)
                            .filter(pl.col("Q.Value") <= 0.01)
                            .filter(
                                (pl.col("Precursor.Mz") >= _MZ_LO) &
                                (pl.col("Precursor.Mz") <= _MZ_HI) &
                                (pl.col("IM") >= _IM_LO) &
                                (pl.col("IM") <= _IM_HI)
                            )
                        )
                        seq_c = "Stripped.Sequence" if "Stripped.Sequence" in idf.columns else "Modified.Sequence"
                        import re as _re2
                        _upat = _re2.compile(r"\(UniMod:\d+\)")
                        for row in idf.iter_rows(named=True):
                            raw_s = row.get(seq_c, "") or ""
                            clean_s = _upat.sub("", raw_s)
                            identified.append({
                                "mz":     round(float(row["Precursor.Mz"]), 3),
                                "im":     round(float(row["IM"]), 4),
                                "seq":    clean_s[:20],
                                "length": len(clean_s),
                                "charge": int(row.get("Precursor.Charge", 0) or 0),
                            })
                except Exception:
                    logger.debug("immuno-landscape identified overlay failed", exc_info=True)

            return {
                "grid":            grid.tolist(),
                "mz_centers":      mz_centers,
                "im_centers":      im_centers,
                "mz_lo":           _MZ_LO,
                "mz_hi":           _MZ_HI,
                "im_lo":           _IM_LO,
                "im_hi":           _IM_HI,
                "n_frames_sampled": len(sampled),
                "identified":      identified,
            }

    except Exception:
        logger.exception("immuno-landscape failed for %s", raw_path)
        return {}


@app.get("/api/runs/{run_id}/enzyme-stats")
async def api_enzyme_stats(run_id: str, enzyme: str = "trypsin") -> dict:
    """Enzyme efficiency and PTM statistics.

    Returns missed cleavage distribution, oxidation %, and other modification
    frequencies at 1% FDR.  Source: DIA-NN report.parquet > Sage results.sage.parquet.

    Args:
        enzyme: One of trypsin, trypsin_lysc, lysc, argc, chymotrypsin,
                rchymoselect, krakatoa, vesuvius, aspn, proalanase, pepsin,
                nonspecific.  Determines which residues count as missed cleavages.
    """
    from stan.metrics.mobility_diann import get_enzyme_stats_diann
    from stan.metrics.mobility_sage import get_enzyme_stats_sage

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    report_path = _resolve_report_path(run)
    if report_path:
        return get_enzyme_stats_diann(report_path, run_name=run.get("run_name"), enzyme=enzyme)

    sage_path = _resolve_sage_path(run)
    if sage_path:
        return get_enzyme_stats_sage(sage_path, enzyme=enzyme)

    return {}


@app.get("/api/runs/{run_id}/ion-detail")
async def api_ion_detail(
    run_id: str,
    mz: float,
    rt: float,
    ook0: float,
    tol_ppm: float = 10.0,
) -> dict:
    """XIC + mobilogram for a clicked precursor ion.

    Reads raw binary data from the .d directory via the Bruker timsdata DLL.
    Uses a single-pass extractChromatograms call for efficiency.

    Args:
        mz:      Target m/z (Th).
        rt:      Approximate RT in seconds.
        ook0:    Measured 1/K₀ (Vs/cm²).
        tol_ppm: m/z extraction tolerance (default 10 ppm).
    """
    from stan.metrics.ion_detail import get_ion_detail

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    raw_path = run.get("raw_path")
    if not raw_path or not raw_path.endswith(".d"):
        return {}

    return get_ion_detail(raw_path, mz=mz, rt_sec=rt, ook0=ook0, mz_tol_ppm=tol_ppm)


@app.get("/api/runs/{run_id}/frame-heatmap")
async def api_frame_heatmap(
    run_id: str,
    rt: float,
    mz_lo: float | None = None,
    mz_hi: float | None = None,
) -> dict:
    """Raw 2D frame heatmap — m/z × 1/K₀ for the frame nearest rt (seconds).

    Equivalent to mzmine's Frame Heatmap panel. Reads all mobility scans in the
    frame and bins them into a log-scaled intensity grid.
    """
    from stan.metrics.ion_detail import get_frame_heatmap

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    raw_path = run.get("raw_path")
    if not raw_path or not raw_path.endswith(".d"):
        return {}

    return get_frame_heatmap(raw_path, rt_sec=rt, mz_lo=mz_lo, mz_hi=mz_hi)


@app.get("/api/runs/{run_id}/frame-spectrum")
async def api_frame_spectrum(run_id: str, rt: float) -> dict:
    """Summed MS spectrum for the frame nearest rt (seconds).

    Equivalent to mzmine's Summed Frame Spectrum panel. All mobility scans
    in the frame are summed into a single m/z-intensity profile.
    """
    from stan.metrics.ion_detail import get_frame_spectrum

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    raw_path = run.get("raw_path")
    if not raw_path or not raw_path.endswith(".d"):
        return {}

    return get_frame_spectrum(raw_path, rt_sec=rt)


@app.get("/api/runs/{run_id}/ccs")
async def api_ccs(run_id: str) -> dict:
    """CCS vs m/z scatter and per-charge CCS distribution histograms.

    Converts 1/K₀ → CCS (Å²) via the Bruker timsdata DLL.  Falls back to
    raw 1/K₀ if the DLL is unavailable.  Source: DIA-NN report > Sage PSMs.
    """
    from stan.metrics.mobility_diann import get_ccs_data_diann
    from stan.metrics.mobility_sage import get_ccs_data_sage

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    report_path = _resolve_report_path(run)
    if report_path:
        result = get_ccs_data_diann(report_path, run_name=run.get("run_name"))
        if result:
            return result

    sage_path = _resolve_sage_path(run)
    if sage_path:
        return get_ccs_data_sage(sage_path)

    chimerys_path = _resolve_chimerys_path(run)
    if chimerys_path:
        from stan.metrics.mobility_chimerys import get_ccs_data_chimerys
        return get_ccs_data_chimerys(chimerys_path)

    return {}


@app.get("/api/instruments/{instrument}/tic")
async def api_instrument_tic(instrument: str, limit: int = 20) -> dict:
    """Fetch recent TIC traces for an instrument (for overlay plot)."""
    traces = get_tic_traces_for_instrument(instrument, limit=min(limit, 50))
    return {"instrument": instrument, "traces": traces, "count": len(traces)}


# ── MSAID Platform / CHIMERYS endpoints ──────────────────────────────────────

@app.get("/api/msaid/status")
async def api_msaid_status() -> dict:
    """Check MSAID Platform authentication status."""
    from stan.search.msaid_platform import MsaidPlatformClient, _DEFAULT_API_URL
    from stan.config import load_instruments
    inst = (load_instruments() or {}).get("instruments", [{}])[0]
    api_url = inst.get("msaid_api_url", _DEFAULT_API_URL)
    client = MsaidPlatformClient(api_url)
    return {
        "authenticated": client.is_authenticated,
        "api_url": api_url,
    }


@app.get("/api/msaid/login")
async def api_msaid_login() -> dict:
    """Start MSAID Platform OAuth2 browser login flow.

    Opens the system browser to the Cognito login page.  The auth code
    is captured on the redirect callback at /api/msaid/callback.
    Returns immediately — client should poll /api/msaid/status.
    """
    import threading
    from stan.search.msaid_platform import MsaidPlatformClient, _DEFAULT_API_URL
    from stan.config import load_instruments
    inst = (load_instruments() or {}).get("instruments", [{}])[0]
    api_url = inst.get("msaid_api_url", _DEFAULT_API_URL)

    def _do_login():
        try:
            MsaidPlatformClient(api_url).login()
        except Exception as e:
            logger.warning("MSAID login error: %s", e)

    threading.Thread(target=_do_login, daemon=True).start()
    return {"status": "login_started", "message": "Browser opened — complete login then return here."}


@app.get("/api/msaid/logout")
async def api_msaid_logout() -> dict:
    from stan.search.msaid_platform import MsaidPlatformClient, _DEFAULT_API_URL
    from stan.config import load_instruments
    inst = (load_instruments() or {}).get("instruments", [{}])[0]
    api_url = inst.get("msaid_api_url", _DEFAULT_API_URL)
    MsaidPlatformClient(api_url).logout()
    return {"status": "logged_out"}


@app.get("/api/msaid/experiments")
async def api_msaid_experiments() -> list:
    """List CHIMERYS experiments from the MSAID Platform."""
    from stan.search.msaid_platform import MsaidPlatformClient, _DEFAULT_API_URL
    from stan.config import load_instruments
    inst = (load_instruments() or {}).get("instruments", [{}])[0]
    api_url = inst.get("msaid_api_url", _DEFAULT_API_URL)
    client = MsaidPlatformClient(api_url)
    if not client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated with MSAID Platform. Use /api/msaid/login first.")
    try:
        return client.list_experiments(status="COMPLETED")
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


class ChimerysLinkBody(BaseModel):
    run_id: str
    experiment_uuid: str
    level: str = "PSMS"


@app.post("/api/msaid/link")
async def api_msaid_link(body: ChimerysLinkBody) -> dict:
    """Download a Chimerys experiment result and link it to a run.

    Downloads the specified result level (default: PSMS) to the local
    Chimerys cache and stores the experiment UUID on the run record so
    future requests resolve to the cached parquet automatically.
    """
    from stan.search.msaid_platform import MsaidPlatformClient, _DEFAULT_API_URL
    from stan.config import load_instruments
    from stan.db import update_run_field

    run = get_run(body.run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    inst = (load_instruments() or {}).get("instruments", [{}])[0]
    api_url = inst.get("msaid_api_url", _DEFAULT_API_URL)
    client = MsaidPlatformClient(api_url)
    if not client.is_authenticated:
        raise HTTPException(status_code=401, detail="Not authenticated with MSAID Platform.")

    try:
        parquet_path = client.download_results(body.experiment_uuid, level=body.level)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Download failed: {e}")

    # Store experiment UUID on run so _resolve_chimerys_path can find it
    try:
        update_run_field(body.run_id, "chimerys_experiment_uuid", body.experiment_uuid)
        update_run_field(body.run_id, "chimerys_path", str(parquet_path))
    except Exception as e:
        logger.warning("Could not persist chimerys_path to DB: %s", e)

    # Quick stats
    try:
        import polars as pl
        df = pl.read_parquet(str(parquet_path))
        n_psms = df.height
    except Exception:
        n_psms = -1

    return {
        "status":           "linked",
        "run_id":           body.run_id,
        "experiment_uuid":  body.experiment_uuid,
        "parquet_path":     str(parquet_path),
        "n_rows":           n_psms,
        "level":            body.level,
    }


@app.get("/api/runs/{run_id}/chimerys-stats")
async def api_chimerys_stats(run_id: str) -> dict:
    """Return Chimerys peptide / chimeric spectrum statistics for a run."""
    from stan.metrics.mobility_chimerys import get_peptide_stats_chimerys, get_charge_distribution_chimerys

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    chimerys_path = _resolve_chimerys_path(run)
    if not chimerys_path:
        return {"available": False}

    return {
        "available":    True,
        "peptide_stats": get_peptide_stats_chimerys(chimerys_path),
        "charge_dist":   get_charge_distribution_chimerys(chimerys_path),
    }


@app.get("/api/community/cohort")
async def api_community_cohort() -> dict:
    """Fetch community cohort data.

    Returns cached cohort percentiles — updated by nightly consolidation.
    """
    try:
        from stan.community.fetch import fetch_cohort_percentiles

        return fetch_cohort_percentiles()
    except Exception:
        logger.exception("Failed to fetch community cohort")
        return {"cohorts": {}, "error": "Failed to fetch community data"}


class CommunitySubmitRequest(BaseModel):
    run_id: str
    spd: int | None = None
    gradient_length_min: int | None = None
    amount_ng: float = 50.0
    hela_source: str = "Pierce HeLa Protein Digest Standard"


@app.get("/api/community/submissions")
async def api_community_submissions() -> list:
    """Return all runs that have been submitted to the community benchmark."""
    from stan.db import get_db_path
    import sqlite3
    db_path = get_db_path()
    if not db_path.exists():
        return []
    with sqlite3.connect(str(db_path)) as con:
        con.row_factory = sqlite3.Row
        rows = con.execute(
            "SELECT id, run_name, instrument, run_date, n_precursors, n_psms, "
            "gate_result, submission_id, submitted_to_benchmark "
            "FROM runs WHERE submitted_to_benchmark = 1 ORDER BY run_date DESC"
        ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/community/withdraw/{run_id}")
async def api_community_withdraw(run_id: str) -> dict:
    """Withdraw a community submission — marks as not shared in local DB.

    Note: this removes the run from STAN's local submitted list immediately.
    To permanently remove it from the public HuggingFace dataset, contact
    the benchmark maintainer (bsphinney@ucdavis.edu) with the submission_id.
    """
    from stan.db import get_db_path
    import sqlite3
    db_path = get_db_path()
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    submission_id = run.get("submission_id")
    with sqlite3.connect(str(db_path)) as con:
        con.execute(
            "UPDATE runs SET submitted_to_benchmark = 0 WHERE id = ?", (run_id,)
        )
    return {
        "status": "withdrawn",
        "run_id": run_id,
        "submission_id": submission_id,
        "message": (
            "Run removed from your shared list. "
            "To permanently delete it from the public dataset, email "
            f"bsphinney@ucdavis.edu with submission ID: {submission_id or 'unknown'}"
        ),
    }


@app.post("/api/community/submit")
async def api_community_submit(body: CommunitySubmitRequest) -> dict:
    """Submit a QC run to the community benchmark.

    If amount_ng is not provided in the request, falls back to the value
    stored in the run record (from the instrument config), then to 50 ng.
    """
    run = get_run(body.run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    # Use stored values from the run if caller didn't override
    amount = body.amount_ng
    if amount == 50.0 and run.get("amount_ng"):
        amount = run["amount_ng"]

    spd = body.spd or run.get("spd")
    gradient = body.gradient_length_min or run.get("gradient_length_min")

    try:
        from stan.community.submit import submit_to_benchmark

        result = submit_to_benchmark(
            run=run,
            spd=spd,
            gradient_length_min=gradient,
            amount_ng=amount,
            hela_source=body.hela_source,
        )
        return result
    except Exception as e:
        logger.exception("Community submission failed")
        raise HTTPException(status_code=500, detail=str(e))


# ── Scan for new runs ────────────────────────────────────────────────

@app.get("/api/scan-new-runs")
async def api_scan_new_runs() -> dict:
    """Scan configured watch directories for raw data files/dirs not yet in the database.

    Detects all supported vendor formats:
      - Bruker .d (timsTOF TDF, QTOF BAF, legacy YEP)
      - Thermo .raw files
      - Waters .raw directories
      - Agilent .d (with AcqData/)
      - AB Sciex .wiff / .wiff2
      - Shimadzu .lcd

    Returns:
        found: list of dicts with raw_path, run_name, instrument, mtime,
               vendor, file_format, file_subformat, format_label, badge_color
        n_known: total runs already in DB
    """
    watcher = _get_instruments_watcher()
    if watcher is None:
        return {"found": [], "n_known": 0, "error": "No instruments.yml found"}

    instruments_cfg = watcher.data.get("instruments", [])

    # Collect all known raw_paths from DB (normalised for comparison)
    db_path = get_db_path()
    known_norm: set[str] = set()
    if db_path.exists():
        with _sqlite3_sa.connect(str(db_path)) as con:
            rows = con.execute(
                "SELECT raw_path FROM runs WHERE raw_path IS NOT NULL"
            ).fetchall()
            for (rp,) in rows:
                if rp:
                    known_norm.add(rp.replace("\\", "/").lower())

    # Glob patterns to scan — covers all major vendor formats
    _SCAN_PATTERNS = [
        ("*.d",     True),    # Bruker timsTOF / QTOF / Agilent (directories)
        ("*.raw",   None),    # Thermo (files) or Waters (directories)
        ("*.wiff",  False),   # AB Sciex (files)
        ("*.wiff2", False),   # AB Sciex ZenoTOF (files)
        ("*.lcd",   False),   # Shimadzu (files)
    ]

    found: list[dict] = []
    for inst in instruments_cfg:
        watch_dir = inst.get("watch_dir", "")
        if not watch_dir:
            continue
        watch_path = Path(watch_dir)
        if not watch_path.exists():
            continue
        inst_name = inst.get("name", watch_dir)

        candidates: set[Path] = set()
        for pattern, must_be_dir in _SCAN_PATTERNS:
            for p in watch_path.glob(pattern):
                if must_be_dir is True and not p.is_dir():
                    continue
                if must_be_dir is False and not p.is_file():
                    continue
                candidates.add(p)

        for raw_path in sorted(candidates):
            norm = str(raw_path).replace("\\", "/").lower()
            if norm in known_norm:
                continue

            # Detect format
            fmt_info = detect_format(raw_path)

            # Skip completely unrecognised directories (e.g. random .d folders)
            if fmt_info.get("confidence") == "low" and fmt_info.get("vendor") == "Unknown":
                continue

            try:
                mtime = raw_path.stat().st_mtime
                mtime_iso = datetime.fromtimestamp(mtime).isoformat()
            except OSError:
                mtime_iso = ""

            found.append({
                "raw_path":      str(raw_path),
                "run_name":      raw_path.name,
                "instrument":    inst_name,
                "mtime":         mtime_iso,
                "vendor":        fmt_info.get("vendor") or "",
                "file_format":   fmt_info.get("format") or "",
                "file_subformat": fmt_info.get("subformat") or "",
                "format_label":  format_label(fmt_info),
                "badge_color":   format_badge_css(fmt_info),
                "instrument_family": fmt_info.get("instrument_family") or "",
            })

    # Newest first
    found.sort(key=lambda x: x["mtime"], reverse=True)
    return {"found": found, "n_known": len(known_norm)}


class ScanImportRequest(BaseModel):
    raw_path: str
    instrument: str


@app.post("/api/scan-new-runs/import")
async def api_scan_import(body: ScanImportRequest) -> dict:
    """Import a discovered raw data file/dir into the database (metadata only).

    Detects vendor format automatically.  For Bruker timsTOF .d directories,
    reads analysis.tdf for AcquisitionDateTime and MsmsType.  For all other
    vendors a stub row is inserted with no QC metrics so the run is visible
    in Run History immediately.
    """
    raw_path = Path(body.raw_path)
    if not raw_path.exists():
        raise HTTPException(
            status_code=400,
            detail=f"Path not found: {body.raw_path}",
        )

    # Detect vendor format first — works for files and directories
    fmt_info = detect_format(raw_path)
    vendor    = fmt_info.get("vendor") or ""
    fmt       = fmt_info.get("format") or ""
    subfmt    = fmt_info.get("subformat") or ""
    flabel    = format_label(fmt_info)

    run_name = raw_path.name
    run_date: str | None = None
    mode = "diaPASEF"

    # Bruker timsTOF: read acquisition metadata from analysis.tdf
    is_bruker_tdf = (fmt == "Bruker timsTOF" and (raw_path / "analysis.tdf").exists())
    if is_bruker_tdf:
        tdf_path = raw_path / "analysis.tdf"
        try:
            with _sqlite3_sa.connect(str(tdf_path)) as con:
                meta_row = con.execute(
                    "SELECT Value FROM GlobalMetadata WHERE Key = 'AcquisitionDateTime'"
                ).fetchone()
                if meta_row:
                    run_date = meta_row[0]

                # MsmsType: 8=ddaPASEF, 9=diaPASEF, 0=MS1 only
                type_rows = con.execute(
                    "SELECT MsmsType FROM Frames GROUP BY MsmsType"
                ).fetchall()
                types = {r[0] for r in type_rows}
                if 8 in types and 9 not in types:
                    mode = "ddaPASEF"
        except Exception:
            logger.warning("Could not read analysis.tdf for %s", run_name, exc_info=True)
    elif "Thermo" in vendor:
        mode = "ddaMS2"   # Thermo default until searched
    elif "Waters" in vendor:
        mode = "Waters"
    elif "Sciex" in vendor or "AB Sciex" in vendor:
        mode = "AB Sciex"

    # Auto-resolve instrument name from Bruker .m method file when caller
    # passes a placeholder value (e.g. "auto", "Auto", "unknown", "").
    resolved_instrument = body.instrument
    _placeholder = {"auto", "unknown", "instrument", ""}
    if resolved_instrument.lower().strip() in _placeholder and is_bruker_tdf:
        try:
            from stan.watcher.instrument_name import read_instrument_name_from_d
            _name = read_instrument_name_from_d(raw_path)
            if _name:
                resolved_instrument = _name
                logger.info("Auto-resolved instrument name for %s: %s", run_name, _name)
        except Exception:
            logger.warning("Could not auto-resolve instrument name for %s", run_name, exc_info=True)

    from stan.db import insert_run
    run_id = insert_run(
        instrument=resolved_instrument,
        run_name=run_name,
        raw_path=str(raw_path),
        mode=mode,
        metrics={},
        gate_result="",
        run_date=run_date,
    )

    # Stamp vendor/format onto the new row
    db_path = get_db_path()
    with _sqlite3_sa.connect(str(db_path)) as con:
        con.execute(
            "UPDATE runs SET instrument_vendor=?, file_format=?, file_subformat=? WHERE id=?",
            (vendor, fmt, subfmt, run_id),
        )

    return {
        "run_id": run_id,
        "run_name": run_name,
        "mode": mode,
        "run_date": run_date,
        "vendor": vendor,
        "file_format": fmt,
        "format_label": flabel,
        "status": "imported",
    }


# ── Background search processing ─────────────────────────────────────

# run_id → {"status": "queued"|"running"|"done"|"failed", "message": str}
_process_jobs: dict[str, dict] = {}
_process_lock = threading.Lock()

# Limit concurrent primary searches (DIA-NN / Sage) to 1 at a time.
# Comparison engine threads (MSFragger, X!Tandem, Comet, MaxQuant) are
# unaffected — they run in their own daemon threads after the primary
# search completes.
_search_semaphore = threading.Semaphore(1)


def _find_diann_exe() -> str:
    """Find DIA-NN executable: instruments.yml → common install paths → PATH."""
    import shutil
    candidates = [
        r"C:\DIA-NN\2.3.2\diann.exe",
        r"C:\DIA-NN\2.3.1\diann.exe",
        r"C:\DIA-NN\2.3.0\diann.exe",
        r"C:\Program Files\DIA-NN\2.3.2\diann.exe",
        r"C:\Program Files\DIA-NN\DiaNN.exe",
        r"C:\DiaNN\DiaNN.exe",
    ]
    for c in candidates:
        if Path(c).exists():
            return c
    return shutil.which("diann") or shutil.which("DiaNN") or "diann"


def _run_process_job(run_id: str, run: dict, inst_cfg: dict) -> None:
    """Background thread: run DIA-NN/Sage, extract metrics, update DB."""
    from stan.metrics.extractor import extract_dda_metrics, extract_dia_metrics
    from stan.search.local import run_diann_local, run_sage_local

    def _set(status: str, message: str = "") -> None:
        with _process_lock:
            _process_jobs[run_id] = {"status": status, "message": message}

    _semaphore_acquired = False
    _semaphore_released = False
    try:
        raw_path = Path(run["raw_path"])
        mode = run.get("mode", "DIA")
        vendor = "bruker" if raw_path.suffix.lower() == ".d" else "thermo"

        # Wait in the queue — only one primary search (DIA-NN/Sage) runs at a time.
        # Update status so the UI shows "Queued (waiting…)" instead of just "queued".
        _set("queued", f"Waiting for current search to finish before starting {raw_path.name}…")
        _search_semaphore.acquire()
        _semaphore_acquired = True
        _set("running", "Starting search…")

        # Always re-verify mode from TDF for Bruker files — the DB value can be
        # wrong if the run was registered before the detector was in place, or
        # if the file was mis-labelled.  Trusting a stale "diaPASEF" tag on a
        # ddaPASEF file causes DIA-NN to load a speclib, find no DIA windows,
        # and segfault (Windows "referenced memory" crash).
        if vendor == "bruker" and (raw_path / "analysis.tdf").exists():
            detected = _detect_mode_from_tdf(raw_path)
            if detected != mode:
                logger.warning(
                    "Mode mismatch for %s: DB says '%s', TDF says '%s' — using TDF value.",
                    raw_path.name, mode, detected,
                )
                mode = detected

        # Pre-populate all comparison engine statuses so no column is ever blank.
        # not_applicable = wrong mode, pending = will run (tool check happens later).
        try:
            from stan.search.comparison import init_run_comparison_statuses
            init_run_comparison_statuses(run_id, mode)
        except Exception:
            pass

        # Resolve output dir — default to <watch_dir>/stan_results/<run_stem>
        output_dir_base = inst_cfg.get("output_dir", "")
        if not output_dir_base:
            output_dir_base = str(raw_path.parent / "stan_results")
        output_dir = Path(output_dir_base) / raw_path.stem
        output_dir.mkdir(parents=True, exist_ok=True)

        diann_exe = inst_cfg.get("diann_path") or _find_diann_exe()
        fasta_path = inst_cfg.get("fasta_path")
        lib_path = inst_cfg.get("lib_path")
        search_mode = inst_cfg.get("search_mode", "community" if not fasta_path else "local")

        # ── Determine search tool and immunopeptidomics class ─────────────────
        # Routing table (respects preferred_dia_engine / preferred_dda_engine from instruments.yml):
        #   diaPASEF / DIA   → preferred DIA engine (DIA-NN default) → report.parquet
        #   ddaPASEF         → preferred DDA engine (Sage default)   → results.sage.parquet
        #   DDA / ddaMS2     → preferred DDA engine (Sage default)   → results.sage.parquet
        #
        # DIA-NN is ONLY used for DIA data.  DDA searches use Sage (or MSFragger
        # if configured — set preferred_dda_engine in instruments.yml).
        #
        # For immunopeptidomics samples (HLA / MHC in run name), the preset's
        # immuno_class (1 or 2) is passed through so Sage uses non-specific enzyme
        # params with the correct peptide length window.
        preferred_dda = inst_cfg.get("preferred_dda_engine", "sage")
        preferred_dia = inst_cfg.get("preferred_dia_engine", "diann")
        use_diann = _is_dia(mode) and preferred_dia in ("diann", "")   # DIA only — NOT ddaPASEF
        use_sage  = not _is_dia(mode) and preferred_dda in ("sage", "")  # DDA → Sage
        # MSFragger routing (DDA): if preferred_dda_engine = msfragger
        use_msfragger_dda = not _is_dia(mode) and preferred_dda == "msfragger"

        # Resolve immunopeptidomics class from preset or run name
        preset_key  = run.get("_preset", "")
        preset_info = SEARCH_PRESETS.get(preset_key, {})
        immuno_class = preset_info.get("immuno_class", 0)
        if immuno_class == 0 and _is_immuno_run(raw_path.name):
            immuno_class = _immuno_class(raw_path.name)

        # For DIA immuno presets, override DIA-NN args from the preset
        diann_extra: list[str] = []
        if use_diann and preset_info.get("diann_args"):
            diann_extra = preset_info["diann_args"]

        # Check whether a previous search already produced output.
        # "Re-run" from the UI passes force=True to bypass this shortcut.
        force_rerun = run.get("_force_rerun", False)
        existing_parquet = (output_dir / "report.parquet") if use_diann else (output_dir / "results.sage.parquet")

        result_path: Path | None = None
        if not force_rerun and existing_parquet.exists():
            logger.info(
                "Existing search output found for %s — skipping search, re-extracting metrics.",
                raw_path.name,
            )
            _set("running", f"Re-extracting metrics from existing results for {raw_path.name}…")
            result_path = existing_parquet
        elif use_diann:
            if immuno_class:
                _set("running", f"Running DIA-NN MHC-{'I' * immuno_class} on {raw_path.name}…")
            else:
                _set("running", f"Running DIA-NN on {raw_path.name}…")
            result_path = run_diann_local(
                raw_path=raw_path,
                output_dir=output_dir,
                vendor=vendor,
                diann_exe=diann_exe,
                fasta_path=fasta_path,
                lib_path=lib_path,
                search_mode=search_mode,
            )
        else:
            sage_exe = inst_cfg.get("sage_path") or "sage"
            engine_label = "Sage"
            if immuno_class:
                engine_label = f"Sage MHC-{'I' * immuno_class} (non-specific)"

            # For Bruker DDA, prefer MSFragger if available — it reads .d natively
            # via timsdata.dll, bypassing the Sage timsrust stack-buffer-overrun crash
            # that occurs on large timsTOF .d files (≥ ~3 GB tdf_bin).
            # Fall back to Sage if MSFragger is not installed.
            msfragger_jar = inst_cfg.get("msfragger_path") or None
            if msfragger_jar is None and vendor == "bruker":
                from stan.search.local import _find_msfragger
                msfragger_jar = _find_msfragger()

            if msfragger_jar and vendor == "bruker":
                from stan.search.local import run_msfragger_local
                msf_label = "MSFragger"
                if immuno_class:
                    msf_label = f"MSFragger MHC-{'I' * immuno_class}"
                _set("running", f"Running {msf_label} on {raw_path.name}…")
                result_path = run_msfragger_local(
                    raw_path=raw_path,
                    output_dir=output_dir,
                    vendor=vendor,
                    fasta_path=fasta_path,
                    search_mode=search_mode,
                    immuno_class=immuno_class,
                )
                if result_path is None:
                    # MSFragger failed — fall back to Sage
                    logger.warning(
                        "MSFragger failed for %s — falling back to Sage",
                        raw_path.name,
                    )
                    _set("running", f"MSFragger failed — running {engine_label} (fallback) on {raw_path.name}…")
                    result_path = run_sage_local(
                        raw_path=raw_path,
                        output_dir=output_dir,
                        vendor=vendor,
                        sage_exe=sage_exe,
                        fasta_path=fasta_path,
                        search_mode=search_mode,
                        immuno_class=immuno_class,
                    )
            else:
                _set("running", f"Running {engine_label} on {raw_path.name}…")
                result_path = run_sage_local(
                    raw_path=raw_path,
                    output_dir=output_dir,
                    vendor=vendor,
                    sage_exe=sage_exe,
                    fasta_path=fasta_path,
                    search_mode=search_mode,
                    immuno_class=immuno_class,
                )

        # Primary search complete — release the semaphore so the next queued run can start.
        _search_semaphore.release()
        _semaphore_released = True

        if result_path is None:
            # Surface the most useful lines from the search engine log
            hint = ""
            for log_name in ("diann.log", "sage.log"):
                log_file = output_dir / log_name
                if log_file.exists():
                    try:
                        lines = log_file.read_text(errors="replace").splitlines()
                        errors = [
                            line.strip() for line in lines
                            if any(kw in line for kw in ("ERROR", "cannot open", "cannot read", "Cannot load", "0 files will", "unrecognised option"))
                        ]
                        if errors:
                            hint = " | ".join(errors[-4:])
                    except Exception:
                        pass
                    break
            msg = f"Search failed. {hint}" if hint else (
                "Search engine returned no output. Check that DIA-NN is installed, "
                "community assets are downloaded, and the raw file is readable."
            )
            _set("failed", msg[:400])
            return

        _set("running", "Extracting QC metrics…")
        grad_min = inst_cfg.get("gradient_length_min")
        # Route to the correct extractor based on the result file, not the mode.
        # DIA-NN → report.parquet → extract_dia_metrics
        # Sage / MSFragger → results.sage.parquet → extract_dda_metrics
        # (Historically ddaPASEF used DIA-NN → report.parquet, but MSFragger now
        # produces results.sage.parquet for Bruker DDA — check the filename.)
        if result_path.name == "results.sage.parquet":
            metrics = extract_dda_metrics(result_path, gradient_min=float(grad_min) if grad_min else 60)
        else:
            metrics = extract_dia_metrics(result_path, gradient_min=float(grad_min) if grad_min else None)

        # Update the existing run record with all available metrics.
        # Include every writeable DB column that an extractor might return —
        # the filter `if c in metrics` keeps it safe for partial results.
        db_path = get_db_path()
        cols = [
            # Core identifications
            "n_precursors", "n_peptides", "n_proteins",
            "n_psms", "n_peptides_dda",
            # DIA-specific
            "median_cv_precursor", "median_fragments_per_precursor",
            "pct_fragments_quantified",
            # DDA-specific
            "median_hyperscore", "ms2_scan_rate", "median_delta_mass_ppm",
            # Shared
            "missed_cleavage_rate", "missed_cleavage_rate_2plus",
            "pct_charge_1", "pct_charge_2", "pct_charge_3", "pct_charge_4plus",
            "median_peak_width_sec", "median_points_across_peak",
            # Run-stats (from report.stats.tsv / run-level DIA-NN output)
            "ms1_signal", "ms2_signal",
            "fwhm_rt_min", "fwhm_scans",
            "median_mass_acc_ms1_ppm", "median_mass_acc_ms2_ppm",
            # IPS / scoring
            "ips_score", "tic_auc", "peak_rt_min", "irt_max_deviation_min",
            "ms2_fill_time_median_ms",
            # Advanced metrics
            "peak_capacity", "dynamic_range_log10",
            "peak_width_early_sec", "peak_width_middle_sec", "peak_width_late_sec",
            "c2a_rt_start_min", "c2a_rt_stop_min", "c2a_width_min",
            "ids_per_minute_in_c2a", "median_precursor_intensity",
            "pct_delta_mass_lt5ppm", "pct_hyperscore_gt30",
            # Gate / QC evaluation
            "gate_result", "failed_gates", "diagnosis",
            # Run-level metadata from search
            "gradient_length_min", "spd",
            # Path to search results (enables re-extract without re-search)
            "result_path",
        ]
        # Add result_path to metrics dict so it gets persisted
        metrics["result_path"] = str(result_path)

        set_parts = [f"{c} = ?" for c in cols if c in metrics]
        vals = [metrics[c] for c in cols if c in metrics]
        if set_parts:
            with _sqlite3_sa.connect(str(db_path)) as con:
                con.execute(
                    f"UPDATE runs SET {', '.join(set_parts)} WHERE id = ?",
                    vals + [run_id],
                )

        n = metrics.get("n_precursors") or metrics.get("n_psms") or 0
        _set("done", f"Complete — {n:,} {'precursors' if _is_dia(mode) else 'PSMs'} identified")

        # Fire comparison searches (MSFragger DDA + DIA) in background daemon threads.
        # Uses raw_path.stem as run_id so _attach_comparisons can match by filename.
        try:
            from stan.search.comparison import dispatch_comparison_searches
            _workflow = _suggest_preset({"run_name": raw_path.stem, "mode": str(mode)})
            dispatch_comparison_searches(
                run_id=raw_path.stem,
                raw_path=raw_path,
                mode=mode,
                output_base=output_dir.parent,
                fasta_path=inst_cfg.get("fasta_path"),
                workflow=_workflow,
            )
        except Exception:
            logger.debug("Comparison dispatch skipped (FragPipe not found or error)", exc_info=True)

    except Exception as exc:
        logger.exception("Background search failed for run %s", run_id)
        # RuntimeError from ensure_community_assets has multi-line help text — take first line
        msg = str(exc).split("\n")[0][:300]
        _set("failed", msg)
    finally:
        # Release the semaphore on unexpected exceptions — prevents deadlock.
        if _semaphore_acquired and not _semaphore_released:
            try:
                _search_semaphore.release()
            except Exception:
                pass


@app.post("/api/runs/{run_id}/process")
async def api_process_run(run_id: str) -> dict:
    """Trigger DIA-NN or Sage search for a run that has no metrics yet.

    Runs the search in a background thread and returns immediately.
    Poll GET /api/runs/{run_id}/process-status for progress.
    """
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    with _process_lock:
        existing = _process_jobs.get(run_id, {})
        if existing.get("status") in ("queued", "running"):
            return {"status": existing["status"], "message": existing.get("message", "")}

    raw_path = run.get("raw_path", "")
    if not raw_path:
        raise HTTPException(status_code=400, detail="Run has no raw_path")
    if not Path(raw_path).exists():
        raise HTTPException(status_code=400, detail=f"Raw file not found: {raw_path}")

    # Resolve instrument config
    watcher = _get_instruments_watcher()
    instruments_cfg = watcher.data.get("instruments", []) if watcher else []
    inst_name = run.get("instrument", "")
    inst_cfg = next((i for i in instruments_cfg if i.get("name") == inst_name), {})

    with _process_lock:
        _process_jobs[run_id] = {"status": "queued", "message": "Queued…"}

    t = threading.Thread(target=_run_process_job, args=(run_id, run, inst_cfg), daemon=True)
    t.start()
    return {"status": "queued", "message": "Search queued — this will take several minutes."}


@app.get("/api/runs/{run_id}/process-status")
async def api_process_status(run_id: str) -> dict:
    """Poll the status of a background search job."""
    with _process_lock:
        job = _process_jobs.get(run_id)
    if job is None:
        return {"status": "idle"}
    return job


@app.post("/api/process-all-new")
async def api_process_all_new() -> dict:
    """Queue every run that has no search results yet for DIA-NN/Sage processing.

    Skips runs that are already queued or running, and runs with no raw_path or
    a raw_path that no longer exists on disk.  Returns immediately — jobs run
    in background threads.
    """
    all_runs = get_runs(limit=5000)
    watcher = _get_instruments_watcher()
    instruments_cfg = watcher.data.get("instruments", []) if watcher else []

    queued_ids: list[str] = []
    skipped_no_file: int = 0

    for run in all_runs:
        # Process runs with no primary metrics, OR runs that have IDs but are missing
        # key secondary metrics (fwhm_rt_min, ms1_signal, median_mass_acc_ms1_ppm).
        # The latter handles runs that had a partial extraction (old code) or where
        # the server restarted mid-extraction.
        has_primary = run.get("n_precursors") is not None or run.get("n_psms") is not None
        missing_secondary = (
            has_primary and
            run.get("fwhm_rt_min") is None and
            run.get("ms1_signal") is None
        )
        if has_primary and not missing_secondary:
            continue  # fully processed, skip

        run_id = str(run["id"])
        raw_path_str = run.get("raw_path", "")
        if not raw_path_str or not Path(raw_path_str).exists():
            skipped_no_file += 1
            continue

        with _process_lock:
            existing = _process_jobs.get(run_id, {})
            if existing.get("status") in ("queued", "running"):
                continue

        inst_name = run.get("instrument", "")
        inst_cfg = next((i for i in instruments_cfg if i.get("name") == inst_name), {})

        with _process_lock:
            _process_jobs[run_id] = {"status": "queued", "message": "Queued…"}

        t = threading.Thread(target=_run_process_job, args=(run_id, run, inst_cfg), daemon=True)
        t.start()
        queued_ids.append(run_id)

    return {
        "queued": len(queued_ids),
        "skipped_no_file": skipped_no_file,
        "run_ids": queued_ids,
    }


# ── Run annotation (sample type, workflow, notes) ─────────────────────

_VALID_SAMPLE_TYPES = {"", "QC", "Sample", "Blank", "Standard", "Pool"}
_VALID_WORKFLOWS    = {"", "Standard", "Immunopeptidomics", "Single Cell", "Training", "Phospho", "Glyco", "Crosslink"}
_VALID_MODES        = {"", "diaPASEF", "ddaPASEF", "DIA", "DDA", "ddaMS2", "ddaMRM", "PRM", "MS1only"}

@app.get("/api/runs/{run_id}/mobility-calibration")
async def api_mobility_calibration(run_id: str, max_points: int = 4000) -> dict:
    """Measured vs Predicted 1/K₀ from DIA-NN report.parquet.

    Uses DIA-NN's built-in Predicted.IM column (the library-predicted ion
    mobility) vs the measured IM.  The shift Δ = IM − Predicted.IM is the
    basis for the calibration QC described in:

        Impact of Local Air Pressure on Ion Mobilities...
        J. Proteome Res. 2025, doi:10.1021/acs.jproteome.4c00932

    15 mbar air-pressure change → ~0.025 Vs/cm² systematic shift.
    """
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    report_path = _resolve_report_path(run)
    if not report_path:
        return {"error": "no_report", "message": "No DIA-NN report.parquet found for this run."}

    try:
        import polars as pl
        import random

        schema = pl.read_parquet_schema(report_path)
        needed = ["IM", "Predicted.IM", "Precursor.Mz", "Precursor.Charge",
                  "Stripped.Sequence", "Q.Value", "Precursor.Quantity"]
        available = [c for c in needed if c in schema]

        if "IM" not in available or "Predicted.IM" not in available:
            return {"error": "no_predicted_im",
                    "message": "Predicted.IM not in report. DIA-NN ≥ 1.9 required."}

        df = pl.read_parquet(report_path, columns=available)

        # Filter to confident precursors only
        if "Q.Value" in df.columns:
            df = df.filter(pl.col("Q.Value") <= 0.01)

        # Drop rows without valid IM / Predicted.IM
        df = df.filter(
            pl.col("IM").is_not_null() & pl.col("Predicted.IM").is_not_null() &
            (pl.col("IM") > 0.3) & (pl.col("Predicted.IM") > 0.3)
        )

        if df.height == 0:
            return {"error": "no_data", "message": "No confident precursors with IM data."}

        # Compute shift per precursor
        df = df.with_columns(
            (pl.col("IM") - pl.col("Predicted.IM")).alias("delta_im")
        )

        # Summary stats
        deltas = df["delta_im"].to_list()
        deltas_sorted = sorted(deltas)
        n = len(deltas_sorted)
        median_shift = deltas_sorted[n // 2]
        mean_shift = sum(deltas) / n
        p05 = deltas_sorted[max(0, int(n * 0.05))]
        p95 = deltas_sorted[min(n - 1, int(n * 0.95))]
        std = (sum((d - mean_shift) ** 2 for d in deltas) / n) ** 0.5

        # Histogram of shifts (−0.10 to +0.10 in 40 bins)
        BIN_LO, BIN_HI, N_BINS = -0.10, 0.10, 50
        bin_w = (BIN_HI - BIN_LO) / N_BINS
        hist_counts = [0] * N_BINS
        for d in deltas:
            bi = int((d - BIN_LO) / bin_w)
            if 0 <= bi < N_BINS:
                hist_counts[bi] += 1
        hist_edges = [round(BIN_LO + i * bin_w, 4) for i in range(N_BINS + 1)]

        # Scatter — downsample proportionally by charge
        rows_list = df.to_dicts()
        if len(rows_list) > max_points:
            rows_list = random.sample(rows_list, max_points)

        scatter_mz      = [round(float(r.get("Precursor.Mz", 0) or 0), 3) for r in rows_list]
        scatter_im      = [round(float(r.get("IM", 0) or 0), 4)            for r in rows_list]
        scatter_pred_im = [round(float(r.get("Predicted.IM", 0) or 0), 4)  for r in rows_list]
        scatter_charge  = [int(r.get("Precursor.Charge", 2) or 2)          for r in rows_list]
        scatter_delta   = [round(float(r.get("delta_im", 0) or 0), 4)      for r in rows_list]

        return {
            "n_precursors": n,
            "stats": {
                "median_shift": round(median_shift, 5),
                "mean_shift":   round(mean_shift,   5),
                "std_shift":    round(std,           5),
                "p05_shift":    round(p05,           5),
                "p95_shift":    round(p95,           5),
            },
            "histogram": {"edges": hist_edges, "counts": hist_counts},
            "scatter": {
                "mz":       scatter_mz,
                "im":       scatter_im,
                "pred_im":  scatter_pred_im,
                "charge":   scatter_charge,
                "delta":    scatter_delta,
            },
            "thresholds": {
                "warn":  0.025,   # ~15 mbar air pressure change (paper threshold)
                "alert": 0.050,   # ~30 mbar — severe, impacts diaPASEF window coverage
            },
        }

    except Exception as exc:
        import traceback
        return {"error": "extraction_failed", "message": str(exc),
                "traceback": traceback.format_exc()[-800:]}


@app.get("/api/runs/{run_id}/4d-features")
async def api_4d_features(run_id: str) -> dict:
    """Novel 4D timsTOF feature analyses — impossible on Orbitrap.

    Reads DIA-NN report.parquet and computes six analyses unique to ion mobility:
      im_deviation  — Δ1/K₀ (measured − predicted) by peptide length
      lc_im_map     — RT × 1/K₀ 2D density grid (the peptide diagonal)
      im_fwhm       — chromatographic FWHM vs m/z vs 1/K₀ scatter
      im_dispersion — IQR of 1/K₀ per charge state (CCS ladder)
      seq_length_im — empirical CCS–mass law from the run's own peptides
      conformers    — peptides detected at multiple distinct 1/K₀ values
    """
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    report_path = _resolve_report_path(run)
    if not report_path:
        return {"error": "no_report",
                "message": "No DIA-NN report.parquet for this run (DDA runs use Sage, not DIA-NN)."}

    try:
        from stan.metrics.mobility_4d_features import compute_all
        result = compute_all(str(report_path), run.get("run_name"))
        result["run_id"] = run_id
        return result
    except Exception as exc:
        import traceback
        logger.exception("4d-features failed for run %s", run_id)
        return {"error": "computation_failed", "message": str(exc),
                "traceback": traceback.format_exc()[-600:]}


@app.post("/api/runs/{run_id}/recompute-metrics")
async def api_recompute_metrics(run_id: str) -> dict:
    """Re-extract QC metrics from the stored result_path and patch the DB.

    Useful for runs ingested before all metric columns existed, or where
    the initial extraction failed.  Reads DIA-NN report.parquet (or Sage
    parquet) from result_path and updates n_peptides, n_proteins, ms1_signal,
    fwhm_rt_min, median_mass_acc_ms1_ppm, median_mass_acc_ms2_ppm,
    median_mobility_fwhm in the runs table.
    """
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    report_path = _resolve_report_path(run)
    if not report_path:
        return {"ok": False, "error": "No report.parquet found for this run."}

    try:
        from stan.metrics.extractor import extract_dia_metrics, extract_dda_metrics

        # Detect DDA vs DIA by mode or file name
        mode = (run.get("mode") or "").lower()
        is_dda = "dda" in mode or "sage" in str(report_path).lower()

        if is_dda:
            metrics = extract_dda_metrics(report_path)
        else:
            metrics = extract_dia_metrics(report_path)

        if not metrics:
            return {"ok": False, "error": "Metric extraction returned empty result."}

        # Only update columns that are currently NULL or 0 in the run
        fields = {
            "n_precursors":              metrics.get("n_precursors"),
            "n_peptides":                metrics.get("n_peptides"),
            "n_proteins":                metrics.get("n_proteins"),
            "ms1_signal":                metrics.get("ms1_signal"),
            "ms2_signal":                metrics.get("ms2_signal"),
            "fwhm_rt_min":               metrics.get("fwhm_rt_min"),
            "fwhm_scans":                metrics.get("fwhm_scans"),
            "median_mass_acc_ms1_ppm":   metrics.get("median_mass_acc_ms1_ppm"),
            "median_mass_acc_ms2_ppm":   metrics.get("median_mass_acc_ms2_ppm"),
            "median_mobility_fwhm":      metrics.get("median_mobility_fwhm"),
            "median_fragments_per_precursor": metrics.get("median_fragments_per_precursor"),
            "median_cv_precursor":       metrics.get("median_cv_precursor"),
            "pct_charge_1":              metrics.get("pct_charge_1"),
            "pct_charge_2":              metrics.get("pct_charge_2"),
            "pct_charge_3":              metrics.get("pct_charge_3"),
            "pct_charge_4plus":          metrics.get("pct_charge_4plus"),
        }
        # Filter to non-None new values
        updates = {k: v for k, v in fields.items() if v is not None}
        if not updates:
            return {"ok": False, "error": "No new metrics extracted from report."}

        cols = ", ".join(f"{k} = ?" for k in updates)
        vals = list(updates.values()) + [run_id]
        db_path = get_db_path()
        with _sqlite3_sa.connect(str(db_path)) as con:
            con.execute(f"UPDATE runs SET {cols} WHERE id = ?", vals)

        return {"ok": True, "updated": list(updates.keys()), "values": updates}

    except Exception as exc:
        import traceback
        return {"ok": False, "error": str(exc), "traceback": traceback.format_exc()[-1200:]}


@app.patch("/api/runs/{run_id}/annotate")
async def api_annotate_run(run_id: str, body: dict) -> dict:
    """Set sample_type, workflow, mode, and/or run_notes for a run."""
    updates: dict[str, str] = {}
    if "sample_type" in body:
        val = str(body["sample_type"]).strip()
        if val not in _VALID_SAMPLE_TYPES:
            from fastapi import HTTPException
            raise HTTPException(400, f"Invalid sample_type '{val}'")
        updates["sample_type"] = val
    if "workflow" in body:
        val = str(body["workflow"]).strip()
        if val not in _VALID_WORKFLOWS:
            from fastapi import HTTPException
            raise HTTPException(400, f"Invalid workflow '{val}'")
        updates["workflow"] = val
    if "mode" in body:
        val = str(body["mode"]).strip()
        if val not in _VALID_MODES:
            from fastapi import HTTPException
            raise HTTPException(400, f"Invalid mode '{val}'. Valid: {sorted(_VALID_MODES - {''})}")
        updates["mode"] = val
    if "run_notes" in body:
        updates["run_notes"] = str(body["run_notes"])[:500]

    if not updates:
        return {"ok": True}

    cols = ", ".join(f"{k} = ?" for k in updates)
    vals = list(updates.values()) + [run_id]
    db_path = get_db_path()
    with _sqlite3_sa.connect(str(db_path)) as con:
        con.execute(f"UPDATE runs SET {cols} WHERE id = ?", vals)
    return {"ok": True, "updated": list(updates.keys())}


@app.post("/api/runs/{run_id}/clear-result")
async def api_clear_result(run_id: str) -> dict:
    """Clear search result from a run so it appears as unsearched again.

    Sets result_path, n_proteins, n_peptides, ms1_signal, fwhm_rt_min,
    median_mass_acc_ms1_ppm, median_mass_acc_ms2_ppm, median_mobility_fwhm
    to NULL in the runs table.
    """
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    db_path = get_db_path()
    with _sqlite3_sa.connect(str(db_path)) as con:
        con.execute(
            """UPDATE runs SET
                result_path = NULL,
                n_proteins = NULL,
                n_peptides = NULL,
                ms1_signal = NULL,
                fwhm_rt_min = NULL,
                median_mass_acc_ms1_ppm = NULL,
                median_mass_acc_ms2_ppm = NULL,
                median_mobility_fwhm = NULL
            WHERE id = ?""",
            [run_id],
        )
    return {"ok": True, "run_id": run_id}


@app.post("/api/runs/{run_id}/redetect-mode")
async def api_redetect_mode(run_id: str) -> dict:
    """Re-read MsmsType from analysis.tdf and update the mode in the DB.

    Useful when auto-detection set the wrong mode on import, e.g. a ddaPASEF
    file that has 'DIA' in its name or was imported before detection was added.
    """
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    raw_path = run.get("raw_path", "")
    if not raw_path or not raw_path.endswith(".d"):
        raise HTTPException(status_code=400, detail="Re-detect only supported for Bruker .d files")

    detected = _detect_mode_from_tdf(Path(raw_path))
    db_path  = get_db_path()
    with _sqlite3_sa.connect(str(db_path)) as con:
        con.execute("UPDATE runs SET mode = ? WHERE id = ?", (detected, run_id))
    return {"ok": True, "mode": detected, "previous": run.get("mode", "")}


# ── Auto-search scheduler ─────────────────────────────────────────────
# Polls every minute. Queues runs that have been waiting longer than
# auto_search_delay_minutes (default 60) with no search results.
# Honours a quiet window: skip if current hour is NOT in the active range.

_auto_search_cfg: dict = {
    "enabled": False,
    "delay_minutes": 60,          # how long a file must sit before auto-search
    "quiet_start": None,          # hour 0-23 to stop auto-search (None = always on)
    "quiet_end":   None,          # hour 0-23 to resume
    "last_run": None,
    "last_queued": 0,
}

def _auto_search_loop() -> None:
    """Background daemon that auto-queues unsearched runs on a schedule."""
    import time as _time
    while True:
        _time.sleep(60)
        try:
            cfg = _auto_search_cfg
            if not cfg["enabled"]:
                continue
            now = __import__("datetime").datetime.now()
            hour = now.hour
            qs, qe = cfg.get("quiet_start"), cfg.get("quiet_end")
            if qs is not None and qe is not None:
                in_quiet = (qs < qe and qs <= hour < qe) or (qs > qe and (hour >= qs or hour < qe))
                if in_quiet:
                    continue
            # Find runs that arrived more than delay_minutes ago with no search results
            delay_min = cfg.get("delay_minutes", 60)
            cutoff_iso = (now - __import__("datetime").timedelta(minutes=delay_min)).isoformat()
            all_runs = get_runs(limit=5000)
            watcher = _get_instruments_watcher()
            instruments_cfg = watcher.data.get("instruments", []) if watcher else []
            queued = 0
            for run in all_runs:
                has_primary = run.get("n_precursors") is not None or run.get("n_psms") is not None
                if has_primary:
                    continue
                run_date = run.get("run_date") or ""
                if run_date > cutoff_iso:
                    continue  # too recent, let it wait
                run_id = str(run["id"])
                raw_path_str = run.get("raw_path", "")
                if not raw_path_str or not Path(raw_path_str).exists():
                    continue
                with _process_lock:
                    existing = _process_jobs.get(run_id, {})
                    if existing.get("status") in ("queued", "running"):
                        continue
                inst_name = run.get("instrument", "")
                inst_cfg = next((i for i in instruments_cfg if i.get("name") == inst_name), {})
                with _process_lock:
                    _process_jobs[run_id] = {"status": "queued", "message": "Auto-queued…"}
                t = threading.Thread(target=_run_process_job, args=(run_id, run, inst_cfg), daemon=True)
                t.start()
                queued += 1
            cfg["last_run"] = now.isoformat()
            cfg["last_queued"] = queued
            if queued:
                logger.info("Auto-search: queued %d runs", queued)
        except Exception:
            logger.exception("Auto-search loop error")

_auto_search_thread = threading.Thread(target=_auto_search_loop, daemon=True)
_auto_search_thread.start()


@app.get("/api/auto-search/config")
async def api_auto_search_get() -> dict:
    return dict(_auto_search_cfg)


@app.post("/api/auto-search/config")
async def api_auto_search_set(body: dict) -> dict:
    """Update auto-search scheduler settings."""
    if "enabled" in body:
        _auto_search_cfg["enabled"] = bool(body["enabled"])
    if "delay_minutes" in body:
        v = int(body["delay_minutes"])
        _auto_search_cfg["delay_minutes"] = max(5, min(1440, v))
    if "quiet_start" in body:
        v = body["quiet_start"]
        _auto_search_cfg["quiet_start"] = None if v is None else max(0, min(23, int(v)))
    if "quiet_end" in body:
        v = body["quiet_end"]
        _auto_search_cfg["quiet_end"] = None if v is None else max(0, min(23, int(v)))
    return dict(_auto_search_cfg)


@app.get("/api/unsearched-runs")
async def api_unsearched_runs() -> dict:
    """Count and list runs that have no search results."""
    all_runs = get_runs(limit=5000)
    unsearched = []
    now_iso = __import__("datetime").datetime.now().isoformat()
    for run in all_runs:
        has_primary = run.get("n_precursors") is not None or run.get("n_psms") is not None
        if has_primary:
            continue
        run_date = run.get("run_date") or ""
        raw_ok = bool(run.get("raw_path") and Path(run.get("raw_path","")).exists())
        age_min = None
        if run_date:
            try:
                from datetime import datetime, timezone
                rd = datetime.fromisoformat(run_date.replace("Z","+00:00"))
                now_dt = datetime.now(tz=timezone.utc)
                age_min = int((now_dt - rd.astimezone(timezone.utc)).total_seconds() / 60)
            except Exception:
                pass
        status = _process_jobs.get(str(run["id"]), {}).get("status", "idle")
        unsearched.append({
            "id": run["id"],
            "run_name": run.get("run_name",""),
            "run_date": run_date,
            "raw_path": run.get("raw_path",""),
            "raw_exists": raw_ok,
            "age_minutes": age_min,
            "mode": run.get("mode",""),
            "instrument": run.get("instrument",""),
            "status": status,
        })
    unsearched.sort(key=lambda r: r.get("run_date",""), reverse=True)
    return {"count": len(unsearched), "runs": unsearched}


# ── Static frontend ──────────────────────────────────────────────────

_FRONTEND_DIR = Path(__file__).parent / "public"


@app.get("/api/searches")
async def api_searches(limit: int = 2000) -> list:
    """All runs enriched with search engine details and report.stats.tsv data.

    Returns one row per run with:
    - All standard run metrics from the DB
    - search_engine: "diann" | "sage" | "unknown"
    - diann_version: parsed from diann.log
    - diann_library: spectral library filename from diann.log
    - stats_*: columns from report.stats.tsv (Precursors.Identified etc.)
    """
    import csv
    import re

    runs = get_runs(limit=min(limit, 5000))
    result = []

    for run in runs:
        row = dict(run)

        raw_path = run.get("raw_path") or ""
        result_path = run.get("result_path") or ""
        mode = run.get("mode") or ""

        # Determine search engine
        if result_path.endswith(".parquet") and "sage" in result_path.lower():
            row["search_engine"] = "sage"
        elif result_path.endswith(".parquet"):
            row["search_engine"] = "diann"
        elif _is_dda(mode):
            row["search_engine"] = "sage"
        else:
            row["search_engine"] = "diann" if _is_dia(mode) else "unknown"

        row["diann_version"] = None
        row["diann_library"] = None
        row["diann_threads"] = None
        row["stats_precursors"] = None
        row["stats_proteins"] = None
        row["stats_ms1_signal"] = None
        row["stats_ms2_signal"] = None
        row["stats_fwhm_rt"] = None
        row["stats_fwhm_scans"] = None
        row["stats_mass_acc_ms1"] = None
        row["stats_mass_acc_ms2"] = None
        row["stats_rt_pred_acc"] = None
        row["stats_avg_charge"] = None
        row["stats_missed_cleavages"] = None

        # Resolve output directory — use result_path if available, else derive from raw_path
        out_dir: Path | None = None
        if result_path:
            out_dir = Path(result_path).parent
        elif raw_path:
            stem = Path(raw_path).stem
            candidates = [
                # K562 convention: sibling stan_results dir
                Path(raw_path).parent.parent / "stan_results" / stem,
                Path(raw_path).parent / "stan_results" / stem,
                # Absolute fallback used on this machine
                Path("E:/timsTOF/stan_results") / stem,
            ]
            try:
                from stan.config import get_user_config_dir
                candidates.append(get_user_config_dir() / "baseline_output" / stem)
            except Exception:
                pass
            for c in candidates:
                if c.exists():
                    out_dir = c
                    break

        # Try to read diann.log for version + library
        if out_dir is not None:
            log_path = out_dir / "diann.log"
            if log_path.exists():
                try:
                    log_text = log_path.read_text(errors="replace")
                    # Version: "DIA-NN 2.3.2 Academia"
                    m = re.search(r"DIA-NN\s+([\d.]+)", log_text)
                    if m:
                        row["diann_version"] = m.group(1)
                    # Library: "Loading spectral library /path/to/file.parquet"
                    m = re.search(r"Loading spectral library\s+(.+)", log_text)
                    if m:
                        row["diann_library"] = Path(m.group(1).strip()).name
                    # Thread count
                    m = re.search(r"Thread number set to (\d+)", log_text)
                    if m:
                        row["diann_threads"] = int(m.group(1))
                except Exception:
                    pass

            # Try report.stats.tsv
            stats_path = out_dir / "report.stats.tsv"
            if stats_path.exists():
                try:
                    with open(stats_path, newline="", errors="replace") as f:
                        reader = csv.DictReader(f, delimiter="\t")
                        stats = next(reader, None)
                    if stats:
                        def _f(k: str) -> float | None:
                            v = stats.get(k)
                            try:
                                return float(v) if v else None
                            except (ValueError, TypeError):
                                return None

                        row["stats_precursors"] = _f("Precursors.Identified")
                        row["stats_proteins"] = _f("Proteins.Identified")
                        row["stats_ms1_signal"] = _f("MS1.Signal")
                        row["stats_ms2_signal"] = _f("MS2.Signal")
                        row["stats_fwhm_rt"] = _f("FWHM.RT")
                        row["stats_fwhm_scans"] = _f("FWHM.Scans")
                        row["stats_mass_acc_ms1"] = _f("Median.Mass.Acc.MS1.Corrected")
                        row["stats_mass_acc_ms2"] = _f("Median.Mass.Acc.MS2.Corrected")
                        row["stats_rt_pred_acc"] = _f("Median.RT.Prediction.Acc")
                        row["stats_avg_charge"] = _f("Average.Peptide.Charge")
                        row["stats_missed_cleavages"] = _f("Average.Missed.Tryptic.Cleavages")
                except Exception:
                    pass

        result.append(row)

    # Enrich each run with comparison search results from search_comparisons table
    _attach_comparisons(result)

    return result


def _attach_comparisons(runs: list[dict]) -> None:
    """Fetch all search_comparisons rows and attach them to matching run dicts.

    Modifies runs in-place, adding:
      row["comparisons"] = {
          "msfragger_dda": {"status": "done", "n_psms": 18000, ...},
          "msfragger_dia": {"status": "running", ...},
      }
    """
    import sqlite3
    try:
        db_path = get_db_path()
        with sqlite3.connect(str(db_path)) as con:
            con.row_factory = sqlite3.Row
            rows = con.execute(
                "SELECT * FROM search_comparisons ORDER BY finished_at DESC"
            ).fetchall()
    except Exception:
        return

    # Index by run_id
    by_run: dict[str, dict] = {}
    for r in rows:
        rid = r["run_id"]
        engine = r["engine"]
        if rid not in by_run:
            by_run[rid] = {}
        by_run[rid][engine] = {
            "status":       r["status"],
            "started_at":   r["started_at"],
            "finished_at":  r["finished_at"],
            "n_psms":       r["n_psms"],
            "n_peptides":   r["n_peptides"],
            "n_proteins":   r["n_proteins"],
            "n_precursors": r["n_precursors"],
            "result_path":  r["result_path"],
            "error_msg":    r["error_msg"],
        }

    for run in runs:
        # search_comparisons uses raw_path.stem (e.g. "K562_200pg_..._13238")
        # runs table uses UUID. Match on raw_path stem.
        raw = run.get("raw_path") or ""
        stem = Path(raw).stem if raw else ""
        run["comparisons"] = by_run.get(stem, {})


# ── De Novo Sequencing ───────────────────────────────────────────────

# In-memory job registry for async de novo runs
_denovo_jobs: dict[str, dict] = {}


@app.get("/api/denovo/engines")
async def api_denovo_engines() -> dict:
    """List available de novo engines and their status."""
    from stan.search.denovo import casanovo_available, novor_available, list_available_engines
    return {
        "available": list_available_engines(),
        "casanovo": casanovo_available(),
        "novor": novor_available(),
        "casanovo_note": "Reads .d natively via TdfParser (ion mobility preserved)",
        "novor_note": "Requires novor.jar at E:/ziggy/tools/novor/novor.jar",
    }


@app.post("/api/runs/{run_id}/denovo")
async def api_run_denovo(
    run_id: str,
    engine: str = "auto",
    max_spectra: int = 2000,
    immuno_mode: bool = False,
) -> dict:
    """Start a de novo sequencing job for a run.

    Casanovo reads the .d file directly (no MGF extraction step needed).
    Novor falls back to MGF extraction first.
    Poll /api/denovo/{job_id} for status and results.
    """
    import uuid as _uuid
    from stan.metrics.denovo_extract import extract_to_mgf  # used by Novor path
    from stan.search.denovo import run_denovo, list_available_engines

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    raw_path_str = run.get("raw_path", "")
    if not raw_path_str:
        raise HTTPException(status_code=400, detail="Run has no raw_path")

    d_path = Path(raw_path_str)
    if not d_path.exists():
        raise HTTPException(status_code=400, detail=f"Raw file not found: {d_path}")

    if not list_available_engines():
        raise HTTPException(
            status_code=503,
            detail="No de novo engines available. Install Casanovo or Novor.",
        )

    job_id = str(_uuid.uuid4())[:12]
    _denovo_jobs[job_id] = {
        "status": "queued",
        "run_id": run_id,
        "run_name": run.get("run_name", ""),
        "engine": engine,
        "immuno_mode": immuno_mode,
        "results": [],
    }

    def _worker():
        job = _denovo_jobs[job_id]
        try:
            out_dir = d_path.parent / "ziggy_denovo" / run_id
            out_dir.mkdir(parents=True, exist_ok=True)

            # Determine effective engine so we know whether MGF extraction is needed
            effective_engine = engine
            if effective_engine == "auto":
                from stan.search.denovo import casanovo_available
                effective_engine = "casanovo" if casanovo_available() else "novor"

            if effective_engine == "casanovo":
                # Casanovo reads .d natively via TdfParser — skip MGF extraction.
                # This preserves ion mobility (1/K₀) via timsrust_pyo3.
                job["status"] = "sequencing"
                job["acq_mode"] = "ddaPASEF"
                input_path = d_path
            else:
                # Novor requires MGF — extract first
                job["status"] = "extracting"
                mgf_path = out_dir / "spectra.mgf"
                n_spectra, acq_mode = extract_to_mgf(
                    d_path, mgf_path,
                    max_spectra=max_spectra,
                )
                job["n_spectra"] = n_spectra
                job["acq_mode"] = acq_mode

                if n_spectra == 0:
                    job["status"] = "done"
                    job["warning"] = f"No spectra extracted. {acq_mode} data may need ddaPASEF mode."
                    return

                job["status"] = "sequencing"
                input_path = mgf_path

            results, engine_used = run_denovo(
                input_path, out_dir,
                engine=engine,
                immuno_mode=immuno_mode,
            )
            job["engine_used"] = engine_used
            job["n_results"] = len(results)

            # ── 4D CCS confidence scoring ─────────────────────────────────
            # Theoretical 1/K₀ from empirical linear CCS model (same as UI)
            def _ccs_expected(mz, z):
                return 0.3 + z * 0.12 + mz * (0.00015 + z * 0.00008)

            for r in results:
                mz = r.get("precursor_mz", 0) or 0
                z  = r.get("charge", 0) or 0
                im = r.get("one_over_k0", 0) or 0
                if z > 0 and mz > 0:
                    theo = _ccs_expected(mz, z)
                    r["ccs_theo"] = round(theo, 4)
                    if im > 0:
                        delta = im - theo
                        r["ccs_delta"] = round(delta, 4)
                        r["ccs_ok"]    = abs(delta) <= 0.08
                    else:
                        r["ccs_delta"] = None
                        r["ccs_ok"]    = None   # no IM available
                else:
                    r["ccs_theo"]  = None
                    r["ccs_delta"] = None
                    r["ccs_ok"]    = None

            # ── Post-search DB match filter ───────────────────────────────
            # Load identified neutral masses from DIA-NN report (if present)
            # and flag every de novo hit that falls within ±5 ppm of a known PSM.
            import bisect as _bisect
            identified_masses: list[float] = []
            report_path = _resolve_report_path(run)
            if report_path and report_path.exists():
                try:
                    import polars as _pl
                    _df = _pl.read_parquet(
                        str(report_path),
                        columns=["Precursor.Mz", "Precursor.Charge"],
                    )
                    _mz_col = _df["Precursor.Mz"].to_list()
                    _z_col  = _df["Precursor.Charge"].to_list()
                    identified_masses = sorted(
                        float(mz) * int(z) - int(z) * 1.007276
                        for mz, z in zip(_mz_col, _z_col)
                        if mz and z and float(mz) > 0 and int(z) > 0
                    )
                    job["n_identified"] = len(identified_masses)
                    logger.info(
                        "De novo: loaded %d identified masses from DIA-NN report for cross-reference",
                        len(identified_masses),
                    )
                except Exception as _e:
                    logger.warning("Could not load DIA-NN report for de novo filtering: %s", _e)

            for r in results:
                mz = r.get("precursor_mz", 0) or 0
                z  = r.get("charge", 0) or 0
                if not identified_masses or mz <= 0 or z <= 0:
                    r["db_match"]     = False
                    r["db_delta_ppm"] = None
                    continue
                neutral = mz * z - z * 1.007276
                tol     = neutral * 5e-6
                idx     = _bisect.bisect_left(identified_masses, neutral - tol)
                matched   = False
                best_ppm  = None
                while idx < len(identified_masses) and identified_masses[idx] <= neutral + tol:
                    ppm = (neutral - identified_masses[idx]) / max(identified_masses[idx], 1e-9) * 1e6
                    if best_ppm is None or abs(ppm) < abs(best_ppm):
                        best_ppm = ppm
                    matched = True
                    idx += 1
                r["db_match"]     = matched
                r["db_delta_ppm"] = round(best_ppm, 2) if best_ppm is not None else None

            # ── Sort and serialise ────────────────────────────────────────
            results.sort(key=lambda r: r["score"], reverse=True)
            for r in results:
                for k, v in r.items():
                    if hasattr(v, "tolist"):
                        r[k] = v.tolist()
            job["results"] = results
            job["status"]  = "done"

        except Exception as e:
            logger.exception("De novo job %s failed", job_id)
            job["status"] = "error"
            job["error"] = str(e)

    t = threading.Thread(target=_worker, daemon=True)
    t.start()

    return {"job_id": job_id, "status": "queued"}


@app.get("/api/denovo/{job_id}")
async def api_denovo_status(job_id: str) -> dict:
    """Poll de novo job status and results."""
    if job_id == "engines":
        # Prevent FastAPI from matching "engines" as a job_id
        raise HTTPException(status_code=404, detail="Use /api/denovo/engines")
    job = _denovo_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    out = {k: v for k, v in job.items() if k != "results"}
    if job["status"] == "done":
        out["results"] = job.get("results", [])
    return out


# ── HLA Atlas ────────────────────────────────────────────────────────

# Background download job registry
_atlas_download_job: dict = {"status": "idle"}


@app.on_event("startup")
async def _auto_seed_hla_atlas():
    """Install built-in seed atlas at startup if no atlas exists yet."""
    try:
        from stan.search.hla_atlas import AtlasManager
        am = AtlasManager()
        if not am.is_available():
            logger.info("HLA atlas not found — installing built-in seed…")
            am.build_seed()
    except Exception as e:
        logger.warning("HLA seed install failed at startup: %s", e)


@app.get("/api/hla-atlas/status")
async def api_hla_atlas_status() -> dict:
    """Return HLA atlas availability stats + current download job state."""
    try:
        from stan.search.hla_atlas import AtlasManager
        stats = AtlasManager().stats()
    except Exception as e:
        stats = {"available": False, "error": str(e)}
    return {**stats, "download_job": _atlas_download_job}


@app.post("/api/hla-atlas/seed")
async def api_hla_atlas_seed() -> dict:
    """Install the built-in seed atlas immediately (no network required)."""
    global _atlas_download_job
    if _atlas_download_job.get("status") == "running":
        return {"started": False, "reason": "Download already in progress"}

    _atlas_download_job = {"status": "running", "log": []}

    def _worker():
        global _atlas_download_job
        try:
            from stan.search.hla_atlas import AtlasManager
            msgs: list[str] = []

            def _cb(msg: str):
                msgs.append(msg)
                _atlas_download_job["log"] = msgs
                logger.info("[HLA atlas seed] %s", msg)

            result = AtlasManager().build_seed(callback=_cb)
            _atlas_download_job = {
                "status": "done" if result.get("success") else "error",
                "log": msgs,
                **result,
            }
        except Exception as e:
            logger.exception("HLA atlas seed failed")
            _atlas_download_job = {"status": "error", "error": str(e), "log": [str(e)]}

    threading.Thread(target=_worker, daemon=True).start()
    return {"started": True}


@app.post("/api/hla-atlas/download")
async def api_hla_atlas_download(source: str = "auto") -> dict:
    """Trigger a background atlas download.  Poll /api/hla-atlas/status for progress."""
    global _atlas_download_job
    if _atlas_download_job.get("status") == "running":
        return {"started": False, "reason": "Download already in progress"}

    _atlas_download_job = {"status": "running", "log": []}

    def _worker():
        global _atlas_download_job
        try:
            from stan.search.hla_atlas import AtlasManager
            msgs: list[str] = []

            def _cb(msg: str):
                msgs.append(msg)
                _atlas_download_job["log"] = msgs[-50:]  # keep last 50 lines
                logger.info("[HLA atlas] %s", msg)

            result = AtlasManager().download(source=source, callback=_cb)
            _atlas_download_job = {
                "status": "done" if result.get("success") else "error",
                "log": msgs[-50:],
                **result,
            }
        except Exception as e:
            logger.exception("HLA atlas download failed")
            _atlas_download_job = {"status": "error", "error": str(e), "log": [str(e)]}

    threading.Thread(target=_worker, daemon=True).start()
    return {"started": True}


@app.post("/api/hla-atlas/import")
async def api_hla_atlas_import(file: UploadFile = File(...)) -> dict:
    """Import a manually uploaded HLA Ligand Atlas ZIP file."""
    import tempfile
    try:
        from stan.search.hla_atlas import AtlasManager
        data = await file.read()
        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
            tmp.write(data)
            tmp_path = Path(tmp.name)
        result = AtlasManager().import_zip(tmp_path)
        tmp_path.unlink(missing_ok=True)
        return result
    except Exception as e:
        logger.exception("HLA atlas import failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/hla-atlas/search")
async def api_hla_atlas_search(
    q: str = "",
    allele: str = "",
    protein: str = "",
    mhc_class: int = 0,
    min_obs: int = 1,
    limit: int = 200,
) -> list:
    """Search the HLA atlas. Returns up to `limit` matches."""
    try:
        from stan.search.hla_atlas import AtlasManager
        return AtlasManager().search(
            query=q, allele=allele, protein=protein,
            mhc_class=mhc_class, min_obs=min_obs, limit=limit,
        )
    except Exception as e:
        logger.exception("HLA atlas search failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/hla-atlas/standards")
async def api_hla_atlas_standards(
    min_tissues: int = 3,
    mhc_class: int = 1,
    limit: int = 100,
) -> list:
    """Return canonical HLA peptides detected in many tissues (reliable internal standards)."""
    try:
        from stan.search.hla_atlas import AtlasManager
        return AtlasManager().canonical_standards(
            min_tissues=min_tissues, mhc_class=mhc_class, limit=limit,
        )
    except Exception as e:
        logger.exception("HLA atlas standards failed")
        raise HTTPException(status_code=500, detail=str(e))


# ── Monoisotopic residue masses for theoretical m/z / 1/K₀ prediction ──────
_AA_MASS: dict[str, float] = {
    "G":57.02146,"A":71.03711,"V":99.06841,"L":113.08406,"I":113.08406,
    "P":97.05276,"F":147.06841,"W":186.07931,"M":131.04049,"S":87.03203,
    "T":101.04768,"C":103.00919,"Y":163.06333,"H":137.05891,"D":115.02694,
    "E":129.04259,"N":114.04293,"Q":128.05858,"K":128.09496,"R":156.10111,
}
_WATER = 18.01056

def _seq_mz(seq: str, z: int = 2) -> float:
    mass = sum(_AA_MASS.get(aa, 111.1) for aa in seq.upper()) + _WATER
    return (mass + z * 1.00728) / z

def _theoretical_im(mz: float, z: int) -> float:
    return 0.3 + z * 0.12 + mz * (0.00015 + z * 0.00008)

_DISEASE_VIRAL    = {"HIV","EBV","CMV","SARS","SARS-COV","INFLUENZA","HCV","HBV","DENGUE","HTLV","HSV","VZV"}
_DISEASE_CANCER   = {"MART","NY-ESO","WT1","PRAME","HER2","CAIX","MUC1","PSA","PSMA","AFP","P53","GP100","CEA",
                     "SURVIVIN","TYROSINASE","TERT","TELOMERASE","MAGE","BAGE","GAGE","SSX","CTAG"}
_DISEASE_AUTO     = {"MBP","GAD65","COLLAGEN","CII","GLIADIN","INSULIN","BERYLLIUM","GAD","MOG"}

def _disease_category(protein: str) -> str:
    p = protein.upper()
    if any(v in p for v in _DISEASE_VIRAL):    return "viral"
    if any(c in p for c in _DISEASE_CANCER):   return "cancer"
    if any(a in p for a in _DISEASE_AUTO):     return "autoimmune"
    return "control"


@app.get("/api/hla-atlas/browse")
async def api_hla_atlas_browse() -> dict:
    """Return full atlas peptide set enriched with disease classification and
    theoretical ion mobility (1/K₀) for TIMS corridor visualisation."""
    try:
        from stan.search.hla_atlas import AtlasManager, _ATLAS_PQ
        am = AtlasManager()
        if not am.is_available():
            return {"available": False, "peptides": []}
        import polars as _pl
        df = _pl.read_parquet(str(_ATLAS_PQ))
        rows = df.to_dicts()
        # Annotate each row
        for r in rows:
            r["disease_category"] = _disease_category(r.get("protein", ""))
            z_typ = 2 if r.get("mhc_class", 1) == 1 else 2
            r["mz_z2"]  = round(_seq_mz(r["sequence"], z=z_typ), 3)
            r["im_z2"]  = round(_theoretical_im(r["mz_z2"], z_typ), 4)
            r["mz_z1"]  = round(_seq_mz(r["sequence"], z=1), 3)
            r["im_z1"]  = round(_theoretical_im(r["mz_z1"], 1), 4)
        # Allele × protein observation matrix
        matrix: dict[str, dict[str, int]] = {}
        for r in rows:
            al = r.get("allele", "unknown")
            pr = r.get("protein", "unknown")
            matrix.setdefault(al, {}).setdefault(pr, 0)
            matrix[al][pr] += r.get("total_obs", 1)
        # Disease summary
        from collections import defaultdict
        disease_summary: dict[str, dict] = defaultdict(lambda: {"n": 0, "proteins": set(), "alleles": set()})
        for r in rows:
            dc = r["disease_category"]
            disease_summary[dc]["n"] += 1
            disease_summary[dc]["proteins"].add(r.get("protein",""))
            disease_summary[dc]["alleles"].add(r.get("allele",""))
        for dc, v in disease_summary.items():
            v["proteins"] = sorted(v["proteins"])
            v["alleles"]  = sorted(v["alleles"])
        return {
            "available": True,
            "peptides":  rows,
            "matrix":    matrix,
            "disease_summary": dict(disease_summary),
        }
    except Exception as e:
        logger.exception("HLA atlas browse failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/hla-atlas/run-match")
async def api_hla_atlas_run_match(run_id: str, mhc_class: int = 0) -> dict:
    """Match a run's detected immunopeptides against the atlas.
    Returns per-peptide hit/miss + aggregated disease/allele coverage stats."""
    try:
        from stan.search.hla_atlas import AtlasManager, _ATLAS_PQ
        am = AtlasManager()
        if not am.is_available():
            return {"available": False, "hits": [], "stats": {}}

        import polars as _pl
        run  = get_run(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail="Run not found")

        # Load detected peptide sequences from the run
        report = _resolve_report_path(run)
        sage   = _resolve_sage_path(run)
        detected_seqs: set[str] = set()
        if report:
            try:
                df_r = _pl.scan_parquet(str(report))
                cols = df_r.columns
                seq_col = next((c for c in ["Modified.Sequence","Stripped.Sequence","peptide","sequence"] if c in cols), None)
                if seq_col:
                    seqs = df_r.select(seq_col).collect()[seq_col].to_list()
                    for s in seqs:
                        if s:
                            bare = _re.sub(r"\(.*?\)|\[.*?\]","",str(s)).strip("_").upper()
                            detected_seqs.add(bare)
            except Exception:
                pass
        if sage and not detected_seqs:
            try:
                df_s = _pl.scan_parquet(str(sage))
                if "peptide" in df_s.columns:
                    seqs = df_s.select("peptide").collect()["peptide"].to_list()
                    for s in seqs:
                        if s:
                            detected_seqs.add(_re.sub(r"\(.*?\)|\[.*?\]","",str(s)).strip("_").upper())
            except Exception:
                pass

        # Match against atlas
        atlas_df = _pl.read_parquet(str(_ATLAS_PQ))
        if mhc_class in (1, 2):
            atlas_df = atlas_df.filter(_pl.col("mhc_class") == mhc_class)

        atlas_rows = atlas_df.to_dicts()
        hits, misses = [], []
        for r in atlas_rows:
            r["disease_category"] = _disease_category(r.get("protein", ""))
            seq = r["sequence"].upper()
            z   = 2 if r.get("mhc_class", 1) == 1 else 2
            r["mz_z2"] = round(_seq_mz(seq, z), 3)
            r["im_z2"] = round(_theoretical_im(r["mz_z2"], z), 4)
            r["detected"] = seq in detected_seqs
            (hits if r["detected"] else misses).append(r)

        # Per-disease stats
        from collections import defaultdict
        disease_stats: dict[str, dict] = defaultdict(lambda: {"n_atlas":0,"n_detected":0,"proteins":set(),"alleles":set()})
        for r in atlas_rows:
            dc = r["disease_category"]
            disease_stats[dc]["n_atlas"] += 1
            disease_stats[dc]["proteins"].add(r.get("protein",""))
            disease_stats[dc]["alleles"].add(r.get("allele",""))
            if r["detected"]:
                disease_stats[dc]["n_detected"] += 1
        for dc, v in disease_stats.items():
            v["proteins"] = sorted(v["proteins"])
            v["alleles"]  = sorted(v["alleles"])
            v["pct"] = round(100 * v["n_detected"] / max(v["n_atlas"], 1), 1)

        return {
            "available":   True,
            "run_name":    run.get("run_name",""),
            "n_detected_total": len(detected_seqs),
            "n_atlas":     len(atlas_rows),
            "n_hits":      len(hits),
            "pct_overall": round(100 * len(hits) / max(len(atlas_rows), 1), 1),
            "hits":        hits,
            "misses":      misses,
            "disease_stats": dict(disease_stats),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("HLA atlas run-match failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/runs/{run_id}/hla-coverage")
async def api_hla_coverage(run_id: str, mhc_class: int = 0) -> dict:
    """Match peptides from this run against the HLA atlas, return coverage stats."""
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    report_path = _resolve_report_path(run)
    if not report_path:
        raise HTTPException(status_code=404, detail="No search results found for this run")

    try:
        import polars as pl
        from stan.search.hla_atlas import AtlasManager

        df = pl.scan_parquet(str(report_path))
        seq_col = next((c for c in ["Stripped.Sequence", "peptide", "sequence"] if c in df.columns), None)
        if not seq_col:
            raise HTTPException(status_code=422, detail="No sequence column in search results")

        # Length-filter for immunopeptidomics (8–25 aa)
        lf = df.filter(
            pl.col(seq_col).str.len_chars().is_between(8, 25)
        )
        if mhc_class == 1:
            lf = lf.filter(pl.col(seq_col).str.len_chars().is_between(8, 12))
        elif mhc_class == 2:
            lf = lf.filter(pl.col(seq_col).str.len_chars().is_between(13, 25))

        seqs = lf.select(pl.col(seq_col).unique()).collect()[seq_col].to_list()
        return AtlasManager().coverage(seqs)

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("HLA coverage failed for run %s", run_id)
        raise HTTPException(status_code=500, detail=str(e))


# ── Search Assistant ─────────────────────────────────────────────────────────
import sqlite3 as _sqlite3_sa
import subprocess as _subprocess
import uuid as _uuid
import asyncio as _asyncio

# In-memory job registry  { job_id: { status, runs, log_lines, started_at, ... } }
_search_jobs: dict = {}


SEARCH_PRESETS = {
    # ── Standard proteomics ─────────────────────────────────────────────────
    "hela_digest": {
        "label": "HeLa / K562 Digest (QC)",
        "description": "Standard tryptic digest QC. Optimized for 50 ng HeLa or K562 benchmarks.",
        "icon": "🧫",
        "color": "#34d399",
        "engines": ["diann", "sage"],
        "diann_args": [
            "--qvalue", "0.01",
            "--min-pep-len", "7", "--max-pep-len", "30",
            "--missed-cleavages", "1",
            "--cut", "K*,R*",
            "--threads", "8",
        ],
    },
    "single_cell": {
        "label": "Single Cell",
        "description": "Ultra-low input. Match Between Runs enabled. Optimized for <1 ng.",
        "icon": "🔬",
        "color": "#22d3ee",
        "engines": ["diann", "sage"],
        "diann_args": [
            "--qvalue", "0.01",
            "--min-pep-len", "7", "--max-pep-len", "30",
            "--missed-cleavages", "1",
            "--cut", "K*,R*",
            "--threads", "8",
            "--reanalyse",
        ],
    },
    "tmt": {
        "label": "TMT",
        "description": "TMT6/TMT10/TMT16 isobaric labeling. Fixed TMT mod on K and peptide N-term.",
        "icon": "🏷",
        "color": "#DAAA00",
        "engines": ["diann"],
        "diann_args": [
            "--qvalue", "0.01",
            "--min-pep-len", "7", "--max-pep-len", "30",
            "--missed-cleavages", "2",
            "--cut", "K*,R*",
            "--fixed-mod", "TMT6,229.1629,KX",
            "--mod", "TMT6,229.1629,*",
            "--threads", "8",
        ],
    },
    "phospho": {
        "label": "Phosphoproteomics",
        "description": "Variable phosphorylation on STY. 2 missed cleavages for enriched samples.",
        "icon": "⚡",
        "color": "#fb923c",
        "engines": ["diann", "sage"],
        "diann_args": [
            "--qvalue", "0.01",
            "--min-pep-len", "7", "--max-pep-len", "30",
            "--missed-cleavages", "2",
            "--cut", "K*,R*",
            "--var-mod", "UniMod:21,1,STY",
            "--threads", "8",
        ],
    },

    # ── Immunopeptidomics — DDA (Sage, non-specific cleavage) ───────────────
    # DDA immunopeptidomics uses a proper DDA engine (Sage / MSFragger).
    # Key parameters: no enzyme, short peptide window, OxM + Deam NQ variable mods.
    "mhc_class_i_dda": {
        "label": "MHC-I Immunopeptidomics (DDA / PASEF)",
        "description": (
            "HLA-A/B/C — ddaPASEF or DDA. Non-specific, 8–12 aa, z 1–3, ±15 ppm. "
            "Engine: Sage. Mods: OxM (var), DeamNQ (var), CarbamiC (fixed), N-term Ac (var). "
            "Literature: Bassani-Sternberg 2015, Klaeger 2018, Stopfer 2020."
        ),
        "icon": "🛡",
        "color": "#f472b6",
        "engines": ["sage"],
        "acq_modes": ["ddaPASEF", "DDA", "ddaMS2"],
        "immuno_class": 1,
        "sage_enzyme": "nonspecific",
        "sage_min_len": 8,
        "sage_max_len": 12,
    },
    "mhc_class_ii_dda": {
        "label": "MHC-II Immunopeptidomics (DDA / ddaPASEF)",
        "description": (
            "HLA-DR/DP/DQ — ddaPASEF or DDA. Non-specific, 13–25 aa, z 2–4, ±15 ppm. "
            "Engine: Sage. Mods: OxM (var), DeamNQ (var), CarbamiC (fixed), N-term Ac (var). "
            "Literature: Racle 2019, Lund 2013, Caron 2019."
        ),
        "icon": "🛡",
        "color": "#a78bfa",
        "engines": ["sage"],
        "acq_modes": ["ddaPASEF", "DDA", "ddaMS2"],
        "immuno_class": 2,
        "sage_enzyme": "nonspecific",
        "sage_min_len": 13,
        "sage_max_len": 25,
    },

    # ── Immunopeptidomics — DIA (DIA-NN, non-specific) ──────────────────────
    # DIA immunopeptidomics requires a non-tryptic MHC spectral library.
    "mhc_class_i_dia": {
        "label": "MHC-I Immunopeptidomics (DIA / diaPASEF)",
        "description": (
            "HLA-A/B/C — diaPASEF. DIA-NN, non-specific, 8–12 aa, z 1–3. "
            "⚠ Best results require an MHC-I spectral library (not a tryptic library). "
            "Literature: Stopfer 2021, Kacen 2023."
        ),
        "icon": "🛡",
        "color": "#f472b6",
        "engines": ["diann"],
        "acq_modes": ["diaPASEF", "DIA"],
        "immuno_class": 1,
        "diann_args": [
            "--qvalue", "0.01",
            "--min-pep-len", "8",  "--max-pep-len", "12",
            "--missed-cleavages", "0",
            "--min-pr-charge", "1", "--max-pr-charge", "3",
            "--min-pr-mz", "350",  "--max-pr-mz", "1100",
            "--var-mod", "UniMod:35,15.9949,M",
            "--var-mod", "UniMod:7,0.9840,NQ",
            "--cut", "*",
            "--no-prot-inf",
            "--smart-profiling",
            "--threads", "8",
        ],
    },
    "mhc_class_ii_dia": {
        "label": "MHC-II Immunopeptidomics (DIA / diaPASEF)",
        "description": (
            "HLA-DR/DP/DQ — diaPASEF. DIA-NN, non-specific, 13–25 aa, z 2–4. "
            "⚠ Best results require an MHC-II spectral library (not a tryptic library). "
            "Literature: Racle 2019, Bankert 2022."
        ),
        "icon": "🛡",
        "color": "#a78bfa",
        "engines": ["diann"],
        "acq_modes": ["diaPASEF", "DIA"],
        "immuno_class": 2,
        "diann_args": [
            "--qvalue", "0.01",
            "--min-pep-len", "13", "--max-pep-len", "25",
            "--missed-cleavages", "0",
            "--min-pr-charge", "2", "--max-pr-charge", "4",
            "--min-pr-mz", "450",  "--max-pr-mz", "1400",
            "--var-mod", "UniMod:35,15.9949,M",
            "--var-mod", "UniMod:7,0.9840,NQ",
            "--cut", "*",
            "--no-prot-inf",
            "--smart-profiling",
            "--threads", "8",
        ],
    },

    # ── Custom script ────────────────────────────────────────────────────────
    # Runs an arbitrary user-supplied shell command. The token {raw} is
    # replaced with the absolute path to the raw file, {out} with the
    # output directory, and {fasta} with the configured FASTA path.
    "custom_script": {
        "label": "Custom Script",
        "description": (
            "Run your own search engine or workflow script. "
            "Use {raw}, {out}, {fasta} tokens in the command. "
            "Must write results.sage.parquet or report.parquet to {out}."
        ),
        "icon": "⚙",
        "color": "#94a3b8",
        "engines": ["custom"],
        "acq_modes": [],
        "_custom": True,
    },

    # ── Legacy keys — kept for backwards compat with saved jobs ────────────
    "mhc_class_i":  {"label": "MHC Class I (legacy)", "icon": "🛡", "color": "#f472b6",
                     "_alias": "mhc_class_i_dda", "engines": ["sage"],
                     "description": "Use mhc_class_i_dda or mhc_class_i_dia instead.",
                     "immuno_class": 1},
    "mhc_class_ii": {"label": "MHC Class II (legacy)", "icon": "🛡", "color": "#a78bfa",
                     "_alias": "mhc_class_ii_dda", "engines": ["sage"],
                     "description": "Use mhc_class_ii_dda or mhc_class_ii_dia instead.",
                     "immuno_class": 2},
}


@app.get("/api/search/unsearched")
async def api_search_unsearched() -> list[dict]:
    """Return all runs that have no search result, with auto-suggested preset."""
    db_path = get_db_path()
    with _sqlite3_sa.connect(str(db_path)) as con:
        con.row_factory = _sqlite3_sa.Row
        rows = con.execute(
            "SELECT id, run_name, instrument, raw_path, run_date, mode, lc_system "
            "FROM runs WHERE result_path IS NULL OR n_proteins IS NULL "
            "ORDER BY run_date DESC, run_name"
        ).fetchall()
    result = []
    for r in rows:
        d = dict(r)
        d["suggested_preset"] = _suggest_preset(d)
        d["is_immuno"] = _is_immuno_run(d.get("run_name", ""))
        d["immuno_class"] = _immuno_class(d.get("run_name", "")) if d["is_immuno"] else 0
        result.append(d)
    return result


@app.get("/api/search/presets")
async def api_search_presets() -> dict:
    """Return available search presets."""
    return SEARCH_PRESETS


# ── Preset → family mapping ───────────────────────────────────────────────────
# Multiple presets share the same FASTA/library defaults (e.g. mhc_class_i_dda
# and mhc_class_i_dia both use the same human proteome FASTA).
PRESET_FAMILY: dict[str, str] = {
    "hela_digest":      "tryptic",
    "single_cell":      "single_cell",
    "phospho":          "phospho",
    "tmt":              "tmt",
    "mhc_class_i_dda":  "immuno_class_i",
    "mhc_class_i_dia":  "immuno_class_i",
    "mhc_class_ii_dda": "immuno_class_ii",
    "mhc_class_ii_dia": "immuno_class_ii",
}
_PRESET_FAMILY_LABELS: dict[str, str] = {
    "tryptic":        "Standard tryptic (HeLa, tissue, etc.)",
    "single_cell":    "Single-cell / low-input tryptic",
    "phospho":        "Phosphoproteomics",
    "tmt":            "TMT / iTRAQ (DIA-NN)",
    "immuno_class_i": "Immunopeptidomics MHC-I (8–12 aa)",
    "immuno_class_ii":"Immunopeptidomics MHC-II (13–25 aa)",
}


def _get_search_defaults() -> dict[str, dict]:
    """Load per-family defaults from the DB. Returns {family: {fasta_path, library_path, extra_args}}."""
    import sqlite3 as _sq
    try:
        with _sq.connect(str(get_db_path())) as con:
            rows = con.execute(
                "SELECT preset_family, fasta_path, library_path, extra_args FROM search_defaults"
            ).fetchall()
        return {r[0]: {"fasta_path": r[1], "library_path": r[2], "extra_args": r[3]} for r in rows}
    except Exception:
        return {}


@app.get("/api/search/defaults")
async def api_search_defaults_get() -> dict:
    """Return saved default FASTA/library paths per preset family."""
    defaults = _get_search_defaults()
    # Return all families (empty strings for unconfigured ones)
    return {
        fam: defaults.get(fam, {"fasta_path": "", "library_path": "", "extra_args": ""})
        for fam in _PRESET_FAMILY_LABELS
    }


class SearchDefaultsBody(BaseModel):
    preset_family: str
    fasta_path: str = ""
    library_path: str = ""
    extra_args: str = ""


@app.put("/api/search/defaults")
async def api_search_defaults_put(body: SearchDefaultsBody) -> dict:
    """Save default FASTA/library for a preset family."""
    import sqlite3 as _sq
    if body.preset_family not in _PRESET_FAMILY_LABELS:
        raise HTTPException(status_code=400, detail=f"Unknown family: {body.preset_family}. Valid: {list(_PRESET_FAMILY_LABELS)}")
    with _sq.connect(str(get_db_path())) as con:
        con.execute(
            "INSERT OR REPLACE INTO search_defaults (preset_family, fasta_path, library_path, extra_args) "
            "VALUES (?, ?, ?, ?)",
            (body.preset_family, body.fasta_path.strip(), body.library_path.strip(), body.extra_args.strip()),
        )
    return {"status": "saved", "family": body.preset_family}


@app.get("/api/search/auto-ready")
async def api_search_auto_ready() -> list[dict]:
    """Return unsearched runs that have a complete auto-search configuration.

    A run is 'ready' when:
      - Its acquisition mode is known (not empty / 'auto')
      - _suggest_preset() returns a valid preset key
      - The preset family has a configured default FASTA that exists on disk
    """
    defaults = _get_search_defaults()
    unsearched = await api_search_unsearched()

    ready = []
    for run in unsearched:
        mode = run.get("mode", "")
        if not mode or mode in ("auto", "MS1only"):
            continue
        preset = run.get("suggested_preset") or _suggest_preset(run)
        family = PRESET_FAMILY.get(preset)
        if not family:
            continue
        default = defaults.get(family, {})
        fasta = default.get("fasta_path", "")
        if not fasta or not Path(fasta).exists():
            continue
        ready.append({
            **run,
            "resolved_preset":    preset,
            "resolved_family":    family,
            "resolved_fasta":     fasta,
            "resolved_library":   default.get("library_path", ""),
            "resolved_extra_args": default.get("extra_args", ""),
        })
    return ready


class AutoSubmitRequest(BaseModel):
    run_ids: list[str] = []   # empty = all auto-ready runs


@app.post("/api/search/auto-submit")
async def api_search_auto_submit(body: AutoSubmitRequest) -> dict:
    """Submit search jobs for auto-ready runs using configured defaults.

    Groups runs by (preset, fasta, library) so each unique configuration
    is submitted as a single batch job. Returns list of created job IDs.
    """
    ready_runs = await api_search_auto_ready()

    if body.run_ids:
        id_set = {str(x) for x in body.run_ids}
        ready_runs = [r for r in ready_runs if str(r["id"]) in id_set]

    if not ready_runs:
        return {"status": "nothing_to_submit", "jobs": [], "n_runs": 0}

    # Group by (preset, fasta, library, extra_args)
    from collections import defaultdict
    groups: dict[tuple, list] = defaultdict(list)
    for run in ready_runs:
        key = (
            run["resolved_preset"],
            run["resolved_fasta"],
            run["resolved_library"],
            run["resolved_extra_args"],
        )
        groups[key].append(run)

    job_ids = []
    for (preset, fasta, library, extra_args), runs in groups.items():
        req = SearchSubmitRequest(
            run_ids=[str(r["id"]) for r in runs],
            preset=preset,
            fasta_path=fasta,
            library_path=library,
            extra_args=extra_args,
            label=f"Auto · {preset} · {len(runs)} run{'s' if len(runs) != 1 else ''}",
        )
        result = await api_search_submit(req)
        job_ids.append(result["job_id"])

    return {"status": "submitted", "jobs": job_ids, "n_runs": len(ready_runs)}


@app.get("/api/search/jobs")
async def api_search_jobs() -> list[dict]:
    """Return all active and recent search jobs."""
    return [
        {
            "job_id": jid,
            "status": j["status"],
            "preset": j["preset"],
            "n_runs": len(j["runs"]),
            "n_done": j["n_done"],
            "n_failed": j["n_failed"],
            "started_at": j["started_at"],
            "label": j.get("label", ""),
        }
        for jid, j in _search_jobs.items()
    ]


@app.get("/api/search/jobs/{job_id}")
async def api_search_job_detail(job_id: str) -> dict:
    """Return job status + recent log lines."""
    if job_id not in _search_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    j = _search_jobs[job_id]
    return {
        "job_id": job_id,
        "status": j["status"],
        "preset": j["preset"],
        "runs": j["runs"],
        "n_done": j["n_done"],
        "n_failed": j["n_failed"],
        "started_at": j["started_at"],
        "log": j["log"][-200:],  # last 200 lines
    }


@app.delete("/api/search/jobs")
async def api_search_jobs_clear(status: str = "done") -> dict:
    """Remove completed (or all) jobs from the in-memory store."""
    to_del = [jid for jid, j in _search_jobs.items()
              if status == "all" or j.get("status") == status]
    for jid in to_del:
        del _search_jobs[jid]
    return {"cleared": len(to_del)}


class SearchSubmitRequest(BaseModel):
    run_ids: list[str]
    preset: str
    fasta_path: str
    library_path: str = ""
    extra_args: str = ""
    label: str = ""


@app.post("/api/search/submit")
async def api_search_submit(body: SearchSubmitRequest) -> dict:
    """Launch a search job for the given runs.

    Routing:
      DIA preset (diaPASEF / DIA mode)  → DIA-NN  (library search)
      DDA preset (ddaPASEF / DDA mode)  → Sage    (native .d; MSFragger if FragPipe installed)
      Immuno presets (mhc_class_i/ii)   → Sage non-specific (or MSFragger non-specific)
    """
    import shutil

    if body.preset not in SEARCH_PRESETS:
        raise HTTPException(status_code=400, detail=f"Unknown preset: {body.preset}")

    preset_info = SEARCH_PRESETS[body.preset]
    # Resolve alias (legacy preset keys)
    if "_alias" in preset_info:
        preset_info = SEARCH_PRESETS.get(preset_info["_alias"], preset_info)

    immuno_class = preset_info.get("immuno_class", 0)
    preset_engines = preset_info.get("engines", ["diann"])

    # Validate fasta for DDA/immuno presets (always needed for Sage)
    fasta_path_str = body.fasta_path or ""
    fasta_ok = fasta_path_str and Path(fasta_path_str).exists()

    if body.library_path and not Path(body.library_path).exists():
        raise HTTPException(status_code=400, detail=f"Library not found: {body.library_path}")

    # Resolve run records
    db_path = get_db_path()
    with _sqlite3_sa.connect(str(db_path)) as con:
        con.row_factory = _sqlite3_sa.Row
        runs = []
        for rid in body.run_ids:
            row = con.execute("SELECT id, run_name, raw_path, mode FROM runs WHERE id = ?", (rid,)).fetchone()
            if row:
                runs.append(dict(row))

    if not runs:
        raise HTTPException(status_code=400, detail="No valid run IDs found")

    job_id = str(_uuid.uuid4())[:8]
    _search_jobs[job_id] = {
        "status": "running",
        "preset": body.preset,
        "runs": [r["run_name"] for r in runs],
        "n_done": 0,
        "n_failed": 0,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "label": body.label or preset_info["label"],
        "log": [],
        "n_runs": len(runs),
    }

    extra_args = body.extra_args.split() if body.extra_args.strip() else []
    results_base = Path("E:/timsTOF/stan_results")

    def _run_batch():
        job = _search_jobs[job_id]
        results_base.mkdir(parents=True, exist_ok=True)

        for run in runs:
            raw = Path(run["raw_path"])
            mode = run.get("mode", "")
            stem = Path(run["run_name"]).stem
            out_dir = results_base / stem
            out_dir.mkdir(parents=True, exist_ok=True)

            job["log"].append(f"\n▶ {run['run_name']}  [{mode}]")

            if not raw.exists():
                job["log"].append(f"  ✗ Raw file not found: {raw}")
                job["n_failed"] += 1
                continue

            # Per-run engine decision: DIA → DIA-NN, DDA → Sage
            run_is_dia = _is_dia(mode)
            run_immuno = immuno_class or (_immuno_class(run["run_name"]) if _is_immuno_run(run["run_name"]) else 0)

            try:
                if run_is_dia and "diann" in preset_engines:
                    # ── DIA-NN path ──────────────────────────────────────────
                    diann_exe = _find_diann_exe()
                    if not diann_exe:
                        job["log"].append("  ✗ DIA-NN not found. Install DIA-NN 2.x and add to PATH.")
                        job["n_failed"] += 1
                        continue

                    out_parquet = out_dir / "report.parquet"
                    diann_args = preset_info.get("diann_args", [])
                    cmd = [diann_exe, "--f", str(raw), "--out", str(out_parquet)] + diann_args
                    if fasta_path_str:
                        cmd += ["--fasta", fasta_path_str]
                    if body.library_path:
                        cmd += ["--lib", body.library_path]
                    # Fixed mass accuracy prevents DIA-NN auto-optimization crash on timsTOF
                    _dia_vendor = "bruker" if raw.suffix.lower() == ".d" else "thermo"
                    if "--mass-acc" not in cmd and "--mass-acc-ms1" not in cmd:
                        if _dia_vendor == "bruker":
                            cmd += ["--mass-acc", "15", "--mass-acc-ms1", "15"]
                        else:
                            cmd += ["--mass-acc", "20", "--mass-acc-ms1", "10"]
                    cmd += extra_args
                    engine_label = f"DIA-NN {'MHC-' + 'I'*run_immuno if run_immuno else 'DIA'}"
                    job["log"].append(f"  engine: {engine_label}")
                    job["log"].append(f"  cmd: {' '.join(cmd)}")

                    proc = _subprocess.Popen(cmd, stdout=_subprocess.PIPE, stderr=_subprocess.STDOUT, text=True)
                    for line in proc.stdout:
                        line = line.rstrip()
                        if line:
                            job["log"].append(f"  {line}")
                    proc.wait()
                    result_file = out_parquet if out_parquet.exists() else None

                elif preset_info.get("_custom"):
                    # ── Custom script path ────────────────────────────────────
                    cmd_template = body.extra_args.strip()
                    if not cmd_template:
                        job["log"].append("  ✗ Custom preset requires a command in Extra Args.")
                        job["log"].append("    Use tokens: {raw} {out} {fasta}")
                        job["n_failed"] += 1
                        continue
                    cmd_str = (cmd_template
                               .replace("{raw}", str(raw))
                               .replace("{out}", str(out_dir))
                               .replace("{fasta}", fasta_path_str or ""))
                    job["log"].append(f"  engine: custom script")
                    job["log"].append(f"  cmd: {cmd_str}")
                    log_file = out_dir / "custom.log"
                    try:
                        with open(log_file, "w") as lf:
                            proc = _subprocess.run(
                                cmd_str, shell=True, stdout=lf, stderr=_subprocess.STDOUT,
                                text=True, timeout=14400,
                            )
                        for line in log_file.read_text().splitlines()[-30:]:
                            if line.strip():
                                job["log"].append(f"  {line}")
                        # Find any parquet output
                        parquet_files = list(out_dir.glob("*.parquet"))
                        result_file = parquet_files[0] if parquet_files else None
                    except Exception as e:
                        job["log"].append(f"  ✗ Script error: {e}")
                        job["n_failed"] += 1
                        continue

                else:
                    # ── DDA / immuno path ────────────────────────────────────
                    # For Bruker .d: prefer MSFragger (reads .d natively,
                    # avoids Sage timsrust stack-buffer-overrun on large files).
                    # Fall back to Sage if MSFragger is not installed.
                    vendor = "bruker" if raw.suffix.lower() == ".d" else "thermo"
                    s_mode = "community" if not fasta_ok else "local"

                    msf_jar = None
                    if vendor == "bruker":
                        from stan.search.local import _find_msfragger, run_msfragger_local
                        msf_jar = _find_msfragger()

                    if msf_jar and vendor == "bruker":
                        msf_label = f"MSFragger {'MHC-' + 'I'*(run_immuno==1) + 'II'*(run_immuno==2) if run_immuno else 'DDA'}"
                        job["log"].append(f"  engine: {msf_label} · {msf_jar}")
                        result_file = run_msfragger_local(
                            raw_path=raw,
                            output_dir=out_dir,
                            vendor=vendor,
                            fasta_path=fasta_path_str if fasta_ok else None,
                            search_mode=s_mode,
                            immuno_class=run_immuno,
                        )
                        if result_file is None:
                            job["log"].append("  ⚠ MSFragger failed — retrying with Sage")

                    if (msf_jar is None or vendor != "bruker" or result_file is None):
                        from stan.search.local import run_sage_local
                        _bundled_sage = Path(__file__).parent.parent.parent / "tools" / "sage"
                        _bundled_exe = next(_bundled_sage.rglob("sage.exe"), None) if _bundled_sage.exists() else None
                        sage_exe = shutil.which("sage") or (str(_bundled_exe) if _bundled_exe else "sage")
                        engine_label = f"Sage {'MHC-' + 'I'*(run_immuno==1) + 'II'*(run_immuno==2) + (' (non-specific)' if run_immuno else 'DDA')}"
                        job["log"].append(f"  engine: {engine_label} · {sage_exe}")
                        result_file = run_sage_local(
                            raw_path=raw,
                            output_dir=out_dir,
                            vendor=vendor,
                            sage_exe=sage_exe,
                            fasta_path=fasta_path_str if fasta_ok else None,
                            search_mode=s_mode,
                            immuno_class=run_immuno,
                        )

                    # Surface search log in job log so failures are visible
                    for log_name in ("msfragger.log", "sage.log"):
                        search_log = out_dir / log_name
                        if search_log.exists():
                            lines = search_log.read_text(errors="replace").splitlines()
                            for ln in lines[-40:]:
                                if ln.strip():
                                    job["log"].append(f"    {ln}")
                            break

                if result_file and result_file.exists():
                    # Parse result and update DB
                    try:
                        import polars as pl
                        df = pl.read_parquet(str(result_file))
                        q_col = "Q.Value" if "Q.Value" in df.columns else ("q_value" if "q_value" in df.columns else None)
                        prot_col = "Protein.Group" if "Protein.Group" in df.columns else ("proteins" if "proteins" in df.columns else None)
                        if q_col and prot_col:
                            n = df.filter(pl.col(q_col) < 0.01)[prot_col].n_unique()
                        elif prot_col:
                            n = df[prot_col].n_unique()
                        else:
                            n = len(df)
                        with _sqlite3_sa.connect(str(db_path)) as con2:
                            con2.execute(
                                "UPDATE runs SET n_proteins = ?, result_path = ? WHERE id = ?",
                                (int(n), str(result_file), run["id"]),
                            )
                        job["log"].append(f"  ✓ {n:,} protein/source groups at 1% FDR")
                        job["n_done"] += 1
                    except Exception as e:
                        job["log"].append(f"  ⚠ Result written but metrics failed: {e}")
                        job["n_done"] += 1
                else:
                    job["log"].append("  ✗ Search produced no output file — check engine log above")
                    job["n_failed"] += 1

            except Exception as e:
                job["log"].append(f"  ✗ Error: {e}")
                job["n_failed"] += 1

        job["status"] = "done"
        job["n_runs"] = len(runs)
        job["log"].append(f"\n✓ Batch complete: {job['n_done']} succeeded, {job['n_failed']} failed")

    threading.Thread(target=_run_batch, daemon=True).start()
    return {"job_id": job_id, "status": "running", "n_runs": len(runs)}


@app.get("/api/runs/{run_id}/calibrant-drift")
async def api_calibrant_drift(run_id: str) -> dict:
    """True calibration QC: Bruker reference 1/K₀ vs what was measured post-calibration.

    Reads analysis.tdf CalibrationInfo directly — no DIA-NN result needed.
    Returns one entry per calibrant compound per calibration event stored in the TDF.
    Drift = MobilitiesCorrectedCalibration − ReferencePeakMobilities (Bruker's known values).
    """
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    raw_path = run.get("raw_path", "")
    if not raw_path:
        return {"error": "no_raw_path", "message": "No raw path stored for this run."}
    tdf_path = Path(raw_path) / "analysis.tdf"
    if not tdf_path.exists():
        return {"error": "no_tdf", "message": f"analysis.tdf not found at {raw_path}"}

    try:
        import struct, sqlite3 as _sq3

        con = _sq3.connect(str(tdf_path))
        rows = con.execute("SELECT * FROM CalibrationInfo").fetchall()
        con.close()

        def _decode_names(blob) -> list:
            """Decode null-terminated C-string array from bytes blob."""
            if isinstance(blob, bytes):
                parts = blob.split(b"\x00")
                return [p.decode("ascii", errors="replace") for p in parts if p]
            return []

        def _decode_doubles(blob) -> list:
            """Decode array of little-endian doubles from bytes blob."""
            if isinstance(blob, bytes):
                n = len(blob) // 8
                return [struct.unpack_from("<d", blob, i * 8)[0] for i in range(n)]
            return []

        # Group rows into calibration events — each event has a CalibrationDateTime key
        # The CalibrationInfo table repeats key-value groups for multiple calibration events.
        # We parse all mobility-related entries.
        kv: dict = {}
        for r in rows:
            kv[r[1]] = r[2]

        # Collect all mobility calibration entries (may have multiple blocks)
        # We walk rows sequentially so we can detect group boundaries.
        calib_events = []
        current: dict = {}
        for r in rows:
            key, val = r[1], r[2]
            if key == "MobilityCalibrationDateTime":
                if current:
                    calib_events.append(current)
                current = {"calib_dt": val}
            elif key in (
                "ReferencePeakMobilities", "MobilitiesCorrectedCalibration",
                "MobilitiesPreviousCalibration", "ReferenceMobilityList",
                "MobilityStandardDeviationPercent", "MeasuredMobilityPeakIntensities",
                "ReferenceMobilityPeakNames", "ReferencePeakMasses",
            ):
                if key in ("ReferencePeakMobilities", "MobilitiesCorrectedCalibration",
                           "MobilitiesPreviousCalibration", "MeasuredMobilityPeakIntensities",
                           "ReferencePeakMasses"):
                    current[key] = _decode_doubles(val) if isinstance(val, bytes) else (
                        [float(val)] if isinstance(val, (int, float)) else []
                    )
                elif key == "ReferenceMobilityPeakNames":
                    current["names"] = _decode_names(val)
                else:
                    current[key] = val
        if current:
            calib_events.append(current)

        if not calib_events:
            return {"error": "no_calib", "message": "No mobility calibration data found in TDF."}

        # Build response: for the most recent calibration event, compute compound-level drift
        latest = calib_events[-1]
        ref_mobs    = latest.get("ReferencePeakMobilities", [])
        corr_mobs   = latest.get("MobilitiesCorrectedCalibration", [])
        prev_mobs   = latest.get("MobilitiesPreviousCalibration", [])
        ref_masses  = latest.get("ReferencePeakMasses", [])
        names       = latest.get("names", [])
        intensities = latest.get("MeasuredMobilityPeakIntensities", [])

        # The 3 CCS compendium anchor masses (Agilent ESI-L tuning mix, singly charged).
        # These are the ions used to fit the calibration line — ±5 Da matching tolerance.
        _TARGET_MZ = [622.0, 922.0, 1221.0]
        _TARGET_TOL = 5.0

        def _is_target(mz: float | None) -> bool:
            if mz is None:
                return False
            return any(abs(mz - t) <= _TARGET_TOL for t in _TARGET_MZ)

        n = min(len(ref_mobs), len(corr_mobs))
        compounds = []
        for i in range(n):
            ref_k0  = round(ref_mobs[i], 6)
            meas_k0 = round(corr_mobs[i], 6) if i < len(corr_mobs) else None
            prev_k0 = round(prev_mobs[i], 6) if i < len(prev_mobs) else None
            drift   = round(meas_k0 - ref_k0, 6) if meas_k0 is not None else None
            rmz     = round(ref_masses[i], 4) if i < len(ref_masses) else None
            compounds.append({
                "compound":  names[i] if i < len(names) else f"Calibrant {i+1}",
                "ref_mz":    rmz,
                "ref_k0":    ref_k0,
                "meas_k0":   meas_k0,
                "prev_k0":   prev_k0,
                "drift":     drift,        # corrected − reference (Vs/cm²)
                "pct_dev":   round(abs(drift / ref_k0) * 100, 4) if drift and ref_k0 else None,
                "intensity": round(intensities[i]) if i < len(intensities) else None,
                "is_target": _is_target(rmz),   # True for the 622 / 922 / 1221 anchor ions
            })

        std_pct = latest.get("MobilityStandardDeviationPercent")

        return {
            "calib_datetime": latest.get("calib_dt"),
            "ref_list":       latest.get("ReferenceMobilityList"),
            "std_pct":        float(std_pct) if std_pct else None,
            "compounds":      compounds,
            "all_events":     len(calib_events),
            "thresholds": {
                "warn":  0.025,   # ~15 mbar air-pressure equivalent
                "alert": 0.050,
            },
        }
    except Exception as exc:
        import traceback
        return {"error": "extraction_failed", "message": str(exc),
                "traceback": traceback.format_exc()[-600:]}


@app.get("/api/runs/{run_id}/method-config")
async def api_method_config(run_id: str) -> dict:
    """Parse the Bruker acquisition method file from a timsTOF .d folder.

    Looks for <name>.m/microTOFQImpacTemAcquisition.method inside the .d folder.
    Returns structured hardware config: IMS calibration, TOF calibration, TOF hardware,
    source, and general instrument info.
    """
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    raw_path = run.get("raw_path", "")
    if not raw_path:
        return {"error": "no_raw_path"}
    d_path = Path(raw_path)
    if not d_path.exists():
        return {"error": "no_raw_file", "message": f"Folder not found: {raw_path}"}

    # Locate .m subfolder and method file (case-insensitive)
    m_folder: Path | None = None
    for entry in d_path.iterdir():
        if entry.is_dir() and entry.suffix.lower() == ".m":
            m_folder = entry
            break
    if not m_folder:
        return {"error": "no_m_folder", "message": "No .m subfolder found in .d folder."}

    method_file: Path | None = None
    for entry in m_folder.iterdir():
        if entry.is_file() and "microTOFQImpacTemAcquisition".lower() in entry.name.lower():
            method_file = entry
            break
    if not method_file:
        return {"error": "no_method_file",
                "message": f"microTOFQImpacTemAcquisition.method not found in {m_folder.name}"}

    try:
        import xml.etree.ElementTree as ET

        tree = ET.parse(str(method_file))
        root = tree.getroot()

        # ── Helpers ──────────────────────────────────────────────────────────
        def _get_pol_block(node, pol: str):
            if node.get("polarity") == pol:
                return node
            for c in node:
                r = _get_pol_block(c, pol)
                if r is not None:
                    return r
            return None

        def _params(node) -> dict:
            """Flatten all para_* entries under node into {permname: value}."""
            out: dict = {}
            for child in node.iter():
                perm = child.get("permname", "")
                val  = child.get("value", "")
                if not perm or not val:
                    continue
                if child.tag == "para_vec_double":
                    entries = [float(e.get("value", 0)) for e in child if e.tag == "entry_double"]
                    out[perm] = entries
                elif child.tag in ("para_int", "para_double", "para_string"):
                    try:
                        out[perm] = int(val) if child.tag == "para_int" else (
                            float(val) if child.tag == "para_double" else val.strip()
                        )
                    except (ValueError, TypeError):
                        out[perm] = val.strip()
            return out

        def _fv(p: dict, key: str, default=None):
            return p.get(key, default)

        # ── General info ─────────────────────────────────────────────────────
        gi   = root.find("generalinfo") or root
        fi   = root.find("fileinfo")
        conf = (gi.findtext("configuration") or "").strip()
        # Extract model from configuration string  (e.g. "... timsTOF_Ultra ...")
        model = "timsTOF"
        for token in conf.split():
            if token.startswith("timsTOF"):
                model = token.replace("_", " ")
                break

        general = {
            "model":           model,
            "hostname":        gi.findtext("hostname", "").strip(),
            "author":          gi.findtext("author", "").strip(),
            "timstof_version": fi.get("appversion", "") if fi is not None else "",
            "created":         fi.get("createdate", "") if fi is not None else "",
            "configuration":   conf,
        }

        # ── Polarity blocks ──────────────────────────────────────────────────
        pos = _get_pol_block(root, "positive")
        neg = _get_pol_block(root, "negative")
        # Use positive if available; fall back to negative (some instruments only have one)
        pp  = _params(pos) if pos is not None else {}
        pn  = _params(neg) if neg is not None else {}
        pg  = _params(root)  # global (polarity-independent)

        def _pv(key, default=None):
            return pp.get(key, pn.get(key, pg.get(key, default)))

        # ── IMS calibration ───────────────────────────────────────────────────
        ims_calib = {
            "date":                 _pv("IMS_Calibration_LastCalibrationDate"),
            "score":                _pv("IMS_Calibration_Score"),
            "std_dev":              _pv("IMS_Calibration_StdDev"),
            "reference_mass_list":  _pv("IMS_Calibration_LastCalibrationReferenceMassList"),
            "mobility_start":       _pv("IMS_Calibration_MobilityStart_Save"),
            "mobility_end":         _pv("IMS_Calibration_MobilityEnd_Save"),
            "ramp_velocity":        _pv("IMS_Calibration_RampVelocity_Save"),
            "ramp_start":           _pv("IMS_CalibrationRampStart"),
            "ramp_end":             _pv("IMS_CalibrationRampEnd"),
            "funnel_pressure":      _pv("IMS_Calibration_Funnel1In_Pressure"),
            "pressure_compensation":_pv("IMS_Calibration_SwitchPressureCompensation"),
            "pressure_comp_factor": _pv("IMS_Calibration_Funnel1In_PressureCompensationFactor"),
            "transit_time":         _pv("IMS_CalibrationTransitTime"),
            "n_cycles":             _pv("IMS_CalibrationRampNumberOfCycles"),
        }

        # ── TOF (mass) calibration ────────────────────────────────────────────
        tof_calib = {
            "date":              _pv("Calibration_LastCalibrationDate"),
            "score":             _pv("Calibration_Score"),
            "std_dev":           _pv("Calibration_StdDev"),
            "std_dev_ppm":       _pv("Calibration_StdDevInPPM"),
            "reference_mass_list": _pv("Calibration_LastUsedReferenceMassList"),
            "scan_begin":        _pv("Calibration_ScanBegin"),
            "scan_end":          _pv("Calibration_ScanEnd"),
            "regression_mode":   _pv("Calibration_RegressionMode"),
            "tof2_c0":           _pv("Calibration_Tof2CalC0"),
            "tof2_c1":           _pv("Calibration_Tof2CalC1"),
            "tof2_std_dev":      _pv("Calibration_Tof2StdDev"),
            "tof2_std_dev_ppm":  _pv("Calibration_Tof2StdDevInPPM"),
        }

        # ── TOF hardware ──────────────────────────────────────────────────────
        tof_hw = {
            "flight_tube_v":  _pv("TOF_FlightTubeSetValue"),
            "detector_v":     _pv("Calibration_TOF_DetectorTofSetValue", _pv("TOF_DetectorTofSetValue")),
            "pulser_lens_v":  _pv("TOF_PulserLensSetValue"),
            "reflector_v":    _pv("TOF_ReflectorSetValue"),
            "corrector_fill": _pv("TOF_CorrectorFillSetValue"),
            "corrector_extract": _pv("TOF_CorrectorExtractSetValue"),
            "temp_1":         _pv("TOF_DeviceReferenceTemp1"),
            "temp_2":         _pv("TOF_DeviceReferenceTemp2"),
            "temp_compensation": _pv("TOF_SwitchTempCompensation"),
        }

        # ── Source ────────────────────────────────────────────────────────────
        source = {
            "capillary_exit_v":  _pv("Transfer_CapillaryExit_Base_Set"),
            "dry_gas_flow":      _pv("Source_AcqDryGasFlowRateSetValue"),
            "dry_gas_temp":      _pv("Source_AcqDryGasTemperatureSetValue"),
            "nebulizer_bar":     _pv("Source_AcqNebulizerPressureSetValue"),
            "capillary_v":       _pv("Source_AcqCapillaryVoltageSetValue"),
            "end_plate_offset":  _pv("Source_AcqEndPlateOffsetSetValue"),
        }

        # ── PASEF / acquisition ───────────────────────────────────────────────
        acquisition = {
            "pasef_mz_width":    _pv("MSMS_Pasef_MobilogramGridMzWidth"),
            "pasef_mz_overlap":  _pv("MSMS_Pasef_MobilogramGridMzOverlap"),
            "tof_resolution":    _pv("MSMS_Pasef_TofResolution"),
            "collision_gas":     _pv("Collision_GasSupply_Set"),
        }

        return {
            "general":     general,
            "ims_calib":   ims_calib,
            "tof_calib":   tof_calib,
            "tof_hw":      tof_hw,
            "source":      source,
            "acquisition": acquisition,
            "method_file": str(method_file),
        }

    except Exception as exc:
        import traceback
        return {"error": "parse_failed", "message": str(exc),
                "traceback": traceback.format_exc()[-800:]}


@app.get("/api/validate-paths")
async def api_validate_paths() -> dict:
    """Check every run's raw_path and result_path on disk.

    Returns lists of runs whose files are missing so the UI can flag them.
    """
    all_runs = get_runs(limit=5000)
    missing_raw    = []
    missing_result = []
    ok             = []

    for run in all_runs:
        rid       = str(run.get("id", ""))
        name      = run.get("run_name", "")
        raw       = run.get("raw_path", "") or ""
        result    = run.get("result_path", "") or ""

        raw_ok    = bool(raw    and Path(raw).exists())
        result_ok = bool(not result or Path(result).exists())  # no result path = OK (not yet searched)

        entry = {"id": rid, "run_name": name, "raw_path": raw, "result_path": result}
        if not raw_ok and raw:
            entry["missing"] = "raw"
            missing_raw.append(entry)
        elif not result_ok:
            entry["missing"] = "result"
            missing_result.append(entry)
        else:
            ok.append(rid)

    return {
        "total":          len(all_runs),
        "ok":             len(ok),
        "missing_raw":    missing_raw,
        "missing_result": missing_result,
        "n_missing":      len(missing_raw) + len(missing_result),
    }


@app.post("/api/validate-paths/clear-stale")
async def api_clear_stale_results() -> dict:
    """Null out result_path for runs whose result file no longer exists.

    Safe — only clears the path pointer, does not delete anything.
    Does NOT touch runs whose raw_path is missing (those need manual action).
    """
    all_runs = get_runs(limit=5000)
    cleared = []
    db_path = get_db_path()
    with _sqlite3_sa.connect(str(db_path)) as con:
        for run in all_runs:
            result = run.get("result_path", "") or ""
            if result and not Path(result).exists():
                con.execute(
                    "UPDATE runs SET result_path = NULL WHERE id = ?",
                    (str(run["id"]),)
                )
                cleared.append({"id": str(run["id"]), "run_name": run.get("run_name", ""),
                                 "stale_path": result})
    return {"cleared": cleared, "n_cleared": len(cleared)}


# ── File format detection ─────────────────────────────────────────────────────

@app.get("/api/detect-format")
async def api_detect_format(path: str) -> dict:
    """Detect vendor and file format for any given raw data path.

    Query param:
        path — absolute path to a raw file or directory

    Returns full detection dict: vendor, format, subformat, instrument_family,
    confidence, format_label, badge_color.
    """
    info = detect_format(path)
    info["format_label"] = format_label(info)
    info["badge_color"]  = format_badge_css(info)
    return info


@app.post("/api/runs/backfill-formats")
async def api_backfill_formats() -> dict:
    """Detect and save file format for all runs that have a raw_path but no vendor label.

    Safe read-only detection — only writes instrument_vendor, file_format,
    file_subformat to the DB.  Does not modify any QC metrics.

    Returns counts: total, updated, skipped (already labelled), not_found.
    """
    all_runs = get_runs(limit=10000)
    db_path  = get_db_path()

    updated    = []
    skipped    = []
    not_found  = []

    with _sqlite3_sa.connect(str(db_path)) as con:
        for run in all_runs:
            raw = run.get("raw_path") or ""
            existing_vendor = run.get("instrument_vendor") or ""
            if existing_vendor:
                skipped.append(run.get("run_name", ""))
                continue
            if not raw:
                skipped.append(run.get("run_name", ""))
                continue

            info = detect_format(raw)
            if info.get("confidence") == "none":
                not_found.append({"run_name": run.get("run_name", ""), "raw_path": raw})
                continue

            vendor = info.get("vendor") or ""
            fmt    = info.get("format") or ""
            subfmt = info.get("subformat") or ""
            con.execute(
                "UPDATE runs SET instrument_vendor=?, file_format=?, file_subformat=? WHERE id=?",
                (vendor, fmt, subfmt, str(run["id"])),
            )
            updated.append({
                "run_name":     run.get("run_name", ""),
                "vendor":       vendor,
                "file_format":  fmt,
                "format_label": format_label(info),
            })

    return {
        "total":     len(all_runs),
        "updated":   len(updated),
        "skipped":   len(skipped),
        "not_found": len(not_found),
        "runs":      updated,
        "missing":   not_found,
    }


@app.post("/api/runs/{run_id}/compare")
async def api_run_compare(run_id: str) -> dict:
    """Manually trigger comparison searches (MSFragger, X!Tandem, MaxQuant) for an existing run.

    Fires background daemon threads immediately — does not re-run the primary
    DIA-NN / Sage search.  Returns as soon as threads are dispatched.

    FASTA and spectral library are resolved from the instrument config (Config tab)
    exactly as the primary search would, falling back to community assets.

    The run must have a raw_path stored in the DB and the file must exist.
    """
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    raw = run.get("raw_path") or ""
    if not raw:
        return {"ok": False, "error": "No raw_path stored for this run"}

    raw_path = Path(raw)
    if not raw_path.exists():
        return {"ok": False, "error": f"Raw file not found: {raw}"}

    mode = run.get("mode") or "DDA"

    # Resolve instrument config — same lookup as primary search (Config tab settings)
    watcher = _get_instruments_watcher()
    instruments_cfg = watcher.data.get("instruments", []) if watcher else []
    inst_name = run.get("instrument", "")
    inst_cfg = next((i for i in instruments_cfg if i.get("name") == inst_name), {})

    # FASTA priority: instrument config (Config tab) → community FASTA in STAN dir
    fasta_path: str | None = inst_cfg.get("fasta_path") or None
    if not fasta_path or not Path(fasta_path).exists():
        from stan.config import get_user_config_dir
        from stan.search.community_params import COMMUNITY_FASTA_HF_PATH
        fasta_filename = COMMUNITY_FASTA_HF_PATH.split("/")[-1]
        # Check common community asset locations
        for candidate in [
            get_user_config_dir() / "community_assets" / fasta_filename,
            raw_path.parent / "_community_assets" / fasta_filename,
            raw_path.parent / "stan_results" / "_community_assets" / fasta_filename,
        ]:
            if candidate.exists():
                fasta_path = str(candidate)
                break

    # Output base: instrument output_dir → parent of raw file
    output_dir_base = inst_cfg.get("output_dir") or str(raw_path.parent / "stan_results")
    output_base = Path(output_dir_base) / raw_path.stem

    try:
        from stan.search.comparison import dispatch_comparison_searches
        _workflow = _suggest_preset({"run_name": raw_path.stem, "mode": mode})
        dispatch_comparison_searches(
            run_id=raw_path.stem,
            raw_path=raw_path,
            mode=mode,
            output_base=output_base,
            fasta_path=fasta_path,
            workflow=_workflow,
        )
    except Exception as exc:
        return {"ok": False, "error": str(exc)}

    return {
        "ok": True,
        "message": "Comparison searches dispatched",
        "run_id": run_id,
        "mode": mode,
        "fasta": fasta_path or "not found",
        "output_base": str(output_base),
    }


@app.post("/api/runs/cleanup-missing")
async def api_cleanup_missing_runs(body: dict = {}) -> dict:
    """Delete runs from the DB whose raw file no longer exists on disk.

    Pass {"dry_run": true} to preview without deleting (default: false).
    Also removes orphaned rows from search_comparisons for deleted runs.

    Returns lists of deleted and kept run names.
    """
    import sqlite3 as _sl

    dry_run: bool = body.get("dry_run", False)
    all_runs = get_runs(limit=50000)
    db_path  = get_db_path()

    to_delete: list[dict] = []
    kept:      list[dict] = []

    for run in all_runs:
        raw = run.get("raw_path") or ""
        if not raw:
            # No raw_path stored — keep in DB (might be manually imported)
            kept.append({"run_name": run.get("run_name", ""), "reason": "no_raw_path"})
            continue
        if not Path(raw).exists():
            to_delete.append({
                "id":       str(run["id"]),
                "run_name": run.get("run_name", ""),
                "raw_path": raw,
            })
        else:
            kept.append({"run_name": run.get("run_name", ""), "reason": "exists"})

    if not dry_run and to_delete:
        ids_to_delete = [r["id"] for r in to_delete]
        placeholders = ",".join("?" for _ in ids_to_delete)
        with _sl.connect(str(db_path)) as con:
            con.execute(f"DELETE FROM runs WHERE id IN ({placeholders})", ids_to_delete)
            # Also clean up comparison results for deleted runs
            # search_comparisons uses run_id = raw_path.stem, not the UUID
            # Remove by matching run stems of deleted runs
            stems = [Path(r["raw_path"]).stem for r in to_delete]
            if stems:
                stem_ph = ",".join("?" for _ in stems)
                con.execute(
                    f"DELETE FROM search_comparisons WHERE run_id IN ({stem_ph})",
                    stems,
                )

    return {
        "dry_run":  dry_run,
        "deleted":  len(to_delete) if not dry_run else 0,
        "previewed": len(to_delete) if dry_run else 0,
        "kept":     len(kept),
        "removed":  to_delete if not dry_run else [],
        "would_remove": to_delete if dry_run else [],
    }


@app.get("/")
async def index():
    """Serve the dashboard frontend."""
    from fastapi.responses import Response
    index_path = _FRONTEND_DIR / "index.html"
    if index_path.exists():
        return Response(content=index_path.read_bytes(), media_type="text/html; charset=utf-8")
    return HTMLResponse(_FALLBACK_HTML)


# Mount static files if the directory exists
if _FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(_FRONTEND_DIR)), name="static")


_FALLBACK_HTML = """<!DOCTYPE html>
<html><head><title>STAN Dashboard</title></head>
<body style="font-family: sans-serif; padding: 2rem;">
<h1>STAN Dashboard</h1>
<p>Frontend not built yet. API is running at <code>/api/</code>.</p>
<ul>
<li><a href="/api/version">/api/version</a></li>
<li><a href="/api/runs">/api/runs</a></li>
<li><a href="/api/instruments">/api/instruments</a></li>
<li><a href="/api/thresholds">/api/thresholds</a></li>
<li><a href="/docs">/docs</a> (Swagger UI)</li>
</ul>
</body></html>
"""
