# Architecture and Scientific Boundaries

## Scope

This is a **village-level flash-flood risk forecasting and early-warning
prototype**, not an exact inundation or deterministic flood prediction model.
The pilot ranks locations for preparedness using public data and lightweight,
explainable hydrology.

## Why catchments and villages are separate

Water follows terrain and drainage boundaries, not administrative boundaries.
SCS-CN runoff is therefore calculated for each sub-catchment using
area-weighted land use and soil characteristics. Villages are only the alert
unit: each inherits its catchment hazard and receives a local exposure
adjustment based on distance to streams and local terrain.

Two villages in one weather cell or catchment may receive different alert
scores, but not because rainfall was artificially downscaled. They differ
because their local exposure differs.

## Processing flow

### Offline regional preprocessing

```text
DEM → slope + flow direction + flow accumulation + stream network
    → sub-catchments + longest flow path + channel slope
land use + soil → area-weighted catchment Curve Number inputs
villages → catchment mapping + local slope + distance to stream
```

The ETL writes `catchments.json` and `villages.json`.

### Runtime assessment

```text
async Open-Meteo current/forecast timeline
        ↓
1 h/3 h/6 h/24 h windows + completed antecedent days
        ↓
SCS-CN runoff once per sub-catchment
        ↓
threshold exceedance + estimated response time
        ↓
stream-proximity/terrain exposure per village
        ↓
cached/grouped village risk snapshots
```

Historical replay calls the same engine with archived weather. Lead-time
validation uses pinned Previous Runs data instead of treating reanalysis as a
forecast. IoT remains an optional override/correction rather than a requirement.

## Baseline score

The fallback score currently combines:

- catchment runoff: 30%
- effective rainfall-trigger exceedance: 30%
- antecedent wetness/API: 15%
- village exposure: 25%

These are prototype engineering weights, not claimed as universal calibrated
probabilities. A future classical ML layer may calibrate them where enough
verified event/non-event data exists. Historical event density is optional and
does not drive the baseline score.

## Slope stability

The infinite-slope Factor of Safety remains available as a supplemental
compound-hazard indicator because the SIH statement includes slope stability
and hilly floods can coincide with slope failures. It is deliberately excluded
from the core flash-flood composite score.

## Indicative response time

The Kirpich Time of Concentration estimates how quickly a catchment may respond
to rainfall from longest flow path and channel slope. It must be displayed as
an **estimated hydrological response time**, not guaranteed warning or
safe-evacuation lead time.

## Runtime storage

The MVP uses JSON files, not PostGIS. This is appropriate for one pilot region
because the processed records are compact, mostly read-only, transparent, and
loaded once into indexed in-process catalogs. `DATA_MODE=production` requires
canonical processed files and never falls back to demo fixtures. Raw
raster/vector processing still uses GeoPandas and Rasterio offline.

Move to PostGIS only if later requirements include multiple states, large
geometries served dynamically, concurrent updates, or long sensor time-series.

## Data responsibility

| Data | Runtime role |
|---|---|
| Open-Meteo forecast | Model-derived current and forecast forcing; async, cached, bounded |
| Open-Meteo archive | Historical event replay, not proof of advance warning |
| Open-Meteo Previous Runs | Fixed-lead hindcast sensitivity and forecast-skill evaluation |
| IMD warnings/radar | Required future regional warning and short-duration nowcast signal |
| DEM | Offline slope, drainage, flow path, catchment derivation |
| Land use + soil | Offline catchment Curve Number inputs |
| Village boundaries + streams | Offline village mapping/exposure |
| Historical event evidence | Optional validation and ML calibration |
| Simulated IoT | Demonstrates optional local correction |

## Known approximations

- Rainfall and modeled soil moisture remain coarse-grid forcing; current model
  values are not labeled as gauge observations.
- The 1 h/3 h/6 h/24 h windows are preserved in API snapshots, but the baseline
  composite still uses a 24-hour/event-depth SCS-CN calculation and needs an
  independently calibrated intensity trigger.
- The base rainfall trigger is a pilot parameter until calibrated against
  verified events or channel observations.
- Time of concentration is empirical and indicative.
- Stream proximity/local slope are exposure proxies; relative elevation and
  inundation routing would improve a future version.
- Geotechnical properties are literature lookups, not field measurements.
- The Kedar Valley 31 July 2024 hindcast detects completed event rainfall but
  fails to show reliable high/critical warning at 24–72 hours; Open-Meteo alone
  is insufficient for localized Himalayan extremes.

## Defensible contribution

The system is not the first to combine coarse weather forcing with finer terrain
susceptibility. Its practical contribution is a reproducible,
public-data-first localization layer that can produce baseline village
prioritization before hardware deployment, while remaining ready for optional
sensor correction and government alert integration.
