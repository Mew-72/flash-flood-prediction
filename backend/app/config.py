"""Central configuration and physical constants for the risk engines."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        extra="ignore",
    )

    data_mode: Literal["demo", "production"] = "demo"
    imd_api_base_url: str = "https://api.imd.gov.in/api/v1"
    imd_api_key: SecretStr | None = None
    imd_access_token: SecretStr | None = None
    weather_timeout_seconds: float = Field(default=15.0, gt=0)
    weather_cache_ttl_seconds: float = Field(default=300.0, gt=0)
    weather_cache_max_entries: int = Field(default=128, gt=0)
    weather_max_concurrency: int = Field(default=8, gt=0)
    mqtt_broker_host: str = "localhost"
    mqtt_broker_port: int = 1883



@lru_cache
def get_settings() -> Settings:
    return Settings()


# ---- Physical constants (fixed, not configurable per-environment) ----

GAMMA_WATER_KN_M3 = 9.81          # unit weight of water, kN/m^3
API_DECAY_CONSTANT = 0.875        # typical antecedent precipitation index decay constant (k)
INITIAL_ABSTRACTION_RATIO = 0.20  # lambda in Ia = lambda * S (SCS-CN standard)

# AMC (Antecedent Moisture Condition) classification thresholds, based on
# classic SCS 5-day antecedent rainfall bands (growing season, mm).
AMC_DRY_UPPER_MM = 35.0
AMC_WET_LOWER_MM = 53.0

# Antecedent-rainfall alert-threshold reduction (validated by ISRO/NRSC's own
# experimental Uttarakhand LEWS combining ID thresholds with antecedent rainfall).
# Bands are based on IMD's published daily rainfall intensity classification.
ANTECEDENT_WET_3DAY_MM = 115.6     # IMD "very heavy rain" cumulative band
ANTECEDENT_MODERATE_3DAY_MM = 64.5  # IMD "heavy rain" cumulative band
ANTECEDENT_WET_REDUCTION = 0.30
ANTECEDENT_MODERATE_REDUCTION = 0.15

# Factor of Safety risk classification bands (standard landslide susceptibility banding)
FS_CRITICAL_MAX = 1.0
FS_HIGH_MAX = 1.25
FS_MODERATE_MAX = 1.5
