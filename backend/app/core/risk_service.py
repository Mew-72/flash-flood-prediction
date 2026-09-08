from __future__ import annotations

import asyncio
import math
from collections.abc import Iterable
from typing import Any

from app.core.data_sources.data_store import DataStore
from app.core.data_sources.provider import WeatherProvider
from app.core.physics.risk_engine import (
    assess_catchment_hazard,
    compose_village_risk,
)
from app.schemas.hazard import CatchmentHazard
from app.schemas.risk import RiskSnapshot
from app.schemas.weather import WeatherSnapshot, WeatherTimeline


PROVISIONAL_ASSESSMENT_NOTE = (
    "Provisional score: the source catalog has no measured catchment hydrology or "
    "village terrain features, so neutral literature-based defaults are used with "
    "live OpenWeather forcing. Use for screening only."
)
_PROVISIONAL_CATCHMENT_DEFAULTS = {
    "land_use": "pasture_fair",
    "hydrologic_soil_group": "C",
    "soil_texture": "loam",
    "mean_slope_deg": 15.0,
    "channel_slope_percent": 5.0,
    "base_rainfall_threshold_mm": 64.5,
}
_PROVISIONAL_VILLAGE_DEFAULTS = {
    "slope_deg": 15.0,
    "terrain_class": "generic_hillslope_default",
    "distance_to_stream_m": 500.0,
}


def _positive_number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > 0 else None


def _prepare_catchment(catchment: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    prepared = dict(catchment)
    provisional = prepared.get("model_ready", True) is False
    for field, default in _PROVISIONAL_CATCHMENT_DEFAULTS.items():
        if prepared.get(field) is None:
            prepared[field] = default
            provisional = True

    area_km2 = _positive_number(prepared.get("area_km2")) or 25.0
    prepared["area_km2"] = area_km2
    if _positive_number(prepared.get("flow_path_length_m")) is None:
        equivalent_diameter_m = 2.0 * math.sqrt(area_km2 * 1_000_000 / math.pi)
        prepared["flow_path_length_m"] = max(1_000.0, min(30_000.0, equivalent_diameter_m))
        provisional = True
    return prepared, provisional


def _prepare_village(village: dict[str, Any]) -> tuple[dict[str, Any], bool]:
    prepared = dict(village)
    provisional = prepared.get("model_ready", True) is False
    for field, default in _PROVISIONAL_VILLAGE_DEFAULTS.items():
        if prepared.get(field) is None:
            prepared[field] = default
            provisional = True
    return prepared, provisional


class RiskService:
    def __init__(self, store: DataStore, weather_client: WeatherProvider):
        self.store = store
        self.weather_client = weather_client

    async def snapshots_for_catchment(
        self,
        catchment: dict[str, Any],
        villages: list[dict[str, Any]],
        *,
        include_forecast: bool,
    ) -> list[RiskSnapshot]:
        assessment_catchment, catchment_is_provisional = _prepare_catchment(catchment)
        prepared_villages = [_prepare_village(village) for village in villages]
        timeline = await self.weather_client.get_timeline(assessment_catchment)
        weather_snapshots = select_assessment_horizons(
            timeline, include_forecast=include_forecast
        )
        snapshots: list[RiskSnapshot] = []
        for weather in weather_snapshots:
            hazard_data = assess_catchment_hazard(
                assessment_catchment, _risk_rainfall_series(weather)
            )
            hazard = CatchmentHazard.model_validate(hazard_data)
            for village, village_is_provisional in prepared_villages:
                is_provisional = catchment_is_provisional or village_is_provisional
                assessment_mode = (
                    "provisional_defaults" if is_provisional else "canonical"
                )
                details = compose_village_risk(
                    village,
                    assessment_catchment,
                    hazard_data,
                    weather.soil_moisture,
                )
                details["assessment_mode"] = assessment_mode
                details["assessment_note"] = (
                    PROVISIONAL_ASSESSMENT_NOTE if is_provisional else None
                )
                if is_provisional:
                    details["explain"]["method_note"] = (
                        f"{details['explain']['method_note']} "
                        f"{PROVISIONAL_ASSESSMENT_NOTE}"
                    )
                provenance = {
                    **self.store.provenance,
                    "weather_source": weather.source,
                    "retrieved_at": weather.retrieved_at,
                    "risk_input_mode": assessment_mode,
                    "risk_input_note": (
                        PROVISIONAL_ASSESSMENT_NOTE if is_provisional else None
                    ),
                }
                snapshots.append(
                    RiskSnapshot(
                        village_id=village["id"],
                        village_name=village["name"],
                        catchment_id=catchment["id"],
                        district=village.get("district"),
                        overall_risk_level=details["overall_risk_level"],
                        composite_score=details["composite_score"],
                        assessment_mode=assessment_mode,
                        assessment_note=(
                            PROVISIONAL_ASSESSMENT_NOTE if is_provisional else None
                        ),
                        period=weather.period,
                        retrieved_at=weather.retrieved_at,
                        valid_at=weather.valid_at,
                        lead_time_hours=weather.lead_time_hours,
                        precipitation_1h_mm=weather.precipitation_1h_mm,
                        precipitation_3h_mm=weather.precipitation_3h_mm,
                        precipitation_6h_mm=weather.precipitation_6h_mm,
                        precipitation_24h_mm=weather.precipitation_24h_mm,
                        temperature_c=weather.temperature_c,
                        feels_like_c=weather.feels_like_c,
                        humidity_percent=weather.humidity_percent,
                        pressure_hpa=weather.pressure_hpa,
                        wind_speed_mps=weather.wind_speed_mps,
                        wind_direction_deg=weather.wind_direction_deg,
                        cloud_cover_percent=weather.cloud_cover_percent,
                        visibility_m=weather.visibility_m,
                        weather_condition=weather.weather_condition,
                        weather_description=weather.weather_description,
                        weather_icon=weather.weather_icon,
                        hazard=hazard,
                        details=details,
                        provenance=provenance,
                    )
                )
        return snapshots

    async def snapshots_for_villages(
        self,
        villages: Iterable[dict[str, Any]],
        *,
        include_forecast: bool,
    ) -> list[RiskSnapshot]:
        grouped: dict[str, list[dict[str, Any]]] = {}
        for village in villages:
            grouped.setdefault(village["catchment_id"], []).append(village)

        jobs = []
        for catchment_id, catchment_villages in grouped.items():
            catchment = self.store.catchment(catchment_id)
            if catchment is None:
                raise ValueError(
                    f"Village mapping references missing catchment {catchment_id}"
                )
            jobs.append(
                self.snapshots_for_catchment(
                    catchment,
                    catchment_villages,
                    include_forecast=include_forecast,
                )
            )
        results = await asyncio.gather(*jobs)
        return [snapshot for group in results for snapshot in group]


def select_assessment_horizons(
    timeline: WeatherTimeline, *, include_forecast: bool
) -> list[WeatherSnapshot]:
    selected: list[WeatherSnapshot] = []
    if timeline.current is not None:
        selected.append(timeline.current)
    if not include_forecast or not timeline.forecast:
        return selected

    if timeline.forecast[0].lead_time_hours >= 24:
        selected.extend(timeline.forecast)
        return selected

    chosen_valid_times = set()
    for target_hours in (1, 3, 6, 24):
        candidate = next(
            (
                item
                for item in timeline.forecast
                if item.lead_time_hours >= target_hours
            ),
            None,
        )
        if candidate is not None and candidate.valid_at not in chosen_valid_times:
            selected.append(candidate)
            chosen_valid_times.add(candidate.valid_at)
    furthest = timeline.forecast[-1]
    if furthest.valid_at not in chosen_valid_times:
        selected.append(furthest)
    return selected


def _risk_rainfall_series(snapshot: WeatherSnapshot) -> list[float]:
    antecedent = snapshot.antecedent_daily_rainfall_mm[-5:]
    return [*antecedent, snapshot.precipitation_24h_mm]
