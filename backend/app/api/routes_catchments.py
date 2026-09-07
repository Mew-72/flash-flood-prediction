from fastapi import APIRouter, HTTPException, Query, Request, Response

from app.schemas.admin import CatchmentCatalog, CatchmentOut

router = APIRouter(prefix="/catchments", tags=["catchments"])
v1_router = APIRouter(prefix="/v1/catchments", tags=["catchments"])


@router.get("", response_model=list[CatchmentOut])
def list_catchments(
    request: Request,
    response: Response,
    district: str | None = None,
    q: str | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
):
    items, total = request.app.state.data_store.catalog_catchments(
        district=district, query=q, offset=offset, limit=limit
    )
    response.headers["X-Total-Count"] = str(total)
    return items


@v1_router.get("", response_model=CatchmentCatalog)
def list_catchments_v1(
    request: Request,
    district: str | None = None,
    q: str | None = None,
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
):
    items, total = request.app.state.data_store.catalog_catchments(
        district=district, query=q, offset=offset, limit=limit
    )
    return {"items": items, "total": total, "offset": offset, "limit": limit}


@router.get("/{catchment_id}", response_model=CatchmentOut)
@v1_router.get("/{catchment_id}", response_model=CatchmentOut)
def read_catchment(request: Request, catchment_id: str):
    catchment = request.app.state.data_store.catchment(catchment_id)
    if catchment is None:
        raise HTTPException(status_code=404, detail="Catchment not found")
    return catchment
