from fastapi import APIRouter, HTTPException

from app.core.data_sources.data_store import get_catchment, load_catchments
from app.schemas.village import CatchmentOut

router = APIRouter(prefix="/catchments", tags=["catchments"])


@router.get("", response_model=list[CatchmentOut])
def list_catchments():
    return load_catchments()


@router.get("/{catchment_id}", response_model=CatchmentOut)
def read_catchment(catchment_id: str):
    catchment = get_catchment(catchment_id)
    if catchment is None:
        raise HTTPException(status_code=404, detail="Catchment not found")
    return catchment
