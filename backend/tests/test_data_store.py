import json

from pydantic import ValidationError
import pytest

from app.config import Settings
from app.core.data_sources.data_store import DataStore, DataStoreError
from app.schemas.admin import AdministrativeHierarchy, CatchmentOut, VillageOut


VILLAGES = [
    {
        "id": "v1",
        "name": "Alpha",
        "catchment_id": "c1",
        "lat": 1,
        "lon": 2,
        "slope_deg": 10,
        "terrain_class": "generic_hillslope_default",
        "distance_to_stream_m": 50,
    }
]
CATCHMENTS = [
    {
        "id": "c1",
        "name": "Upper",
        "district": "North",
        "centroid_lat": 1,
        "centroid_lon": 2,
    }
]


def _write(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


def test_data_mode_defaults_to_demo_and_is_constrained(monkeypatch):
    monkeypatch.delenv("DATA_MODE", raising=False)
    assert Settings(_env_file=None).data_mode == "demo"
    with pytest.raises(ValidationError):
        Settings(data_mode="automatic", _env_file=None)


def test_demo_mode_is_strict_indexed_and_has_explicit_district(tmp_path):
    _write(tmp_path / "demo_villages.json", VILLAGES)
    _write(tmp_path / "demo_catchments.json", CATCHMENTS)
    store = DataStore("demo", tmp_path)

    village, catchment = store.village_context("v1")
    assert village is not None
    assert catchment is not None
    assert village["district"] == "demo"
    assert catchment["district"] == "demo"
    assert catchment["id"] == "c1"
    assert store.catalog_villages(district="DEMO", limit=10)[1] == 1
    assert store.catalog_villages(district="North", limit=10)[1] == 0
    assert store.provenance["static_sources"] == [
        "demo_villages.json",
        "demo_catchments.json",
    ]


def test_production_never_falls_back_to_demo_files(tmp_path):
    _write(tmp_path / "demo_villages.json", VILLAGES)
    _write(tmp_path / "demo_catchments.json", CATCHMENTS)

    with pytest.raises(DataStoreError, match="no fallback is allowed"):
        DataStore("production", tmp_path)


def test_canonical_admin_hierarchy_accepts_lgd_identifiers():
    hierarchy = AdministrativeHierarchy.model_validate(
        {
            "state": {"id": "05", "name": "Uttarakhand", "source_code": "5"},
            "district": {"id": "056", "name": "Rudraprayag"},
            "subdistrict": {"id": "00321", "name": "Ukhimath"},
        }
    )
    village = VillageOut.model_validate(
        {
            **VILLAGES[0],
            "lgd_village_code": "example-lgd-code",
            "admin": hierarchy,
        }
    )

    assert village.admin is not None
    assert village.admin.district.name == "Rudraprayag"
    assert village.lgd_village_code == "example-lgd-code"


def test_catalog_schemas_accept_non_model_ready_production_rows():
    village = VillageOut.model_validate(
        {
            **VILLAGES[0],
            "slope_deg": None,
            "terrain_class": None,
            "distance_to_stream_m": None,
            "historical_event_count": None,
            "model_ready": False,
        }
    )
    catchment = CatchmentOut.model_validate(
        {
            **CATCHMENTS[0],
            "area_km2": 12.5,
            "land_use": None,
            "hydrologic_soil_group": None,
            "soil_texture": None,
            "mean_slope_deg": None,
            "flow_path_length_m": None,
            "channel_slope_percent": None,
            "base_rainfall_threshold_mm": None,
            "model_ready": False,
        }
    )

    assert village.model_ready is False
    assert village.slope_deg is None
    assert catchment.model_ready is False
    assert catchment.land_use is None


def test_catalog_filters_and_paginates(tmp_path):
    villages = [
        {**VILLAGES[0], "id": f"v{index}", "name": f"Village {index}"}
        for index in range(4)
    ]
    _write(tmp_path / "villages.json", villages)
    _write(tmp_path / "catchments.json", CATCHMENTS)
    store = DataStore("production", tmp_path)

    page, total = store.catalog_villages(
        district="north", query="Village", offset=1, limit=2
    )
    assert total == 4
    assert [item["id"] for item in page] == ["v1", "v2"]
