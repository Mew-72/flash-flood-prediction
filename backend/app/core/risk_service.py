from __future__ import annotations

import asyncio
from collections.abc import Iterable

from app.core.data_sources.data_store import DataStore
from app.core.data_sources.imd import ImdClient
from app.core.physics.risk_engine import (
    assess_catchment_hazard,
    compose_village_risk,
)
from app.schemas.hazard import CatchmentHazard
from app.schemas.risk import RiskSnapshot
from app.schemas.weather import WeatherSnapshot, WeatherTimeline


class RiskService:
    def __init__(self, store: DataStore, weather_client: ImdClient):
        self.store = store
        self.weather_client = weather_client

    async def snapshots_for_catchment(
        self,
        catchment: dict,
        villages: list[dict],
        *,
        include_forecast: bool,
    ) -> list[RiskSnapshot]:
        timeline = await self.weather_client.get_timeline(catchment)
        weather_snapshots = select_assessment_horizons(
            timeline, include_forecast=include_forecast
        )
        snapshots: list[RiskSnapshot] = []
        for weather in weather_snapshots:
            hazard_data = assess_catchment_hazard(
                catchment, _risk_rainfall_series(weather)
            )
            hazard = CatchmentHazard.model_validate(hazard_data)
            for village in villages:
                details = compose_village_risk(
                    village, catchment, hazard_data, weather.soil_moisture
                )
                provenance = {
                    **self.store.provenance,
                    "weather_source": weather.source,
                    "retrieved_at": weather.retrieved_at,
                }
                snapshots.append(
                    RiskSnapshot(
                        village_id=village["id"],
                        village_name=village["name"],
                        catchment_id=catchment["id"],
                        district=village.get("district"),
                        overall_risk_level=details["overall_risk_level"],
                        composite_score=details["composite_score"],
                        period=weather.period,
                        retrieved_at=weather.retrieved_at,
                        valid_at=weather.valid_at,
                        lead_time_hours=weather.lead_time_hours,
                        precipitation_1h_mm=weather.precipitation_1h_mm,
                        precipitation_3h_mm=weather.precipitation_3h_mm,
                        precipitation_6h_mm=weather.precipitation_6h_mm,
                        precipitation_24h_mm=weather.precipitation_24h_mm,
                        hazard=hazard,
                        details=details,
                        provenance=provenance,
                    )
                )
        return snapshots

    async def snapshots_for_villages(
        self, villages: Iterable[dict], *, include_forecast: bool
    ) -> list[RiskSnapshot]:
        grouped: dict[str, list[dict]] = {}
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
