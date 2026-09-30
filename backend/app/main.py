import logging
from collections.abc import Callable
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    routes_admin,
    routes_catchments,
    routes_replay,
    routes_risk,
    routes_simulate,
    routes_villages,
    routes_weather,
)
from app.config import get_settings
from app.core.data_sources.data_store import get_data_store
from app.core.data_sources.demo_weather import DemoWeatherClient
from app.core.data_sources.hybrid_weather import HybridWeatherClient
from app.core.data_sources.imd import ImdClient
from app.core.data_sources.openweather import OpenWeatherClient
from app.schemas.provenance import HealthOut

HttpClientFactory = Callable[[], httpx.AsyncClient]
logger = logging.getLogger(__name__)


def _secret_is_set(value: object | None) -> bool:
    if value is None:
        return False
    reveal = getattr(value, "get_secret_value", None)
    return bool(str(reveal() if callable(reveal) else value).strip())


def _weather_capabilities(provider: str) -> list[str]:
    if provider == "demo":
        return [
            "deterministic_current_scenario",
            "deterministic_forecast_scenarios",
            "no_external_weather_requests",
            "no_weather_tiles",
        ]

    capabilities = [
        "current_conditions",
        "current_rain_1h_or_3h",
        "five_day_forecast_at_3h_intervals",
        "rolling_6h_and_24h_forecast_rainfall",
        "precipitation_and_cloud_tiles",
        "no_historical_replay",
        "no_soil_moisture",
    ]
    if provider == "openweather+imd":
        capabilities.insert(1, "observed_24h_rainfall_nearest_imd_station")
    return capabilities


def create_app(http_client_factory: HttpClientFactory | None = None) -> FastAPI:
    @asynccontextmanager
    async def lifespan(application: FastAPI):
        settings = get_settings()
        if settings.data_mode == "demo":
            logger.warning(
                "Starting with synthetic demo data; set DATA_MODE=production "
                "to require canonical processed data"
            )
        application.state.data_store = get_data_store()
        application.state.alerts = []
        application.state.weather_tile_cache_ttl_seconds = (
            settings.weather_cache_ttl_seconds
        )

        if settings.data_mode == "demo":
            application.state.weather_client = DemoWeatherClient()
            application.state.weather_provider = "demo"
            application.state.weather_configured = True
            yield
            return

        client = (
            http_client_factory()
            if http_client_factory is not None
            else httpx.AsyncClient(timeout=settings.weather_timeout_seconds)
        )
        async with client:
            application.state.http_client = client
            openweather = OpenWeatherClient(client, settings)
            if _secret_is_set(settings.imd_api_key) and _secret_is_set(
                settings.imd_access_token
            ):
                application.state.weather_client = HybridWeatherClient(
                    openweather, ImdClient(client, settings)
                )
                application.state.weather_provider = "openweather+imd"
            else:
                application.state.weather_client = openweather
                application.state.weather_provider = "openweather"
            application.state.weather_configured = _secret_is_set(
                settings.weather_api
            )
            yield

    application = FastAPI(
        title="Village-Level Flash-Flood Risk Forecasting API",
        description=(
            "SIH project: public-data-first, sub-catchment hydrology mapped to "
            "village preparedness alerts for a pilot hilly region."
        ),
        version="1.0.0",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    application.include_router(routes_villages.router)
    application.include_router(routes_villages.v1_router)
    application.include_router(routes_catchments.router)
    application.include_router(routes_catchments.v1_router)
    application.include_router(routes_risk.router)
    application.include_router(routes_risk.v1_router)
    application.include_router(routes_simulate.router)
    application.include_router(routes_replay.router)
    application.include_router(routes_admin.router)
    application.include_router(routes_weather.router)

    @application.get("/health", response_model=HealthOut)
    def health_check(request: Request):
        store = request.app.state.data_store
        return {
            "status": "ok",
            "storage": "json+parquet",
            "model_unit": "sub-catchment",
            "data_mode": store.data_mode,
            "weather_provider": request.app.state.weather_provider,
            "weather_configured": request.app.state.weather_configured,
            "weather_capabilities": _weather_capabilities(
                request.app.state.weather_provider
            ),
            "provenance": store.provenance,
        }

    return application


app = create_app()
