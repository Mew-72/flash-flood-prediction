from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.hazard import CatchmentHazard
from app.schemas.risk import RiskLevel

ReplayPhase = Literal["antecedent", "impact"]
ReplaySeverity = Literal["INFO", "MODERATE", "HIGH", "CRITICAL"]
ReplayAlertStatus = Literal["NORMAL", "WATCH", "WARNING", "EMERGENCY"]


class ReplayAdministrativeArea(BaseModel):
    state: str
    district: str
    subdistrict: str | None = None


class ReplayCoordinates(BaseModel):
    latitude: float
    longitude: float


class ReplaySource(BaseModel):
    kind: str
    publisher: str
    title: str
    url: str
    published_at: date | None = None


class ReplayReportedEvidence(BaseModel):
    """Event-specific, source-backed evidence retained from a pinned fixture."""

    model_config = {"extra": "allow"}


class ReplaySourceEvidence(BaseModel):
    reported: ReplayReportedEvidence
    sources: list[ReplaySource]


class ReplayCaseMetadata(BaseModel):
    case_id: str
    label: str
    requested_coordinates: ReplayCoordinates
    returned_grid_coordinates: ReplayCoordinates
    distance_to_kedarnath_km_approx: float | None = None
    antecedent_daily_rainfall_mm: list[float]
    event_day_analysis_rainfall_mm: float
    previous_run_forecast_rainfall_mm: dict[str, float]
    retrieval_urls: list[str]


class ReplayVillage(BaseModel):
    id: str
    name: str
    risk_level: RiskLevel
    composite_score: float = Field(ge=0, le=1)
    actionable: bool


class ReplayAlert(BaseModel):
    severity: ReplaySeverity
    status: ReplayAlertStatus
    headline: str
    message: str
    actionable: bool
    changed_from_previous: bool
    previous_severity: ReplaySeverity | None = None


class ReplayTimelineFrame(BaseModel):
    frame_index: int = Field(ge=0)
    date: date
    phase: ReplayPhase
    label: str
    rainfall_mm: float = Field(ge=0)
    cumulative_3day_rainfall_mm: float = Field(ge=0)
    hazard: CatchmentHazard
    villages: list[ReplayVillage]
    peak_risk_level: RiskLevel
    peak_composite_score: float = Field(ge=0, le=1)
    alert: ReplayAlert


class PinnedForecastComparison(BaseModel):
    lead_hours: Literal[24, 48, 72]
    forecast_rainfall_mm: float = Field(ge=0)
    event_day_analysis_rainfall_mm: float = Field(ge=0)
    rainfall_shortfall_mm: float
    villages: list[ReplayVillage]
    peak_risk_level: RiskLevel
    peak_composite_score: float = Field(ge=0, le=1)
    actionable: bool


class ReplayVerdict(BaseModel):
    retrospective_detection: bool
    reliable_actionable_advance_warning: bool
    reason: str
    scope: str


class ReplayCaseOption(BaseModel):
    case_id: str
    label: str


class ReplayEventCatalogItem(BaseModel):
    event_id: str
    name: str
    event_type: str
    impact_start: datetime
    administrative_area: ReplayAdministrativeArea
    affected_places: list[str]
    cases: list[ReplayCaseOption]
    case_ids: list[str]
    default_case_id: str


class ReplayEventCatalog(BaseModel):
    items: list[ReplayEventCatalogItem]
    total: int = Field(ge=0)


class ReplayEventResponse(BaseModel):
    event_id: str
    name: str
    event_type: str
    impact_start: datetime
    historical_replay: Literal[True] = True
    administrative_area: ReplayAdministrativeArea
    affected_places: list[str]
    source_evidence: ReplaySourceEvidence
    cases: list[ReplayCaseMetadata]
    selected_case_id: str
    selected_case_label: str
    selected_case: ReplayCaseMetadata
    timeline: list[ReplayTimelineFrame]
    pinned_forecast_comparison: list[PinnedForecastComparison]
    verdict: ReplayVerdict
    caveats: list[str]
