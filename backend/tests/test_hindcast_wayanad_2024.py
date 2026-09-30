from pathlib import Path

from validation.hindcast import load_event, run_hindcast

EVENT_PATH = (
    Path(__file__).resolve().parents[1]
    / "validation"
    / "events"
    / "wayanad_2024_07_30.json"
)


def test_wayanad_replay_detects_observed_rainfall_but_not_prior_runs():
    event = load_event(EVENT_PATH)
    report = run_hindcast(event)
    case = report["cases"][0]

    assert event["reported_evidence"]["reported_rainfall_mm_in_48_hours"] == 572.0
    assert case["analysis"]["hazard"]["antecedent_5day_mm"] == 128.5
    assert [village["risk_level"] for village in case["analysis"]["villages"]] == [
        "high",
        "high",
        "critical",
    ]
    assert case["retrospective_detection"] is True
    assert case["actionable_forecast_leads_hours"] == []
    assert report["verdict"]["reliable_actionable_advance_warning"] is False
