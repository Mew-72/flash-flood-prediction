from fastapi import APIRouter, HTTPException, Request

from app.core.physics.risk_engine import assess_village_risk
from app.core.risk_service import (
    PROVISIONAL_ASSESSMENT_NOTE,
    _prepare_catchment,
    _prepare_village,
)
from app.schemas.village import SimulateRequest, SimulateResponse

router = APIRouter(prefix="/simulate", tags=["simulate"])


@router.post("", response_model=SimulateResponse)
def simulate_scenario(request: Request, payload: SimulateRequest):
    village, catchment = request.app.state.data_store.village_context(
        payload.village_id
    )
    if village is None:
        raise HTTPException(status_code=404, detail="Village not found")
    if catchment is None:
        raise HTTPException(
            status_code=500, detail="Village has no valid catchment mapping"
        )

    assessment_catchment, catchment_is_provisional = _prepare_catchment(catchment)
    assessment_village, village_is_provisional = _prepare_village(village)
    is_provisional = catchment_is_provisional or village_is_provisional
    result = assess_village_risk(
        assessment_village,
        assessment_catchment,
        payload.daily_rainfall_mm,
        payload.current_soil_moisture,
        payload.base_threshold_override_mm,
    )
    result["assessment_mode"] = (
        "provisional_defaults" if is_provisional else "canonical"
    )
    result["assessment_note"] = (
        PROVISIONAL_ASSESSMENT_NOTE if is_provisional else None
    )
    if is_provisional:
        result["explain"]["method_note"] = (
            f"{result['explain']['method_note']} {PROVISIONAL_ASSESSMENT_NOTE}"
        )
    return {"village_id": village["id"], "result": result}
