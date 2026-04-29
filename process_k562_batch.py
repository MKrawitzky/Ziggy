"""
Batch DIA-NN processing for K562 PepSep runs missing n_proteins.
Uses same parameters as existing processed runs (from report.log.txt).
"""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pandas as pd

DB_PATH = Path("E:/STAN/stan.db")
DIANN = Path("C:/DIA-NN/2.3.2/diann.exe")
RESULTS_DIR = Path("E:/timsTOF/stan_results")
LIB = RESULTS_DIR / "_community_assets/hela_timstof_202604.parquet"
FASTA = RESULTS_DIR / "_community_assets/human_hela_202604.fasta"

DIANN_ARGS = [
    "--qvalue", "0.01",
    "--min-pep-len", "7",
    "--max-pep-len", "30",
    "--missed-cleavages", "1",
    "--min-pr-charge", "2",
    "--max-pr-charge", "4",
    "--cut", "K*,R*",
    "--threads", "8",
    "--lib", str(LIB),
    "--fasta", str(FASTA),
]


def get_n_proteins(report_parquet: Path) -> int | None:
    try:
        df = pd.read_parquet(report_parquet)
        if "Protein.Group" in df.columns and "Q.Value" in df.columns:
            return int(df[df["Q.Value"] < 0.01]["Protein.Group"].nunique())
        elif "Protein.Group" in df.columns:
            return int(df["Protein.Group"].nunique())
    except Exception as e:
        print(f"  [warn] Could not read parquet: {e}")
    return None


def update_db(run_id: str, n_proteins: int, result_path: str) -> None:
    with sqlite3.connect(str(DB_PATH)) as con:
        con.execute(
            "UPDATE runs SET n_proteins = ?, result_path = ? WHERE id = ?",
            (n_proteins, result_path, run_id),
        )


def main():
    # Get unprocessed K562 runs
    with sqlite3.connect(str(DB_PATH)) as con:
        con.row_factory = sqlite3.Row
        rows = con.execute(
            "SELECT id, run_name, raw_path FROM runs "
            "WHERE run_name LIKE 'K562_%' AND n_proteins IS NULL "
            "ORDER BY run_name"
        ).fetchall()

    print(f"Found {len(rows)} runs to process")
    print()

    success = 0
    failed = 0

    for i, row in enumerate(rows, 1):
        run_id = row["id"]
        run_name = row["run_name"]
        raw_path = Path(row["raw_path"])
        stem = run_name.replace(".d", "")
        out_dir = RESULTS_DIR / stem
        out_parquet = out_dir / "report.parquet"

        print(f"[{i}/{len(rows)}] {run_name}")

        if not raw_path.exists():
            print(f"  SKIP — raw file not found: {raw_path}")
            failed += 1
            continue

        out_dir.mkdir(parents=True, exist_ok=True)

        cmd = [
            str(DIANN),
            "--f", str(raw_path),
            "--out", str(out_parquet),
        ] + DIANN_ARGS

        result = subprocess.run(cmd, capture_output=True, text=True)

        if result.returncode != 0 or not out_parquet.exists():
            print(f"  FAILED (exit {result.returncode})")
            # Print last 5 lines of stderr for diagnosis
            for line in result.stderr.strip().split("\n")[-5:]:
                print(f"    {line}")
            failed += 1
            continue

        n = get_n_proteins(out_parquet)
        if n is None:
            print(f"  FAILED — could not read report.parquet")
            failed += 1
            continue

        update_db(run_id, n, str(out_parquet))
        print(f"  OK — {n} protein groups")
        success += 1

    print()
    print(f"Done: {success} succeeded, {failed} failed")


if __name__ == "__main__":
    main()
