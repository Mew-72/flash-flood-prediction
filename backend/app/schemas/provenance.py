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
    risk_input_mode: Literal["canonical", "provisional_defaults"] = "canonical"
    risk_input_note: str | None = None


class HealthOut(BaseModel):
    status: Literal["ok"] = "ok"
    storage: Literal["json+parquet"] = "json+parquet"
    model_unit: Literal["sub-catchment"] = "sub-catchment"
    data_mode: DataMode
    weather_provider: Literal["demo", "openweather", "openweather+imd"]
    weather_configured: bool
    weather_capabilities: list[str]
    provenance: DataProvenance
