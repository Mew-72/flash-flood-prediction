# FlashGuard React Frontend

React frontend for the SIH Village-Level Flash-Flood Risk Forecasting project. It uses Vite for local development and production builds and Leaflet for the interactive map.

## Pages

- `index.html` — public monitoring dashboard
- `admin.html` — administrator console

Both pages mount the React entry point in `src/main.jsx`, so the existing URLs continue to work with static hosting.

## Development

Requirements: Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

Vite prints the local URL, which is normally `http://localhost:5173`. Start the FastAPI backend on `http://localhost:8000` for live risk snapshots. If it is unavailable, the UI retains its demonstration values and alert history remains available in browser storage.

## Production build

```bash
npm run build
npm run preview
```

The static output is written to `dist/` and contains both `index.html` and `admin.html`.

## API configuration

The frontend uses `http://localhost:8000` while running locally and same-origin API paths in production. Override the API base with one of:

- `VITE_API_BASE_URL` at build time
- `window.FLASHGUARD_API_BASE` at runtime
- `?api_base=https://example.test` in the URL
- `FLASHGUARD_API_BASE` in browser local storage

## Source structure

```text
src/
├── components/       shared header, Leaflet map, village modal
├── pages/            public dashboard and administrator console
├── api.js            backend client and snapshot normalization
├── data.js           demonstration map and village data
├── App.jsx           page selection
├── main.jsx          React entry point
└── styles.css        shared dashboard styles
```
