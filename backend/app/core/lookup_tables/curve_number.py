"""
Standard SCS/NRCS Curve Number lookup table (condensed from USDA TR-55 Table 2-2c),
keyed by simplified land-use category and Hydrologic Soil Group (HSG: A, B, C, D).

HSG meaning (infiltration capacity, A = highest infiltration/lowest runoff):
  A: sand, loamy sand, sandy loam
  B: silt loam, loam
  C: sandy clay loam
  D: clay loam, silty clay, clay, or very shallow soil over bedrock

Replace/extend LAND_USE_ALIAS_MAP once the real Bhuvan LULC class names for your
target state are known -- map them onto the keys of CURVE_NUMBER_TABLE below.
"""

CURVE_NUMBER_TABLE = {
    "forest_good": {"A": 30, "B": 55, "C": 70, "D": 77},
    "forest_fair": {"A": 36, "B": 60, "C": 73, "D": 79},
    "forest_poor": {"A": 45, "B": 66, "C": 77, "D": 83},
    "scrub_good": {"A": 30, "B": 48, "C": 65, "D": 73},
    "scrub_fair": {"A": 35, "B": 56, "C": 70, "D": 77},
    "pasture_good": {"A": 30, "B": 58, "C": 71, "D": 78},
    "pasture_fair": {"A": 49, "B": 69, "C": 79, "D": 84},
    "agriculture_row_crop": {"A": 67, "B": 78, "C": 85, "D": 89},
    "fallow_bare_soil": {"A": 77, "B": 86, "C": 91, "D": 94},
    "built_up_residential": {"A": 77, "B": 85, "C": 90, "D": 92},
    "water_wetland": {"A": 98, "B": 98, "C": 98, "D": 98},
}

# Map raw land-use labels (e.g. from Bhuvan LULC / india-geodata repo) onto the
# simplified categories above. EXTEND THIS once you inspect the real layer's
# attribute values -- these are best-guess defaults.
LAND_USE_ALIAS_MAP = {
    "dense forest": "forest_good",
    "open forest": "forest_fair",
    "degraded forest": "forest_poor",
    "scrub land": "scrub_fair",
    "grassland": "pasture_fair",
    "agricultural land": "agriculture_row_crop",
    "cropland": "agriculture_row_crop",
    "fallow land": "fallow_bare_soil",
    "barren land": "fallow_bare_soil",
    "built-up": "built_up_residential",
    "settlement": "built_up_residential",
    "water body": "water_wetland",
    "wetland": "water_wetland",
}


def normalize_land_use(raw_label: str) -> str:
    """Map a raw land-use label to a key in CURVE_NUMBER_TABLE. Defaults to
    'pasture_fair' (a moderate, middle-of-the-road value) if unrecognized."""
    key = raw_label.strip().lower()
    return LAND_USE_ALIAS_MAP.get(key, "pasture_fair")


def get_curve_number(land_use_label: str, hydrologic_soil_group: str) -> int:
    """Look up the AMC-II (normal condition) Curve Number.

    Args:
        land_use_label: raw or normalized land-use label.
        hydrologic_soil_group: one of "A", "B", "C", "D".
    """
    hsg = hydrologic_soil_group.strip().upper()
    if hsg not in ("A", "B", "C", "D"):
        raise ValueError(f"Invalid hydrologic soil group: {hydrologic_soil_group}")

    category = land_use_label if land_use_label in CURVE_NUMBER_TABLE else normalize_land_use(land_use_label)
    return CURVE_NUMBER_TABLE[category][hsg]
