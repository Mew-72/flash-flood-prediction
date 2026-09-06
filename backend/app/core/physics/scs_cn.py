"""
SCS Curve Number (SCS-CN) runoff model.

Q = (P - Ia)^2 / (P - Ia + S)   if P > Ia, else Q = 0
S = 25400 / CN - 254   (mm)
Ia = lambda * S        (initial abstraction, lambda default 0.20)

Reference: USDA NRCS National Engineering Handbook, Part 630, Chapter 10.
"""
from app.config import INITIAL_ABSTRACTION_RATIO, AMC_DRY_UPPER_MM, AMC_WET_LOWER_MM


def compute_potential_retention(curve_number: float) -> float:
    """S, in mm."""
    if not (0 < curve_number <= 100):
        raise ValueError("Curve Number must be in (0, 100]")
    return (25400.0 / curve_number) - 254.0


def compute_initial_abstraction(s_mm: float, lam: float = INITIAL_ABSTRACTION_RATIO) -> float:
    return lam * s_mm


def compute_runoff_depth_mm(rainfall_mm: float, curve_number: float,
                             lam: float = INITIAL_ABSTRACTION_RATIO) -> float:
    """Direct runoff depth Q, in mm, for a given rainfall depth and Curve Number."""
    s = compute_potential_retention(curve_number)
    ia = compute_initial_abstraction(s, lam)
    if rainfall_mm <= ia:
        return 0.0
    return ((rainfall_mm - ia) ** 2) / (rainfall_mm - ia + s)


def adjust_cn_for_amc(cn_ii: float, amc_class: int) -> float:
    """Convert a normal-condition (AMC-II) Curve Number to AMC-I (dry) or
    AMC-III (wet) using the standard Hawkins (1985) conversion formulas."""
    if amc_class == 1:
        return (4.2 * cn_ii) / (10 - 0.058 * cn_ii)
    if amc_class == 3:
        return (23 * cn_ii) / (10 + 0.13 * cn_ii)
    return cn_ii  # AMC-II: unchanged


def determine_amc_class(antecedent_5day_rainfall_mm: float) -> int:
    """Classic SCS AMC classification from 5-day antecedent rainfall (mm)."""
    if antecedent_5day_rainfall_mm < AMC_DRY_UPPER_MM:
        return 1
    if antecedent_5day_rainfall_mm > AMC_WET_LOWER_MM:
        return 3
    return 2


def compute_moisture_adjusted_runoff_mm(rainfall_mm: float, cn_ii: float,
                                         antecedent_5day_rainfall_mm: float) -> dict:
    """Full pipeline: pick AMC class from antecedent rainfall, adjust CN,
    then compute runoff. Returns a breakdown dict (useful for the explainability panel)."""
    amc_class = determine_amc_class(antecedent_5day_rainfall_mm)
    adjusted_cn = adjust_cn_for_amc(cn_ii, amc_class)
    runoff_mm = compute_runoff_depth_mm(rainfall_mm, adjusted_cn)
    return {
        "amc_class": amc_class,
        "cn_ii": cn_ii,
        "adjusted_cn": round(adjusted_cn, 2),
        "runoff_mm": round(runoff_mm, 2),
    }
