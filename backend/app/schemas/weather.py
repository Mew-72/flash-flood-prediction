from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

WeatherPeriod = Literal["past", "current", "forecast"]


class PrecipitationWindows(BaseModel):
    model_config = ConfigDict(extra="forbid")

    precipitation_1h_mm: float | None = Field(default=None, ge=0)
    precipitation_3h_mm: float | None = Field(default=None, ge=0)
    precipitation_6h_mm: float | None = Field(default=None, ge=0)
    precipitation_24h_mm: float = Field(ge=0)


class WeatherConditions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    temperature_c: float | None = None
    feels_like_c: float | None = None
    humidity_percent: float | None = Field(default=None, ge=0, le=100)
    pressure_hpa: float | None = Field(default=None, ge=0)
    wind_speed_mps: float | None = Field(default=None, ge=0)
    wind_direction_deg: float | None = Field(default=None, ge=0, le=360)
    cloud_cover_percent: float | None = Field(default=None, ge=0, le=100)
    visibility_m: float | None = Field(default=None, ge=0)
    weather_condition: str | None = None
    weather_description: str | None = None
    weather_icon: str | None = None


class WeatherSnapshot(PrecipitationWindows, WeatherConditions):
    period: WeatherPeriod
    retrieved_at: datetime
    valid_at: datetime
    lead_time_hours: float = Field(ge=0)
    soil_moisture: float | None = Field(default=None, ge=0, le=1)
    antecedent_daily_rainfall_mm: list[float] = Field(default_factory=list)
    source: str = "weather-provider"


class WeatherTimeline(BaseModel):
    retrieved_at: datetime
    past: list[WeatherSnapshot]
    current: WeatherSnapshot | None
    forecast: list[WeatherSnapshot]
