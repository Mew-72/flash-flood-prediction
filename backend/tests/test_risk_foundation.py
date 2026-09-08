from app.core.risk_service import _prepare_catchment, _prepare_village
from app.core.physics.risk_engine import (
    assess_catchment_hazard,
    assess_village_risk,
    compose_village_risk,
)
from tests.test_risk_engine import CATCHMENT, NEAR_STREAM_VILLAGE


def test_missing_production_features_receive_explicit_provisional_defaults():
    catchment, catchment_is_provisional = _prepare_catchment(
        {
            "id": "proxy",
            "area_km2": 100,
            "model_ready": False,
            "land_use": None,
            "hydrologic_soil_group": None,
            "soil_texture": None,
            "mean_slope_deg": None,
            "flow_path_length_m": None,
            "channel_slope_percent": None,
            "base_rainfall_threshold_mm": None,
        }
    )
    village, village_is_provisional = _prepare_village(
        {
            "id": "catalog-only",
            "model_ready": False,
            "slope_deg": None,
            "terrain_class": None,
            "distance_to_stream_m": None,
        }
    )

    assert catchment_is_provisional is True
    assert catchment["land_use"] == "pasture_fair"
    assert catchment["hydrologic_soil_group"] == "C"
    assert catchment["flow_path_length_m"] > 0
    assert village_is_provisional is True
    assert village["slope_deg"] == 15.0
    assert village["distance_to_stream_m"] == 500.0


def test_split_hazard_and_composition_preserve_legacy_orchestration():
    rainfall = [5, 10, 20, 45, 80]
    hazard = assess_catchment_hazard(CATCHMENT, rainfall)
    composed = compose_village_risk(
        NEAR_STREAM_VILLAGE, CATCHMENT, hazard, 0.35
    )
    legacy = assess_village_risk(
        NEAR_STREAM_VILLAGE, CATCHMENT, rainfall, 0.35
    )

    assert composed == legacy
    assert hazard["catchment_id"] == CATCHMENT["id"]
    assert "village_exposure" not in hazard
