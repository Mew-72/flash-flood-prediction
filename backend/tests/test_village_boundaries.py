import pyarrow as pa
from pyarrow import parquet
import pytest
from shapely.geometry import MultiPolygon, Polygon
from shapely.wkb import dumps

from app.core.data_sources.village_boundaries import VillageBoundaryStore


def _write_boundaries(path):
    geometries = [
        MultiPolygon([Polygon([(78, 30), (79, 30), (79, 31), (78, 31)])]),
        MultiPolygon([Polygon([(79, 30), (80, 30), (80, 31), (79, 31)])]),
    ]
    table = pa.table(
        {
            "s_name": ["Uttarakhand", "Uttarakhand"],
            "s_code": ["5", "5"],
            "d_name": ["Rudraprayag", "Chamoli"],
            "d_code": ["58", "57"],
            "b_name": ["Agustmuni", "Joshimath"],
            "b_code": ["1005", "1004"],
            "gp_name": ["A", "B"],
            "gp_code": ["1", "2"],
            "v_name": ["Alpha", "Beta"],
            "v_code": ["42340", "42341"],
            "geometry": [dumps(geometry) for geometry in geometries],
        }
    )
    parquet.write_table(table, path)


def test_boundary_store_filters_and_normalises_polygon_records(tmp_path):
    _write_boundaries(tmp_path / "villages.parquet")
    store = VillageBoundaryStore(tmp_path)

    items, total = store.catalog(district_code="58", limit=10)

    assert total == 1
    assert store.source_filename == "villages.parquet"
    assert items[0]["id"] == "5:58:42340"
    assert items[0]["name"] == "Alpha"
    assert items[0]["district"]["name"] == "Rudraprayag"
    assert items[0]["geometry"]["type"] == "MultiPolygon"
    assert 78 < items[0]["lon"] < 79
    assert 30 < items[0]["lat"] < 31


def test_boundary_store_requires_a_bounded_region_selector(tmp_path):
    _write_boundaries(tmp_path / "bhuvan_villages.parquet")
    store = VillageBoundaryStore(tmp_path)

    with pytest.raises(ValueError, match="state_code"):
        store.catalog()


def test_boundary_store_searches_within_selected_region(tmp_path):
    _write_boundaries(tmp_path / "villages.parquet")
    store = VillageBoundaryStore(tmp_path)

    items, total = store.catalog(state_code="5", query="42341", limit=10)

    assert total == 1
    assert items[0]["name"] == "Beta"
