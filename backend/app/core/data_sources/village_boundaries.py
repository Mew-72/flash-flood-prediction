"""Pushdown-filtered access to the national Bhuvan village GeoParquet."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

from pyarrow import parquet
from shapely import from_wkb
from shapely.geometry import mapping

from app.core.data_sources.data_store import PROCESSED_DATA_DIR, DataStoreError

EXPECTED_COLUMNS = (
    "s_name",
    "s_code",
    "d_name",
    "d_code",
    "b_name",
    "b_code",
    "gp_name",
    "gp_code",
    "v_name",
    "v_code",
    "geometry",
)
BOUNDARY_FILENAMES = ("villages.parquet", "bhuvan_villages.parquet")


class VillageBoundaryStore:
    def __init__(self, data_dir: Path = PROCESSED_DATA_DIR):
        self.path = self._resolve_path(data_dir)
        self._region_cache: dict[
            tuple[str | None, str | None, str | None],
            tuple[dict[str, Any], ...],
        ] = {}
        self._validate_schema()

    @staticmethod
    def _resolve_path(data_dir: Path) -> Path:
        for filename in BOUNDARY_FILENAMES:
            path = data_dir / filename
            if path.is_file():
                return path
        expected = " or ".join(str(data_dir / name) for name in BOUNDARY_FILENAMES)
        raise DataStoreError(f"Village boundary GeoParquet not found; expected {expected}")

    def _validate_schema(self) -> None:
        try:
            schema = parquet.ParquetFile(self.path).schema_arrow
        except (OSError, ValueError) as exc:
            raise DataStoreError(f"Unable to inspect {self.path}: {exc}") from exc
        missing = [name for name in EXPECTED_COLUMNS if name not in schema.names]
        if missing:
            raise DataStoreError(
                f"Village boundary GeoParquet is missing columns: {', '.join(missing)}"
            )

    @property
    def source_filename(self) -> str:
        return self.path.name

    def catalog(
        self,
        *,
        state_code: str | None = None,
        district_code: str | None = None,
        district_name: str | None = None,
        query: str | None = None,
        offset: int = 0,
        limit: int = 100,
    ) -> tuple[list[dict[str, Any]], int]:
        if not any((state_code, district_code, district_name)):
            raise ValueError(
                "A state_code, district_code, or exact district_name is required"
            )
        records = list(
            self._region_records(
                _clean(state_code),
                _clean(district_code),
                _clean(district_name),
            )
        )
        if query:
            wanted = query.casefold()
            records = [
                record
                for record in records
                if wanted in record["name"].casefold()
                or wanted in record["lgd_village_code"].casefold()
            ]
        return records[offset : offset + limit], len(records)

    def _region_records(
        self,
        state_code: str | None,
        district_code: str | None,
        district_name: str | None,
    ) -> tuple[dict[str, Any], ...]:
        cache_key = (state_code, district_code, district_name)
        cached = self._region_cache.get(cache_key)
        if cached is not None:
            return cached

        filters = []
        if state_code:
            filters.append(("s_code", "=", state_code))
        if district_code:
            filters.append(("d_code", "=", district_code))
        if district_name:
            filters.append(("d_name", "=", district_name))
        try:
            table = parquet.read_table(
                self.path,
                columns=list(EXPECTED_COLUMNS),
                filters=filters,
            )
        except (OSError, ValueError) as exc:
            raise DataStoreError(f"Unable to read {self.path}: {exc}") from exc
        records = tuple(_normalise_record(record) for record in table.to_pylist())
        if len(self._region_cache) >= 32:
            self._region_cache.pop(next(iter(self._region_cache)))
        self._region_cache[cache_key] = records
        return records


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def _unit(code: Any, name: Any) -> dict[str, str]:
    return {
        "id": str(code),
        "name": str(name),
        "source_code": str(code),
    }


def _normalise_record(record: dict[str, Any]) -> dict[str, Any]:
    geometry = from_wkb(record["geometry"])
    if geometry.is_empty or geometry.geom_type not in {"Polygon", "MultiPolygon"}:
        raise DataStoreError(
            f"Village {record.get('v_code')!r} has invalid polygon geometry"
        )
    point = geometry.representative_point()
    state_code = str(record["s_code"])
    district_code = str(record["d_code"])
    village_code = str(record["v_code"])
    return {
        "id": f"{state_code}:{district_code}:{village_code}",
        "name": str(record["v_name"]),
        "lgd_village_code": village_code,
        "state": _unit(state_code, record["s_name"]),
        "district": _unit(district_code, record["d_name"]),
        "block": _unit(record["b_code"], record["b_name"]),
        "gram_panchayat": _unit(record["gp_code"], record["gp_name"]),
        "lat": point.y,
        "lon": point.x,
        "geometry": mapping(geometry),
    }


@lru_cache(maxsize=1)
def get_village_boundary_store() -> VillageBoundaryStore:
    return VillageBoundaryStore()
