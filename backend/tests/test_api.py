import httpx
from fastapi.testclient import TestClient

from app.config import get_settings
from app.core.data_sources.data_store import clear_cache
from app.main import create_app


def _payload():
    times = [f"2026-01-01T{hour:02d}:00" for hour in range(24)] + [
        f"2026-01-02T{hour:02d}:00" for hour in range(24)
    ]
    return {
        "current": {"time": "2026-01-01T23:00"},
        "hourly": {
            "time": times,
            "precipitation": [1.0] * len(times),
            "soil_moisture_0_to_1cm": [0.3] * len(times),
        },
    }


def test_health_catalog_batch_and_grouped_snapshots_are_mocked(monkeypatch):
    monkeypatch.setenv("DATA_MODE", "demo")
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
        assert calls == 2

        forecast = client.post(
            "/v1/risk/batch",
            json={"village_ids": ["v1"], "include_forecast": True},
        )
        periods = [item["period"] for item in forecast.json()["items"]]
        assert periods[0] == "current"
        assert periods[-1] == "forecast"
        assert forecast.json()["items"][-1]["lead_time_hours"] == 24
        assert calls == 2

    get_settings.cache_clear()
    clear_cache()
