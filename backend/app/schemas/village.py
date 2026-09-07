"""Legacy schema import path.

Canonical models live in focused schema modules; these aliases keep existing
imports and clients working during the API transition.
"""

from pydantic import BaseModel, Field

from app.schemas.admin import CatchmentOut, VillageOut
from app.schemas.risk import RiskOut


class SimulateRequest(BaseModel):
    village_id: str
    daily_rainfall_mm: list[float] = Field(min_length=1)
    current_soil_moisture: float = Field(ge=0.0, le=1.0)
    base_threshold_override_mm: float | None = Field(default=None, gt=0.0)


class SimulateResponse(BaseModel):
    village_id: str
    result: dict


__all__ = [
    "CatchmentOut",
    "RiskOut",
    "SimulateRequest",
    "SimulateResponse",
    "VillageOut",
]
