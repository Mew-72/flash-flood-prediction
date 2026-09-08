"""Async OpenWeather adapter for current conditions, forecasts, and map tiles."""

from __future__ import annotations

import asyncio
import math
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any, Protocol

import httpx
from pydantic import SecretStr

from app.core.data_sources.cache import AsyncTTLCache
from app.core.data_sources.provider import WeatherCapabilityError
from app.schemas.weather import WeatherSnapshot, WeatherTimeline


class OpenWeatherError(ValueError):
    """Base error for invalid OpenWeather configuration or data."""


class OpenWeatherConfigurationError(OpenWeatherError):
    """Raised when the server-side OpenWeather configuration is absent."""


class OpenWeatherCapabilityError(WeatherCapabilityError, OpenWeatherError):
    """Raised when OpenWeather cannot provide a requested capability."""


class _OpenWeatherSettings(Protocol):
    openweather_api_base_url: str
    openweather_tile_base_url: str
    weather_api: SecretStr | None
    weather_cache_max_entries: int
    weather_cache_ttl_seconds: float
    weather_max_concurrency: int


class OpenWeatherClient:
    """Normalize free-compatible OpenWeather 2.5 responses for the risk model."""

    def __init__(self, http_client: httpx.AsyncClient, settings: _OpenWeatherSettings):
        self._http_client = http_client
        self._settings = settings
        self._json_cache: AsyncTTLCache[dict[str, Any]] = AsyncTTLCache(
            max_entries=settings.weather_cache_max_entries,
            ttl_seconds=settings.weather_cache_ttl_seconds,
        )
        self._tile_cache: AsyncTTLCache[bytes] = AsyncTTLCache(
            max_entries=settings.weather_cache_max_entries,
            ttl_seconds=settings.weather_cache_ttl_seconds,
        )
        self._request_slots = asyncio.Semaphore(settings.weather_max_concurrency)

    def _api_key(self) -> str:
        value = self._settings.weather_api
        if value is None:
            raise OpenWeatherConfigurationError("WEATHER_API is required")
        reveal = getattr(value, "get_secret_value", None)
        api_key = str(reveal() if callable(reveal) else value).strip()
        if not api_key:
            raise OpenWeatherConfigurationError("WEATHER_API is required")
        return api_key

    async def _get_json(
        self, endpoint: str, latitude: float, longitude: float
    ) -> dict[str, Any]:
        base_url = self._settings.openweather_api_base_url.strip().rstrip("/")
        if not base_url:
            raise OpenWeatherConfigurationError(
                "OpenWeather API base URL is required"
            )
        url = f"{base_url}/data/2.5/{endpoint}"
        params = {"lat": latitude, "lon": longitude, "units": "metric"}
        cache_key = (url, latitude, longitude, "metric")

        async def fetch() -> dict[str, Any]:
            async with self._request_slots:
                response = await self._http_client.get(
                    url, params={**params, "appid": self._api_key()}
                )
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                raise OpenWeatherError("OpenWeather returned invalid JSON")
            return payload

        return await self._json_cache.get_or_create(cache_key, fetch)

    async def get_timeline(self, catchment: dict[str, Any]) -> WeatherTimeline:
        latitude = _catchment_coordinate(catchment, "centroid_lat", -90, 90)
        longitude = _catchment_coordinate(catchment, "centroid_lon", -180, 180)
        retrieved_at = datetime.now(timezone.utc)
        current_payload, forecast_payload = await asyncio.gather(
            self._get_json("weather", latitude, longitude),
            self._get_json("forecast", latitude, longitude),
        )

        current = _current_snapshot(current_payload, retrieved_at)
        forecast = _forecast_snapshots(
            forecast_payload, retrieved_at, current.valid_at
        )
        return WeatherTimeline(
            retrieved_at=retrieved_at,
            past=[],
            current=current,
            forecast=forecast,
        )

    async def get_tile(self, layer: str, z: int, x: int, y: int) -> bytes:
        base_url = self._settings.openweather_tile_base_url.strip().rstrip("/")
        if not base_url:
            raise OpenWeatherConfigurationError(
                "OpenWeather tile base URL is required"
            )
        url = f"{base_url}/map/{layer}/{z}/{x}/{y}.png"
        cache_key = (layer, z, x, y)

        async def fetch() -> bytes:
            async with self._request_slots:
                response = await self._http_client.get(
                    url, params={"appid": self._api_key()}
                )
            response.raise_for_status()
            content_type = response.headers.get("content-type", "").casefold()
            if "image/" not in content_type:
                raise OpenWeatherError("OpenWeather tile response was not an image")
            return response.content

        return await self._tile_cache.get_or_create(cache_key, fetch)

    async def get_historical(self, *args: Any, **kwargs: Any) -> WeatherTimeline:
        del args, kwargs
        raise OpenWeatherCapabilityError(
            "OpenWeather free runtime endpoints do not support historical replay"
        )


def _catchment_coordinate(
    catchment: Mapping[str, Any], name: str, minimum: float, maximum: float
) -> float:
    value = catchment.get(name)
    if value is None or isinstance(value, bool):
        raise OpenWeatherError(f"Catchment {name} must be numeric")
    try:
        coordinate = float(value)
    except (TypeError, ValueError) as exc:
        raise OpenWeatherError(f"Catchment {name} must be numeric") from exc
    if not math.isfinite(coordinate) or not minimum <= coordinate <= maximum:
        raise OpenWeatherError(
            f"Catchment {name} must be between {minimum} and {maximum}"
        )
    return coordinate


def _timestamp(payload: Mapping[str, Any]) -> datetime:
    value = payload.get("dt")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise OpenWeatherError("OpenWeather response is missing a valid dt")
    try:
        return datetime.fromtimestamp(value, timezone.utc)
    except (OverflowError, OSError, ValueError) as exc:
        raise OpenWeatherError("OpenWeather response contains an invalid dt") from exc


def _number(
    mapping: Mapping[str, Any],
    name: str,
    *,
    minimum: float | None = None,
    maximum: float | None = None,
) -> float | None:
    value = mapping.get(name)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise OpenWeatherError(f"OpenWeather {name} must be numeric")
    number = float(value)
    if not math.isfinite(number):
        raise OpenWeatherError(f"OpenWeather {name} must be finite")
    if minimum is not None and number < minimum:
        raise OpenWeatherError(f"OpenWeather {name} is below its valid range")
    if maximum is not None and number > maximum:
        raise OpenWeatherError(f"OpenWeather {name} is above its valid range")
    return number


def _object(payload: Mapping[str, Any], name: str) -> Mapping[str, Any]:
    value = payload.get(name)
    if value is None:
        return {}
    if not isinstance(value, Mapping):
        raise OpenWeatherError(f"OpenWeather {name} must be an object")
    return value


def _rain(payload: Mapping[str, Any], window: str) -> float | None:
    return _number(_object(payload, "rain"), window, minimum=0)


def _weather_text(payload: Mapping[str, Any]) -> tuple[str | None, str | None, str | None]:
    weather = payload.get("weather")
    if weather is None:
        return None, None, None
    if not isinstance(weather, list) or not weather:
        raise OpenWeatherError("OpenWeather weather must be a non-empty list")
    first = weather[0]
    if not isinstance(first, Mapping):
        raise OpenWeatherError("OpenWeather weather entry must be an object")

    values: list[str | None] = []
    for name in ("main", "description", "icon"):
        value = first.get(name)
        if value is not None and not isinstance(value, str):
            raise OpenWeatherError(f"OpenWeather weather {name} must be text")
        values.append(value)
    return values[0], values[1], values[2]


def _condition_fields(payload: Mapping[str, Any]) -> dict[str, Any]:
    main = _object(payload, "main")
    wind = _object(payload, "wind")
    clouds = _object(payload, "clouds")
    condition, description, icon = _weather_text(payload)
    return {
        "temperature_c": _number(main, "temp"),
        "feels_like_c": _number(main, "feels_like"),
        "humidity_percent": _number(main, "humidity", minimum=0, maximum=100),
        "pressure_hpa": _number(main, "pressure", minimum=0),
        "wind_speed_mps": _number(wind, "speed", minimum=0),
        "wind_direction_deg": _number(wind, "deg", minimum=0, maximum=360),
        "cloud_cover_percent": _number(clouds, "all", minimum=0, maximum=100),
        "visibility_m": _number(payload, "visibility", minimum=0),
        "weather_condition": condition,
        "weather_description": description,
        "weather_icon": icon,
    }


def _current_snapshot(
    payload: Mapping[str, Any], retrieved_at: datetime
) -> WeatherSnapshot:
    rain_3h = _rain(payload, "3h")
    rain_1h = _rain(payload, "1h")
    if rain_3h is not None:
        model_rainfall = rain_3h
        rainfall_source = "rain.3h"
    elif rain_1h is not None:
        model_rainfall = rain_1h
        rainfall_source = "rain.1h"
    else:
        model_rainfall = 0.0
        rainfall_source = "no-rain-field=0"

    return WeatherSnapshot(
        period="current",
        retrieved_at=retrieved_at,
        valid_at=_timestamp(payload),
        lead_time_hours=0,
        precipitation_1h_mm=rain_1h,
        precipitation_3h_mm=rain_3h,
        precipitation_6h_mm=None,
        precipitation_24h_mm=model_rainfall,
        soil_moisture=None,
        antecedent_daily_rainfall_mm=[],
        source=f"openweather-current:{rainfall_source}",
        **_condition_fields(payload),
    )


def _forecast_snapshots(
    payload: Mapping[str, Any],
    retrieved_at: datetime,
    current_valid_at: datetime,
) -> list[WeatherSnapshot]:
    entries = payload.get("list")
    if not isinstance(entries, list):
        raise OpenWeatherError("OpenWeather forecast response is missing list")

    normalized: list[tuple[datetime, Mapping[str, Any], float]] = []
    for entry in entries:
        if not isinstance(entry, Mapping):
            raise OpenWeatherError("OpenWeather forecast entry must be an object")
        normalized.append((_timestamp(entry), entry, _rain(entry, "3h") or 0.0))
    normalized.sort(key=lambda item: item[0])

    snapshots: list[WeatherSnapshot] = []
    rain_bins: list[float] = []
    for valid_at, entry, rain_3h in normalized:
        rain_bins.append(rain_3h)
        six_hour_bins = rain_bins[-2:]
        day_bins = rain_bins[-8:]
        precipitation_6h = (
            sum(six_hour_bins) if len(six_hour_bins) == 2 else None
        )
        precipitation_24h = sum(day_bins)
        source = (
            "openweather-forecast:rain.3h-or-omitted=0;"
            f"rolling-6h={len(six_hour_bins)}x3h;"
            f"rolling-24h={len(day_bins)}x3h"
        )
        snapshots.append(
            WeatherSnapshot(
                period="forecast",
                retrieved_at=retrieved_at,
                valid_at=valid_at,
                lead_time_hours=max(
                    0.0,
                    (valid_at - current_valid_at).total_seconds() / 3600,
                ),
                precipitation_1h_mm=None,
                precipitation_3h_mm=rain_3h,
                precipitation_6h_mm=precipitation_6h,
                precipitation_24h_mm=precipitation_24h,
                soil_moisture=None,
                antecedent_daily_rainfall_mm=[],
                source=source,
                **_condition_fields(entry),
            )
        )
    return snapshots
