import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.core.data_sources.data_store import clear_cache
from app.main import create_app
from validation.hindcast import create_timeline_frames, load_event

EVENT_ID = "in-uk-rudraprayag-kedar-valley-2024-07-31"


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("DATA_MODE", "demo")
    get_settings.cache_clear()
    clear_cache()

    def reject_network(request: httpx.Request):
        raise AssertionError(f"Replay made an unexpected network call: {request.url}")

    app = create_app(
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(reject_network))
    )
    with TestClient(app) as test_client:
        yield test_client

    get_settings.cache_clear()
    clear_cache()


def test_replay_event_catalog_is_pinned_and_network_free(client):
    response = client.get("/replay/events")

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["event_id"] == EVENT_ID
    assert body["items"][0]["default_case_id"] == "kedarnath-grid-sensitivity"
    assert [case["case_id"] for case in body["items"][0]["cases"]] == [
        "current-demo-c1-grid",
        "kedarnath-grid-sensitivity",
    ]
    assert body["items"][0]["affected_places"] == [
        "Kedarnath",
        "Lincholi",
        "Bhimbali",
        "Rambada",
        "Gaurikund",
        "Sonprayag",
    ]


def test_replay_timeline_has_ordered_daily_prefix_frames_and_alert_transitions(client):
    response = client.get(
        f"/replay/events/{EVENT_ID}?case_id=current-demo-c1-grid"
    )

    assert response.status_code == 200, response.text
    body = response.json()
    timeline = body["timeline"]
    assert [frame["frame_index"] for frame in timeline] == list(range(7))
    assert [frame["date"] for frame in timeline] == [
        "2024-07-25",
        "2024-07-26",
        "2024-07-27",
        "2024-07-28",
        "2024-07-29",
        "2024-07-30",
        "2024-07-31",
    ]
    assert [frame["phase"] for frame in timeline] == [
        "antecedent",
        "antecedent",
        "antecedent",
        "antecedent",
        "antecedent",
        "antecedent",
        "impact",
    ]
    assert timeline[-1]["cumulative_3day_rainfall_mm"] == 67.9
    assert timeline[-1]["hazard"]["antecedent_5day_mm"] == 60.9

    changed = [frame for frame in timeline if frame["alert"]["changed_from_previous"]]
    assert [(frame["date"], frame["alert"]["severity"]) for frame in changed] == [
        ("2024-07-30", "HIGH")
    ]
    assert changed[0]["alert"]["previous_severity"] == "MODERATE"
    assert timeline[-1]["alert"]["status"] == "WARNING"
    assert timeline[-1]["alert"]["actionable"] is True
    assert "not a current warning" in timeline[-1]["alert"]["message"]


def test_known_event_day_scores_and_pinned_forecast_comparison(client):
    primary = client.get(
        f"/replay/events/{EVENT_ID}?case_id=current-demo-c1-grid"
    ).json()
    assert primary["timeline"][-1]["peak_risk_level"] == "high"
    assert primary["timeline"][-1]["peak_composite_score"] == 0.696
    assert [item["lead_hours"] for item in primary["pinned_forecast_comparison"]] == [
        24,
        48,
        72,
    ]
    assert all(
        item["actionable"] is False
        for item in primary["pinned_forecast_comparison"]
    )
    assert primary["verdict"]["retrospective_detection"] is True
    assert primary["verdict"]["reliable_actionable_advance_warning"] is False

    sensitivity = client.get(f"/replay/events/{EVENT_ID}")
    assert sensitivity.status_code == 200, sensitivity.text
    sensitivity_body = sensitivity.json()
    assert sensitivity_body["selected_case_id"] == "kedarnath-grid-sensitivity"
    assert sensitivity_body["selected_case_label"].startswith(
        "Location-corrected Kedarnath"
    )
    event_day = sensitivity_body["timeline"][-1]
    assert event_day["peak_risk_level"] == "critical"
    assert [village["composite_score"] for village in event_day["villages"]] == [
        0.804,
        0.756,
        0.815,
    ]


def test_replay_rejects_unknown_event_and_case(client):
    assert client.get("/replay/events/not-an-event").status_code == 404
    response = client.get(f"/replay/events/{EVENT_ID}?case_id=not-a-case")
    assert response.status_code == 404
    assert response.json()["detail"] == "Replay case not found"


def test_timeline_builder_uses_only_rainfall_available_through_each_day():
    frames = create_timeline_frames(load_event(), "current-demo-c1-grid")

    assert frames[0]["rainfall_mm"] == 37.0
    assert frames[0]["cumulative_3day_rainfall_mm"] == 37.0
    assert frames[0]["hazard"]["antecedent_5day_mm"] == 0.0
    assert frames[2]["cumulative_3day_rainfall_mm"] == 72.7
    assert frames[2]["hazard"]["antecedent_5day_mm"] == 60.3


def test_simulate_uses_provisional_defaults_for_catalog_only_records(client):
    village = {
        "id": "catalog-only",
        "name": "Catalog only village",
        "catchment_id": "proxy",
        "model_ready": False,
        "slope_deg": None,
        "terrain_class": None,
        "distance_to_stream_m": None,
    }
    catchment = {
        "id": "proxy",
        "name": "Administrative proxy",
        "model_ready": False,
        "area_km2": 100.0,
        "land_use": None,
        "hydrologic_soil_group": None,
        "soil_texture": None,
        "mean_slope_deg": None,
        "flow_path_length_m": None,
        "channel_slope_percent": None,
        "base_rainfall_threshold_mm": None,
    }

    class CatalogOnlyStore:
        @staticmethod
        def village_context(village_id):
            assert village_id == "catalog-only"
            return village, catchment

    client.app.state.data_store = CatalogOnlyStore()
    response = client.post(
        "/simulate",
        json={
            "village_id": "catalog-only",
            "daily_rainfall_mm": [10.0, 20.0, 60.0],
            "current_soil_moisture": 0.35,
        },
    )

    assert response.status_code == 200, response.text
    result = response.json()["result"]
    assert result["assessment_mode"] == "provisional_defaults"
    assert result["assessment_note"].startswith("Provisional score:")
    assert result["catchment_id"] == "proxy"
    assert 0 <= result["composite_score"] <= 1
