"""Flash-flood risk forecasting at sub-catchment scale with village alerts.

Hydrology is computed for a sub-catchment because runoff follows drainage
boundaries, not administrative boundaries. Villages are the reporting unit:
they inherit catchment hazard and receive a local exposure adjustment based
on stream proximity and terrain.

The infinite-slope calculation is retained as a supplemental indicator because
the SIH statement includes slope stability, but it does not drive the core
flash-flood score.
"""
from app.core.lookup_tables.curve_number import get_curve_number
from app.core.lookup_tables.soil_geotech import (
    get_soil_hydraulic_properties,
    get_terrain_geotech_properties,
)
from app.core.physics.antecedent import (
    apply_threshold_reduction,
    compute_api_series,
    sum_last_n_days,
)
from app.core.physics.scs_cn import compute_moisture_adjusted_runoff_mm
from app.core.physics.slope_stability import compute_slope_risk

FALLBACK_WEIGHTS = {
    "runoff": 0.30,
    "rainfall_trigger": 0.30,
    "antecedent": 0.15,
    "village_exposure": 0.25,
}


def _clip01(value: float) -> float:
    return max(0.0, min(1.0, value))


def compute_time_of_concentration_minutes(flow_path_length_m: float,
                                           channel_slope_fraction: float) -> float:
    """Estimate catchment response time with the Kirpich equation.

    Tc = 0.0195 * L^0.77 * S^-0.385, where L is metres and S is m/m.
    This is an indicative response time, not a guaranteed evacuation lead time.
    """
    if flow_path_length_m <= 0:
        raise ValueError("flow_path_length_m must be positive")
    if channel_slope_fraction <= 0:
        raise ValueError("channel_slope_fraction must be positive")
    return 0.0195 * (flow_path_length_m ** 0.77) * (channel_slope_fraction ** -0.385)


def compute_village_exposure(distance_to_stream_m: float, slope_deg: float) -> dict:
    """Translate catchment hazard into local village exposure.

    Proximity to the drainage network dominates. Local slope is a smaller
    concentration proxy until relative elevation/flow-path data is available.
    """
    stream_proximity = 1.0 - _clip01(distance_to_stream_m / 1000.0)
    terrain_concentration = _clip01(slope_deg / 45.0)
    score = 0.70 * stream_proximity + 0.30 * terrain_concentration
    return {
        "distance_to_stream_m": distance_to_stream_m,
        "stream_proximity_score": round(stream_proximity, 3),
        "terrain_concentration_score": round(terrain_concentration, 3),
        "score": round(score, 3),
    }


def _risk_level(score: float) -> str:
    if score >= 0.75:
        return "critical"
    if score >= 0.50:
        return "high"
    if score >= 0.25:
        return "moderate"
    return "low"


def assess_village_risk(village: dict, catchment: dict,
                         daily_rainfall_mm: list[float],
                         current_soil_moisture: float,
                         base_threshold_override_mm: float | None = None) -> dict:
    """Compute catchment hydrology and map the result to a village alert.

    `daily_rainfall_mm` is chronological and its last value is the assessment
    day's rainfall. The catchment supplies area-weighted land-use/soil inputs;
    the village supplies only local exposure and supplemental slope inputs.
    """
    if not daily_rainfall_mm:
        daily_rainfall_mm = [0.0]

    today_rainfall = daily_rainfall_mm[-1]
    prior_rainfall = daily_rainfall_mm[:-1]
    antecedent_5day = sum_last_n_days(prior_rainfall, n=5)
    antecedent_3day = sum_last_n_days(prior_rainfall, n=3)
    api_values = compute_api_series(prior_rainfall)
    latest_api = api_values[-1] if api_values else 0.0

    cn_ii = get_curve_number(catchment["land_use"], catchment["hydrologic_soil_group"])
    runoff = compute_moisture_adjusted_runoff_mm(today_rainfall, cn_ii, antecedent_5day)
    runoff_volume_m3 = runoff["runoff_mm"] * catchment["area_km2"] * 1000.0

    base_threshold = (
        base_threshold_override_mm
        if base_threshold_override_mm is not None
        else catchment["base_rainfall_threshold_mm"]
    )
    rainfall_trigger = apply_threshold_reduction(base_threshold, antecedent_3day)
    effective_threshold = max(rainfall_trigger["effective_threshold_mm"], 1.0)

    channel_slope_fraction = catchment["channel_slope_percent"] / 100.0
    response_time_minutes = compute_time_of_concentration_minutes(
        catchment["flow_path_length_m"], channel_slope_fraction
    )

    exposure = compute_village_exposure(
        village["distance_to_stream_m"], village["slope_deg"]
    )

    runoff_score = _clip01(runoff["runoff_mm"] / 100.0)
    rainfall_trigger_score = _clip01(today_rainfall / effective_threshold)
    antecedent_score = _clip01(latest_api / max(base_threshold, 1.0))

    composite_score = (
        FALLBACK_WEIGHTS["runoff"] * runoff_score
        + FALLBACK_WEIGHTS["rainfall_trigger"] * rainfall_trigger_score
        + FALLBACK_WEIGHTS["antecedent"] * antecedent_score
        + FALLBACK_WEIGHTS["village_exposure"] * exposure["score"]
    )

    soil_props = get_soil_hydraulic_properties(catchment["soil_texture"])
    geotech_props = get_terrain_geotech_properties(village["terrain_class"])
    slope_indicator = compute_slope_risk(
        volumetric_soil_moisture=current_soil_moisture,
        field_capacity=soil_props["field_capacity"],
        porosity=soil_props["porosity"],
        cohesion_kpa=geotech_props["c_kpa"],
        unit_weight_kn_m3=geotech_props["gamma_kn_m3"],
        soil_depth_m=geotech_props["z_m"],
        slope_deg=village["slope_deg"],
        friction_angle_deg=geotech_props["phi_deg"],
    )

    return {
        "catchment_id": catchment["id"],
        "catchment_hydrology": {
            **runoff,
            "area_km2": catchment["area_km2"],
            "runoff_volume_m3": round(runoff_volume_m3, 1),
            "estimated_response_time_minutes": round(response_time_minutes, 1),
        },
        "rainfall_trigger": rainfall_trigger,
        "village_exposure": exposure,
        "supplemental_slope_stability": slope_indicator,
        "composite_score": round(composite_score, 3),
        "overall_risk_level": _risk_level(composite_score),
        "explain": {
            "today_rainfall_mm": today_rainfall,
            "antecedent_3day_mm": antecedent_3day,
            "antecedent_5day_mm": antecedent_5day,
            "antecedent_precipitation_index": round(latest_api, 2),
            "current_soil_moisture": current_soil_moisture,
            "score_components": {
                "runoff": round(runoff_score, 3),
                "rainfall_trigger": round(rainfall_trigger_score, 3),
                "antecedent": round(antecedent_score, 3),
                "village_exposure": exposure["score"],
            },
            "method_note": (
                "Runoff is computed for the sub-catchment. The village is the "
                "alert unit, adjusted by local exposure; no finer rainfall value "
                "is invented for the village."
            ),
        },
    }
