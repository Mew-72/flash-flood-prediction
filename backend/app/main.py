from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import (
    routes_catchments,
    routes_replay,
    routes_risk,
    routes_simulate,
    routes_villages,
)

app = FastAPI(
    title="Village-Level Flash-Flood Risk Forecasting API",
    description=(
        "SIH project: public-data-first, sub-catchment hydrology mapped to "
        "village preparedness alerts for a pilot hilly region."
    ),
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten before real deployment
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(routes_villages.router)
app.include_router(routes_catchments.router)
app.include_router(routes_risk.router)
app.include_router(routes_simulate.router)
app.include_router(routes_replay.router)


@app.get("/health")
def health_check():
    return {"status": "ok", "storage": "json", "model_unit": "sub-catchment"}
