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

The MVP uses compact files instead of PostgreSQL/PostGIS:

- `data/processed/catchments.json` — generated catchment features
- `data/processed/villages.json` — generated village mappings/exposure
- `data/processed/villages.parquet` or `bhuvan_villages.parquet` — national
  GeoParquet village boundaries, filtered by state/district before reading
- `demo_catchments.json` and `demo_villages.json` — explicit `DATA_MODE=demo` fixtures

Production mode never falls back to demo data. It fails at startup when the
canonical processed files are missing, and `/health` reports the active mode
and source filenames.

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
│   ├── data_sources/    indexed JSON store, async cached weather, IoT simulator
│   ├── lookup_tables/   Curve Number and soil reference values
│   ├── physics/         catchment hazard and village risk composition
│   └── risk_service.py  grouped/bulk assessment orchestration
└── schemas/              typed admin, weather, hazard, risk, provenance
backend/etl/              one-time geospatial preprocessing contract
backend/validation/       reproducible historical-event hindcasts
data/processed/           compact runtime JSON files
```

## Run

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
# Add IMD_API_KEY and the portal-issued IMD_ACCESS_TOKEN JWT to .env.
# IMD_API_KEY alone is not accepted by the IMD gateway.
uvicorn app.main:app --reload --port 8000
```

Open `http://localhost:8000/docs`.

In a second terminal, start the React frontend:

```bash
cd frontend
npm install
npm run dev
```

Open the Vite URL (normally `http://localhost:5173`). The public dashboard is
available at `/` and the React administrator route at `/admin`.

Useful endpoints:

- `GET /v1/villages?district=...&offset=0&limit=100`
- `GET /v1/villages/boundaries?district_code=58&offset=0&limit=100`
- `GET /v1/catchments?district=...&offset=0&limit=100`
- `GET /v1/risk/{village_id}`
- `POST /v1/risk/batch` — bounded bulk assessment grouped by catchment
- `GET /v1/risk/snapshots?district=...` — grouped current/forecast snapshots
- `POST /simulate`
- `GET /replay/{village_id}?start_date=YYYY-MM-DD&end_date=YYYY-MM-DD` —
  returns `501` with the IMD provider until an official historical range product
  is available

The IMD weather client is asynchronous, caches/coalesces identical requests,
and bounds concurrent upstream calls. It uses exact 24-hour station rainfall
from `cityforecastloc`. Live inspection confirms that `basinqpf` `Day1…Day5`
values are category codes rather than millimetres, so they are not fed into the
numerical risk engine. IMD's public reference does not expose soil moisture,
quantitative 1/3/6-hour totals, or a historical date-range endpoint, so these
values are not fabricated. Villages in one catchment share one weather
request and one catchment-hazard computation.

Run tests with `pytest tests -v` from `backend/`.

Reproduce the pinned 31 July 2024 Kedar Valley hindcast with:

```bash
python -m validation.hindcast
pytest tests/test_hindcast_kedar_2024.py -v
```

The current result is scientifically useful but deliberately limited: the
engine detects the completed event-day rainfall as high/critical, while the
24–72 hour Open-Meteo previous runs do not produce a reliable actionable
warning. See `docs/HINDCAST_KEDAR_2024.md`.

Install heavier tools only when needed:

- `pip install -r requirements-etl.txt` for GeoPandas/Rasterio preprocessing.
- `pip install -r requirements-ml.txt` for future RF/XGBoost calibration.

## Next implementation step

Build real Rudraprayag/Kedar Valley features from DEM, catchment, village,
land-use, soil, and stream layers, then adapt
`backend/etl/build_village_features.py` to their profiled columns. Add more
positive events and matched non-event controls before calibrating thresholds or
claiming predictive skill.
