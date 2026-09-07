from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

WeatherPeriod = Literal["past", "current", "forecast"]


class PrecipitationWindows(BaseModel):
    model_config = ConfigDict(extra="forbid")

    precipitation_1h_mm: float = Field(ge=0)
    precipitation_3h_mm: float = Field(ge=0)
    precipitation_6h_mm: float = Field(ge=0)
    precipitation_24h_mm: float = Field(ge=0)


class WeatherSnapshot(PrecipitationWindows):
    period: WeatherPeriod
    retrieved_at: datetime
    valid_at: datetime
    lead_time_hours: float = Field(ge=0)
    soil_moisture: float = Field(ge=0, le=1)
    antecedent_daily_rainfall_mm: list[float] = Field(default_factory=list)
    source: str = "open-meteo"


class WeatherTimeline(BaseModel):
    retrieved_at: datetime
    past: list[WeatherSnapshot]
    current: WeatherSnapshot | None
    forecast: list[WeatherSnapshot]
