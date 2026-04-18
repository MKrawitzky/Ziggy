"""Bruker 4DFF (Universal Feature Finder) integration — auto feature finding.

After a Bruker .d acquisition is stable and the search completes, STAN can
automatically run 4DFF to produce a .features SQLite file.  This populates
the Ion Mobility tab in the dashboard without any manual steps.

Opt-in per instrument in instruments.yml::

    instruments:
      - name: "timsTOF Pro"
        vendor: bruker
        fourdff_enabled: true
        fourdff_path: "C:/Bruker/4DFF/4DFF.exe"   # required — path to standalone CLI
        fourdff_output_dir: "D:/stan_features"     # optional — defaults to same dir as .d

The .features file is written to fourdff_output_dir (or the parent dir of the
.d if not set) and the path is stored in the run's DB row so the Ion Mobility
tab can find it without searching the filesystem.

CLI invocation assumed::

    4DFF.exe <config_file>

where the config file uses Bruker key=value format (same as the reference
config in docs/4dff_proteomics_reference.config).

NOTE: The standalone 4DFF CLI is a separate Bruker download from the
DataAnalysis plugin.  Set fourdff_path to the path of the standalone exe.
"""

from __future__ import annotations

import logging
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

logger = logging.getLogger(__name__)

# Minimal proteomics config — enables .features output with sensible defaults.
# Mirrors the key TIMS clustering parameters from docs/4dff_proteomics_reference.config.
_CONFIG_TEMPLATE = """\
input={d_path}

### MGF output — disabled (we only need .features)
# MgfOutput.enable

### .features output
FeatureWriter.enable

### Workflow
Workflow.substanceClass=peptides
Workflow.massToleranceUnit=Da

### Recalibration — use instrument calibration (no reference masses needed)
Workflow.calibrationMode=off

### Clustering
Clustering.minClusterLength=5
Clustering.splitFactor=1.3
LcmsClustering.massTolerance=0.009
TimsClustering.clusteringHeuristic=10
TimsClustering.minClusterSize=50
TimsClustering.calculateSplitDelta
TimsClustering.minMaxSplitDelta=3.0
TimsClustering.mobilityDistance=0.01
TimsClustering.mzDistance=0.007
TimsClustering.mzTolerance=0.4
TimsClustering.rtDistanceInFrames=3

### Deisotoping
MsDeisotoping.absoluteAbundanceThreshold=0
MsDeisotoping.upperCharge=5
MsDeisotoping.massTolerance=0.007
MsDeisotoping.minCorrelatedFraction=0.75
MsDeisotoping.minCorrelation=0.75
MsDeisotoping.minExistFraction=0.75
MsDeisotoping.minNumClusters=3
MsDeisotoping.minNumClusters_enforce=2
MsDeisotoping.featureIntervalMethod=BoundingBox
"""


def run_4dff(
    d_path: Path,
    exe_path: str | Path,
    output_dir: Path | None = None,
) -> Path | None:
    """Run 4DFF synchronously on a .d directory and return the .features path.

    Args:
        d_path:     Path to the Bruker .d acquisition directory.
        exe_path:   Path to the standalone 4DFF CLI executable.
        output_dir: Directory to move the .features file into after 4DFF
                    completes.  If None, the .features file stays in
                    d_path.parent (4DFF's default output location).

    Returns:
        Path to the .features file on success, None on failure.
    """
    exe = Path(exe_path)
    if not exe.exists():
        logger.error("4DFF exe not found: %s", exe)
        return None

    d_path = Path(d_path)
    if not d_path.exists():
        logger.error("4DFF: .d directory not found: %s", d_path)
        return None

    # Write a temp config file — 4DFF CLI takes a config file path as its sole argument
    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".config",
        prefix="stan_4dff_",
        delete=False,
        encoding="utf-8",
    ) as f:
        f.write(_CONFIG_TEMPLATE.format(d_path=str(d_path)))
        config_path = Path(f.name)

    try:
        logger.info("4DFF: starting feature finding for %s", d_path.name)
        logger.debug("4DFF config: %s", config_path)

        result = subprocess.run(
            [str(exe), str(config_path)],
            capture_output=True,
            text=True,
            timeout=3600,  # 1-hour ceiling — feature finding can take a while
        )

        if result.returncode != 0:
            logger.error(
                "4DFF failed (exit %d):\n%s",
                result.returncode,
                (result.stderr or result.stdout)[-2000:],
            )
            return None

        # 4DFF writes <stem>.features to the parent directory of the .d folder
        default_out = d_path.parent / f"{d_path.stem}.features"
        if not default_out.exists():
            logger.error(
                "4DFF completed (exit 0) but .features not found at %s", default_out
            )
            return None

        logger.info("4DFF: .features written to %s", default_out)

        # Move to output_dir if requested
        if output_dir:
            output_dir = Path(output_dir)
            output_dir.mkdir(parents=True, exist_ok=True)
            dest = output_dir / default_out.name
            try:
                shutil.move(str(default_out), str(dest))
                logger.info("4DFF: moved .features to %s", dest)
                return dest
            except Exception:
                logger.exception("4DFF: failed to move .features — using original location")
                return default_out

        return default_out

    except subprocess.TimeoutExpired:
        logger.error("4DFF timed out after 3600 s for %s", d_path.name)
        return None
    except Exception:
        logger.exception("4DFF: unexpected error for %s", d_path.name)
        return None
    finally:
        config_path.unlink(missing_ok=True)


def run_4dff_async(
    raw_path: Path,
    exe_path: str | Path,
    run_id: str | None = None,
    output_dir: Path | None = None,
) -> None:
    """Launch 4DFF in a background thread and store the result in the DB.

    Safe to call from the watcher daemon — returns immediately.

    Args:
        raw_path:   Path to the .d directory.
        exe_path:   Path to the standalone 4DFF CLI executable.
        run_id:     STAN run ID to update with the features_path on completion.
        output_dir: Optional directory to move the .features file into.
    """
    def _worker() -> None:
        features_path = run_4dff(raw_path, exe_path=exe_path, output_dir=output_dir)
        if features_path and run_id:
            try:
                from stan.db import update_features_path
                update_features_path(run_id, str(features_path))
                logger.info(
                    "4DFF: stored features_path for run %s → %s", run_id, features_path.name
                )
            except Exception:
                logger.exception("4DFF: failed to update run %s with features path", run_id)

    thread = threading.Thread(
        target=_worker,
        name=f"4dff-{raw_path.stem}",
        daemon=True,
    )
    thread.start()
    logger.info("4DFF: background feature finding started for %s", raw_path.name)
