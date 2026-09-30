"""Combine OpenWeather conditions/forecasts with observed IMD 24-hour rainfall."""

from __future__ import annotations

import asyncio
from typing import Any

from app.core.data_sources.imd import ImdClient
from app.core.data_sources.openweather import OpenWeatherClient
from app.schemas.weather import WeatherTimeline


class HybridWeatherClient:
    """Use IMD rainfall for current risk while retaining OpenWeather context."""

    provider_name = "openweather+imd"

    def __init__(self, openweather: OpenWeatherClient, imd: ImdClient):
        self._openweather = openweather
        self._imd = imd

    async def get_timeline(self, catchment: dict[str, Any]) -> WeatherTimeline:
        openweather_timeline, imd_timeline = await asyncio.gather(
            self._openweather.get_timeline(catchment),
            self._imd.get_timeline(catchment),
        )
        openweather_current = openweather_timeline.current
        imd_current = imd_timeline.current
        if imd_current is None:
            return openweather_timeline

        if openweather_current is None:
            current = imd_current
        else:
            current = openweather_current.model_copy(
                update={
                    "valid_at": imd_current.valid_at,
                    "precipitation_24h_mm": imd_current.precipitation_24h_mm,
                    "antecedent_daily_rainfall_mm": (
                        imd_current.antecedent_daily_rainfall_mm
                    ),
                    "source": (
                        f"{imd_current.source}:observed-24h;"
                        f"{openweather_current.source}:conditions"
                    ),
                }
            )

        return WeatherTimeline(
            retrieved_at=max(
                openweather_timeline.retrieved_at, imd_timeline.retrieved_at
            ),
            past=imd_timeline.past,
            current=current,
            forecast=openweather_timeline.forecast,
        )

    async def get_tile(self, layer: str, z: int, x: int, y: int) -> bytes:
        return await self._openweather.get_tile(layer, z, x, y)

    async def get_historical(self, *args: Any, **kwargs: Any) -> WeatherTimeline:
        return await self._imd.get_historical(*args, **kwargs)
