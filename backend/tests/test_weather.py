import asyncio
from datetime import datetime, timezone

import httpx
import pytest

from app.config import Settings
from app.core.data_sources.cache import AsyncTTLCache
from app.core.data_sources.open_meteo import (
    OpenMeteoClient,
    extract_daily_latest_soil_moisture,
    extract_weather_timeline,
)


def weather_payload():
    times = [
        "2026-01-01T22:00",
        "2026-01-01T23:00",
        "2026-01-02T00:00",
        "2026-01-02T01:00",
        "2026-01-02T02:00",
        "2026-01-03T00:00",
    ]
    return {
        "current": {"time": "2026-01-02T00:00"},
        "hourly": {
            "time": times,
            "precipitation": [1, 2, 3, 4, 5, 20],
            "soil_moisture_0_to_1cm": [0.2, 0.21, 0.22, 0.23, 0.24, 0.3],
        },
    }


def test_daily_soil_moisture_does_not_leak_from_later_days():
    payload = weather_payload()

    assert extract_daily_latest_soil_moisture(payload) == [0.21, 0.24, 0.3]


def test_live_timeline_separates_current_and_forecast():
    timeline = extract_weather_timeline(
        weather_payload(),
        retrieved_at=datetime(2026, 1, 2, 0, 5, tzinfo=timezone.utc),
    )

    assert timeline.current.valid_at.isoformat() == "2026-01-02T00:00:00+00:00"
    assert timeline.current.period == "current"
    assert timeline.current.precipitation_1h_mm == 3
    assert timeline.current.precipitation_3h_mm == 6
    assert timeline.forecast[-1].valid_at.date().isoformat() == "2026-01-03"
    assert timeline.forecast[-1].period == "forecast"
    assert timeline.forecast[-1].lead_time_hours == 24
    assert timeline.current.precipitation_24h_mm != timeline.forecast[-1].precipitation_24h_mm


@pytest.mark.asyncio
async def test_ttl_cache_coalesces_identical_work_and_is_bounded():
    cache = AsyncTTLCache[int](max_entries=2, ttl_seconds=60)
    calls = 0

    async def produce():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return 7

    values = await asyncio.gather(
        cache.get_or_create("same", produce), cache.get_or_create("same", produce)
    )
    assert values == [7, 7]
    assert calls == 1

    await cache.get_or_create("second", produce)
    await cache.get_or_create("third", produce)
    assert cache.size == 2


@pytest.mark.asyncio
async def test_open_meteo_client_uses_mocked_http_and_request_cache():
    calls = 0

    async def handler(request):
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return httpx.Response(200, json=weather_payload())

    settings = Settings(data_mode="demo", _env_file=None)
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        weather = OpenMeteoClient(client, settings)
        first, second = await asyncio.gather(
            weather.get_forecast(1, 2), weather.get_forecast(1, 2)
        )

    assert first == second
    assert calls == 1


@pytest.mark.asyncio
async def test_open_meteo_client_bounds_different_upstream_requests():
    active = 0
    maximum_active = 0

    async def handler(request):
        nonlocal active, maximum_active
        active += 1
        maximum_active = max(maximum_active, active)
        await asyncio.sleep(0.02)
        active -= 1
        return httpx.Response(200, json=weather_payload())

    settings = Settings(
        data_mode="demo", weather_max_concurrency=2, _env_file=None
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        weather = OpenMeteoClient(client, settings)
        await asyncio.gather(
            *(weather.get_forecast(latitude, 2) for latitude in range(6))
        )

    assert maximum_active == 2
