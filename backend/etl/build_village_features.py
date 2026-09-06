"""One-time geospatial ETL for a pilot region.

Hydrological features are generated per sub-catchment; administrative and
exposure features are generated per village. Outputs are compact JSON files,
so the running FastAPI service needs no database.

Required raw layers:
- DEM: Bhuvan Cartosat, SRTM, or ALOS PALSAR
- villages and watersheds/sub-catchments: india-geodata/LGD/Bhuvan/SOI
- land use, soil classification, and rivers/streams: india-geodata/Bhuvan
- historical events: GSI Bhukosh/flood inventory, optional calibration only
"""
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR = PROJECT_ROOT / "data" / "raw"
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"
VILLAGES_OUTPUT = PROCESSED_DIR / "villages.json"
CATCHMENTS_OUTPUT = PROCESSED_DIR / "catchments.json"

DEM_PATH = RAW_DIR / "dem.tif"
VILLAGES_PATH = RAW_DIR / "villages.geojson"
CATCHMENTS_PATH = RAW_DIR / "catchments.geojson"
LAND_USE_PATH = RAW_DIR / "land_use.geojson"
SOIL_PATH = RAW_DIR / "soil_classification.geojson"
RIVERS_PATH = RAW_DIR / "rivers.geojson"
HISTORICAL_EVENTS_PATH = RAW_DIR / "historical_events.geojson"


def build_features() -> None:
    """Build the two JSON datasets expected by the backend.

    Implementation steps once pilot files and their actual column names are
    known:

    Catchment output (`catchments.json`)
    1. Load/reproject every layer into one local metric CRS.
    2. Derive slope, D8 flow direction, flow accumulation, and drainage paths
       from the DEM. Use supplied watershed polygons or delineate sub-catchments.
    3. Compute catchment area, longest flow path, and channel slope.
    4. Spatially aggregate land-use + hydrologic-soil combinations and compute
       an area-weighted Curve Number category/HSG.
    5. Assign a pilot rainfall trigger threshold; calibrate later where verified
       events or channel observations are available.

    Village output (`villages.json`)
    6. Map each village centroid/outlet to its containing or draining catchment.
    7. Compute local mean/max slope and distance to the derived stream network.
    8. Add historical event count only where reliable geotagged evidence exists;
       this field is optional and does not drive the baseline physics score.
    9. Export compact JSON records matching the demo file schemas.

    GeoPandas/Rasterio are intentionally ETL-only dependencies. Do not add a
    runtime database unless the pilot dataset later becomes too large for files.
    """
    missing = [
        path for path in (
            DEM_PATH,
            VILLAGES_PATH,
            CATCHMENTS_PATH,
            LAND_USE_PATH,
            SOIL_PATH,
            RIVERS_PATH,
        ) if not path.exists()
    ]
    if missing:
        formatted = "\n".join(f"- {path}" for path in missing)
        raise FileNotFoundError(f"Download/configure the pilot input layers first:\n{formatted}")

    raise NotImplementedError(
        "Input files exist, but their attribute columns must be mapped for the "
        "chosen pilot region before implementing the GeoPandas/Rasterio joins."
    )


if __name__ == "__main__":
    build_features()
