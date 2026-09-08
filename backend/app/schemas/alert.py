"""Administrator early-warning alert schemas.

The prototype keeps alerts in memory (see ``app.api.routes_admin``); this
module only defines the request/response contracts used by the React
administrator console.
"""

from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

Severity = Literal["INFO", "MODERATE", "HIGH", "CRITICAL"]


class AlertRequest(BaseModel):
    state: str = Field(min_length=1)
    district: str = Field(min_length=1)
    target: str = Field(min_length=1)
    severity: Severity
    message: str = Field(min_length=1, max_length=1000)
    issued_by: str = Field(default="administrator", min_length=1)
    issued_at: datetime | None = None


class AlertOut(BaseModel):
    id: str
    state: str
    district: str
    target: str
    severity: Severity
    message: str
    issued_by: str
    issued_at: datetime
    status: Literal["sent"] = "sent"

    @classmethod
    def from_request(cls, alert_id: str, payload: AlertRequest) -> "AlertOut":
        return cls(
            id=alert_id,
            state=payload.state,
            district=payload.district,
            target=payload.target,
            severity=payload.severity,
            message=payload.message,
            issued_by=payload.issued_by,
            issued_at=payload.issued_at or datetime.now(timezone.utc),
        )


class AlertHistory(BaseModel):
    items: list[AlertOut]
    total: int = Field(ge=0)
