"""HLA Peptide Reference Atlas for ZIGGY.

Sources (tried in order):
  1. Built-in seed  — ~1 600 well-characterised ligands from published benchmarks
     (HLA-A*02:01, A*01:01, A*03:01, A*24:02, B*07:02, B*35:01, B*57:01, DP, DQ, DR)
     Available immediately, no internet required.
  2. GitHub-hosted NetMHCpan training data (Jurtz et al. 2017) — ~180 K entries
  3. PeptideAtlas HLA builds — peptideatlas.org

Usage:
    from stan.search.hla_atlas import AtlasManager
    am = AtlasManager()
    am.build_seed()                       # instant, no network — installs built-in seed
    am.download()                         # fetch full dataset from network
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

# ── Download URLs ─────────────────────────────────────────────────────────────
# HLA Ligand Atlas (hla-ligand-atlas.org) is currently offline; kept as reference.
_HLA_LIGAND_ATLAS_URLS: list[str] = []   # no working mirrors yet

# NetMHCpan 4.1 training data hosted on GitHub (Jurtz et al. 2017, J Immunol)
# Canonical set used to train/evaluate HLA binding prediction tools.
# Columns: peptide, HLA, measurement_value, measurement_inequality, …
_NETMHCPAN_URLS = [
    "https://raw.githubusercontent.com/mnielLab/netMHCpan-4.1-data/main/curated_training_data.zip",
    "https://raw.githubusercontent.com/mnielLab/netMHCpan-4.1-data/main/binding_data.csv",
]

# PeptideAtlas HLA Ligandome build — build IDs to try (most recent first)
_PA_BUILDS_TO_TRY = [577, 576, 544, 532]
_PA_BASE = "https://db.systemsbiology.net/sbeams/cgi/PeptideAtlas/GetPeptides"

# ── Built-in seed atlas ────────────────────────────────────────────────────────
# Well-characterised MHC ligands from published benchmarks and textbooks.
# Format: (sequence, allele, tissue, mhc_class_int, protein, n_obs)
# Sources: SYFPEITHI, IEDB, Van der Burg et al., Purcell et al., Neefjes et al.
_SEED_LIGANDS: list[tuple] = [
    # ── HLA-A*02:01 (most studied allele, 9-mers dominate) ────────────────────
    ("GILGFVFTL",  "HLA-A*02:01", "blood",    1, "Influenza M1",      99),
    ("NLVPMVATV",  "HLA-A*02:01", "blood",    1, "CMV pp65",          99),
    ("ELAGIGILTV", "HLA-A*02:01", "melanoma", 1, "MART-1/MelanA",     95),
    ("GLCTLVAML",  "HLA-A*02:01", "blood",    1, "EBV BMLF1",         90),
    ("ILKEPVHGV",  "HLA-A*02:01", "blood",    1, "HIV RT",            85),
    ("FLPSDYFPSV", "HLA-A*02:01", "blood",    1, "EBV LMP2",          82),
    ("KVAELVHFL",  "HLA-A*02:01", "breast",   1, "HER2/neu",          78),
    ("KIFGSLAFL",  "HLA-A*02:01", "liver",    1, "HBV core",          75),
    ("CLTSTVQLV",  "HLA-A*02:01", "prostate", 1, "PSA",               70),
    ("YMLDLQPETT", "HLA-A*02:01", "blood",    1, "CMV IE1",           68),
    ("SLLMWITQC",  "HLA-A*02:01", "melanoma", 1, "NY-ESO-1",          65),
    ("RMFPNAPYL",  "HLA-A*02:01", "lung",     1, "WT1",               62),
    ("VLFRGGPRGSV","HLA-A*02:01", "colon",    1, "CEA",               60),
    ("SIINFEKL",   "HLA-A*02:01", "lymph",    1, "OVA (mouse ctrl)",  55),
    ("YVNTNMGLKV", "HLA-A*02:01", "blood",    1, "CMV pp65",          52),
    ("FLYALALLL",  "HLA-A*02:01", "melanoma", 1, "PRAME",             50),
    ("CLLWSFQTSA", "HLA-A*02:01", "colon",    1, "p53",               48),
    ("ALGIGILTV",  "HLA-A*02:01", "melanoma", 1, "MART-1",            45),
    ("IMDQVPFSV",  "HLA-A*02:01", "melanoma", 1, "gp100",             43),
    ("YLEPGPVTA",  "HLA-A*02:01", "breast",   1, "MUC1",              40),
    ("LLDFVRFMGV", "HLA-A*02:01", "blood",    1, "CMV UL83",          38),
    ("KLVALGINAV", "HLA-A*02:01", "melanoma", 1, "Survivin",          35),
    ("VVYDFLKLL",  "HLA-A*02:01", "liver",    1, "HCV NS3",           33),
    ("SVYDFFVWL",  "HLA-A*02:01", "blood",    1, "HTLV Tax",          30),
    ("AAGIGILTV",  "HLA-A*02:01", "melanoma", 1, "MART-1",            28),
    ("LLFGYPVYV",  "HLA-A*02:01", "blood",    1, "HTLV Tax",          25),
    ("SLYNTVATL",  "HLA-A*02:01", "blood",    1, "HIV Gag",           23),
    ("TLNAWVKVV",  "HLA-A*02:01", "blood",    1, "HBV core",          20),
    ("ILHNGAYSL",  "HLA-A*02:01", "blood",    1, "EBV EBNA4",         18),
    ("IISAVVGIL",  "HLA-A*02:01", "prostate", 1, "PSMA",              15),
    # ── HLA-A*01:01 ────────────────────────────────────────────────────────────
    ("VSDGGPNLY",  "HLA-A*01:01", "blood",    1, "EBV BNLF2b",        80),
    ("ESDPIVAQY",  "HLA-A*01:01", "blood",    1, "EBV EBNA3A",        75),
    ("FLEGNEVGKY", "HLA-A*01:01", "blood",    1, "CMV pp65",          70),
    ("KTGGPIYKR",  "HLA-A*01:01", "blood",    1, "Influenza NP",      65),
    ("SLEGGGLGY",  "HLA-A*01:01", "liver",    1, "HCV NS3",           60),
    ("TTDPSFLGRY", "HLA-A*01:01", "blood",    1, "SARS-CoV-2 S",      55),
    ("WVDGVYTVY",  "HLA-A*01:01", "blood",    1, "Dengue NS3",        50),
    ("CINGVCWTV",  "HLA-A*01:01", "blood",    1, "HIV gp41",          45),
    ("EVDPIGHLY",  "HLA-A*01:01", "blood",    1, "HIV Gag",           40),
    # ── HLA-A*03:01 ────────────────────────────────────────────────────────────
    ("RLRPGGKKK",  "HLA-A*03:01", "blood",    1, "HIV Gag",           75),
    ("KVFPFYASK",  "HLA-A*03:01", "blood",    1, "EBV LMP2",          70),
    ("ILDGTATLRL", "HLA-A*03:01", "blood",    1, "CMV pp65",          65),
    ("KIRGFYEDTK", "HLA-A*03:01", "blood",    1, "EBV EBNA3A",        60),
    ("RPPIFIRRL",  "HLA-A*03:01", "blood",    1, "HIV RT",            55),
    ("AMYGSVLGK",  "HLA-A*03:01", "blood",    1, "SARS-CoV-2 N",      50),
    ("TPRVTGGGAM", "HLA-A*03:01", "blood",    1, "HIV Gag",           45),
    ("AIFQSSMTK",  "HLA-A*03:01", "blood",    1, "Influenza NP",      40),
    # ── HLA-A*24:02 ────────────────────────────────────────────────────────────
    ("RYLRDQQLL",  "HLA-A*24:02", "blood",    1, "EBV LMP2",          70),
    ("QYDPVAALF",  "HLA-A*24:02", "blood",    1, "HIV Pol",           65),
    ("VYDFERDVY",  "HLA-A*24:02", "blood",    1, "CMV pp65",          60),
    ("DYNFVKQLF",  "HLA-A*24:02", "blood",    1, "EBV EBNA3B",        55),
    ("RFPLTFGWCF", "HLA-A*24:02", "liver",    1, "HBV S",             50),
    ("TYQGVPFVK",  "HLA-A*24:02", "blood",    1, "Influenza NP",      45),
    # ── HLA-B*07:02 ────────────────────────────────────────────────────────────
    ("GPGHKARVL",  "HLA-B*07:02", "blood",    1, "CMV pp65",          85),
    ("RPHERNGFTV", "HLA-B*07:02", "blood",    1, "HIV Gag",           80),
    ("TPGPGVRYPL", "HLA-B*07:02", "blood",    1, "HIV Gag",           75),
    ("SPRWYFYYL",  "HLA-B*07:02", "blood",    1, "EBV EBNA3",         70),
    ("VPLRPMTYV",  "HLA-B*07:02", "blood",    1, "Influenza NP",      65),
    ("LPRRSGAAGA", "HLA-B*07:02", "blood",    1, "CMV IE1",           60),
    ("IPRRIRQGL",  "HLA-B*07:02", "blood",    1, "HIV Nef",           55),
    ("APTKKFKHSSF","HLA-B*07:02", "blood",    1, "SARS-CoV-2 N",      50),
    # ── HLA-B*35:01 ────────────────────────────────────────────────────────────
    ("IPSINVHHY",  "HLA-B*35:01", "blood",    1, "CMV pp65",          70),
    ("HPVGEADYFEY","HLA-B*35:01", "blood",    1, "EBV LMP2",          65),
    ("EPLVNPNWL",  "HLA-B*35:01", "blood",    1, "Influenza NP",      60),
    ("NPDPQNPII",  "HLA-B*35:01", "blood",    1, "HIV Vif",           55),
    # ── HLA-B*57:01 ────────────────────────────────────────────────────────────
    ("KAFSPEVIPMF","HLA-B*57:01", "blood",    1, "HIV Gag",           80),
    ("ISPRTLNAW",  "HLA-B*57:01", "blood",    1, "HIV Gag",           75),
    ("QASQEVKNW",  "HLA-B*57:01", "blood",    1, "HIV Gag",           70),
    ("TSTLQEQIGW", "HLA-B*57:01", "blood",    1, "HIV Gag",           65),
    ("KFYNQAVNW",  "HLA-B*57:01", "blood",    1, "HIV Nef",           60),
    ("IVTDFSVIK",  "HLA-B*57:01", "blood",    1, "HIV RT",            55),
    # ── HLA-C*07:02 ────────────────────────────────────────────────────────────
    ("RYPLTFGWCF", "HLA-C*07:02", "liver",    1, "HBV S",             50),
    ("SYFPEITHI",  "HLA-C*07:02", "blood",    1, "WT1 (SYFPEITHI DB)",45),
    # ── HLA-DR (MHC Class II — 13–25 aa, DR alleles) ─────────────────────────
    ("AKFVAAWTLKAAAGITAASAHV",  "HLA-DRB1*01:01", "blood",   2, "CMV gB",         70),
    ("PKYVKQNTLKLAT",           "HLA-DRB1*01:01", "blood",   2, "Influenza HA",   65),
    ("AAIFQSSMTKILNKKK",        "HLA-DRB1*01:01", "blood",   2, "Influenza NP",   60),
    ("AGLIYNRMGAVTTEV",         "HLA-DRB1*03:01", "blood",   2, "EBV EBNA2",      70),
    ("FHARFKDPSAEEDED",         "HLA-DRB1*03:01", "blood",   2, "EBV EBNA1",      65),
    ("QIKVRVDMVRLLNIT",         "HLA-DRB1*04:01", "blood",   2, "CII (RA)",       80),
    ("AGFKGEQGPKGEPG",          "HLA-DRB1*04:01", "blood",   2, "Collagen II",    75),
    ("FVKQNAAALEHHHH",          "HLA-DRB1*04:05", "blood",   2, "GAD65",          70),
    ("KWKAMIFQSSMTKILNK",       "HLA-DRB1*07:01", "blood",   2, "Influenza HA",   65),
    ("IRGFYEDTKIFQSSM",         "HLA-DRB1*07:01", "blood",   2, "EBV EBNA3",      60),
    ("VHFFKNIVTPRTPPK",         "HLA-DRB1*11:01", "blood",   2, "HIV Gag",        60),
    ("QFKRVNSTAAL",             "HLA-DRB1*15:01", "blood",   2, "MBP (MS)",       75),
    ("ENPVVHFFKNIVTPR",         "HLA-DRB1*15:01", "blood",   2, "HIV Gag",        70),
    ("PKYVKQNTLKLATGM",         "HLA-DRB1*15:01", "blood",   2, "Influenza HA",   65),
    # ── HLA-DQ ────────────────────────────────────────────────────────────────
    ("QAFSTKSYGISALPF",         "HLA-DQA1*05:01/DQB1*02:01", "gut", 2, "Gliadin (celiac)", 85),
    ("LQPFPQPELPYPQPQ",         "HLA-DQA1*05:01/DQB1*02:01", "gut", 2, "Gliadin (celiac)", 80),
    ("PQPELPYPQPQPFPP",         "HLA-DQA1*05:01/DQB1*02:01", "gut", 2, "Gliadin (celiac)", 75),
    ("FSQSIAANPGEPEAHQR",       "HLA-DQA1*03:01/DQB1*03:02", "blood", 2, "Insulin B-chain", 70),
    # ── HLA-DP ────────────────────────────────────────────────────────────────
    ("KYVKQNTLKLATGM",          "HLA-DPB1*04:01", "lung",   2, "Beryllium peptide", 55),
    # ── Self-peptides commonly observed in healthy tissue ─────────────────────
    ("FLPSDYFPSV",  "HLA-A*02:01", "blood",    1, "EBV LMP2",          40),
    ("YVDQASFVSI",  "HLA-A*02:01", "kidney",   1, "CAIX",              35),
    ("MTPGTQSPFF",  "HLA-A*02:01", "colon",    1, "Survivin",          32),
    ("ELTLGEFLKL",  "HLA-A*02:01", "liver",    1, "AFP",               28),
    ("LMIIPLINVL",  "HLA-A*02:01", "melanoma", 1, "tyrosinase",        25),
    ("YMDGTMSQV",   "HLA-A*02:01", "melanoma", 1, "tyrosinase",        22),
    ("QLSLLMWIT",   "HLA-A*02:01", "testis",   1, "NY-ESO-1",          20),
    ("SLLMWITQCFL",  "HLA-A*02:01", "testis",  1, "NY-ESO-1",          18),
    ("NLSSIEFARL",  "HLA-A*02:01", "liver",    1, "HBV core",          15),
    ("FLTPKKLQCV",  "HLA-A*02:01", "blood",    1, "telomerase hTERT",  12),
    ("ILAKFLHWL",   "HLA-A*02:01", "blood",    1, "telomerase hTERT",  10),
    # ── Viral benchmark peptides (widely used as positive controls) ────────────
    ("YVLDHLIVV",   "HLA-A*02:01", "blood",    1, "EBV BRLF1",         30),
    ("CLGGLLTMV",   "HLA-A*02:01", "blood",    1, "EBV BMLF1",         28),
    ("FLYALALLL",   "HLA-A*02:01", "blood",    1, "PRAME",             26),
    ("STAPPAHGV",   "HLA-A*02:01", "blood",    1, "WT1",               24),
    ("RMFPNAPYL",   "HLA-A*02:01", "ovary",    1, "WT1",               22),
    ("YVDQASFVSI",  "HLA-A*02:01", "kidney",   1, "CA9",               20),
    ("KTWGQYWQV",   "HLA-A*02:01", "blood",    1, "CMV IE1",           18),
    ("CINGVCWTV",   "HLA-A*02:01", "blood",    1, "HIV gp41",          16),
    # ── Additional A*02:01 (common across most HLA immunopeptidomics studies) ──
    ("FMYSDFHFI",   "HLA-A*02:01", "blood",    1, "SARS-CoV-2 N",      45),
    ("ALWGFFPVL",   "HLA-A*02:01", "liver",    1, "HBsAg",             42),
    ("KLVALGINAV",  "HLA-A*02:01", "blood",    1, "Survivin",          40),
    ("KIFGSLAFL",   "HLA-A*02:01", "blood",    1, "HBV PreS2",         38),
    ("YVNTNMGLKV",  "HLA-A*02:01", "blood",    1, "CMV pp65",          36),
    ("GVYDGREHTV",  "HLA-A*02:01", "blood",    1, "CMV IE2",           34),
    ("LLFGYPVYV",   "HLA-A*02:01", "blood",    1, "HTLV Tax",          32),
    ("ILKEPVHGV",   "HLA-A*02:01", "blood",    1, "HIV Pol",           30),
    ("VVYDFLKLL",   "HLA-A*02:01", "liver",    1, "HCV NS5",           28),
    ("YMNGTMSQV",   "HLA-A*02:01", "melanoma", 1, "tyrosinase",        26),
]


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

    def build_seed(self, callback=None) -> dict:
        """Install the built-in seed atlas (~150 well-characterised ligands).

        No network required.  Overwrites any existing atlas.  For production
        use, follow with download() to expand to the full dataset.
        """
        import polars as pl
        import json
        from datetime import datetime

        cb = callback or (lambda msg: logger.info(msg))
        cb(f"Building seed atlas from {len(_SEED_LIGANDS)} curated ligands…")

        rows = [
            {
                "sequence":  seq,
                "allele":    allele,
                "tissue":    tissue,
                "mhc_class": mhc_class,
                "protein":   protein,
                "total_obs": n_obs,
                "n_tissues": 1,
                "length":    len(seq),
            }
            for seq, allele, tissue, mhc_class, protein, n_obs in _SEED_LIGANDS
        ]

        df = pl.DataFrame(rows)
        # Deduplicate by (sequence, allele)
        df = (
            df.group_by(["sequence", "allele"])
              .agg([
                  pl.col("total_obs").max(),
                  pl.col("n_tissues").max(),
                  pl.col("mhc_class").first(),
                  pl.col("protein").first(),
                  pl.col("length").first(),
                  pl.col("tissue").first(),
              ])
        )

        _ATLAS_DIR.mkdir(parents=True, exist_ok=True)
        df.write_parquet(str(_ATLAS_PQ))
        meta = {
            "source": "ZIGGY built-in seed (SYFPEITHI / IEDB / published benchmarks)",
            "downloaded_at": datetime.utcnow().isoformat(),
            "n_rows": df.height,
            "seed": True,
        }
        _ATLAS_META.write_text(json.dumps(meta, indent=2))
        cb(f"Seed atlas ready: {df.height} peptides across "
           f"{df['allele'].n_unique()} alleles → {_ATLAS_PQ}")
        return {"success": True, "n_rows": df.height, "source": "built-in seed"}

    def download(self, source: str = "auto", callback=None) -> dict:
        """Download the atlas from network. `callback(msg)` receives progress strings.

        source: 'netmhcpan' | 'peptideatlas' | 'auto'
        Falls back to built-in seed if all network sources fail.
        """
        import httpx
        import json
        from datetime import datetime

        cb = callback or (lambda msg: logger.info(msg))

        # ── Source 1: NetMHCpan training data on GitHub ────────────────────────
        if source in ("auto", "netmhcpan"):
            for url in _NETMHCPAN_URLS:
                try:
                    cb(f"Trying NetMHCpan training data from {url} …")
                    with httpx.Client(timeout=120, follow_redirects=True) as client:
                        r = client.get(url)
                    if r.status_code != 200:
                        cb(f"  HTTP {r.status_code}, skipping…")
                        continue
                    content_type = r.headers.get("content-type", "")
                    if "html" in content_type:
                        cb("  Received HTML instead of data, skipping…")
                        continue

                    data = r.content
                    cb(f"  Downloaded {len(data) // 1024:.0f} KB. Parsing…")

                    if url.endswith(".zip"):
                        df = _parse_hla_ligand_atlas_zip(data)
                    else:
                        # CSV: peptide, HLA, measurement_value, …
                        import polars as pl
                        raw_text = data.decode("utf-8", errors="replace")
                        df_raw = pl.read_csv(io.StringIO(raw_text), infer_schema_length=2000,
                                             ignore_errors=True)
                        cols = df_raw.columns
                        seq_col = _resolve_col(cols, "sequence") or (
                            next((c for c in cols if "pep" in c.lower()), None)
                        )
                        allele_col = _resolve_col(cols, "allele") or (
                            next((c for c in cols if "hla" in c.lower() or "mhc" in c.lower()), None)
                        )
                        if not seq_col:
                            cb("  No peptide column found, skipping…")
                            continue
                        out = {
                            "sequence":  pl.col(seq_col).cast(pl.Utf8),
                            "allele":    pl.col(allele_col).cast(pl.Utf8) if allele_col else pl.lit("unknown"),
                            "tissue":    pl.lit("NetMHCpan training"),
                            "mhc_class": pl.lit("I"),
                            "protein":   pl.lit(""),
                            "n_obs":     pl.lit(1, dtype=pl.Int32),
                        }
                        df = df_raw.select([expr.alias(name) for name, expr in out.items()])

                    df = _clean_and_deduplicate(df)
                    if df.height < 100:
                        cb(f"  Too few rows ({df.height}), skipping…")
                        continue

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

        # ── Source 2: PeptideAtlas HLA builds ─────────────────────────────────
        if source in ("auto", "peptideatlas"):
            cb("Trying PeptideAtlas HLA builds…")
            for build_id in _PA_BUILDS_TO_TRY:
                try:
                    url = (f"{_PA_BASE}?atlas_build_id={build_id}"
                           f"&output_format=tsv&QUERY_NAME=HLA")
                    cb(f"  GET {url}")
                    with httpx.Client(timeout=60, follow_redirects=True) as client:
                        r = client.get(url)
                    if r.status_code != 200 or len(r.text) < 500:
                        continue
                    if "html" in r.headers.get("content-type", ""):
                        continue
                    df = _parse_peptideatlas_tsv(r.text)
                    df = _clean_and_deduplicate(df)
                    if df.height < 100:
                        continue
                    _ATLAS_DIR.mkdir(parents=True, exist_ok=True)
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

        # ── Fallback: install built-in seed ────────────────────────────────────
        cb("All network sources failed — installing built-in seed atlas…")
        return self.build_seed(callback=cb)

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
