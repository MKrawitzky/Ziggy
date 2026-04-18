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
from stan.db import get_db_path, get_run, get_runs, get_tic_trace, get_tic_traces_for_instrument, get_trends, init_db

logger = logging.getLogger(__name__)

app = FastAPI(title="STAN Dashboard", version=__version__)

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
def _is_dia(mode: str) -> bool:
    return mode in ("DIA", "diaPASEF")


def _is_dda(mode: str) -> bool:
    return mode in ("DDA", "ddaPASEF")


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

    Priority:
      1. result_path column in DB (stored by watcher after each search)
      2. Disk fallback: <raw_parent>/stan_results/<run_stem>/report.parquet
         (the layout STAN uses when writing search results locally)
      3. Disk fallback: report.parquet directly next to the .d directory
    """
    stored = run.get("result_path", "")
    if stored:
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
    """2D RT × 1/K0 density grid. Source: 4DFF .features (preferred) or DIA-NN report."""
    from stan.metrics.mobility_viz import get_mobility_map
    from stan.metrics.mobility_diann import get_mobility_map_diann

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    features_path = _resolve_features_path(run)
    if features_path:
        return get_mobility_map(features_path, rt_bins=rt_bins, mobility_bins=mob_bins)

    report_path = _resolve_report_path(run)
    if report_path:
        return get_mobility_map_diann(report_path, run_name=run.get("run_name"), rt_bins=rt_bins, mobility_bins=mob_bins)

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
    """3D feature point cloud (RT × m/z × 1/K0). Source: 4DFF or DIA-NN report."""
    from stan.metrics.mobility_viz import get_feature_3d_data
    from stan.metrics.mobility_diann import get_feature_3d_data_diann

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    cap = min(max_features, 20_000)
    features_path = _resolve_features_path(run)
    if features_path:
        return get_feature_3d_data(features_path, max_features=cap)

    report_path = _resolve_report_path(run)
    if report_path:
        return get_feature_3d_data_diann(report_path, run_name=run.get("run_name"), max_features=cap)

    return {}


@app.get("/api/runs/{run_id}/mobility-stats")
async def api_mobility_stats(run_id: str) -> dict:
    """Charge distribution + FWHM + intensity histograms. Source: 4DFF or DIA-NN report."""
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

    report_path = _resolve_report_path(run)
    if report_path:
        run_name = run.get("run_name")
        return {
            "charge_dist": get_charge_distribution_diann(report_path, run_name),
            "fwhm_hist":   get_fwhm_histogram_diann(report_path, run_name),
            "intensity_hist": get_intensity_histogram_diann(report_path, run_name),
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
    """Retroactively resolve 'auto' instrument names from Bruker .d method files.

    Scans all runs in the database whose instrument field is 'auto' and whose
    raw_path points to a .d directory. For each, reads the model name from
    the .m subfolder and updates the database row.

    Returns a summary: {updated: int, skipped: int, errors: int}
    """
    from stan.db import get_db_path
    from stan.watcher.instrument_name import read_instrument_name_from_d
    from pathlib import Path
    import sqlite3

    db_path = get_db_path()
    if not db_path.exists():
        return {"updated": 0, "skipped": 0, "errors": 0, "detail": "No database found"}

    updated = skipped = errors = 0

    try:
        with sqlite3.connect(str(db_path)) as con:
            con.row_factory = sqlite3.Row
            rows = con.execute(
                "SELECT id, raw_path FROM runs WHERE instrument = 'auto'"
            ).fetchall()

            for row in rows:
                raw_path = row["raw_path"]
                if not raw_path or not raw_path.endswith(".d"):
                    skipped += 1
                    continue
                try:
                    name = read_instrument_name_from_d(Path(raw_path))
                    if name:
                        con.execute(
                            "UPDATE runs SET instrument = ? WHERE id = ?",
                            (name, row["id"]),
                        )
                        updated += 1
                        logger.info("Fixed instrument name for run %s: %s", row["id"], name)
                    else:
                        skipped += 1
                except Exception as exc:
                    logger.warning("Error reading instrument name for run %s: %s", row["id"], exc)
                    errors += 1

            con.commit()

    except sqlite3.OperationalError as exc:
        return {"updated": 0, "skipped": 0, "errors": 1, "detail": str(exc)}

    return {"updated": updated, "skipped": skipped, "errors": errors}


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


@app.get("/api/runs/{run_id}/immunopeptidomics")
async def api_immunopeptidomics(run_id: str) -> dict:
    """Immunopeptidomics analysis from DIA-NN report.parquet.

    Computes peptide length distribution, MHC Class I (8-14aa) and
    Class II (13-25aa) counts, charge distribution, top peptides,
    and modification frequencies — all at 1% FDR.
    """
    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    report_path = _resolve_report_path(run)
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
        }
    except Exception as e:
        logger.exception("immunopeptidomics endpoint failed")
        return {}


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
    """Enzyme efficiency and PTM statistics from DIA-NN report.parquet.

    Returns missed cleavage distribution, oxidation %, and other modification
    frequencies at 1% FDR.  Requires result_path to be set in the DB (set
    automatically by the watcher after each search).

    Args:
        enzyme: One of trypsin, trypsin_lysc, lysc, argc, chymotrypsin,
                rchymoselect, krakatoa, vesuvius, aspn, proalanase, pepsin,
                nonspecific.  Determines which residues count as missed cleavages.
    """
    from stan.metrics.mobility_diann import get_enzyme_stats_diann

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    report_path = _resolve_report_path(run)
    if not report_path:
        return {}

    return get_enzyme_stats_diann(report_path, run_name=run.get("run_name"), enzyme=enzyme)


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

    Converts 1/K₀ → CCS (Å²) via the Bruker timsdata DLL.  Returns an empty
    dict for non-timsTOF runs or when the DLL is unavailable.
    """
    from stan.metrics.mobility_diann import get_ccs_data_diann

    run = get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    report_path = _resolve_report_path(run)
    if not report_path:
        return {}

    return get_ccs_data_diann(report_path, run_name=run.get("run_name"))


@app.get("/api/instruments/{instrument}/tic")
async def api_instrument_tic(instrument: str, limit: int = 20) -> dict:
    """Fetch recent TIC traces for an instrument (for overlay plot)."""
    traces = get_tic_traces_for_instrument(instrument, limit=min(limit, 50))
    return {"instrument": instrument, "traces": traces, "count": len(traces)}


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
    """Scan configured watch directories for .d folders not yet in the database.

    Returns:
        found: list of dicts with raw_path, run_name, instrument, mtime
        n_known: total runs already in DB
    """
    import sqlite3 as _sqlite3
    import os

    watcher = _get_instruments_watcher()
    if watcher is None:
        return {"found": [], "n_known": 0, "error": "No instruments.yml found"}

    instruments_cfg = watcher.data.get("instruments", [])

    # Collect all known raw_paths from DB (normalised to forward-slash lowercase for comparison)
    db_path = get_db_path()
    known_norm: set[str] = set()
    if db_path.exists():
        with _sqlite3.connect(str(db_path)) as con:
            rows = con.execute(
                "SELECT raw_path FROM runs WHERE raw_path IS NOT NULL"
            ).fetchall()
            for (rp,) in rows:
                if rp:
                    known_norm.add(rp.replace("\\", "/").lower())

    found: list[dict] = []
    for inst in instruments_cfg:
        watch_dir = inst.get("watch_dir", "")
        if not watch_dir:
            continue
        watch_path = Path(watch_dir)
        if not watch_path.exists():
            continue
        inst_name = inst.get("name", watch_dir)

        for d_path in sorted(watch_path.glob("*.d")):
            if not d_path.is_dir():
                continue
            # Only Bruker timsTOF acquisitions contain analysis.tdf
            if not (d_path / "analysis.tdf").exists():
                continue
            norm = str(d_path).replace("\\", "/").lower()
            if norm in known_norm:
                continue

            try:
                mtime = d_path.stat().st_mtime
                mtime_iso = __import__("datetime").datetime.fromtimestamp(mtime).isoformat()
            except OSError:
                mtime_iso = ""

            found.append({
                "raw_path": str(d_path),
                "run_name": d_path.name,
                "instrument": inst_name,
                "mtime": mtime_iso,
            })

    # Newest first
    found.sort(key=lambda x: x["mtime"], reverse=True)
    return {"found": found, "n_known": len(known_norm)}


class ScanImportRequest(BaseModel):
    raw_path: str
    instrument: str


@app.post("/api/scan-new-runs/import")
async def api_scan_import(body: ScanImportRequest) -> dict:
    """Import a discovered .d run into the database (metadata only — no search results).

    Reads analysis.tdf for AcquisitionDateTime and MsmsType; inserts a stub
    row with no QC metrics so the run is visible in Run History immediately.
    """
    import sqlite3 as _sqlite3

    d_path = Path(body.raw_path)
    if not d_path.exists() or not d_path.is_dir():
        raise HTTPException(
            status_code=400,
            detail=f"Path not found or not a directory: {body.raw_path}",
        )
    if not (d_path / "analysis.tdf").exists():
        raise HTTPException(
            status_code=400,
            detail=f"Not a valid Bruker timsTOF acquisition (no analysis.tdf): {body.raw_path}",
        )

    run_name = d_path.name
    run_date: str | None = None
    mode = "diaPASEF"

    tdf_path = d_path / "analysis.tdf"
    if tdf_path.exists():
        try:
            with _sqlite3.connect(str(tdf_path)) as con:
                meta_row = con.execute(
                    "SELECT Value FROM GlobalMetadata WHERE Key = 'AcquisitionDateTime'"
                ).fetchone()
                if meta_row:
                    run_date = meta_row[0]

                # MsmsType: 8=ddaPASEF, 9=diaPASEF, 0=MS1 only (treat as diaPASEF)
                type_rows = con.execute(
                    "SELECT MsmsType FROM Frames GROUP BY MsmsType"
                ).fetchall()
                types = {r[0] for r in type_rows}
                if 8 in types and 9 not in types:
                    mode = "ddaPASEF"
        except Exception:
            logger.warning("Could not read analysis.tdf for %s", run_name, exc_info=True)

    from stan.db import insert_run
    run_id = insert_run(
        instrument=body.instrument,
        run_name=run_name,
        raw_path=str(d_path),
        mode=mode,
        metrics={},
        gate_result="",
        run_date=run_date,
    )

    return {
        "run_id": run_id,
        "run_name": run_name,
        "mode": mode,
        "run_date": run_date,
        "status": "imported",
    }


# ── Background search processing ─────────────────────────────────────

# run_id → {"status": "queued"|"running"|"done"|"failed", "message": str}
_process_jobs: dict[str, dict] = {}
_process_lock = threading.Lock()


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

    try:
        _set("running", "Starting search…")

        raw_path = Path(run["raw_path"])
        mode = run.get("mode", "DIA")
        vendor = "bruker" if raw_path.suffix.lower() == ".d" else "thermo"

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

        # Check whether a previous search already produced output in the expected location.
        # If so, skip the search entirely and go straight to metric extraction.
        # This lets "Process" recover quickly after a crash mid-extraction, and avoids
        # re-running a multi-hour DIA-NN search just to re-populate missing DB columns.
        # "Re-run" from the UI passes force=True to bypass this shortcut.
        force_rerun = run.get("_force_rerun", False)
        existing_parquet = (output_dir / "report.parquet") if _is_dia(mode) else (output_dir / "results.sage.parquet")

        result_path: Path | None = None
        if not force_rerun and existing_parquet.exists():
            logger.info(
                "Existing search output found for %s — skipping search, re-extracting metrics.",
                raw_path.name,
            )
            _set("running", f"Re-extracting metrics from existing results for {raw_path.name}…")
            result_path = existing_parquet
        elif _is_dia(mode):
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
            _set("running", f"Running Sage on {raw_path.name}…")
            result_path = run_sage_local(
                raw_path=raw_path,
                output_dir=output_dir,
                vendor=vendor,
                sage_exe=sage_exe,
                fasta_path=fasta_path,
                search_mode=search_mode,
            )

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
        if _is_dia(mode):
            metrics = extract_dia_metrics(result_path, gradient_min=float(grad_min) if grad_min else None)
        else:
            metrics = extract_dda_metrics(result_path, gradient_min=float(grad_min) if grad_min else 60)

        # Update the existing run record with all available metrics.
        # Include every writeable DB column that an extractor might return —
        # the filter `if c in metrics` keeps it safe for partial results.
        import sqlite3 as _sq
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
            with _sq.connect(str(db_path)) as con:
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
            dispatch_comparison_searches(
                run_id=raw_path.stem,
                raw_path=raw_path,
                mode=mode,
                output_base=output_dir.parent,
                fasta_path=inst_cfg.get("fasta_path"),
            )
        except Exception:
            logger.debug("Comparison dispatch skipped (FragPipe not found or error)", exc_info=True)

    except Exception as exc:
        logger.exception("Background search failed for run %s", run_id)
        # RuntimeError from ensure_community_assets has multi-line help text — take first line
        msg = str(exc).split("\n")[0][:300]
        _set("failed", msg)


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

            # Sort by score descending, convert any numpy types
            results.sort(key=lambda r: r["score"], reverse=True)
            for r in results:
                for k, v in r.items():
                    if hasattr(v, "tolist"):
                        r[k] = v.tolist()
            job["results"] = results
            job["status"] = "done"

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


@app.get("/api/hla-atlas/status")
async def api_hla_atlas_status() -> dict:
    """Return HLA atlas availability stats + current download job state."""
    try:
        from stan.search.hla_atlas import AtlasManager
        stats = AtlasManager().stats()
    except Exception as e:
        stats = {"available": False, "error": str(e)}
    return {**stats, "download_job": _atlas_download_job}


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
