from fastapi import APIRouter, HTTPException, Query, Request, Response

from app.core.data_sources.data_store import DataStoreError
from app.schemas.admin import VillageCatalog, VillageOut
from app.schemas.boundary import VillageBoundaryCatalog

router = APIRouter(prefix="/villages", tags=["villages"])
v1_router = APIRouter(prefix="/v1/villages", tags=["villages"])


@router.get("", response_model=list[VillageOut])
def list_villages(
    request: Request,
    response: Response,
    district: str | None = None,
    catchment_id: str | None = None,
    q: str | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
):
    items, total = request.app.state.data_store.catalog_villages(
        district=district,
        catchment_id=catchment_id,
        query=q,
        offset=offset,
        limit=limit,
    )
    response.headers["X-Total-Count"] = str(total)
    return items


@v1_router.get("", response_model=VillageCatalog)
def list_villages_v1(
    request: Request,
    district: str | None = None,
    catchment_id: str | None = None,
    q: str | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
):
    items, total = request.app.state.data_store.catalog_villages(
        district=district,
        catchment_id=catchment_id,
        query=q,
        offset=offset,
        limit=limit,
    )
    return {"items": items, "total": total, "offset": offset, "limit": limit}


@v1_router.get("/boundaries", response_model=VillageBoundaryCatalog)
def list_village_boundaries(
    state_code: str | None = None,
    district_code: str | None = None,
    district_name: str | None = None,
    q: str | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
):
    if not any((state_code, district_code, district_name)):
        raise HTTPException(
            status_code=422,
            detail="A state_code, district_code, or exact district_name is required",
        )
    try:
        from app.core.data_sources.village_boundaries import (
            get_village_boundary_store,
        )

        store = get_village_boundary_store()
        items, total = store.catalog(
            state_code=state_code,
            district_code=district_code,
            district_name=district_name,
            query=q,
            offset=offset,
            limit=limit,
        )
    except DataStoreError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {
        "items": items,
        "total": total,
        "offset": offset,
        "limit": limit,
        "source": store.source_filename,
    }


@router.get("/{village_id}", response_model=VillageOut)
@v1_router.get("/{village_id}", response_model=VillageOut)
def read_village(request: Request, village_id: str):
    village = request.app.state.data_store.village(village_id)
    if village is None:
        raise HTTPException(status_code=404, detail="Village not found")
    return village
