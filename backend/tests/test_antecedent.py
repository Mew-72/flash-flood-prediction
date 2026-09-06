from app.core.physics.antecedent import (
    compute_api_next,
    compute_api_series,
    sum_last_n_days,
    get_threshold_reduction_factor,
    apply_threshold_reduction,
)


def test_compute_api_next_basic():
    assert compute_api_next(10, 5, k=0.9) == 14.0


def test_api_series_length_matches_input():
    series = compute_api_series([5, 10, 0, 20])
    assert len(series) == 4


def test_sum_last_n_days():
    assert sum_last_n_days([10, 20, 30, 40], n=2) == 70


def test_threshold_reduction_bands():
    assert get_threshold_reduction_factor(200) == 0.30
    assert get_threshold_reduction_factor(80) == 0.15
    assert get_threshold_reduction_factor(10) == 0.0


def test_apply_threshold_reduction_output():
    result = apply_threshold_reduction(50, 200)
    assert result["effective_threshold_mm"] == 35.0
