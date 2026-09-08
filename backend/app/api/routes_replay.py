from datetime import date

from fastapi import APIRouter, HTTPException, Request

from app.core.data_sources.provider import WeatherCapabilityError

router = APIRouter(prefix="/replay", tags=["replay"])


@router.get("/{village_id}")
async def replay_event(
    request: Request, village_id: str, start_date: date, end_date: date
):
    """Replay historical forcing when the configured provider supports it."""
    village, catchment = request.app.state.data_store.village_context(village_id)
    if village is None:
        raise HTTPException(status_code=404, detail="Village not found")
    if catchment is None:
        raise HTTPException(
            status_code=500, detail="Village has no valid catchment mapping"
        )
    if start_date > end_date:
        raise HTTPException(
            status_code=422, detail="start_date must be on or before end_date"
        )

    try:
        await request.app.state.weather_client.get_historical(
            catchment,
            start_date.isoformat(),
            end_date.isoformat(),
        )
    except WeatherCapabilityError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc

    raise HTTPException(
        status_code=501,
        detail="The configured weather provider did not return replay data",
    )
