from validation.hindcast import load_event, run_hindcast


def _case(report: dict, case_id: str) -> dict:
    return next(item for item in report["cases"] if item["case_id"] == case_id)


def test_exact_demo_configuration_detects_event_only_retrospectively():
    report = run_hindcast(load_event())
    current = _case(report, "current-demo-c1-grid")

    assert [item["risk_level"] for item in current["analysis"]["villages"]] == [
        "high",
        "high",
        "high",
    ]
    assert current["analysis"]["hazard"]["amc_class"] == 3
    assert current["analysis"]["hazard"]["antecedent_5day_mm"] == 60.9
    assert current["retrospective_detection"] is True
    assert current["actionable_forecast_leads_hours"] == []
    assert all(
        village["risk_level"] == "moderate"
        for scenario in current["forecasts"].values()
        for village in scenario["villages"]
    )
    assert report["verdict"]["reliable_actionable_advance_warning"] is False


def test_location_corrected_rainfall_escalates_retrospective_scores():
    report = run_hindcast(load_event())
    kedarnath = _case(report, "kedarnath-grid-sensitivity")

    assert [item["risk_level"] for item in kedarnath["analysis"]["villages"]] == [
        "critical",
        "critical",
        "critical",
    ]
    assert [
        item["composite_score"] for item in kedarnath["analysis"]["villages"]
    ] == [0.804, 0.756, 0.815]
    assert kedarnath["analysis"]["hazard"]["runoff_mm"] == 43.11
    assert kedarnath["analysis"]["hazard"]["antecedent_5day_mm"] == 79.4
    assert kedarnath["actionable_forecast_leads_hours"] == []


def test_fixture_preserves_event_and_forecast_provenance():
    event = load_event()

    assert event["impact_start"] == "2024-07-31T19:30:00+05:30"
    assert event["reported_evidence"]["sonprayag_max_hourly_rainfall_mm"] == 30.0
    assert event["reported_evidence"]["sonprayag_value_is_lower_bound"] is True
    assert event["reported_evidence"]["imd_warning_level"] == "red"
    assert event["expected_conclusion"] == {
        "retrospective_detection": True,
        "reliable_actionable_advance_warning": False,
        "reason": (
            "The engine escalates when supplied completed event-day rainfall, but "
            "Open-Meteo previous runs severely underpredicted the localized storm "
            "and the engine discards the reported hourly intensity."
        ),
    }
