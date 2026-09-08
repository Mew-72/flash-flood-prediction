"""Shared weather-provider contracts and capability errors."""

from __future__ import annotations

from typing import Any, Protocol

from app.schemas.weather import WeatherTimeline


class WeatherCapabilityError(ValueError):
    """Raised when a provider cannot supply a requested weather capability."""


class WeatherProvider(Protocol):
    """Runtime contract required by the risk assessment service."""

    async def get_timeline(self, catchment: dict[str, Any]) -> WeatherTimeline: ...
