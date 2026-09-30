from datetime import datetime, timezone

import pytest

from app.core.data_sources.hybrid_weather import HybridWeatherClient
from app.schemas.weather import WeatherSnapshot, WeatherTimeline


NOW = datetime(2026, 9, 29, 6, 0, tzinfo=timezone.utc)


def _snapshot(*, rainfall: float, source: str, condition: str | None = None):
    return WeatherSnapshot(
        period="current",
        retrieved_at=NOW,
        valid_at=NOW,
        lead_time_hours=0,
        precipitation_24h_mm=rainfall,
        source=source,
        temperature_c=17.5 if condition else None,
        weather_condition=condition,
    )


class _OpenWeather:
    async def get_timeline(self, catchment):
        del catchment
        current = _snapshot(
            rainfall=2.0,
            source="openweather-current:rain.1h",
            condition="Clouds",
        )
        forecast = current.model_copy(
            update={"period": "forecast", "lead_time_hours": 3.0}
        )
        return WeatherTimeline(
            retrieved_at=NOW,
            past=[],
            current=current,
            forecast=[forecast],
        )

    async def get_tile(self, layer, z, x, y):
        return f"{layer}/{z}/{x}/{y}".encode()


class _Imd:
    async def get_timeline(self, catchment):
        del catchment
        return WeatherTimeline(
            retrieved_at=NOW,
            past=[],
            current=_snapshot(
                rainfall=27.5,
                source="imd-cityforecastloc",
            ),
            forecast=[],
        )


@pytest.mark.asyncio
async def test_imd_observation_replaces_only_current_model_rainfall():
    weather = HybridWeatherClient(_OpenWeather(), _Imd())

    timeline = await weather.get_timeline(
        {"centroid_lat": 30.3, "centroid_lon": 78.1}
    )

    assert timeline.current is not None
    assert timeline.current.precipitation_24h_mm == 27.5
    assert timeline.current.temperature_c == 17.5
    assert timeline.current.weather_condition == "Clouds"
    assert timeline.current.source == (
        "imd-cityforecastloc:observed-24h;"
        "openweather-current:rain.1h:conditions"
    )
    assert timeline.forecast[0].precipitation_24h_mm == 2.0
    assert await weather.get_tile("precipitation_new", 3, 4, 2) == (
        b"precipitation_new/3/4/2"
    )
