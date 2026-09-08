from typing import Any

from pydantic import BaseModel, Field

from app.schemas.admin import AdminUnitRef


class VillageBoundaryOut(BaseModel):
    id: str
    name: str
    lgd_village_code: str
    state: AdminUnitRef
    district: AdminUnitRef
    block: AdminUnitRef
    gram_panchayat: AdminUnitRef
    lat: float
    lon: float
    geometry: dict[str, Any]


class VillageBoundaryCatalog(BaseModel):
    items: list[VillageBoundaryOut]
    total: int = Field(ge=0)
    offset: int = Field(ge=0)
    limit: int = Field(gt=0, le=500)
    source: str
    crs: str = "OGC:CRS84"
