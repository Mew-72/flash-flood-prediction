import asyncio
from dataclasses import dataclass, field

import httpx
from pydantic import SecretStr
import pytest

from app.core.data_sources.openweather import (
    OpenWeatherCapabilityError,
    OpenWeatherClient,
    OpenWeatherConfigurationError,
)

CURRENT_DT = 1_800_000_000


@dataclass
class OpenWeatherTestSettings:
    openweather_api_base_url: str = "https://api.openweathermap.org"
    openweather_tile_base_url: str = "https://tile.openweathermap.org"
    weather_api: SecretStr | None = field(
        default_factory=lambda: SecretStr("server-key")
    )
    weather_cache_max_entries: int = 16
    weather_cache_ttl_seconds: float = 60.0
    weather_max_concurrency: int = 2


def _conditions(timestamp: int) -> dict:
    return {
        "dt": timestamp,
        "main": {
            "temp": 18.5,
            "feels_like": 18.0,
            "humidity": 82,
            "pressure": 1007,
        },
        "wind": {"speed": 4.2, "deg": 215},
        "clouds": {"all": 74},
        "visibility": 6000,
        "weather": [
            {"main": "Rain", "description": "moderate rain", "icon": "10d"}
        ],
    }


def _current_payload() -> dict:
    return {**_conditions(CURRENT_DT), "rain": {"1h": 2.5, "3h": 7.5}}


def _forecast_payload() -> dict:
    entries = []
    for index, rainfall in enumerate(range(1, 10), start=1):
        entry = _conditions(CURRENT_DT + index * 3 * 3600)
        entry["rain"] = {"3h": rainfall}
        entries.append(entry)
    return {"cod": "200", "list": entries}


@pytest.mark.asyncio
async def test_timeline_uses_metric_endpoints_and_exact_rain_windows():
    requests: list[httpx.Request] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.url.params["appid"] == "server-key"
        assert request.url.params["units"] == "metric"
        if request.url.path == "/data/2.5/weather":
            return httpx.Response(200, json=_current_payload())
        if request.url.path == "/data/2.5/forecast":
            return httpx.Response(200, json=_forecast_payload())
        pytest.fail(f"Unexpected OpenWeather request: {request.url}")

    catchment = {"centroid_lat": 30.3, "centroid_lon": 78.1}
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        weather = OpenWeatherClient(client, OpenWeatherTestSettings())
        first, second = await asyncio.gather(
            weather.get_timeline(catchment), weather.get_timeline(catchment)
        )

    assert len(requests) == 2
    assert {request.url.path for request in requests} == {
        "/data/2.5/weather",
        "/data/2.5/forecast",
    }
    assert first.current is not None
    assert second.current is not None
    current = first.current
    assert current.precipitation_1h_mm == 2.5
    assert current.precipitation_3h_mm == 7.5
    assert current.precipitation_6h_mm is None
    assert current.precipitation_24h_mm == 7.5
    assert current.source == "openweather-current:rain.3h"
    assert current.temperature_c == 18.5
    assert current.feels_like_c == 18.0
    assert current.humidity_percent == 82
    assert current.pressure_hpa == 1007
    assert current.wind_speed_mps == 4.2
    assert current.wind_direction_deg == 215
    assert current.cloud_cover_percent == 74
    assert current.visibility_m == 6000
    assert current.weather_condition == "Rain"
    assert current.weather_description == "moderate rain"
    assert current.weather_icon == "10d"

    forecast = first.forecast
    assert len(forecast) == 9
    assert forecast[0].precipitation_3h_mm == 1
    assert forecast[0].precipitation_6h_mm is None
    assert forecast[0].precipitation_24h_mm == 1
    assert "rolling-24h=1x3h" in forecast[0].source
    assert forecast[1].precipitation_6h_mm == 3
    assert forecast[7].precipitation_24h_mm == 36
    assert "rolling-24h=8x3h" in forecast[7].source
    assert forecast[8].precipitation_24h_mm == 44


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("rain", "expected", "source"),
    [
        ({"1h": 4.0}, 4.0, "openweather-current:rain.1h"),
        (None, 0.0, "openweather-current:no-rain-field=0"),
    ],
)
async def test_current_model_rainfall_fallback_is_traceable(rain, expected, source):
    current = _conditions(CURRENT_DT)
    if rain is not None:
        current["rain"] = rain

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/weather"):
            return httpx.Response(200, json=current)
        return httpx.Response(200, json={"list": []})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        timeline = await OpenWeatherClient(
            client, OpenWeatherTestSettings()
        ).get_timeline({"centroid_lat": 30.3, "centroid_lon": 78.1})

    assert timeline.current is not None
    assert timeline.current.precipitation_24h_mm == expected
    assert timeline.current.source == source


@pytest.mark.asyncio
async def test_missing_weather_api_fails_without_an_upstream_request():
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(500)

    settings = OpenWeatherTestSettings(weather_api=None)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        weather = OpenWeatherClient(client, settings)
        with pytest.raises(OpenWeatherConfigurationError, match="WEATHER_API"):
            await weather.get_timeline({"centroid_lat": 30.3, "centroid_lon": 78.1})

    assert calls == 0


@pytest.mark.asyncio
async def test_historical_replay_is_unsupported():
    async with httpx.AsyncClient() as client:
        weather = OpenWeatherClient(client, OpenWeatherTestSettings())
        with pytest.raises(OpenWeatherCapabilityError, match="historical replay"):
            await weather.get_historical({}, "2024-01-01", "2024-01-02")
