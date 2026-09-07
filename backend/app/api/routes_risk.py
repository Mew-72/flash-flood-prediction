from collections import defaultdict
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

from app.core.risk_service import RiskService
from app.schemas.batch import BatchItemError, RiskBatchRequest, RiskBatchResponse
from app.schemas.risk import (
    CatchmentRiskSnapshots,
    RiskOut,
    RiskSnapshot,
    RiskSnapshotsResponse,
)

router = APIRouter(prefix="/risk", tags=["risk"])
v1_router = APIRouter(prefix="/v1/risk", tags=["risk"])
MAX_BATCH_VILLAGES = 500


def _service(request: Request) -> RiskService:
    return RiskService(
        request.app.state.data_store, request.app.state.weather_client
    )


def _weather_failure(exc: Exception) -> HTTPException:
    return HTTPException(
        status_code=502,
        detail=f"Weather data unavailable: {type(exc).__name__}",
    )


@v1_router.post("/batch", response_model=RiskBatchResponse)
async def assess_risk_batch(request: Request, payload: RiskBatchRequest):
    store = request.app.state.data_store
    errors: list[BatchItemError] = []
    villages: list[dict] = []

    if payload.village_ids is not None:
        seen = set()
        for village_id in payload.village_ids:
            if village_id in seen:
                continue
            seen.add(village_id)
            village = store.village(village_id)
            if village is None:
                errors.append(BatchItemError(id=village_id, error="Village not found"))
            else:
                villages.append(village)
        requested = len(seen)
    else:
        villages = store.villages()
        requested = len(villages)

    if payload.catchment_ids is not None:
        selected_catchments = set(payload.catchment_ids)
        for catchment_id in selected_catchments:
            if store.catchment(catchment_id) is None:
                errors.append(
                    BatchItemError(id=catchment_id, error="Catchment not found")
                )
        villages = [
            item for item in villages if item["catchment_id"] in selected_catchments
        ]
    if payload.district is not None:
        district = payload.district.casefold()
        villages = [
            item
            for item in villages
            if str(item.get("district", "")).casefold() == district
        ]
    if len(villages) > MAX_BATCH_VILLAGES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"Batch resolves to {len(villages)} villages; narrow the selector "
                f"to at most {MAX_BATCH_VILLAGES}"
            ),
        )

    try:
        snapshots = await _service(request).snapshots_for_villages(
            villages, include_forecast=payload.include_forecast
        )
    except (httpx.HTTPError, ValueError) as exc:
        raise _weather_failure(exc) from exc

    return RiskBatchResponse(
        items=snapshots,
        errors=errors,
        requested=requested,
        returned=len(snapshots),
        data_mode=store.data_mode,
    )


@v1_router.get("/snapshots", response_model=RiskSnapshotsResponse)
async def get_risk_snapshots(
    request: Request,
    district: str | None = None,
    catchment_id: str | None = None,
    include_forecast: bool = False,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=500),
):
    store = request.app.state.data_store
    if catchment_id is not None and store.catchment(catchment_id) is None:
        raise HTTPException(status_code=404, detail="Catchment not found")
    villages, _ = store.catalog_villages(
        district=district,
        catchment_id=catchment_id,
        offset=offset,
        limit=limit,
    )
    try:
        snapshots = await _service(request).snapshots_for_villages(
            villages, include_forecast=include_forecast
        )
    except (httpx.HTTPError, ValueError) as exc:
        raise _weather_failure(exc) from exc

    grouped: dict[str, list[RiskSnapshot]] = defaultdict(list)
    for snapshot in snapshots:
        grouped[snapshot.catchment_id].append(snapshot)
    catchment_groups = []
    for selected_catchment_id, items in grouped.items():
        catchment = store.catchment(selected_catchment_id)
        catchment_groups.append(
            CatchmentRiskSnapshots(
                catchment_id=selected_catchment_id,
                catchment_name=catchment["name"],
                district=catchment.get("district"),
                snapshots=items,
            )
        )
    return RiskSnapshotsResponse(
        generated_at=datetime.now(timezone.utc),
        data_mode=store.data_mode,
        catchments=catchment_groups,
    )


@router.get("/{village_id}", response_model=RiskOut)
async def get_village_risk(request: Request, village_id: str):
    village = request.app.state.data_store.village(village_id)
    if village is None:
        raise HTTPException(status_code=404, detail="Village not found")
    try:
        snapshots = await _service(request).snapshots_for_villages(
            [village], include_forecast=False
        )
    except (httpx.HTTPError, ValueError) as exc:
        raise _weather_failure(exc) from exc
    if not snapshots:
        raise HTTPException(status_code=502, detail="No current weather observation")
    snapshot = snapshots[0]
    return RiskOut(
        village_id=snapshot.village_id,
        village_name=snapshot.village_name,
        overall_risk_level=snapshot.overall_risk_level,
        composite_score=snapshot.composite_score,
        details=snapshot.details,
    )


@v1_router.get("/{village_id}", response_model=RiskSnapshot)
async def get_village_risk_v1(request: Request, village_id: str):
    village = request.app.state.data_store.village(village_id)
    if village is None:
        raise HTTPException(status_code=404, detail="Village not found")
    try:
        snapshots = await _service(request).snapshots_for_villages(
            [village], include_forecast=False
        )
    except (httpx.HTTPError, ValueError) as exc:
        raise _weather_failure(exc) from exc
    if not snapshots:
        raise HTTPException(status_code=502, detail="No current weather observation")
    return snapshots[0]
