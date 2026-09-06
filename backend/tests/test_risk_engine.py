from app.core.physics.risk_engine import assess_village_risk, compute_time_of_concentration_minutes


CATCHMENT = {
    "id": "c1",
    "area_km2": 20.0,
    "land_use": "forest_fair",
    "hydrologic_soil_group": "C",
    "soil_texture": "sandy_loam",
    "flow_path_length_m": 7000.0,
    "channel_slope_percent": 8.0,
    "base_rainfall_threshold_mm": 50.0,
}

NEAR_STREAM_VILLAGE = {
    "id": "v1",
    "catchment_id": "c1",
    "slope_deg": 35.0,
    "terrain_class": "himalayan_colluvium",
    "distance_to_stream_m": 50.0,
}

FAR_VILLAGE = {
    **NEAR_STREAM_VILLAGE,
    "id": "v2",
    "slope_deg": 5.0,
    "distance_to_stream_m": 900.0,
}


def test_time_of_concentration_is_positive():
    assert compute_time_of_concentration_minutes(7000, 0.08) > 0


def test_villages_share_catchment_runoff_but_have_different_exposure():
    rainfall = [5, 10, 20, 45, 80]
    near = assess_village_risk(NEAR_STREAM_VILLAGE, CATCHMENT, rainfall, 0.35)
    far = assess_village_risk(FAR_VILLAGE, CATCHMENT, rainfall, 0.35)

    assert near["catchment_hydrology"]["runoff_mm"] == far["catchment_hydrology"]["runoff_mm"]
    assert near["village_exposure"]["score"] > far["village_exposure"]["score"]
    assert near["composite_score"] > far["composite_score"]


def test_antecedent_rain_reduces_trigger_threshold():
    wet = assess_village_risk(NEAR_STREAM_VILLAGE, CATCHMENT, [50, 50, 50, 10, 10], 0.35)
    dry = assess_village_risk(NEAR_STREAM_VILLAGE, CATCHMENT, [0, 0, 0, 10, 10], 0.25)

    assert wet["rainfall_trigger"]["effective_threshold_mm"] < dry["rainfall_trigger"]["effective_threshold_mm"]
