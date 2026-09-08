"""Run pinned historical rainfall scenarios through the production risk engine.

This module deliberately distinguishes retrospective event detection from an
advance forecast. It performs no network I/O: source responses are reduced to
reviewable values in versioned event fixtures under ``validation/events``.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from app.core.physics.risk_engine import (
    assess_catchment_hazard,
    compose_village_risk,
)

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT.parent / "data" / "processed"
DEFAULT_EVENT_PATH = (
    Path(__file__).resolve().parent / "events" / "kedar_valley_2024_07_31.json"
)
PINNED_EVENT_PATHS = (DEFAULT_EVENT_PATH,)
RISK_ALERT_MAPPING = {
    "low": ("INFO", "NORMAL"),
    "moderate": ("MODERATE", "WATCH"),
    "high": ("HIGH", "WARNING"),
    "critical": ("CRITICAL", "EMERGENCY"),
}


def load_event(path: Path = DEFAULT_EVENT_PATH) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        event = json.load(file)
    if event.get("schema_version") != 1:
        raise ValueError(f"Unsupported event schema: {event.get('schema_version')}")
    return event


def list_pinned_events() -> list[dict[str, Any]]:
    """Load the versioned replay catalog without external I/O."""
    return [load_event(path) for path in PINNED_EVENT_PATHS]


def get_pinned_event(event_id: str) -> dict[str, Any] | None:
    return next(
        (event for event in list_pinned_events() if event["event_id"] == event_id),
        None,
    )


def _forcing_case(event: dict[str, Any], case_id: str | None) -> dict[str, Any]:
    available_ids = {case["case_id"] for case in event["forcing_cases"]}
    preferred_id = "kedarnath-grid-sensitivity"
    default_id = (
        preferred_id
        if preferred_id in available_ids
        else event["forcing_cases"][0]["case_id"]
    )
    selected_id = case_id or default_id
    try:
        return next(
            case for case in event["forcing_cases"] if case["case_id"] == selected_id
        )
    except StopIteration as exc:
        raise ValueError(f"Unknown replay case: {selected_id}") from exc


def _load_demo_context(event: dict[str, Any]) -> tuple[dict, list[dict]]:
    with (DATA_DIR / "demo_catchments.json").open("r", encoding="utf-8") as file:
        catchments = json.load(file)
    with (DATA_DIR / "demo_villages.json").open("r", encoding="utf-8") as file:
        villages = json.load(file)

    context = event["model_context"]
    catchment = next(
        item for item in catchments if item["id"] == context["catchment_id"]
    )
    requested_ids = set(context["village_ids"])
    selected_villages = [item for item in villages if item["id"] in requested_ids]
    if {item["id"] for item in selected_villages} != requested_ids:
        raise ValueError("Event fixture references an unknown demo village")
    return catchment, selected_villages


def _assess(
    catchment: dict,
    villages: list[dict],
    rainfall: list[float],
    soil_moisture: float,
    actionable_levels: set[str],
) -> dict[str, Any]:
    hazard = assess_catchment_hazard(catchment, rainfall)
    village_results = []
    for village in villages:
        result = compose_village_risk(
            village, catchment, hazard, current_soil_moisture=soil_moisture
        )
        village_results.append(
            {
                "village_id": village["id"],
                "risk_level": result["overall_risk_level"],
                "composite_score": result["composite_score"],
                "actionable": result["overall_risk_level"] in actionable_levels,
            }
        )
    return {
        "rainfall_mm": rainfall[-1],
        "hazard": {
            "amc_class": hazard["catchment_hydrology"]["amc_class"],
            "runoff_mm": hazard["catchment_hydrology"]["runoff_mm"],
            "runoff_volume_m3": hazard["catchment_hydrology"]["runoff_volume_m3"],
            "estimated_response_time_minutes": hazard["catchment_hydrology"][
                "estimated_response_time_minutes"
            ],
            "antecedent_5day_mm": round(hazard["antecedent_5day_mm"], 3),
            "antecedent_precipitation_index": hazard[
                "antecedent_precipitation_index"
            ],
        },
        "villages": village_results,
        "any_actionable": any(item["actionable"] for item in village_results),
        "all_actionable": all(item["actionable"] for item in village_results),
    }


def create_timeline_frames(
    event: dict[str, Any], case_id: str | None = None
) -> list[dict[str, Any]]:
    """Create deterministic daily frames from pinned rainfall available by each day."""
    forcing = _forcing_case(event, case_id)
    catchment, villages = _load_demo_context(event)
    context = event["model_context"]
    soil_moisture = float(context["soil_moisture_assumption"])
    actionable_levels = set(context["actionable_levels"])
    antecedent = [float(value) for value in forcing["antecedent_daily_rainfall_mm"]]
    rainfall = [*antecedent, float(forcing["event_day_analysis_rainfall_mm"])]
    impact_date = datetime.fromisoformat(event["impact_start"]).date()
    first_date = impact_date - timedelta(days=len(antecedent))

    frames = []
    previous_severity = None
    for frame_index, rainfall_mm in enumerate(rainfall):
        available_rainfall = rainfall[: frame_index + 1]
        hazard = assess_catchment_hazard(catchment, available_rainfall)
        hazard["antecedent_3day_mm"] = round(hazard["antecedent_3day_mm"], 3)
        hazard["antecedent_5day_mm"] = round(hazard["antecedent_5day_mm"], 3)
        village_results = []
        for village in villages:
            result = compose_village_risk(
                village,
                catchment,
                hazard,
                current_soil_moisture=soil_moisture,
            )
            risk_level = result["overall_risk_level"]
            village_results.append(
                {
                    "id": village["id"],
                    "name": village["name"],
                    "risk_level": risk_level,
                    "composite_score": result["composite_score"],
                    "actionable": risk_level in actionable_levels,
                }
            )

        peak = max(village_results, key=lambda item: item["composite_score"])
        severity, status = RISK_ALERT_MAPPING[peak["risk_level"]]
        frame_date = first_date + timedelta(days=frame_index)
        phase = "impact" if frame_date == impact_date else "antecedent"
        changed = previous_severity is not None and severity != previous_severity
        frames.append(
            {
                "frame_index": frame_index,
                "date": frame_date.isoformat(),
                "phase": phase,
                "label": (
                    "Impact day"
                    if phase == "impact"
                    else f"Antecedent rainfall day {frame_index + 1}"
                ),
                "rainfall_mm": rainfall_mm,
                "cumulative_3day_rainfall_mm": round(
                    sum(available_rainfall[-3:]), 3
                ),
                "hazard": hazard,
                "villages": village_results,
                "peak_risk_level": peak["risk_level"],
                "peak_composite_score": peak["composite_score"],
                "alert": {
                    "severity": severity,
                    "status": status,
                    "headline": (
                        f"Historical replay: {severity} modeled risk on "
                        f"{frame_date.isoformat()}"
                    ),
                    "message": (
                        "Historical replay only; this frame reconstructs modeled risk "
                        "from pinned rainfall and is not a current warning or an "
                        "operational forecast."
                    ),
                    "actionable": peak["risk_level"] in actionable_levels,
                    "changed_from_previous": changed,
                    "previous_severity": previous_severity,
                },
            }
        )
        previous_severity = severity
    return frames


def run_hindcast(event: dict[str, Any]) -> dict[str, Any]:
    catchment, villages = _load_demo_context(event)
    context = event["model_context"]
    soil_moisture = float(context["soil_moisture_assumption"])
    actionable_levels = set(context["actionable_levels"])

    cases = []
    for forcing in event["forcing_cases"]:
        antecedent = [float(value) for value in forcing["antecedent_daily_rainfall_mm"]]
        analysis = _assess(
            catchment,
            villages,
            [*antecedent, float(forcing["event_day_analysis_rainfall_mm"])],
            soil_moisture,
            actionable_levels,
        )
        forecasts = {}
        for lead, rainfall in forcing["previous_run_forecast_rainfall_mm"].items():
            forecasts[lead] = _assess(
                catchment,
                villages,
                [*antecedent, float(rainfall)],
                soil_moisture,
                actionable_levels,
            )

        cases.append(
            {
                "case_id": forcing["case_id"],
                "label": forcing["label"],
                "analysis": analysis,
                "forecasts": forecasts,
                "retrospective_detection": analysis["any_actionable"],
                "actionable_forecast_leads_hours": sorted(
                    int(lead)
                    for lead, result in forecasts.items()
                    if result["any_actionable"]
                ),
            }
        )

    primary = next(
        item for item in cases if item["case_id"] == "current-demo-c1-grid"
    )
    return {
        "event_id": event["event_id"],
        "impact_start": event["impact_start"],
        "cases": cases,
        "verdict": {
            "retrospective_detection": primary["retrospective_detection"],
            "reliable_actionable_advance_warning": bool(
                primary["actionable_forecast_leads_hours"]
            ),
            "scope": "Exact current demo catchment and engine",
            "caveat": (
                "Forecast scenarios reuse event-analysis antecedents and are an "
                "optimistic sensitivity test, not a leakage-free operational replay."
            ),
        },
    }


def event_catalog() -> dict[str, Any]:
    items = []
    for event in list_pinned_events():
        cases = event["forcing_cases"]
        items.append(
            {
                "event_id": event["event_id"],
                "name": event["name"],
                "event_type": event["event_type"],
                "impact_start": event["impact_start"],
                "administrative_area": event["administrative_area"],
                "affected_places": event["reported_evidence"]["affected_places"],
                "cases": [
                    {"case_id": case["case_id"], "label": case["label"]}
                    for case in cases
                ],
                "case_ids": [case["case_id"] for case in cases],
                "default_case_id": (
                    "kedarnath-grid-sensitivity"
                    if any(
                        case["case_id"] == "kedarnath-grid-sensitivity"
                        for case in cases
                    )
                    else cases[0]["case_id"]
                ),
            }
        )
    return {"items": items, "total": len(items)}


def _replay_villages(
    assessment: dict[str, Any], village_names: dict[str, str]
) -> list[dict[str, Any]]:
    return [
        {
            "id": village["village_id"],
            "name": village_names[village["village_id"]],
            "risk_level": village["risk_level"],
            "composite_score": village["composite_score"],
            "actionable": village["actionable"],
        }
        for village in assessment["villages"]
    ]


def build_event_replay(
    event: dict[str, Any], case_id: str | None = None
) -> dict[str, Any]:
    """Build the API replay response solely from pinned fixture data."""
    selected_case = _forcing_case(event, case_id)
    report = run_hindcast(event)
    selected_report = next(
        case for case in report["cases"] if case["case_id"] == selected_case["case_id"]
    )
    _, villages = _load_demo_context(event)
    village_names = {village["id"]: village["name"] for village in villages}

    comparisons = []
    for lead in (24, 48, 72):
        assessment = selected_report["forecasts"][str(lead)]
        replay_villages = _replay_villages(assessment, village_names)
        peak = max(replay_villages, key=lambda item: item["composite_score"])
        analysis_rainfall = float(selected_case["event_day_analysis_rainfall_mm"])
        comparisons.append(
            {
                "lead_hours": lead,
                "forecast_rainfall_mm": assessment["rainfall_mm"],
                "event_day_analysis_rainfall_mm": analysis_rainfall,
                "rainfall_shortfall_mm": round(
                    analysis_rainfall - assessment["rainfall_mm"], 3
                ),
                "villages": replay_villages,
                "peak_risk_level": peak["risk_level"],
                "peak_composite_score": peak["composite_score"],
                "actionable": assessment["any_actionable"],
            }
        )

    expected = event["expected_conclusion"]
    caveats = [*event["model_context"]["notes"], report["verdict"]["caveat"]]
    return {
        "event_id": event["event_id"],
        "name": event["name"],
        "event_type": event["event_type"],
        "impact_start": event["impact_start"],
        "historical_replay": True,
        "administrative_area": event["administrative_area"],
        "affected_places": event["reported_evidence"]["affected_places"],
        "source_evidence": {
            "reported": {
                key: value
                for key, value in event["reported_evidence"].items()
                if key != "affected_places"
            },
            "sources": event["sources"],
        },
        "cases": event["forcing_cases"],
        "selected_case_id": selected_case["case_id"],
        "selected_case_label": selected_case["label"],
        "selected_case": selected_case,
        "timeline": create_timeline_frames(event, selected_case["case_id"]),
        "pinned_forecast_comparison": comparisons,
        "verdict": {
            "retrospective_detection": expected["retrospective_detection"],
            "reliable_actionable_advance_warning": expected[
                "reliable_actionable_advance_warning"
            ],
            "reason": expected["reason"],
            "scope": report["verdict"]["scope"],
        },
        "caveats": caveats,
    }


def _print_report(report: dict[str, Any]) -> None:
    print(f"Event: {report['event_id']}")
    print(f"Impact start: {report['impact_start']}")
    print()
    for case in report["cases"]:
        print(case["label"])
        print("  scenario   rain_mm  " + "  ".join(
            item["village_id"] for item in case["analysis"]["villages"]
        ))
        scenarios = [("analysis", case["analysis"]), *(
            (f"lead-{lead}h", result)
            for lead, result in sorted(
                case["forecasts"].items(), key=lambda item: int(item[0])
            )
        )]
        for name, result in scenarios:
            village_text = "  ".join(
                f"{item['risk_level']}({item['composite_score']:.3f})"
                for item in result["villages"]
            )
            print(f"  {name:<10} {result['rainfall_mm']:>7.1f}  {village_text}")
        print()
    verdict = report["verdict"]
    print(
        "Verdict: retrospective detection="
        f"{verdict['retrospective_detection']}; reliable actionable advance warning="
        f"{verdict['reliable_actionable_advance_warning']}"
    )
    print(f"Caveat: {verdict['caveat']}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("event", nargs="?", type=Path, default=DEFAULT_EVENT_PATH)
    parser.add_argument("--json", action="store_true", dest="as_json")
    args = parser.parse_args()
    report = run_hindcast(load_event(args.event))
    if args.as_json:
        print(json.dumps(report, indent=2))
    else:
        _print_report(report)


if __name__ == "__main__":
    main()
