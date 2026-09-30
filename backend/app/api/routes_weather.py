"""Server-side proxy routes for allowlisted OpenWeather map tiles."""

from collections.abc import Awaitable, Callable
from typing import cast

import httpx
from fastapi import APIRouter, HTTPException, Path, Request, Response

from app.core.data_sources.openweather import (
    OpenWeatherConfigurationError,
    OpenWeatherError,
)

router = APIRouter(prefix="/v1/weather", tags=["weather"])
TILE_LAYERS = frozenset({"precipitation_new", "clouds_new"})


@router.get("/tiles/{layer}/{z}/{x}/{y}.png")
async def weather_tile(
    request: Request,
    layer: str,
    z: int = Path(ge=0, le=18),
    x: int = Path(ge=0),
    y: int = Path(ge=0),
):
    if layer not in TILE_LAYERS:
        raise HTTPException(status_code=404, detail="Weather tile layer not found")
    maximum_index = (1 << z) - 1
    if x > maximum_index or y > maximum_index:
        raise HTTPException(
            status_code=422,
            detail="Tile x and y must be valid indices for the requested zoom",
        )

    get_tile = cast(
        Callable[[str, int, int, int], Awaitable[bytes]] | None,
        getattr(request.app.state.weather_client, "get_tile", None),
    )
    if not callable(get_tile):
        raise HTTPException(
            status_code=503,
            detail="Weather tiles are disabled for the active data mode",
        )

    try:
        tile = await get_tile(layer, z, x, y)
    except OpenWeatherConfigurationError as exc:
        raise HTTPException(
            status_code=503, detail="Weather tile service is not configured"
        ) from exc
    except (httpx.HTTPError, OpenWeatherError) as exc:
        raise HTTPException(
            status_code=502, detail="Weather tile is temporarily unavailable"
        ) from exc

    max_age = int(request.app.state.weather_tile_cache_ttl_seconds)
    return Response(
        content=tile,
        media_type="image/png",
        headers={
            "Cache-Control": f"public, max-age={max_age}",
            "X-Content-Type-Options": "nosniff",
        },
    )
