import logging
from collections.abc import Callable
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    routes_catchments,
    routes_replay,
    routes_risk,
    routes_simulate,
    routes_villages,
)
from app.config import get_settings
from app.core.data_sources.data_store import get_data_store
from app.core.data_sources.open_meteo import OpenMeteoClient
from app.schemas.provenance import HealthOut

HttpClientFactory = Callable[[], httpx.AsyncClient]
logger = logging.getLogger(__name__)


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
        client = (
            http_client_factory()
            if http_client_factory is not None
            else httpx.AsyncClient(timeout=settings.weather_timeout_seconds)
        )
        async with client:
            application.state.http_client = client
            application.state.weather_client = OpenMeteoClient(client, settings)
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

    @application.get("/health", response_model=HealthOut)
    def health_check(request: Request):
        store = request.app.state.data_store
        return {
            "status": "ok",
            "storage": "json",
            "model_unit": "sub-catchment",
            "data_mode": store.data_mode,
            "provenance": store.provenance,
        }

    return application


app = create_app()
