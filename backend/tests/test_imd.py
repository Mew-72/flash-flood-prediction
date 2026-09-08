import asyncio
from dataclasses import dataclass, field
from datetime import timezone

import httpx
from pydantic import SecretStr
import pytest

from app.core.data_sources.imd import (
    ImdCapabilityError,
    ImdClient,
    ImdConfigurationError,
    ImdError,
)


@dataclass
class ImdTestSettings:
    imd_api_base_url: str = "https://api.imd.gov.in/api/v1"
    imd_api_key: SecretStr | None = field(
        default_factory=lambda: SecretStr("gateway-key")
    )
    imd_access_token: SecretStr | None = field(
        default_factory=lambda: SecretStr("jwt-token")
    )
    weather_cache_max_entries: int = 16
    weather_cache_ttl_seconds: float = 60.0
    weather_max_concurrency: int = 2


def imd_settings() -> ImdTestSettings:
    return ImdTestSettings()


@pytest.mark.asyncio
async def test_timeline_authenticates_and_selects_nearest_exact_observation():
    requests = []

    async def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        assert request.headers["x-api-key"] == "gateway-key"
        assert request.headers["Authorization"] == "Bearer jwt-token"

        if request.url.path.endswith("/cityforecastloc"):
            assert "id" not in request.url.params
            return httpx.Response(
                200,
                json={
                    "data": [
                        {
                            "Date": "2026-07-01",
                            "Latitude": "30.0",
                            "Longitude": "80.0",
                            "Past_24_hrs_Rainfall": "99",
                        },
                        {
                            "DATE": "2026-07-02",
                            "latitude": "28.61",
                            "LONGITUDE": "77.21",
                            "past_24_hrs_rainfall": "7.25",
                        },
                    ]
                },
            )

        pytest.fail(f"Unexpected IMD request: {request.url}")

    catchment = {
        "centroid_lat": 28.6,
        "centroid_lon": 77.2,
        "imd_basin_id": "100",
    }
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        timeline = await ImdClient(client, imd_settings()).get_timeline(catchment)

    assert len(requests) == 1
    assert timeline.past == []
    current = timeline.current
    assert current is not None
    assert current.period == "current"
    assert current.valid_at.isoformat() == "2026-07-02T03:00:00+00:00"
    assert current.valid_at.tzinfo is timezone.utc
    assert current.precipitation_24h_mm == 7.25
    assert current.precipitation_1h_mm is None
    assert current.precipitation_3h_mm is None
    assert current.precipitation_6h_mm is None
    assert current.soil_moisture is None
    assert current.antecedent_daily_rainfall_mm == []
    assert current.source == "imd-cityforecastloc"

    assert timeline.forecast == []


@pytest.mark.asyncio
async def test_city_request_cache_coalesces_and_accepts_raw_object_response():
    calls = 0

    async def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        await asyncio.sleep(0.01)
        return httpx.Response(
            200,
            json={
                "Date": "2026-08-09",
                "LATITUDE": "30.3",
                "longitude": "78.1",
                "Past_24_hrs_Rainfall": "TRACE",
            },
        )

    catchment = {"centroid_lat": "30.3", "centroid_lon": "78.1"}
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        weather = ImdClient(client, imd_settings())
        first, second = await asyncio.gather(
            weather.get_timeline(catchment), weather.get_timeline(catchment)
        )

    assert calls == 1
    assert first.current is not None
    assert second.current is not None
    assert first.current.precipitation_24h_mm == 0
    assert second.current.precipitation_24h_mm == 0


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("api_key", "access_token"),
    [(None, SecretStr("jwt-token")), (SecretStr("gateway-key"), None)],
)
async def test_missing_credentials_raise_configuration_error(api_key, access_token):
    async def handler(request: httpx.Request) -> httpx.Response:
        pytest.fail(f"Unexpected IMD request: {request.url}")

    settings = ImdTestSettings(
        imd_api_key=api_key, imd_access_token=access_token
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        weather = ImdClient(client, settings)
        with pytest.raises(ImdConfigurationError, match="key and access token"):
            await weather.get_timeline({"centroid_lat": 1, "centroid_lon": 2})


@pytest.mark.asyncio
@pytest.mark.parametrize("rainfall", [None, "5-10", "isolated rain"])
async def test_current_rainfall_must_be_present_and_exact(rainfall):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json=[
                {
                    "Date": "2026-01-01",
                    "Latitude": 1,
                    "Longitude": 2,
                    "Past_24_hrs_Rainfall": rainfall,
                }
            ],
        )

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        weather = ImdClient(client, imd_settings())
        with pytest.raises(ImdError, match="exact current 24-hour rainfall"):
            await weather.get_timeline({"centroid_lat": 1, "centroid_lon": 2})


@pytest.mark.asyncio
async def test_historical_reports_documented_capability_gap():
    async def handler(request: httpx.Request) -> httpx.Response:
        pytest.fail(f"Unexpected IMD request: {request.url}")

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        weather = ImdClient(client, imd_settings())
        with pytest.raises(
            ImdCapabilityError, match="no historical date-range endpoint"
        ):
            await weather.get_historical(30.3, 78.1, "2020-01-01", "2020-01-31")
