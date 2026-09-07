"""Strict, indexed JSON data store for processed administrative data."""

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from app.config import get_settings

PROJECT_ROOT = Path(__file__).resolve().parents[4]
PROCESSED_DATA_DIR = PROJECT_ROOT / "data" / "processed"
DEMO_DISTRICT = "demo"
DataMode = Literal["demo", "production"]


class DataStoreError(RuntimeError):
    pass


class DataStore:
    """Load the selected dataset once and provide indexed reads and catalogs."""

    def __init__(self, data_mode: DataMode, data_dir: Path = PROCESSED_DATA_DIR):
        self.data_mode = data_mode
        self.data_dir = data_dir
        village_filename = (
            "demo_villages.json" if data_mode == "demo" else "villages.json"
        )
        catchment_filename = (
            "demo_catchments.json" if data_mode == "demo" else "catchments.json"
        )
        self.source_files = [village_filename, catchment_filename]

        catchments = self._load_json(catchment_filename)
        villages = self._load_json(village_filename)
        if not isinstance(catchments, list) or not isinstance(villages, list):
            raise DataStoreError("Village and catchment files must contain JSON arrays")

        self._catchments = [self._normalise_catchment(item) for item in catchments]
        self._catchment_by_id = self._build_index(self._catchments, "catchment")
        self._villages = [self._normalise_village(item) for item in villages]
        self._village_by_id = self._build_index(self._villages, "village")
        self._villages_by_catchment: dict[str, list[dict]] = {
            catchment_id: [] for catchment_id in self._catchment_by_id
        }
        for village in self._villages:
            catchment_id = village.get("catchment_id")
            if not isinstance(catchment_id, str) or not catchment_id:
                raise DataStoreError(
                    f"Village {village.get('id')!r} has no valid catchment_id"
                )
            catchment = self._catchment_by_id.get(catchment_id)
            if catchment is None:
                raise DataStoreError(
                    f"Village {village.get('id')!r} maps to unknown catchment "
                    f"{catchment_id!r}"
                )
            if village.get("district") is None and catchment.get("district") is not None:
                village["district"] = catchment["district"]
            self._villages_by_catchment[catchment_id].append(village)

    def _load_json(self, filename: str) -> Any:
        path = self.data_dir / filename
        if not path.is_file():
            raise DataStoreError(
                f"DATA_MODE={self.data_mode} requires {path}; no fallback is allowed"
            )
        try:
            with path.open("r", encoding="utf-8") as file:
                return json.load(file)
        except json.JSONDecodeError as exc:
            raise DataStoreError(f"Invalid JSON in {path}: {exc}") from exc
        except OSError as exc:
            raise DataStoreError(f"Unable to read {path}: {exc}") from exc

    def _normalise_catchment(self, record: Any) -> dict:
        if not isinstance(record, dict):
            raise DataStoreError("Each catchment record must be a JSON object")
        normalised = dict(record)
        if self.data_mode == "demo":
            normalised["district"] = DEMO_DISTRICT
        return normalised

    def _normalise_village(self, record: Any) -> dict:
        if not isinstance(record, dict):
            raise DataStoreError("Each village record must be a JSON object")
        normalised = dict(record)
        if self.data_mode == "demo":
            normalised["district"] = DEMO_DISTRICT
        return normalised

    @staticmethod
    def _build_index(records: list[dict], kind: str) -> dict[str, dict]:
        index: dict[str, dict] = {}
        for record in records:
            record_id = record.get("id")
            if not isinstance(record_id, str) or not record_id:
                raise DataStoreError(f"Every {kind} must have a non-empty string id")
            if record_id in index:
                raise DataStoreError(f"Duplicate {kind} id: {record_id}")
            index[record_id] = record
        return index

    @property
    def provenance(self) -> dict:
        return {
            "data_mode": self.data_mode,
            "static_sources": list(self.source_files),
        }

    def villages(self) -> list[dict]:
        return list(self._villages)

    def catchments(self) -> list[dict]:
        return list(self._catchments)

    def village(self, village_id: str) -> dict | None:
        return self._village_by_id.get(village_id)

    def catchment(self, catchment_id: str) -> dict | None:
        return self._catchment_by_id.get(catchment_id)

    def villages_for_catchment(self, catchment_id: str) -> list[dict]:
        return list(self._villages_by_catchment.get(catchment_id, ()))

    def village_context(self, village_id: str) -> tuple[dict | None, dict | None]:
        village = self.village(village_id)
        if village is None:
            return None, None
        return village, self.catchment(village["catchment_id"])

    def catalog_villages(
        self,
        *,
        district: str | None = None,
        catchment_id: str | None = None,
        query: str | None = None,
        offset: int = 0,
        limit: int = 100,
    ) -> tuple[list[dict], int]:
        records = self._villages
        if catchment_id is not None:
            records = self._villages_by_catchment.get(catchment_id, [])
        records = self._filter(records, district=district, query=query)
        return records[offset : offset + limit], len(records)

    def catalog_catchments(
        self,
        *,
        district: str | None = None,
        query: str | None = None,
        offset: int = 0,
        limit: int = 100,
    ) -> tuple[list[dict], int]:
        records = self._filter(self._catchments, district=district, query=query)
        return records[offset : offset + limit], len(records)

    @staticmethod
    def _filter(
        records: list[dict], *, district: str | None, query: str | None
    ) -> list[dict]:
        filtered = records
        if district is not None:
            district_key = district.casefold()
            filtered = [
                item
                for item in filtered
                if str(item.get("district", "")).casefold() == district_key
            ]
        if query:
            query_key = query.casefold()
            filtered = [
                item
                for item in filtered
                if query_key in str(item.get("name", "")).casefold()
                or query_key in str(item.get("id", "")).casefold()
            ]
        return filtered


@lru_cache(maxsize=2)
def _store_for_mode(data_mode: DataMode) -> DataStore:
    return DataStore(data_mode=data_mode, data_dir=PROCESSED_DATA_DIR)


def get_data_store() -> DataStore:
    return _store_for_mode(get_settings().data_mode)


# Legacy function API retained for existing code and integrations.
def load_villages() -> list[dict]:
    return get_data_store().villages()


def load_catchments() -> list[dict]:
    return get_data_store().catchments()


def get_village(village_id: str) -> dict | None:
    return get_data_store().village(village_id)


def get_catchment(catchment_id: str) -> dict | None:
    return get_data_store().catchment(catchment_id)


def get_village_context(village_id: str) -> tuple[dict | None, dict | None]:
    return get_data_store().village_context(village_id)


def clear_cache() -> None:
    _store_for_mode.cache_clear()
