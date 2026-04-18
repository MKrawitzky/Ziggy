"""HLA Peptide Reference Atlas for ZIGGY.

Sources (tried in order):
  1. HLA Ligand Atlas  — hla-ligand-atlas.org (Schuster et al. 2017 / ongoing)
     90K class-I + 142K class-II peptides, 29 human tissues, allele-annotated
  2. PeptideAtlas HLA builds — peptideatlas.org (fallback)

Usage:
    from stan.search.hla_atlas import AtlasManager
    am = AtlasManager()
    am.download()                         # one-time, ~30 MB
    stats = am.stats()
    hits = am.search("GILGFVFTL")
    cov  = am.coverage(["GILGFVFTL", "NLVPMVATV", ...])
"""

from __future__ import annotations

import io
import logging
import zipfile
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Atlas lives next to the ZIGGY tools dir
_ZIGGY_DIR   = Path(__file__).parent.parent.parent   # E:\ziggy
_ATLAS_DIR   = _ZIGGY_DIR / "resources" / "hla_atlas"
_ATLAS_PQ    = _ATLAS_DIR / "hla_peptides.parquet"
_ATLAS_META  = _ATLAS_DIR / "atlas_meta.json"

# Download URLs (try in order)
_HLA_LIGAND_ATLAS_URLS = [
    "https://hla-ligand-atlas.org/downloads/hla_2020.12.zip",
    "https://hla-ligand-atlas.org/downloads/hla_2020.06.zip",
    "https://hla-ligand-atlas.org/downloads/hla_2019.09a.zip",
]

# PeptideAtlas HLA Ligandome build — build IDs to try (most recent first)
_PA_BUILDS_TO_TRY = [577, 576, 544, 532]
_PA_BASE = "https://db.systemsbiology.net/sbeams/cgi/PeptideAtlas/GetPeptides"


# ── Column name normalization ──────────────────────────────────────────────────
# The HLA Ligand Atlas ZIP has changed column names across releases.
# Try each alias in order until a match is found.
_COL_ALIASES = {
    "sequence":  ["peptide_sequence", "sequence", "Sequence", "pep_seq",
                  "ligand_sequence", "Peptide", "peptide"],
    "allele":    ["hla_allotype", "allele", "hla_allele", "HLA", "mhc_allele",
                  "HLA_allotype", "allotype", "HLA_Allele"],
    "tissue":    ["tissue", "Tissue", "tissue_type", "TissueType", "sample_name",
                  "source_tissue", "tissue_source"],
    "mhc_class": ["mhc_class", "MHC_class", "class", "mhc", "HLA_class",
                  "peptide_class", "Class"],
    "protein":   ["gene_symbol", "gene", "protein", "Protein", "Gene",
                  "source_protein", "protein_accession", "Gene_Symbol"],
    "n_obs":     ["n_runs", "n_samples", "n_observations", "obs", "count",
                  "sample_count", "N_obs", "N_runs", "nobs"],
}


def _resolve_col(df_cols: list[str], field: str) -> Optional[str]:
    """Return the first alias that exists in df_cols, or None."""
    for alias in _COL_ALIASES.get(field, [field]):
        if alias in df_cols:
            return alias
    return None


def _parse_hla_ligand_atlas_zip(zip_bytes: bytes) -> "pl.DataFrame":
    """Extract and normalise the HLA Ligand Atlas ZIP into a canonical DataFrame."""
    import polars as pl
    import re

    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        names = zf.namelist()
        logger.info("ZIP contains: %s", names[:20])

        # Find peptide data files (TSV / CSV)
        data_files = [
            n for n in names
            if (n.endswith(".tsv") or n.endswith(".csv"))
            and not n.startswith("__MACOSX")
            and "readme" not in n.lower()
        ]
        if not data_files:
            raise ValueError(f"No TSV/CSV files found in ZIP. Contents: {names[:30]}")

        logger.info("Parsing %d data file(s): %s", len(data_files), data_files[:5])
        frames = []
        for fname in data_files:
            try:
                raw = zf.read(fname).decode("utf-8", errors="replace")
                sep = "\t" if "\t" in raw[:500] else ","
                df = pl.read_csv(io.StringIO(raw), separator=sep, infer_schema_length=2000,
                                 ignore_errors=True)

                cols = df.columns
                seq_col     = _resolve_col(cols, "sequence")
                allele_col  = _resolve_col(cols, "allele")
                tissue_col  = _resolve_col(cols, "tissue")
                class_col   = _resolve_col(cols, "mhc_class")
                protein_col = _resolve_col(cols, "protein")
                nobs_col    = _resolve_col(cols, "n_obs")

                if not seq_col:
                    logger.warning("No sequence column in %s (columns: %s)", fname, cols[:10])
                    continue

                # Build canonical frame
                out_cols = {
                    "sequence": pl.col(seq_col).cast(pl.Utf8),
                }
                if allele_col:
                    out_cols["allele"] = pl.col(allele_col).cast(pl.Utf8)
                else:
                    out_cols["allele"] = pl.lit("unknown")

                if tissue_col:
                    out_cols["tissue"] = pl.col(tissue_col).cast(pl.Utf8)
                else:
                    # infer tissue from file name
                    tissue_hint = Path(fname).stem.replace("_", " ")
                    out_cols["tissue"] = pl.lit(tissue_hint)

                if class_col:
                    out_cols["mhc_class"] = pl.col(class_col).cast(pl.Utf8)
                else:
                    # Infer from file name
                    cls = "I" if "class_i" in fname.lower() or "mhci_" in fname.lower() \
                               or "hla_i_" in fname.lower() \
                               else ("II" if "class_ii" in fname.lower() or "mhcii" in fname.lower() else "I")
                    out_cols["mhc_class"] = pl.lit(cls)

                if protein_col:
                    out_cols["protein"] = pl.col(protein_col).cast(pl.Utf8)
                else:
                    out_cols["protein"] = pl.lit("")

                if nobs_col:
                    out_cols["n_obs"] = pl.col(nobs_col).cast(pl.Float64, strict=False).cast(pl.Int32, strict=False).fill_null(1)
                else:
                    out_cols["n_obs"] = pl.lit(1, dtype=pl.Int32)

                fdf = df.select([expr.alias(name) for name, expr in out_cols.items()])
                frames.append(fdf)
                logger.info("  %s → %d rows", fname, fdf.height)

            except Exception as e:
                logger.warning("Failed to parse %s: %s", fname, e)

        if not frames:
            raise ValueError("Could not parse any data files from the atlas ZIP")

        combined = pl.concat(frames, how="diagonal")
        return combined


def _parse_peptideatlas_tsv(tsv_text: str) -> "pl.DataFrame":
    """Parse a PeptideAtlas GetPeptides TSV into a canonical DataFrame."""
    import polars as pl
    import io as _io

    df = pl.read_csv(_io.StringIO(tsv_text), separator="\t", infer_schema_length=1000,
                     ignore_errors=True)
    cols = df.columns
    seq_col  = _resolve_col(cols, "sequence") or _resolve_col(cols, "peptide_sequence")
    prot_col = _resolve_col(cols, "protein")
    nobs_col = _resolve_col(cols, "n_obs")

    if not seq_col:
        raise ValueError(f"No sequence column in PeptideAtlas TSV. Columns: {cols}")

    out = {
        "sequence":  pl.col(seq_col).cast(pl.Utf8),
        "allele":    pl.lit("unknown"),
        "tissue":    pl.lit("PeptideAtlas"),
        "mhc_class": pl.lit("I"),
        "protein":   pl.col(prot_col).cast(pl.Utf8) if prot_col else pl.lit(""),
        "n_obs":     pl.col(nobs_col).cast(pl.Int32, strict=False).fill_null(1) if nobs_col else pl.lit(1, dtype=pl.Int32),
    }
    return df.select([expr.alias(name) for name, expr in out.items()])


def _clean_and_deduplicate(df: "pl.DataFrame") -> "pl.DataFrame":
    """Normalise sequences, add derived columns, deduplicate."""
    import polars as pl
    import re

    # Strip modifications and whitespace, uppercase
    df = df.with_columns([
        pl.col("sequence")
          .str.replace_all(r"\(.*?\)", "")
          .str.replace_all(r"\[.*?\]", "")
          .str.replace_all(r"[^A-Z]", "")
          .str.strip_chars()
          .alias("sequence"),
        pl.col("allele").str.strip_chars().alias("allele"),
        pl.col("tissue").str.strip_chars().alias("tissue"),
        pl.col("protein").str.strip_chars().alias("protein"),
    ])

    # Remove empties and sequences <6 or >35 aa
    df = df.filter(
        pl.col("sequence").str.len_chars().is_between(6, 35) &
        pl.col("sequence").str.contains(r"^[ACDEFGHIKLMNPQRSTVWY]+$")
    )

    # Add length + derived MHC class
    df = df.with_columns([
        pl.col("sequence").str.len_chars().alias("length"),
        pl.when(pl.col("mhc_class").str.contains("2|II"))
          .then(pl.lit(2))
          .otherwise(pl.lit(1))
          .alias("mhc_class_int"),
    ])

    # Count detections per (sequence, allele) pair
    freq = (
        df.group_by(["sequence", "allele"])
          .agg([
              pl.col("n_obs").sum().alias("total_obs"),
              pl.col("tissue").unique().len().alias("n_tissues"),
              pl.col("mhc_class_int").first().alias("mhc_class"),
              pl.col("protein").first().alias("protein"),
              pl.col("length").first().alias("length"),
          ])
    )

    logger.info("Atlas after dedup: %d unique (sequence, allele) pairs", freq.height)
    return freq


class AtlasManager:
    """Manage the local HLA peptide reference atlas."""

    def __init__(self):
        _ATLAS_DIR.mkdir(parents=True, exist_ok=True)

    def is_available(self) -> bool:
        return _ATLAS_PQ.exists() and _ATLAS_PQ.stat().st_size > 1000

    def stats(self) -> dict:
        if not self.is_available():
            return {"available": False}
        import polars as pl
        import json
        meta = {}
        if _ATLAS_META.exists():
            try:
                meta = json.loads(_ATLAS_META.read_text())
            except Exception:
                pass
        df = pl.scan_parquet(str(_ATLAS_PQ))
        n_total  = df.select(pl.len()).collect().item()
        n_mhc1   = df.filter(pl.col("mhc_class") == 1).select(pl.len()).collect().item()
        n_mhc2   = df.filter(pl.col("mhc_class") == 2).select(pl.len()).collect().item()
        alleles  = df.select(pl.col("allele").unique()).collect()["allele"].to_list()
        tissues  = df.select(pl.col("tissue").unique()).collect()["tissue"].to_list()
        return {
            "available":    True,
            "n_total":      n_total,
            "n_mhc1":       n_mhc1,
            "n_mhc2":       n_mhc2,
            "n_alleles":    len([a for a in alleles if a != "unknown"]),
            "n_tissues":    len(tissues),
            "alleles_sample": sorted([a for a in alleles if "HLA-" in a or "*" in a])[:20],
            "tissues_sample": sorted([t for t in tissues if t])[:20],
            "source":       meta.get("source", "unknown"),
            "downloaded_at":meta.get("downloaded_at", ""),
            "path":         str(_ATLAS_PQ),
        }

    def search(
        self,
        query: str = "",
        allele: str = "",
        protein: str = "",
        mhc_class: int = 0,
        min_obs: int = 1,
        limit: int = 200,
    ) -> list[dict]:
        """Search the atlas. Returns list of match dicts."""
        if not self.is_available():
            return []
        import polars as pl
        df = pl.scan_parquet(str(_ATLAS_PQ))
        if query:
            df = df.filter(pl.col("sequence").str.contains(query.upper()))
        if allele:
            df = df.filter(pl.col("allele").str.contains(allele, literal=False))
        if protein:
            df = df.filter(pl.col("protein").str.contains(protein, literal=False))
        if mhc_class in (1, 2):
            df = df.filter(pl.col("mhc_class") == mhc_class)
        if min_obs > 1:
            df = df.filter(pl.col("total_obs") >= min_obs)
        rows = df.sort("total_obs", descending=True).limit(limit).collect()
        return rows.to_dicts()

    def coverage(self, sequences: list[str]) -> dict:
        """Return coverage stats: how many of `sequences` are in the atlas."""
        if not self.is_available() or not sequences:
            return {"n_query": len(sequences), "n_hits": 0, "pct": 0.0, "hits": []}
        import polars as pl
        seqs_clean = list({s.upper().strip() for s in sequences if s})
        df = pl.scan_parquet(str(_ATLAS_PQ))
        hits_df = (
            df.filter(pl.col("sequence").is_in(seqs_clean))
              .sort("total_obs", descending=True)
              .collect()
        )
        hit_seqs = set(hits_df["sequence"].to_list())
        n_hits = len(hit_seqs)
        pct = round(n_hits / max(len(seqs_clean), 1) * 100, 1)
        return {
            "n_query": len(seqs_clean),
            "n_hits":  n_hits,
            "pct":     pct,
            "hits":    hits_df.head(300).to_dicts(),
        }

    def canonical_standards(
        self,
        min_tissues: int = 3,
        mhc_class: int = 1,
        limit: int = 100,
    ) -> list[dict]:
        """Return highly-canonical peptides detected in many tissues — ideal internal standards."""
        if not self.is_available():
            return []
        import polars as pl
        df = (
            pl.scan_parquet(str(_ATLAS_PQ))
              .filter(pl.col("mhc_class") == mhc_class)
              .filter(pl.col("n_tissues") >= min_tissues)
              .sort("n_tissues", descending=True)
              .limit(limit)
              .collect()
        )
        return df.to_dicts()

    def download(self, source: str = "auto", callback=None) -> dict:
        """Download the atlas. `callback(msg)` receives progress strings.

        source: 'hla_ligand_atlas' | 'peptideatlas' | 'auto'
        """
        import requests
        import json
        from datetime import datetime

        cb = callback or (lambda msg: logger.info(msg))

        if source in ("auto", "hla_ligand_atlas"):
            for url in _HLA_LIGAND_ATLAS_URLS:
                try:
                    cb(f"Downloading HLA Ligand Atlas from {url} …")
                    r = requests.get(url, timeout=120, stream=True)
                    if r.status_code != 200:
                        cb(f"  HTTP {r.status_code}, trying next URL…")
                        continue
                    total = int(r.headers.get("content-length", 0))
                    data = b""
                    downloaded = 0
                    for chunk in r.iter_content(chunk_size=1 << 17):  # 128 KB
                        data += chunk
                        downloaded += len(chunk)
                        if total:
                            pct = downloaded / total * 100
                            cb(f"  {downloaded // 1024 // 1024:.1f} / {total // 1024 // 1024:.1f} MB ({pct:.0f}%)")

                    cb(f"Downloaded {len(data) // 1024 // 1024:.1f} MB. Parsing…")
                    df = _parse_hla_ligand_atlas_zip(data)
                    df = _clean_and_deduplicate(df)
                    _ATLAS_DIR.mkdir(parents=True, exist_ok=True)
                    df.write_parquet(str(_ATLAS_PQ))
                    meta = {
                        "source": url,
                        "downloaded_at": datetime.utcnow().isoformat(),
                        "n_rows": df.height,
                    }
                    _ATLAS_META.write_text(json.dumps(meta, indent=2))
                    cb(f"Atlas saved: {df.height:,} peptides → {_ATLAS_PQ}")
                    return {"success": True, "n_rows": df.height, "source": url}
                except Exception as e:
                    cb(f"  Failed ({e}), trying next…")

        if source in ("auto", "peptideatlas"):
            cb("Trying PeptideAtlas HLA builds…")
            for build_id in _PA_BUILDS_TO_TRY:
                try:
                    url = (f"{_PA_BASE}?atlas_build_id={build_id}"
                           f"&output_format=tsv&QUERY_NAME=HLA")
                    cb(f"  GET {url}")
                    r = requests.get(url, timeout=60)
                    if r.status_code != 200 or len(r.text) < 500:
                        continue
                    df = _parse_peptideatlas_tsv(r.text)
                    df = _clean_and_deduplicate(df)
                    if df.height < 100:
                        continue
                    df.write_parquet(str(_ATLAS_PQ))
                    meta = {
                        "source": f"PeptideAtlas build {build_id}",
                        "downloaded_at": datetime.utcnow().isoformat(),
                        "n_rows": df.height,
                    }
                    _ATLAS_META.write_text(json.dumps(meta, indent=2))
                    cb(f"Atlas saved: {df.height:,} peptides from PeptideAtlas build {build_id}")
                    return {"success": True, "n_rows": df.height, "source": f"PA build {build_id}"}
                except Exception as e:
                    cb(f"  Build {build_id} failed: {e}")

        return {
            "success": False,
            "error": (
                "All download sources failed.\n"
                "Manual option: download hla_2020.12.zip from "
                "https://hla-ligand-atlas.org/downloads and place it in "
                f"{_ATLAS_DIR}/ then run AtlasManager().import_zip(path)."
            ),
        }

    def import_zip(self, zip_path: Path) -> dict:
        """Import a manually downloaded HLA Ligand Atlas ZIP."""
        import json
        from datetime import datetime
        zip_path = Path(zip_path)
        data = zip_path.read_bytes()
        df = _parse_hla_ligand_atlas_zip(data)
        df = _clean_and_deduplicate(df)
        _ATLAS_DIR.mkdir(parents=True, exist_ok=True)
        df.write_parquet(str(_ATLAS_PQ))
        meta = {
            "source": str(zip_path),
            "downloaded_at": datetime.utcnow().isoformat(),
            "n_rows": df.height,
        }
        _ATLAS_META.write_text(json.dumps(meta, indent=2))
        logger.info("Imported %d peptides from %s", df.height, zip_path)
        return {"success": True, "n_rows": df.height}
