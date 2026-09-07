from pydantic import BaseModel, ConfigDict, Field


class CatchmentHydrology(BaseModel):
    model_config = ConfigDict(extra="allow")

    amc_class: int
    cn_ii: float
    adjusted_cn: float
    runoff_mm: float
    area_km2: float
    runoff_volume_m3: float
    estimated_response_time_minutes: float


class RainfallTrigger(BaseModel):
    model_config = ConfigDict(extra="allow")

    base_threshold_mm: float
    cumulative_3day_rainfall_mm: float
    reduction_factor: float
    effective_threshold_mm: float


class CatchmentHazard(BaseModel):
    model_config = ConfigDict(extra="allow")

    catchment_id: str
    catchment_hydrology: CatchmentHydrology
    rainfall_trigger: RainfallTrigger
    hazard_score: float = Field(ge=0, le=1)
    today_rainfall_mm: float = Field(ge=0)
    antecedent_3day_mm: float = Field(ge=0)
    antecedent_5day_mm: float = Field(ge=0)
    antecedent_precipitation_index: float = Field(ge=0)
