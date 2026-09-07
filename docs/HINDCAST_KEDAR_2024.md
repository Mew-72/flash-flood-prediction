# Kedar Valley 31 July 2024 hindcast

## Question

Could the current prototype have warned before the destructive rainfall, flash
flooding, and slope failures reported in the Kedar Valley at approximately
19:30 IST on 31 July 2024?

## Evidence and provenance

Down To Earth reported damage in Rudraprayag, including the Kedarnath route,
Gaurikund, Lincholi, Bhimbali, and Rambada. It cites an IMD red alert and more
than 30 mm of rainfall in one hour at Sonprayag. IMD did not classify the event
as a cloudburst under its more-than-100-mm-per-hour definition.

Sources and the exact Open-Meteo retrieval URLs are pinned in
`backend/validation/events/kedar_valley_2024_07_31.json`.

The Open-Meteo datasets have different meanings:

- Historical/event-day data approximates what happened and is useful for
  retrospective detection.
- Historical Forecast stitches the first hours of successive model runs and is
  close to analysis; it does not preserve an advance forecast horizon.
- Previous Runs exposes precipitation predicted 24, 48, and 72 hours before
  each valid hour and is the relevant source for lead-time sensitivity.

## Reproduce

From `backend/`:

```bash
python -m validation.hindcast
python -m validation.hindcast --json
pytest tests/test_hindcast_kedar_2024.py -v
```

The runner performs no network access. It feeds the pinned forcing values into
the same `assess_catchment_hazard` and `compose_village_risk` functions used by
the API.

## Results

### Exact current demo configuration

The current `c1` weather point is approximately 39 km from Kedarnath.

| Scenario | Rainfall | v1 | v3 | v4 |
|---|---:|---:|---:|---:|
| Completed event-day analysis | 43.6 mm | high | high | high |
| Forecast 24 h earlier | 3.8 mm | moderate | moderate | moderate |
| Forecast 48 h earlier | 10.4 mm | moderate | moderate | moderate |
| Forecast 72 h earlier | 10.3 mm | moderate | moderate | moderate |

### Kedarnath-grid sensitivity

This applies location-corrected weather to the existing synthetic catchment and
village parameters; it is not a real Kedar Valley terrain hindcast.

| Scenario | Rainfall | v1 | v3 | v4 |
|---|---:|---:|---:|---:|
| Completed event-day analysis | 76.9 mm | 0.804 critical | 0.756 critical | 0.815 critical |
| Forecast 24 h earlier | 0.1 mm | moderate | moderate | moderate |
| Forecast 48 h earlier | 1.0 mm | moderate | moderate | moderate |
| Forecast 72 h earlier | 2.1 mm | moderate | moderate | moderate |

The retrospective Kedarnath calculation estimates 43.11 mm of direct runoff
under wet AMC-III conditions. That shows the engine reacts in the correct
direction when supplied a sufficiently large rainfall total.

## Verdict

The prototype detects the event retrospectively but does not demonstrate a
reliable actionable advance warning. Open-Meteo previous model runs severely
underpredicted this localized storm. The moderate forecast scores are largely
static exposure plus antecedent wetness, not a forecast of extreme rainfall.

This result is useful: it supports retaining the catchment/runoff layer while
showing that Open-Meteo cannot be the only operational trigger.

## Important limitations

1. The full event-day total contains rain at and after the reported impact, so
   its critical/high result is detection, not prediction.
2. Forecast scenarios reuse event-analysis antecedent totals. This is an
   optimistic sensitivity with some future leakage at 48 and 72 hours. The lack
   of an actionable warning despite that optimism strengthens the negative
   conclusion but does not make this a formal skill score.
3. The current villages and catchment are synthetic and geographically
   misplaced. Real DEM-derived Kedar Valley features are still required.
4. The engine converts hourly input to daily totals. It therefore discards the
   reported greater-than-30-mm hourly intensity even though its estimated
   catchment response time is about 47 minutes.
5. One positive event cannot estimate false-alarm rate, probability of
   detection, or critical success index. Non-events and additional events must
   be added before calibration.

## Engineering consequence

The runtime forcing layer should combine numerical forecasts with IMD warning
levels, radar/satellite nowcasts, and gauges where available. The risk contract
must retain 1 h, 3 h, 6 h, and 24 h rainfall windows. Operational products
should be separated into 24–72 h preparedness outlooks, 1–6 h watches, and
real-time detection/escalation.
