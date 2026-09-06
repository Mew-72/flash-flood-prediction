from fastapi import APIRouter, HTTPException

from app.core.data_sources.data_store import get_village_context
from app.core.data_sources.open_meteo import (
    extract_daily_rainfall_totals,
    extract_latest_soil_moisture,
    get_forecast,
)
from app.core.physics.risk_engine import assess_village_risk
from app.schemas.village import RiskOut

router = APIRouter(prefix="/risk", tags=["risk"])


@router.get("/{village_id}", response_model=RiskOut)
def get_village_risk(village_id: str):
    village, catchment = get_village_context(village_id)
    if village is None:
        raise HTTPException(status_code=404, detail="Village not found")
    if catchment is None:
        raise HTTPException(status_code=500, detail="Village has no valid catchment mapping")

    forecast = get_forecast(catchment["centroid_lat"], catchment["centroid_lon"])
    daily_rainfall = extract_daily_rainfall_totals(forecast)
    soil_moisture = extract_latest_soil_moisture(forecast)
    result = assess_village_risk(village, catchment, daily_rainfall, soil_moisture)

    return {
        "village_id": village["id"],
        "village_name": village["name"],
        "overall_risk_level": result["overall_risk_level"],
        "composite_score": result["composite_score"],
        "details": result,
    }
