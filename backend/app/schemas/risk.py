from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.schemas.hazard import (
    CatchmentHazard,
    CatchmentHydrology,
    RainfallTrigger,
)
from app.schemas.provenance import DataProvenance
from app.schemas.weather import (
    PrecipitationWindows,
    WeatherConditions,
    WeatherPeriod,
)

RiskLevel = Literal["low", "moderate", "high", "critical"]
AssessmentMode = Literal["canonical", "provisional_defaults"]


class VillageExposure(BaseModel):
    distance_to_stream_m: float = Field(ge=0)
    stream_proximity_score: float = Field(ge=0, le=1)
    terrain_concentration_score: float = Field(ge=0, le=1)
    score: float = Field(ge=0, le=1)


class SlopeStabilityIndicator(BaseModel):
    saturation_ratio: float = Field(ge=0, le=1)
    factor_of_safety: float
    risk_class: RiskLevel


class ScoreComponents(BaseModel):
    runoff: float = Field(ge=0, le=1)
    rainfall_trigger: float = Field(ge=0, le=1)
    antecedent: float = Field(ge=0, le=1)
    village_exposure: float = Field(ge=0, le=1)


class RiskExplanation(BaseModel):
    today_rainfall_mm: float = Field(ge=0)
    antecedent_3day_mm: float = Field(ge=0)
    antecedent_5day_mm: float = Field(ge=0)
    antecedent_precipitation_index: float = Field(ge=0)
    current_soil_moisture: float | None = Field(default=None, ge=0, le=1)
    score_components: ScoreComponents
    method_note: str


class VillageRiskAssessment(BaseModel):
    model_config = ConfigDict(extra="allow")

    catchment_id: str
    catchment_hydrology: CatchmentHydrology
    rainfall_trigger: RainfallTrigger
    village_exposure: VillageExposure
    supplemental_slope_stability: SlopeStabilityIndicator | None = None
    composite_score: float = Field(ge=0, le=1)
    overall_risk_level: RiskLevel
    assessment_mode: AssessmentMode = "canonical"
    assessment_note: str | None = None
    explain: RiskExplanation


class RiskOut(BaseModel):
    """Legacy single-village response retained for existing clients."""

    village_id: str
    village_name: str
    overall_risk_level: RiskLevel
    composite_score: float = Field(ge=0, le=1)
    details: VillageRiskAssessment


class RiskSnapshot(PrecipitationWindows, WeatherConditions):
    village_id: str
    village_name: str
    catchment_id: str
    district: str | None = None
    overall_risk_level: RiskLevel
    composite_score: float = Field(ge=0, le=1)
    assessment_mode: AssessmentMode = "canonical"
    assessment_note: str | None = None
    period: WeatherPeriod
    retrieved_at: datetime
    valid_at: datetime
    lead_time_hours: float = Field(ge=0)
    hazard: CatchmentHazard
    details: VillageRiskAssessment
    provenance: DataProvenance


class CatchmentRiskSnapshots(BaseModel):
    catchment_id: str
    catchment_name: str
    district: str | None = None
    snapshots: list[RiskSnapshot]


class RiskSnapshotsResponse(BaseModel):
    generated_at: datetime
    data_mode: Literal["demo", "production"]
    catchments: list[CatchmentRiskSnapshots]
