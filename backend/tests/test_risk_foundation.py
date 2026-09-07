from app.core.physics.risk_engine import (
    assess_catchment_hazard,
    assess_village_risk,
    compose_village_risk,
)
from tests.test_risk_engine import CATCHMENT, NEAR_STREAM_VILLAGE


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
