"""Async Open-Meteo client and temporal weather normalization."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx

from app.config import Settings, get_settings
from app.core.data_sources.cache import AsyncTTLCache
from app.schemas.weather import WeatherSnapshot, WeatherTimeline

HOURLY_VARS = (
    "precipitation,soil_moisture_0_to_1cm,"
    "soil_moisture_1_to_3cm,soil_moisture_3_to_9cm"
)
CURRENT_VARS = "precipitation,soil_moisture_0_to_1cm"


class OpenMeteoClient:
    """Reusable API adapter backed by the application's lifespan HTTP client."""

    def __init__(self, http_client: httpx.AsyncClient, settings: Settings):
        self._http_client = http_client
        self._settings = settings
        self._cache: AsyncTTLCache[dict] = AsyncTTLCache(
            max_entries=settings.weather_cache_max_entries,
            ttl_seconds=settings.weather_cache_ttl_seconds,
        )
        self._request_slots = asyncio.Semaphore(settings.weather_max_concurrency)

    async def _get(self, url: str, params: dict[str, Any]) -> dict:
        key = (url, tuple(sorted((name, str(value)) for name, value in params.items())))

        async def fetch() -> dict:
            async with self._request_slots:
                response = await self._http_client.get(url, params=params)
            response.raise_for_status()
            payload = response.json()
            if not isinstance(payload, dict):
                raise ValueError("Open-Meteo returned a non-object JSON response")
            return payload

        return await self._cache.get_or_create(key, fetch)

    async def get_forecast(
        self, lat: float, lon: float, forecast_days: int = 3, past_days: int = 5
    ) -> dict:
        return await self._get(
            self._settings.open_meteo_forecast_url,
            {
                "latitude": lat,
                "longitude": lon,
                "hourly": HOURLY_VARS,
                "current": CURRENT_VARS,
                "forecast_days": forecast_days,
                "past_days": past_days,
                "timezone": "UTC",
            },
        )

    async def get_historical(
        self, lat: float, lon: float, start_date: str, end_date: str
    ) -> dict:
        return await self._get(
            self._settings.open_meteo_archive_url,
            {
                "latitude": lat,
                "longitude": lon,
                "start_date": start_date,
                "end_date": end_date,
                "hourly": HOURLY_VARS,
                "timezone": "UTC",
            },
        )

    async def get_flood_forecast(self, lat: float, lon: float) -> dict:
        return await self._get(
            self._settings.open_meteo_flood_url,
            {
                "latitude": lat,
                "longitude": lon,
                "daily": "river_discharge",
                "timezone": "UTC",
            },
        )


async def get_forecast(
    lat: float,
    lon: float,
    forecast_days: int = 3,
    past_days: int = 5,
    *,
    weather_client: OpenMeteoClient | None = None,
) -> dict:
    """Compatibility helper; callers must provide the lifespan-managed client."""
    if weather_client is None:
        raise RuntimeError("A lifespan-managed OpenMeteoClient is required")
    return await weather_client.get_forecast(lat, lon, forecast_days, past_days)


async def get_historical(
    lat: float,
    lon: float,
    start_date: str,
    end_date: str,
    *,
    weather_client: OpenMeteoClient | None = None,
) -> dict:
    if weather_client is None:
        raise RuntimeError("A lifespan-managed OpenMeteoClient is required")
    return await weather_client.get_historical(lat, lon, start_date, end_date)


async def get_flood_forecast(
    lat: float,
    lon: float,
    *,
    weather_client: OpenMeteoClient | None = None,
) -> dict:
    if weather_client is None:
        raise RuntimeError("A lifespan-managed OpenMeteoClient is required")
    return await weather_client.get_flood_forecast(lat, lon)


def _as_utc(value: str | datetime) -> datetime:
    parsed = datetime.fromisoformat(value) if isinstance(value, str) else value
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _reference_time(payload: dict, retrieved_at: datetime) -> datetime:
    current_time = payload.get("current", {}).get("time")
    return _as_utc(current_time) if current_time else retrieved_at


def _soil_moisture_at(hourly: dict, index: int) -> float:
    values = hourly.get("soil_moisture_0_to_1cm", [])
    for position in range(min(index, len(values) - 1), -1, -1):
        value = values[position]
        if value is not None:
            return max(0.0, min(1.0, float(value)))
    return 0.0


def _window_total(
    times: list[datetime], precipitation: list[float], index: int, hours: int
) -> float:
    valid_at = times[index]
    after = valid_at - timedelta(hours=hours)
    return round(
        sum(
            precipitation[position]
            for position in range(index + 1)
            if after < times[position] <= valid_at
        ),
        3,
    )


def _antecedent_days(
    times: list[datetime], precipitation: list[float], valid_at: datetime
) -> list[float]:
    valid_day_start = valid_at.replace(hour=0, minute=0, second=0, microsecond=0)
    daily: dict[str, float] = {}
    for timestamp, amount in zip(times, precipitation):
        if timestamp >= valid_day_start:
            continue
        day = timestamp.date().isoformat()
        daily[day] = daily.get(day, 0.0) + amount
    return [round(daily[day], 3) for day in sorted(daily)]


def extract_weather_timeline(
    hourly_response: dict,
    *,
    retrieved_at: datetime | None = None,
    reference_time: datetime | None = None,
) -> WeatherTimeline:
    """Separate observations from forecasts and calculate trailing rain windows.

    The model value at or immediately before the provider's current timestamp is
    the only value treated as current. Future values remain forecasts regardless
    of their calendar date, preventing the furthest forecast day from becoming
    the assessment's "today" value.
    """
    retrieved = _as_utc(retrieved_at or datetime.now(timezone.utc))
    reference = _as_utc(reference_time) if reference_time else _reference_time(
        hourly_response, retrieved
    )
    hourly = hourly_response.get("hourly", {})
    raw_times = hourly.get("time", [])
    raw_precipitation = hourly.get("precipitation", [])
    if len(raw_times) != len(raw_precipitation):
        raise ValueError("Hourly time and precipitation arrays must have equal length")

    times = [_as_utc(value) for value in raw_times]
    precipitation = [max(0.0, float(value or 0.0)) for value in raw_precipitation]
    if times != sorted(times):
        raise ValueError("Hourly weather timestamps must be chronological")

    def snapshot(index: int, period: str) -> WeatherSnapshot:
        valid_at = times[index]
        lead = (
            max(0.0, (valid_at - reference).total_seconds() / 3600.0)
            if period == "forecast"
            else 0.0
        )
        return WeatherSnapshot(
            period=period,
            retrieved_at=retrieved,
            valid_at=valid_at,
            lead_time_hours=round(lead, 3),
            precipitation_1h_mm=_window_total(times, precipitation, index, 1),
            precipitation_3h_mm=_window_total(times, precipitation, index, 3),
            precipitation_6h_mm=_window_total(times, precipitation, index, 6),
            precipitation_24h_mm=_window_total(times, precipitation, index, 24),
            soil_moisture=_soil_moisture_at(hourly, index),
            antecedent_daily_rainfall_mm=_antecedent_days(
                times, precipitation, valid_at
            ),
        )

    current_or_past_indices = [
        index for index, value in enumerate(times) if value <= reference
    ]
    current_index = current_or_past_indices[-1] if current_or_past_indices else None
    past = [
        snapshot(index, "past")
        for index in current_or_past_indices
        if index != current_index
    ]
    current = snapshot(current_index, "current") if current_index is not None else None
    forecast = [
        snapshot(index, "forecast")
        for index, value in enumerate(times)
        if value > reference
    ]
    return WeatherTimeline(
        retrieved_at=retrieved,
        past=past,
        current=current,
        forecast=forecast,
    )


def risk_rainfall_series(snapshot: WeatherSnapshot) -> list[float]:
    """Create the legacy engine input without mixing later forecasts into today."""
    antecedent = snapshot.antecedent_daily_rainfall_mm[-5:]
    return [*antecedent, snapshot.precipitation_24h_mm]


def extract_daily_rainfall_totals(hourly_response: dict) -> list[float]:
    """Legacy chronological daily aggregation, retained for replay clients."""
    times = hourly_response.get("hourly", {}).get("time", [])
    precipitation = hourly_response.get("hourly", {}).get("precipitation", [])
    daily_totals: dict[str, float] = {}
    for timestamp, amount in zip(times, precipitation):
        day = timestamp.split("T")[0]
        daily_totals[day] = daily_totals.get(day, 0.0) + float(amount or 0.0)
    return [daily_totals[day] for day in sorted(daily_totals)]


def extract_daily_latest_soil_moisture(
    hourly_response: dict, depth_key: str = "soil_moisture_0_to_1cm"
) -> list[float]:
    """Return each day's final available value without leaking later days."""
    hourly = hourly_response.get("hourly", {})
    times = hourly.get("time", [])
    values = hourly.get(depth_key, [])
    if len(times) != len(values):
        raise ValueError("Hourly time and soil-moisture arrays must have equal length")
    daily: dict[str, float] = {}
    for timestamp, value in zip(times, values):
        if value is not None:
            daily[timestamp.split("T")[0]] = float(value)
    return [daily.get(day, 0.0) for day in sorted({time.split("T")[0] for time in times})]


def extract_latest_soil_moisture(
    hourly_response: dict, depth_key: str = "soil_moisture_0_to_1cm"
) -> float:
    values = hourly_response.get("hourly", {}).get(depth_key, [])
    for value in reversed(values):
        if value is not None:
            return float(value)
    return 0.0


def build_default_client(http_client: httpx.AsyncClient) -> OpenMeteoClient:
    return OpenMeteoClient(http_client, get_settings())
