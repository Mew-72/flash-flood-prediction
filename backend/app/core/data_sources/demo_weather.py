"""Deterministic, network-free weather used with the synthetic demo dataset."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from app.core.data_sources.provider import WeatherCapabilityError
from app.schemas.weather import WeatherSnapshot, WeatherTimeline


_DEMO_WEATHER = {
    "c1": {
        "current_rainfall_mm": 42.0,
        "antecedent_daily_rainfall_mm": [4.0, 8.0, 13.0, 17.0, 21.0],
        "temperature_c": 15.5,
        "humidity_percent": 92.0,
        "condition": "Heavy rain",
        "description": "synthetic heavy rain scenario",
    },
    "c2": {
        "current_rainfall_mm": 9.0,
        "antecedent_daily_rainfall_mm": [0.0, 1.0, 2.0, 1.0, 3.0],
        "temperature_c": 18.0,
        "humidity_percent": 76.0,
        "condition": "Light rain",
        "description": "synthetic light rain scenario",
    },
}


class DemoWeatherClient:
    """Return stable demo scenarios without contacting an external provider."""

    provider_name = "demo"

    async def get_timeline(self, catchment: dict[str, Any]) -> WeatherTimeline:
        now = datetime.now(timezone.utc).replace(microsecond=0)
        values = _DEMO_WEATHER.get(str(catchment.get("id")), _DEMO_WEATHER["c2"])
        current_rainfall = values["current_rainfall_mm"]
        antecedent = list(values["antecedent_daily_rainfall_mm"])

        current = _snapshot(
            period="current",
            retrieved_at=now,
            valid_at=now,
            lead_time_hours=0.0,
            rainfall_mm=current_rainfall,
            antecedent=antecedent,
            values=values,
            source="demo-synthetic:current-24h",
        )
        forecast = [
            _snapshot(
                period="forecast",
                retrieved_at=now,
                valid_at=now + timedelta(hours=lead_hours),
                lead_time_hours=float(lead_hours),
                rainfall_mm=max(0.0, current_rainfall * multiplier),
                antecedent=[*antecedent[1:], current_rainfall],
                values=values,
                source=f"demo-synthetic:forecast-{lead_hours}h",
            )
            for lead_hours, multiplier in ((3, 0.35), (6, 0.55), (24, 1.25), (48, 0.65))
        ]
        return WeatherTimeline(
            retrieved_at=now,
            past=[],
            current=current,
            forecast=forecast,
        )

    async def get_historical(self, *args: Any, **kwargs: Any) -> WeatherTimeline:
        del args, kwargs
        raise WeatherCapabilityError(
            "Demo weather is deterministic; use the pinned event replay for history"
        )


def _snapshot(
    *,
    period: str,
    retrieved_at: datetime,
    valid_at: datetime,
    lead_time_hours: float,
    rainfall_mm: float,
    antecedent: list[float],
    values: dict[str, Any],
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
        precipitation_24h_mm=round(rainfall_mm, 2),
        soil_moisture=None,
        antecedent_daily_rainfall_mm=antecedent,
        source=source,
        temperature_c=values["temperature_c"],
        feels_like_c=values["temperature_c"] - 0.8,
        humidity_percent=values["humidity_percent"],
        pressure_hpa=1006.0,
        wind_speed_mps=3.8,
        wind_direction_deg=190.0,
        cloud_cover_percent=90.0,
        visibility_m=4500.0,
        weather_condition=values["condition"],
        weather_description=values["description"],
        weather_icon=None,
    )
