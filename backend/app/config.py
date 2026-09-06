"""Central configuration and physical constants for the risk engines."""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    open_meteo_forecast_url: str = "https://api.open-meteo.com/v1/forecast"
    open_meteo_archive_url: str = "https://archive-api.open-meteo.com/v1/archive"
    open_meteo_flood_url: str = "https://flood-api.open-meteo.com/v1/flood"
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
