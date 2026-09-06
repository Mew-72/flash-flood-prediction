from app.core.physics.slope_stability import (
    compute_saturation_ratio,
    compute_factor_of_safety,
    classify_landslide_risk,
)


def test_saturation_ratio_clips_to_0_1():
    assert compute_saturation_ratio(0.0, field_capacity=0.2, porosity=0.45) == 0.0
    assert compute_saturation_ratio(1.0, field_capacity=0.2, porosity=0.45) == 1.0


def test_higher_saturation_lowers_factor_of_safety():
    fs_dry = compute_factor_of_safety(10, 19, 1.5, 35, 28, saturation_ratio=0.0)
    fs_wet = compute_factor_of_safety(10, 19, 1.5, 35, 28, saturation_ratio=1.0)
    assert fs_wet < fs_dry


def test_classify_landslide_risk_bands():
    assert classify_landslide_risk(0.8) == "critical"
    assert classify_landslide_risk(1.1) == "high"
    assert classify_landslide_risk(1.4) == "moderate"
    assert classify_landslide_risk(2.0) == "low"
