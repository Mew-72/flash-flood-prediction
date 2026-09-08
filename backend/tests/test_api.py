import httpx
from fastapi.testclient import TestClient

from app.config import get_settings
from app.core.data_sources.data_store import clear_cache
from app.main import create_app


def _payload():
    return [
        {
            "Date": "2026-01-01",
            "Station_Code": "DEMO",
            "Station_Name": "Demo IMD station",
            "Latitude": "30.35",
            "Longitude": "78.95",
            "Past_24_hrs_Rainfall": "24.0",
        }
    ]


def test_health_catalog_batch_and_grouped_snapshots_are_mocked(monkeypatch):
    monkeypatch.setenv("DATA_MODE", "demo")
    monkeypatch.setenv("IMD_API_KEY", "test-api-key")
    monkeypatch.setenv("IMD_ACCESS_TOKEN", "test-access-token")
    get_settings.cache_clear()
    clear_cache()
    calls = 0

    def handler(request):
        nonlocal calls
        calls += 1
        return httpx.Response(200, json=_payload())

    app = create_app(
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler))
    )
    with TestClient(app) as client:
        health = client.get("/health")
        assert health.status_code == 200
        assert health.json()["data_mode"] == "demo"
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
        assert calls == 1

        grouped = client.get("/v1/risk/snapshots?district=demo")
        assert grouped.status_code == 200, grouped.text
        groups = grouped.json()["catchments"]
        assert {group["catchment_id"] for group in groups} == {"c1", "c2"}
        assert all(group["snapshots"] for group in groups)
        assert calls == 1

        forecast = client.post(
            "/v1/risk/batch",
            json={"village_ids": ["v1"], "include_forecast": True},
        )
        periods = [item["period"] for item in forecast.json()["items"]]
        assert periods == ["current"]
        assert forecast.json()["items"][0]["lead_time_hours"] == 0
        assert calls == 1

    get_settings.cache_clear()
    clear_cache()
