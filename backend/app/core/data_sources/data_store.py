"""Small file-backed data store for the hackathon MVP.

Processed regional data is kept as JSON so the backend has no database
runtime dependency. The one-time geospatial ETL can still use GeoPandas and
Rasterio, but its output is reduced to compact records consumed here.
"""
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[4]
PROCESSED_DATA_DIR = PROJECT_ROOT / "data" / "processed"


class DataStoreError(RuntimeError):
    pass


def _load_json(filename: str, demo_filename: str) -> Any:
    path = PROCESSED_DATA_DIR / filename
    if not path.exists():
        path = PROCESSED_DATA_DIR / demo_filename
    if not path.exists():
        raise DataStoreError(
            f"Neither processed nor demo data file exists: {filename}, {demo_filename}"
        )
    try:
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except json.JSONDecodeError as exc:
        raise DataStoreError(f"Invalid JSON in {path}: {exc}") from exc


@lru_cache(maxsize=1)
def load_villages() -> list[dict]:
    return _load_json("villages.json", "demo_villages.json")


@lru_cache(maxsize=1)
def load_catchments() -> list[dict]:
    return _load_json("catchments.json", "demo_catchments.json")


def get_village(village_id: str) -> dict | None:
    return next((item for item in load_villages() if item["id"] == village_id), None)


def get_catchment(catchment_id: str) -> dict | None:
    return next((item for item in load_catchments() if item["id"] == catchment_id), None)


def get_village_context(village_id: str) -> tuple[dict | None, dict | None]:
    village = get_village(village_id)
    if village is None:
        return None, None
    return village, get_catchment(village["catchment_id"])


def clear_cache() -> None:
    """Useful after replacing processed files during development or tests."""
    load_villages.cache_clear()
    load_catchments.cache_clear()
