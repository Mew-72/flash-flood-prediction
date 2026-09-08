from pydantic import BaseModel, ConfigDict, Field


class AdminUnitRef(BaseModel):
    id: str
    name: str
    source_code: str | None = None


class AdministrativeHierarchy(BaseModel):
    state: AdminUnitRef
    district: AdminUnitRef
    subdistrict: AdminUnitRef | None = None
    block: AdminUnitRef | None = None


class VillageOut(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    catchment_id: str
    district: str | None = None
    lgd_village_code: str | None = None
    admin: AdministrativeHierarchy | None = None
    lat: float
    lon: float
    slope_deg: float | None = None
    terrain_class: str | None = None
    distance_to_stream_m: float | None = None
    historical_event_count: int | None = None
    model_ready: bool = True


class CatchmentOut(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    district: str | None = None
    admin: AdministrativeHierarchy | None = None
    centroid_lat: float
    centroid_lon: float
    area_km2: float = Field(gt=0)
    land_use: str | None = None
    hydrologic_soil_group: str | None = None
    soil_texture: str | None = None
    mean_slope_deg: float | None = None
    flow_path_length_m: float | None = Field(default=None, gt=0)
    channel_slope_percent: float | None = Field(default=None, gt=0)
    base_rainfall_threshold_mm: float | None = Field(default=None, gt=0)
    model_ready: bool = True


class VillageCatalog(BaseModel):
    items: list[VillageOut]
    total: int = Field(ge=0)
    offset: int = Field(ge=0)
    limit: int = Field(gt=0)


class CatchmentCatalog(BaseModel):
    items: list[CatchmentOut]
    total: int = Field(ge=0)
    offset: int = Field(ge=0)
    limit: int = Field(gt=0)
