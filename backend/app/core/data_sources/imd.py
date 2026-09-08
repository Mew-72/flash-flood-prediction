"""Async adapter for the documented IMD public weather APIs."""

from __future__ import annotations

import asyncio
import math
import re
from collections.abc import Mapping
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Protocol

import httpx
from pydantic import SecretStr

from app.core.data_sources.cache import AsyncTTLCache
from app.core.data_sources.provider import WeatherCapabilityError
from app.schemas.weather import WeatherSnapshot, WeatherTimeline

IST = timezone(timedelta(hours=5, minutes=30))
_EXACT_NUMBER = re.compile(r"^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$")
_ZERO_RAINFALL = frozenset({"NIL", "NO RAIN", "TRACE", "TR"})


class ImdError(ValueError):
    """Base error for invalid IMD configuration or data."""


class ImdConfigurationError(ImdError):
    """Raised when required IMD gateway configuration is absent."""


class ImdCapabilityError(ImdError, WeatherCapabilityError):
    """Raised when the public IMD API cannot provide a requested capability."""


class _ImdSettings(Protocol):
    imd_api_base_url: str
    imd_api_key: SecretStr | None
    imd_access_token: SecretStr | None
    weather_cache_max_entries: int
    weather_cache_ttl_seconds: float
    weather_max_concurrency: int


class ImdClient:
    """Normalize IMD city observations and basin QPF into a weather timeline."""

    def __init__(self, http_client: httpx.AsyncClient, settings: _ImdSettings):
        self._http_client = http_client
        self._settings = settings
        self._cache: AsyncTTLCache[list[Any] | dict[str, Any]] = AsyncTTLCache(
            max_entries=settings.weather_cache_max_entries,
            ttl_seconds=settings.weather_cache_ttl_seconds,
        )
        self._request_slots = asyncio.Semaphore(settings.weather_max_concurrency)

    def _credentials(self) -> tuple[str, str]:
        api_key = _secret_value(self._settings.imd_api_key)
        access_token = _secret_value(self._settings.imd_access_token)
        if not api_key or not access_token:
            raise ImdConfigurationError(
                "IMD API key and access token are required for the public gateway"
            )
        return api_key, access_token

    async def _get(
        self, endpoint: str, params: Mapping[str, Any] | None = None
    ) -> list[Any] | dict[str, Any]:
        base_url = self._settings.imd_api_base_url.strip().rstrip("/")
        if not base_url:
            raise ImdConfigurationError("IMD API base URL is required")

        request_params = dict(params or {})
        url = f"{base_url}/{endpoint.lstrip('/')}"
        key = (
            url,
            tuple(sorted((name, str(value)) for name, value in request_params.items())),
        )

        async def fetch() -> list[Any] | dict[str, Any]:
            api_key, access_token = self._credentials()
            async with self._request_slots:
                response = await self._http_client.get(
                    url,
                    params=request_params,
                    headers={
                        "x-api-key": api_key,
                        "Authorization": f"Bearer {access_token}",
                    },
                )
            response.raise_for_status()
            payload = response.json()
            if isinstance(payload, dict) and "data" in payload:
                payload = payload["data"]
            if not isinstance(payload, (list, dict)):
                raise ImdError("IMD returned JSON that was neither a list nor an object")
            return payload

        return await self._cache.get_or_create(key, fetch)

    async def get_timeline(self, catchment: dict[str, Any]) -> WeatherTimeline:
        """Return the nearest station's exact observed 24-hour rainfall."""
        latitude = _catchment_coordinate(catchment, "centroid_lat")
        longitude = _catchment_coordinate(catchment, "centroid_lon")
        retrieved_at = datetime.now(timezone.utc)

        city_payload = await self._get("cityforecastloc")
        station = _nearest_station(_records(city_payload), latitude, longitude)
        rainfall = _observed_rainfall(
            _field(station, "Past_24_hrs_Rainfall")
        )
        observed_at = _at_0830_ist(_record_date(station))
        current = _snapshot(
            period="current",
            retrieved_at=retrieved_at,
            valid_at=observed_at,
            lead_time_hours=0.0,
            rainfall=rainfall,
            source="imd-cityforecastloc",
        )

        return WeatherTimeline(
            retrieved_at=retrieved_at,
            past=[],
            current=current,
            forecast=[],
        )

    async def get_historical(self, *args: Any, **kwargs: Any) -> WeatherTimeline:
        del args, kwargs
        raise ImdCapabilityError(
            "The documented IMD public API has no historical date-range endpoint"
        )


def _secret_value(value: SecretStr | str | None) -> str:
    if value is None:
        return ""
    reveal = getattr(value, "get_secret_value", None)
    if callable(reveal):
        return str(reveal()).strip()
    return str(value).strip()


def _normalized_key(value: str) -> str:
    return "".join(character for character in value.casefold() if character.isalnum())


def _field(record: Mapping[str, Any], name: str) -> Any:
    wanted = _normalized_key(name)
    for key, value in record.items():
        if _normalized_key(str(key)) == wanted:
            return value
    return None


def _records(payload: list[Any] | dict[str, Any]) -> list[dict[str, Any]]:
    values = payload if isinstance(payload, list) else [payload]
    return [dict(value) for value in values if isinstance(value, Mapping)]


def _catchment_coordinate(catchment: Mapping[str, Any], name: str) -> float:
    value = catchment.get(name)
    if value is None:
        raise ImdError(f"Catchment {name} must be numeric")
    try:
        coordinate = float(value)
    except (TypeError, ValueError) as exc:
        raise ImdError(f"Catchment {name} must be numeric") from exc
    if not math.isfinite(coordinate):
        raise ImdError(f"Catchment {name} must be finite")
    return coordinate


def _coordinate(record: Mapping[str, Any], name: str) -> float | None:
    value = _field(record, name)
    try:
        coordinate = float(value)
    except (TypeError, ValueError):
        return None
    return coordinate if math.isfinite(coordinate) else None


def _nearest_station(
    records: list[dict[str, Any]], latitude: float, longitude: float
) -> dict[str, Any]:
    candidates: list[tuple[float, dict[str, Any]]] = []
    for record in records:
        station_latitude = _coordinate(record, "Latitude")
        station_longitude = _coordinate(record, "Longitude")
        if station_latitude is None or station_longitude is None:
            continue
        distance = _great_circle_distance_squared(
            latitude, longitude, station_latitude, station_longitude
        )
        candidates.append((distance, record))
    if not candidates:
        raise ImdError("IMD city forecast response contained no station coordinates")
    return min(candidates, key=lambda item: item[0])[1]


def _great_circle_distance_squared(
    latitude: float,
    longitude: float,
    station_latitude: float,
    station_longitude: float,
) -> float:
    latitude_radians = math.radians(latitude)
    station_latitude_radians = math.radians(station_latitude)
    latitude_delta = station_latitude_radians - latitude_radians
    longitude_delta = math.radians(station_longitude - longitude)
    haversine = (
        math.sin(latitude_delta / 2) ** 2
        + math.cos(latitude_radians)
        * math.cos(station_latitude_radians)
        * math.sin(longitude_delta / 2) ** 2
    )
    return min(1.0, haversine)


def _record_date(record: Mapping[str, Any]) -> date:
    value = _field(record, "Date")
    if not isinstance(value, str):
        raise ImdError("IMD record is missing a valid Date")
    try:
        return date.fromisoformat(value.strip())
    except ValueError as exc:
        raise ImdError(f"Invalid IMD Date: {value!r}") from exc


def _at_0830_ist(value: date) -> datetime:
    return datetime.combine(value, time(hour=8, minute=30), IST).astimezone(
        timezone.utc
    )


def _exact_nonnegative_number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        number = float(value)
    elif isinstance(value, str) and _EXACT_NUMBER.fullmatch(value.strip()):
        number = float(value.strip())
    else:
        return None
    if not math.isfinite(number) or number < 0:
        return None
    return number


def _observed_rainfall(value: Any) -> float:
    if isinstance(value, str) and value.strip().upper() in _ZERO_RAINFALL:
        return 0.0
    amount = _exact_nonnegative_number(value)
    if amount is None:
        raise ImdError("Nearest IMD station has no exact current 24-hour rainfall")
    return amount



def _snapshot(
    *,
    period: str,
    retrieved_at: datetime,
    valid_at: datetime,
    lead_time_hours: float,
    rainfall: float,
    source: str,
) -> WeatherSnapshot:
    return WeatherSnapshot(
        period=period,
        retrieved_at=retrieved_at,
        valid_at=valid_at,
        lead_time_hours=lead_time_hours,
        precipitation_1h_mm=None,
        precipitation_3h_mm=None,
        precipitation_6h_mm=None,
        precipitation_24h_mm=rainfall,
        soil_moisture=None,
        antecedent_daily_rainfall_mm=[],
        source=source,
    )
