from fastapi import APIRouter, HTTPException

from app.core.data_sources.data_store import get_village_context
from app.core.physics.risk_engine import assess_village_risk
from app.schemas.village import SimulateRequest, SimulateResponse

router = APIRouter(prefix="/simulate", tags=["simulate"])


@router.post("", response_model=SimulateResponse)
def simulate_scenario(payload: SimulateRequest):
    village, catchment = get_village_context(payload.village_id)
    if village is None:
        raise HTTPException(status_code=404, detail="Village not found")
    if catchment is None:
        raise HTTPException(status_code=500, detail="Village has no valid catchment mapping")

    result = assess_village_risk(
        village,
        catchment,
        payload.daily_rainfall_mm,
        payload.current_soil_moisture,
        payload.base_threshold_override_mm,
    )
    return {"village_id": village["id"], "result": result}
