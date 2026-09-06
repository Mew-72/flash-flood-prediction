"""
Open-Meteo client -- free, no API key required. Covers live forecast,
historical replay, and river discharge (flood) data, replacing the
not-yet-approved IMD API for this project.

NOTE: verify exact query-parameter names against https://open-meteo.com/en/docs
before the demo, in case the API has changed since this was written.
"""
import requests
from app.config import get_settings

HOURLY_VARS = "precipitation,soil_moisture_0_to_1cm,soil_moisture_1_to_3cm,soil_moisture_3_to_9cm"


def get_forecast(lat: float, lon: float, forecast_days: int = 3, past_days: int = 5) -> dict:
    """Live current + short-term forecast rainfall and soil moisture."""
    settings = get_settings()
    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": HOURLY_VARS,
        "forecast_days": forecast_days,
        "past_days": past_days,
        "timezone": "auto",
    }
    response = requests.get(settings.open_meteo_forecast_url, params=params, timeout=15)
    response.raise_for_status()
    return response.json()


def get_historical(lat: float, lon: float, start_date: str, end_date: str) -> dict:
    """Historical replay data for the demo (ERA5-based archive).
    Dates in 'YYYY-MM-DD' format."""
    settings = get_settings()
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start_date,
        "end_date": end_date,
        "hourly": HOURLY_VARS,
        "timezone": "auto",
    }
    response = requests.get(settings.open_meteo_archive_url, params=params, timeout=15)
    response.raise_for_status()
    return response.json()


def get_flood_forecast(lat: float, lon: float) -> dict:
    """River discharge forecast (GloFAS-based), ~5km grid."""
    settings = get_settings()
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": "river_discharge",
    }
    response = requests.get(settings.open_meteo_flood_url, params=params, timeout=15)
    response.raise_for_status()
    return response.json()


def extract_daily_rainfall_totals(hourly_response: dict) -> list[float]:
    """Collapse an hourly Open-Meteo response into a list of daily rainfall
    totals (mm), in chronological order."""
    times = hourly_response.get("hourly", {}).get("time", [])
    precipitation = hourly_response.get("hourly", {}).get("precipitation", [])
    daily_totals: dict[str, float] = {}
    for t, p in zip(times, precipitation):
        day = t.split("T")[0]
        daily_totals[day] = daily_totals.get(day, 0.0) + (p or 0.0)
    return [daily_totals[day] for day in sorted(daily_totals.keys())]


def extract_latest_soil_moisture(hourly_response: dict, depth_key: str = "soil_moisture_0_to_1cm") -> float:
    """Most recent non-null soil moisture reading from an hourly response."""
    values = hourly_response.get("hourly", {}).get(depth_key, [])
    for v in reversed(values):
        if v is not None:
            return v
    return 0.0
