from fastapi import APIRouter, HTTPException

from app.core.data_sources.data_store import get_village_context
from app.core.data_sources.open_meteo import (
    extract_daily_rainfall_totals,
    extract_latest_soil_moisture,
    get_historical,
)
from app.core.physics.risk_engine import assess_village_risk

router = APIRouter(prefix="/replay", tags=["replay"])


@router.get("/{village_id}")
def replay_event(village_id: str, start_date: str, end_date: str):
    """Replay a historical weather window through the production risk path."""
    village, catchment = get_village_context(village_id)
    if village is None:
        raise HTTPException(status_code=404, detail="Village not found")
    if catchment is None:
        raise HTTPException(status_code=500, detail="Village has no valid catchment mapping")

    historical = get_historical(
        catchment["centroid_lat"], catchment["centroid_lon"], start_date, end_date
    )
    daily_rainfall = extract_daily_rainfall_totals(historical)
    soil_moisture = extract_latest_soil_moisture(historical)

    timeline = []
    for day_index in range(1, len(daily_rainfall) + 1):
        result = assess_village_risk(
            village, catchment, daily_rainfall[:day_index], soil_moisture
        )
        timeline.append({
            "day_index": day_index,
            "rainfall_mm": daily_rainfall[day_index - 1],
            "risk": result["overall_risk_level"],
            "score": result["composite_score"],
        })

    return {
        "village_id": village["id"],
        "catchment_id": catchment["id"],
        "start_date": start_date,
        "end_date": end_date,
        "timeline": timeline,
    }
