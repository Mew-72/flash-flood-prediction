# FlashGuard Frontend

Static frontend for the SIH Village-Level Flash-Flood Risk Forecasting project.

## Pages

- `index.html` — public monitoring dashboard
- `admin.html` — separate administrator console

## Main dashboard

Includes:
- Interactive Leaflet map
- State and district selectors
- Flood-risk layer
- Rainfall layer
- Soil-moisture layer
- Slope layer
- Elevation/DEM layer placeholder
- Streams
- Sub-catchments
- Villages
- Risk score and current-condition cards
- Village priority list
- Village detail modal

## Administrator console

Separate page for:
- Sending alerts
- Alert history
- Data monitoring
- System status

The alert form attempts:
`POST http://localhost:8000/v1/admin/alerts`

Your README does not currently define this endpoint, so if the endpoint is not implemented the prototype stores the alert in browser `localStorage` and clearly reports that it has not been delivered through the backend.

## Run

The easiest method is to serve this folder with a local web server.

From this folder:

```bash
python -m http.server 5500
```

Then open:

`http://localhost:5500/index.html`

Run your FastAPI backend separately on port 8000.

## Important

The included map overlays are demo visualization layers. Replace them with GeoJSON/API data from:
- `/v1/catchments`
- `/v1/villages`
- `/v1/risk/{village_id}`
- `/v1/risk/snapshots`

The JavaScript contains an adapter section so your actual FastAPI response fields can be mapped without redesigning the UI.
