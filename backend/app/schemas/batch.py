from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.schemas.risk import RiskSnapshot


class RiskBatchRequest(BaseModel):
    village_ids: list[str] | None = Field(default=None, max_length=500)
    catchment_ids: list[str] | None = Field(default=None, max_length=100)
    district: str | None = None
    include_forecast: bool = False

    @model_validator(mode="after")
    def selectors_are_not_empty(self):
        if self.village_ids == [] or self.catchment_ids == []:
            raise ValueError("selector lists must be omitted or non-empty")
        if (
            self.village_ids is None
            and self.catchment_ids is None
            and self.district is None
        ):
            raise ValueError("at least one village, catchment, or district selector is required")
        return self


class BatchItemError(BaseModel):
    id: str
    error: str


class RiskBatchResponse(BaseModel):
    items: list[RiskSnapshot]
    errors: list[BatchItemError] = Field(default_factory=list)
    requested: int = Field(ge=0)
    returned: int = Field(ge=0)
    data_mode: Literal["demo", "production"]
