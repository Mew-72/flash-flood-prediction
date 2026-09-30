import httpx
from fastapi.testclient import TestClient

from app.config import get_settings
from app.core.data_sources.data_store import clear_cache
from app.main import create_app


def test_demo_runtime_is_network_free_and_deterministic(monkeypatch):
    monkeypatch.setenv("DATA_MODE", "demo")
    monkeypatch.delenv("WEATHER_API", raising=False)
    monkeypatch.delenv("IMD_API_KEY", raising=False)
    monkeypatch.delenv("IMD_ACCESS_TOKEN", raising=False)
    get_settings.cache_clear()
    clear_cache()

    def unexpected_http_client() -> httpx.AsyncClient:
        raise AssertionError("Demo mode must not create an external HTTP client")

    app = create_app(unexpected_http_client)
    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["data_mode"] == "demo"
        assert health.json()["weather_provider"] == "demo"
        assert health.json()["weather_configured"] is True
        assert "no_external_weather_requests" in health.json()[
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
        assert snapshot["precipitation_24h_mm"] == 42.0
        assert snapshot["provenance"]["weather_source"] == (
            "demo-synthetic:current-24h"
        )
        assert snapshot["hazard"]["antecedent_5day_mm"] == 63.0
        assert snapshot["assessment_mode"] == "canonical"
        assert snapshot["weather_condition"] == "Heavy rain"

        grouped = client.get("/v1/risk/snapshots?district=demo")
        assert grouped.status_code == 200, grouped.text
        groups = grouped.json()["catchments"]
        assert {group["catchment_id"] for group in groups} == {"c1", "c2"}
        assert all(group["snapshots"] for group in groups)

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
            48,
        ]

        tile = client.get("/v1/weather/tiles/precipitation_new/3/4/2.png")
        assert tile.status_code == 503
        assert tile.json()["detail"] == (
            "Weather tiles are disabled for the active data mode"
        )

        replay = client.get(
            "/replay/v1?start_date=2024-07-01&end_date=2024-07-02"
        )
        assert replay.status_code == 501
        assert "pinned event replay" in replay.json()["detail"]

    get_settings.cache_clear()
    clear_cache()
