"""
Antecedent Precipitation Index (API) and the antecedent-rainfall alert
threshold reduction. Precedent for combining short-term rainfall thresholds
with antecedent rainfall: ISRO/NRSC's own experimental landslide early
warning system for Uttarakhand road corridors (Mathew et al., 2014) already
does this operationally.
"""
from app.config import (
    API_DECAY_CONSTANT,
    ANTECEDENT_WET_3DAY_MM,
    ANTECEDENT_MODERATE_3DAY_MM,
    ANTECEDENT_WET_REDUCTION,
    ANTECEDENT_MODERATE_REDUCTION,
)


def compute_api_next(previous_api: float, todays_rainfall_mm: float,
                      k: float = API_DECAY_CONSTANT) -> float:
    """API_t = API_(t-1) * k + P_t"""
    return previous_api * k + todays_rainfall_mm


def compute_api_series(daily_rainfall_mm: list[float], k: float = API_DECAY_CONSTANT,
                        initial_api: float = 0.0) -> list[float]:
    """Run the API recurrence over a list of daily rainfall values (oldest first)."""
    api_values = []
    api = initial_api
    for p in daily_rainfall_mm:
        api = compute_api_next(api, p, k)
        api_values.append(api)
    return api_values


def sum_last_n_days(daily_rainfall_mm: list[float], n: int = 3) -> float:
    """Simple cumulative rainfall over the last n days (most recent last in list)."""
    return sum(daily_rainfall_mm[-n:])


def get_threshold_reduction_factor(cumulative_3day_rainfall_mm: float) -> float:
    if cumulative_3day_rainfall_mm >= ANTECEDENT_WET_3DAY_MM:
        return ANTECEDENT_WET_REDUCTION
    if cumulative_3day_rainfall_mm >= ANTECEDENT_MODERATE_3DAY_MM:
        return ANTECEDENT_MODERATE_REDUCTION
    return 0.0


def apply_threshold_reduction(base_threshold_mm: float, cumulative_3day_rainfall_mm: float) -> dict:
    reduction_factor = get_threshold_reduction_factor(cumulative_3day_rainfall_mm)
    effective_threshold = base_threshold_mm * (1 - reduction_factor)
    return {
        "base_threshold_mm": base_threshold_mm,
        "cumulative_3day_rainfall_mm": cumulative_3day_rainfall_mm,
        "reduction_factor": reduction_factor,
        "effective_threshold_mm": round(effective_threshold, 2),
    }
