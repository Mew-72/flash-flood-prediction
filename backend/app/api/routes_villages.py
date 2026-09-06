from fastapi import APIRouter, HTTPException

from app.core.data_sources.data_store import get_village, load_villages
from app.schemas.village import VillageOut

router = APIRouter(prefix="/villages", tags=["villages"])


@router.get("", response_model=list[VillageOut])
def list_villages():
    return load_villages()


@router.get("/{village_id}", response_model=VillageOut)
def read_village(village_id: str):
    village = get_village(village_id)
    if village is None:
        raise HTTPException(status_code=404, detail="Village not found")
    return village
