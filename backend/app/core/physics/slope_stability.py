"""
Infinite-slope Factor of Safety model -- the same physics underpinning
USGS TRIGRS/SINMAP, implemented directly rather than running the full
TRIGRS software (out of scope for a hackathon timeline).

FS = [c + (gamma - m*gamma_w)*z*cos^2(beta)*tan(phi)] / [gamma*z*sin(beta)*cos(beta)]

m (0-1) is the degree of saturation, derived from a soil-moisture reading
normalized against field capacity and porosity.
"""
import math
from app.config import GAMMA_WATER_KN_M3, FS_CRITICAL_MAX, FS_HIGH_MAX, FS_MODERATE_MAX


def compute_saturation_ratio(volumetric_soil_moisture: float, field_capacity: float,
                              porosity: float) -> float:
    """m, clipped to [0, 1]."""
    if porosity <= field_capacity:
        raise ValueError("porosity must be greater than field_capacity")
    m = (volumetric_soil_moisture - field_capacity) / (porosity - field_capacity)
    return max(0.0, min(1.0, m))


def compute_factor_of_safety(cohesion_kpa: float, unit_weight_kn_m3: float,
                              soil_depth_m: float, slope_deg: float,
                              friction_angle_deg: float, saturation_ratio: float,
                              gamma_water_kn_m3: float = GAMMA_WATER_KN_M3) -> float:
    """Returns the Factor of Safety (dimensionless). FS < 1 implies theoretical failure."""
    beta = math.radians(slope_deg)
    phi = math.radians(friction_angle_deg)
    m = saturation_ratio

    numerator = cohesion_kpa + (unit_weight_kn_m3 - m * gamma_water_kn_m3) * soil_depth_m * (math.cos(beta) ** 2) * math.tan(phi)
    denominator = unit_weight_kn_m3 * soil_depth_m * math.sin(beta) * math.cos(beta)

    if denominator <= 0:
        # Flat or near-flat slope: treat as maximally stable.
        return float("inf")
    return numerator / denominator


def classify_landslide_risk(factor_of_safety: float) -> str:
    if factor_of_safety < FS_CRITICAL_MAX:
        return "critical"
    if factor_of_safety < FS_HIGH_MAX:
        return "high"
    if factor_of_safety < FS_MODERATE_MAX:
        return "moderate"
    return "low"


def compute_slope_risk(volumetric_soil_moisture: float, field_capacity: float,
                        porosity: float, cohesion_kpa: float, unit_weight_kn_m3: float,
                        soil_depth_m: float, slope_deg: float, friction_angle_deg: float) -> dict:
    """Full pipeline: soil moisture -> saturation ratio -> FS -> risk class."""
    m = compute_saturation_ratio(volumetric_soil_moisture, field_capacity, porosity)
    fs = compute_factor_of_safety(cohesion_kpa, unit_weight_kn_m3, soil_depth_m,
                                   slope_deg, friction_angle_deg, m)
    return {
        "saturation_ratio": round(m, 3),
        "factor_of_safety": round(fs, 3) if fs != float("inf") else fs,
        "risk_class": classify_landslide_risk(fs),
    }
