from app.core.physics.scs_cn import (
    compute_potential_retention,
    compute_runoff_depth_mm,
    adjust_cn_for_amc,
    determine_amc_class,
)


def test_potential_retention_cn_100_is_zero():
    assert compute_potential_retention(100) == 0


def test_runoff_zero_below_initial_abstraction():
    # CN=70 -> S ~ 108.86mm -> Ia ~ 21.77mm; 10mm rain should produce zero runoff
    assert compute_runoff_depth_mm(10, 70) == 0.0


def test_runoff_positive_for_large_storm():
    q = compute_runoff_depth_mm(150, 70)
    assert q > 0


def test_amc_dry_reduces_cn():
    assert adjust_cn_for_amc(80, 1) < 80


def test_amc_wet_increases_cn():
    assert adjust_cn_for_amc(80, 3) > 80


def test_determine_amc_class_bands():
    assert determine_amc_class(10) == 1
    assert determine_amc_class(40) == 2
    assert determine_amc_class(80) == 3
