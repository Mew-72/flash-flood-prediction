from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

DataMode = Literal["demo", "production"]


class DataProvenance(BaseModel):
    model_config = ConfigDict(extra="forbid")

    data_mode: DataMode
    static_sources: list[str]
    weather_source: str | None = None
    retrieved_at: datetime | None = None


class HealthOut(BaseModel):
    status: Literal["ok"] = "ok"
    storage: Literal["json"] = "json"
    model_unit: Literal["sub-catchment"] = "sub-catchment"
    data_mode: DataMode
    provenance: DataProvenance
