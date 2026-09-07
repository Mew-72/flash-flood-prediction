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
    slope_deg: float
    terrain_class: str
    distance_to_stream_m: float
    historical_event_count: int = 0


class CatchmentOut(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str
    name: str
    district: str | None = None
    admin: AdministrativeHierarchy | None = None
    centroid_lat: float
    centroid_lon: float
    area_km2: float = Field(gt=0)
    land_use: str
    hydrologic_soil_group: str
    soil_texture: str
    mean_slope_deg: float
    flow_path_length_m: float = Field(gt=0)
    channel_slope_percent: float = Field(gt=0)
    base_rainfall_threshold_mm: float = Field(gt=0)


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
