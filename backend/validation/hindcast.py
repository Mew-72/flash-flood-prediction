"""Run pinned historical rainfall scenarios through the production risk engine.

This module deliberately distinguishes retrospective event detection from an
advance forecast. It performs no network I/O: source responses are reduced to
reviewable values in versioned event fixtures under ``validation/events``.
"""

from __future__ import annotations

import argparse
import json
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


def load_event(path: Path = DEFAULT_EVENT_PATH) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as file:
        event = json.load(file)
    if event.get("schema_version") != 1:
        raise ValueError(f"Unsupported event schema: {event.get('schema_version')}")
    return event


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
