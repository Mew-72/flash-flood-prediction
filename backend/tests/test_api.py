import httpx
from fastapi.testclient import TestClient

from app.config import get_settings
from app.core.data_sources.data_store import clear_cache
from app.main import create_app

CURRENT_DT = 1_800_000_000


def _conditions(timestamp: int):
    return {
        "dt": timestamp,
        "main": {
            "temp": 16.25,
            "feels_like": 15.75,
            "humidity": 88,
            "pressure": 1004,
        },
        "wind": {"speed": 3.5, "deg": 190},
        "clouds": {"all": 91},
        "visibility": 4500,
        "weather": [
            {"main": "Rain", "description": "heavy intensity rain", "icon": "10n"}
        ],
    }


def _weather_payload():
    return {**_conditions(CURRENT_DT), "rain": {"1h": 6.0, "3h": 18.0}}


def _forecast_payload():
    entries = []
    for index in range(1, 10):
        item = _conditions(CURRENT_DT + index * 3 * 3600)
        item["rain"] = {"3h": float(index)}
        entries.append(item)
    return {"cod": "200", "list": entries}


def test_openweather_runtime_health_risk_tiles_and_replay_are_mocked(monkeypatch):
    monkeypatch.setenv("DATA_MODE", "demo")
    monkeypatch.setenv("WEATHER_API", "test-weather-key")
    get_settings.cache_clear()
    clear_cache()
    calls: list[str] = []

    def handler(request: httpx.Request):
        calls.append(request.url.path)
        assert request.url.params["appid"] == "test-weather-key"
        if request.url.path == "/data/2.5/weather":
            assert request.url.params["units"] == "metric"
            return httpx.Response(200, json=_weather_payload())
        if request.url.path == "/data/2.5/forecast":
            assert request.url.params["units"] == "metric"
            return httpx.Response(200, json=_forecast_payload())
        if request.url.path == "/map/precipitation_new/3/4/2.png":
            assert "units" not in request.url.params
            return httpx.Response(
                200,
                content=b"mock-png",
                headers={"Content-Type": "image/png"},
            )
        raise AssertionError(f"Unexpected OpenWeather request: {request.url}")

    app = create_app(
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )
    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["data_mode"] == "demo"
        assert health.json()["weather_provider"] == "openweather"
        assert health.json()["weather_configured"] is True
        assert "five_day_forecast_at_3h_intervals" in health.json()[
            "weather_capabilities"
        ]
        assert "precipitation_and_cloud_tiles" in health.json()[
            "weather_capabilities"
        ]
        assert health.json()["provenance"]["static_sources"] == [
            "demo_villages.json",
            "demo_catchments.json",
        ]

        catalog = client.get("/v1/villages?district=demo&offset=1&limit=2")
        assert catalog.status_code == 200
        assert catalog.json()["total"] == 5
        assert len(catalog.json()["items"]) == 2
        assert client.get("/v1/villages?district=not-demo").json()["total"] == 0

        unbounded_batch = client.post("/v1/risk/batch", json={})
        assert unbounded_batch.status_code == 422

        batch = client.post(
            "/v1/risk/batch", json={"village_ids": ["v1", "v3", "missing"]}
        )
        assert batch.status_code == 200, batch.text
        body = batch.json()
        assert body["requested"] == 3
        assert body["returned"] == 2
        assert body["errors"] == [
            {"id": "missing", "error": "Village not found"}
        ]
        assert all(item["period"] == "current" for item in body["items"])
        snapshot = body["items"][0]
        assert snapshot["precipitation_24h_mm"] == 18.0
        assert snapshot["provenance"]["weather_source"] == (
            "openweather-current:rain.3h"
        )
        assert snapshot["assessment_mode"] == "canonical"
        assert snapshot["provenance"]["risk_input_mode"] == "canonical"
        assert snapshot["temperature_c"] == 16.25
        assert snapshot["feels_like_c"] == 15.75
        assert snapshot["humidity_percent"] == 88
        assert snapshot["pressure_hpa"] == 1004
        assert snapshot["wind_speed_mps"] == 3.5
        assert snapshot["wind_direction_deg"] == 190
        assert snapshot["cloud_cover_percent"] == 91
        assert snapshot["visibility_m"] == 4500
        assert snapshot["weather_condition"] == "Rain"
        assert snapshot["weather_description"] == "heavy intensity rain"
        assert snapshot["weather_icon"] == "10n"
        assert calls.count("/data/2.5/weather") == 1
        assert calls.count("/data/2.5/forecast") == 1

        grouped = client.get("/v1/risk/snapshots?district=demo")
        assert grouped.status_code == 200, grouped.text
        groups = grouped.json()["catchments"]
        assert {group["catchment_id"] for group in groups} == {"c1", "c2"}
        assert all(group["snapshots"] for group in groups)
        assert calls.count("/data/2.5/weather") == 2
        assert calls.count("/data/2.5/forecast") == 2

        forecast = client.post(
            "/v1/risk/batch",
            json={"village_ids": ["v1"], "include_forecast": True},
        )
        assert forecast.status_code == 200, forecast.text
        assert [item["period"] for item in forecast.json()["items"]] == [
            "current",
            "forecast",
            "forecast",
            "forecast",
            "forecast",
        ]
        assert [item["lead_time_hours"] for item in forecast.json()["items"]] == [
            0,
            3,
            6,
            24,
            27,
        ]
        assert calls.count("/data/2.5/weather") == 2
        assert calls.count("/data/2.5/forecast") == 2

        tile = client.get("/v1/weather/tiles/precipitation_new/3/4/2.png")
        assert tile.status_code == 200
        assert tile.content == b"mock-png"
        assert tile.headers["content-type"] == "image/png"
        assert tile.headers["cache-control"] == "public, max-age=300"
        cached_tile = client.get(
            "/v1/weather/tiles/precipitation_new/3/4/2.png"
        )
        assert cached_tile.status_code == 200
        assert calls.count("/map/precipitation_new/3/4/2.png") == 1
        assert client.get("/v1/weather/tiles/temperature_new/3/4/2.png").status_code == 404
        assert client.get("/v1/weather/tiles/clouds_new/3/8/2.png").status_code == 422
        assert calls.count("/map/precipitation_new/3/4/2.png") == 1

        replay = client.get(
            "/replay/v1?start_date=2024-07-01&end_date=2024-07-02"
        )
        assert replay.status_code == 501
        assert replay.json()["detail"] == (
            "OpenWeather free runtime endpoints do not support historical replay"
        )

    get_settings.cache_clear()
    clear_cache()
