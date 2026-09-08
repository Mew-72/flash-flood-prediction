from datetime import date

from fastapi import APIRouter, HTTPException, Request

from app.core.data_sources.provider import WeatherCapabilityError
from app.schemas.replay import ReplayEventCatalog, ReplayEventResponse
from validation.hindcast import build_event_replay, event_catalog, get_pinned_event

router = APIRouter(prefix="/replay", tags=["replay"])


@router.get("/events", response_model=ReplayEventCatalog)
def list_replay_events():
    """List deterministic historical events pinned in the repository."""
    return event_catalog()


@router.get("/events/{event_id}", response_model=ReplayEventResponse)
def get_replay_event(event_id: str, case_id: str | None = None):
    """Replay a pinned event without calling a weather or network provider."""
    event = get_pinned_event(event_id)
    if event is None:
        raise HTTPException(status_code=404, detail="Replay event not found")
    try:
        return build_event_replay(event, case_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="Replay case not found") from exc


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
