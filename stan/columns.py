"""LC column catalog — prefilled list of columns from major vendors.

Used by the setup wizard and tracked per instrument for community benchmarking.
Column choice significantly affects chromatographic performance and is an important
variable when comparing QC metrics across labs.
"""

from __future__ import annotations

# ── Column catalog ──────────────────────────────────────────────────
# Organized by vendor. Each entry has model name, length, ID, particle size,
# and compatible LC systems.

COLUMN_CATALOG: dict[str, list[dict]] = {
    "Evosep": [
        # Endurance columns (high-throughput, 200/300/500 SPD)
        {"model": "Endurance 4cm x 150um, 1.9um C18", "id": "EV1107", "length_cm": 4, "id_um": 150, "particle_um": 1.9},
        {"model": "Endurance OE 4cm x 150um, 1.9um C18", "id": "EV1114", "length_cm": 4, "id_um": 150, "particle_um": 1.9},
        # Performance columns (60/100 SPD)
        {"model": "Performance 8cm x 150um, 1.9um C18", "id": "EV1137", "length_cm": 8, "id_um": 150, "particle_um": 1.9},
        {"model": "Performance 15cm x 150um, 1.9um C18", "id": "EV1106", "length_cm": 15, "id_um": 150, "particle_um": 1.9},
        {"model": "Performance 15cm x 75um, 1.9um C18", "id": "EV1112", "length_cm": 15, "id_um": 75, "particle_um": 1.9},
        {"model": "Performance 8cm x 100um, 1.9um C18", "id": "EV1109", "length_cm": 8, "id_um": 100, "particle_um": 1.9},
        {"model": "Performance OE 15cm x 150um, 1.9um C18", "id": "EV2005", "length_cm": 15, "id_um": 150, "particle_um": 1.9},
        # Whisper columns (low-flow, 20/40 SPD)
        {"model": "Whisper 20cm x 75um, 1.9um C18", "id": "EV1113", "length_cm": 20, "id_um": 75, "particle_um": 1.9},
    ],
    "IonOpticks": [
        # Aurora series
        {"model": "Aurora Ultimate 15cm x 75um, 1.7um C18", "id": "AUR3-15075C18U", "length_cm": 15, "id_um": 75, "particle_um": 1.7},
        {"model": "Aurora Ultimate 25cm x 75um, 1.7um C18", "id": "AUR3-25075C18U", "length_cm": 25, "id_um": 75, "particle_um": 1.7},
        {"model": "Aurora Elite 15cm x 75um, 1.7um C18", "id": "AUR2-15075C18A", "length_cm": 15, "id_um": 75, "particle_um": 1.7},
        {"model": "Aurora Elite 25cm x 75um, 1.7um C18", "id": "AUR2-25075C18A", "length_cm": 25, "id_um": 75, "particle_um": 1.7},
        {"model": "Aurora Series 15cm x 75um, 1.6um C18", "id": "AUR-15075C18A", "length_cm": 15, "id_um": 75, "particle_um": 1.6},
        {"model": "Aurora Series 25cm x 75um, 1.6um C18", "id": "AUR-25075C18A", "length_cm": 25, "id_um": 75, "particle_um": 1.6},
    ],
    "PepSep": [
        # PepSep Ultra (UHP/nanoConnect, 150µm ID, 1.5µm ReproSil — ordered as PSC-xx-150-15-UHP-nC)
        # High-throughput wide-bore format for fast loading on nanoElute 2 / proteoElute
        {"model": "PepSep Ultra 10cm x 150um, 1.5um ReproSil C18", "id": "PSC-10-150-15-UHP-nC", "length_cm": 10, "id_um": 150, "particle_um": 1.5},
        {"model": "PepSep Ultra 15cm x 150um, 1.5um ReproSil C18", "id": "PSC-15-150-15-UHP-nC", "length_cm": 15, "id_um": 150, "particle_um": 1.5},
        {"model": "PepSep Ultra 25cm x 150um, 1.5um ReproSil C18", "id": "PSC-25-150-15-UHP-nC", "length_cm": 25, "id_um": 150, "particle_um": 1.5},
        # Bruker/PepSep OEM — PepSeal connector (for direct timsTOF spray connection)
        # BRKR[length×10][ID][particle×10]PepSeal e.g. BRKR157515 = 15cm×75µm×1.5µm
        {"model": "PepSep Advance 15cm x 75um, 1.5um ReproSil C18 (PepSeal)", "id": "BRKR157515PepSeal", "length_cm": 15, "id_um": 75, "particle_um": 1.5},
        {"model": "PepSep Advance 25cm x 75um, 1.5um ReproSil C18 (PepSeal)", "id": "BRKR257515PepSeal", "length_cm": 25, "id_um": 75, "particle_um": 1.5},
        {"model": "PepSep Advance 15cm x 50um, 1.5um ReproSil C18 (PepSeal)", "id": "BRKR155015PepSeal", "length_cm": 15, "id_um": 50, "particle_um": 1.5},
        {"model": "PepSep Advance 25cm x 50um, 1.5um ReproSil C18 (PepSeal)", "id": "BRKR255015PepSeal", "length_cm": 25, "id_um": 50, "particle_um": 1.5},
        # PepSep Pro — standard nanoLC format, 1.9µm ReproSil C18
        {"model": "PepSep Pro 15cm x 75um, 1.9um ReproSil C18", "id": "PSP-15075C18", "length_cm": 15, "id_um": 75, "particle_um": 1.9},
        {"model": "PepSep Pro 25cm x 75um, 1.9um ReproSil C18", "id": "PSP-25075C18", "length_cm": 25, "id_um": 75, "particle_um": 1.9},
        {"model": "PepSep Pro 15cm x 150um, 1.9um ReproSil C18", "id": "PSP-15150C18", "length_cm": 15, "id_um": 150, "particle_um": 1.9},
        {"model": "PepSep Pro 25cm x 150um, 1.9um ReproSil C18", "id": "PSP-25150C18", "length_cm": 25, "id_um": 150, "particle_um": 1.9},
        {"model": "PepSep Pro 50cm x 75um, 1.9um ReproSil C18", "id": "PSP-50075C18", "length_cm": 50, "id_um": 75, "particle_um": 1.9},
    ],
    "Thermo": [
        {"model": "PepMap Neo 15cm x 75um, 2um C18", "id": "TFS-PN15075C18", "length_cm": 15, "id_um": 75, "particle_um": 2.0},
        {"model": "PepMap Neo 25cm x 75um, 2um C18", "id": "TFS-PN25075C18", "length_cm": 25, "id_um": 75, "particle_um": 2.0},
        {"model": "PepMap Neo 50cm x 75um, 2um C18", "id": "TFS-PN50075C18", "length_cm": 50, "id_um": 75, "particle_um": 2.0},
        {"model": "Easy-Spray 15cm x 75um, 3um C18", "id": "ES800", "length_cm": 15, "id_um": 75, "particle_um": 3.0},
        {"model": "Easy-Spray 25cm x 75um, 2um C18", "id": "ES902", "length_cm": 25, "id_um": 75, "particle_um": 2.0},
        {"model": "Easy-Spray 50cm x 75um, 2um C18", "id": "ES903", "length_cm": 50, "id_um": 75, "particle_um": 2.0},
    ],
}


def get_all_columns_flat() -> list[dict]:
    """Return a flat list of all columns with vendor added."""
    result = []
    for vendor, columns in COLUMN_CATALOG.items():
        for col in columns:
            result.append({**col, "vendor": vendor})
    return result


def get_column_display_list() -> list[str]:
    """Return a flat list of display strings for the setup wizard."""
    result = []
    for vendor, columns in COLUMN_CATALOG.items():
        for col in columns:
            result.append(f"{vendor} — {col['model']}")
    result.append("Other / custom column")
    return result


def parse_column_choice(display: str) -> dict:
    """Parse a display string back to vendor + model."""
    if display == "Other / custom column":
        return {"vendor": "other", "model": "custom"}
    parts = display.split(" — ", 1)
    if len(parts) == 2:
        return {"vendor": parts[0], "model": parts[1]}
    return {"vendor": "unknown", "model": display}
