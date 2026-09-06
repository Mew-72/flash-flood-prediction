from pydantic import BaseModel, Field


class VillageOut(BaseModel):
    id: str
    name: str
    catchment_id: str
    lat: float
    lon: float
    slope_deg: float
    terrain_class: str
    distance_to_stream_m: float
    historical_event_count: int = 0


class CatchmentOut(BaseModel):
    id: str
    name: str
    centroid_lat: float
    centroid_lon: float
    area_km2: float
    land_use: str
    hydrologic_soil_group: str
    soil_texture: str
    mean_slope_deg: float
    flow_path_length_m: float
    channel_slope_percent: float
    base_rainfall_threshold_mm: float


class RiskOut(BaseModel):
    village_id: str
    village_name: str
    overall_risk_level: str
    composite_score: float
    details: dict


class SimulateRequest(BaseModel):
    village_id: str
    daily_rainfall_mm: list[float] = Field(min_length=1)
    current_soil_moisture: float = Field(ge=0.0, le=1.0)
    base_threshold_override_mm: float | None = Field(default=None, gt=0.0)


class SimulateResponse(BaseModel):
    village_id: str
    result: dict
