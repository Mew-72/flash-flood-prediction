# Village-Level Flash-Flood Risk Forecasting (SIH)

A public-data-first early-warning prototype for hilly regions. It computes
rainfall-runoff risk at **sub-catchment level**, then maps that hazard to
**village-level preparedness alerts** using local stream proximity and terrain.
It does not claim to measure village-level rainfall or predict exact inundation.

## Product position

The project is a lightweight localization layer between regional weather/flood
guidance and local sensor networks:

```text
coarse rainfall + antecedent wetness
                 ↓
        sub-catchment runoff
                 ↓
 drainage response + village exposure
                 ↓
       village alert prioritization
```

It works without deployed sensors. Optional IoT readings can later correct the
public-data baseline for instrumented locations.

## Computation units

- **Sub-catchment:** hydrological unit. Stores area-weighted land use/soil,
  Curve Number inputs, area, channel slope, and longest flow path.
- **Village:** alert/reporting unit. Stores its catchment mapping, local slope,
  distance to stream, and optional historical evidence.
- **Weather grid:** shared forcing. Villages in a grid may share rainfall and
  soil moisture; the system does not fabricate finer weather observations.

## Methods

- SCS-CN direct runoff with Antecedent Moisture Condition adjustment.
- 3-day antecedent rainfall reduction of the rainfall trigger threshold.
- Antecedent Precipitation Index (API).
- Kirpich Time of Concentration as an indicative catchment response time—not a
  guaranteed evacuation lead time.
- Local village exposure from stream proximity and terrain concentration.
- Infinite-slope stability retained as a supplemental indicator because the
  SIH statement mentions slope stability; it does not drive flash-flood risk.
- Future optional Random Forest/XGBoost calibration using verified events.

## Storage choice

The MVP intentionally uses JSON instead of PostgreSQL/PostGIS:

- `data/processed/catchments.json` — generated catchment features
- `data/processed/villages.json` — generated village mappings/exposure
- `demo_catchments.json` and `demo_villages.json` — automatic fallback fixtures

GeoPandas/Rasterio are used only during one-time preprocessing. JSON is simpler
for a one-region hackathon demo and easy for the team to inspect/version. A
spatial database is only justified later for multiple states, concurrent edits,
or very large geometries/time-series.

## Backend structure

```text
backend/app/
├── main.py
├── api/                 villages, catchments, risk, replay, simulation
├── core/
│   ├── data_sources/    JSON store, Open-Meteo client, IoT simulator
│   ├── lookup_tables/   Curve Number and soil reference values
│   └── physics/         runoff, antecedent wetness, slope, risk orchestration
└── schemas/
backend/etl/              one-time geospatial preprocessing contract
data/processed/           compact runtime JSON files
```

## Run

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
uvicorn app.main:app --reload --port 8000
```

Open `http://localhost:8000/docs`.

Useful endpoints:

- `GET /catchments`
- `GET /villages`
- `GET /risk/{village_id}`
- `POST /simulate`
- `GET /replay/{village_id}?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD`

Run tests with `pytest tests -v` from `backend/`.

Install heavier tools only when needed:

- `pip install -r requirements-etl.txt` for GeoPandas/Rasterio preprocessing.
- `pip install -r requirements-ml.txt` for future RF/XGBoost calibration.

## Next implementation step

Choose one pilot region, download its DEM, catchment, village, land-use, soil,
and stream layers, then adapt `backend/etl/build_village_features.py` to their
actual columns. Historical events are optional calibration/validation evidence,
not a prerequisite for the baseline engine.
