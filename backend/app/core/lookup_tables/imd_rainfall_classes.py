"""IMD's published daily rainfall intensity classification (mm/day)."""

IMD_RAINFALL_CLASSES = [
    ("light", 2.5, 15.5),
    ("moderate", 15.6, 64.4),
    ("heavy", 64.5, 115.5),
    ("very_heavy", 115.6, 204.4),
    ("extremely_heavy", 204.5, float("inf")),
]


def classify_daily_rainfall(rainfall_mm: float) -> str:
    if rainfall_mm < 2.5:
        return "no_rain_or_trace"
    for label, low, high in IMD_RAINFALL_CLASSES:
        if low <= rainfall_mm <= high:
            return label
    return "extremely_heavy"
