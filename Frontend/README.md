# FlashGuard React Frontend

React frontend for the SIH Village-Level Flash-Flood Risk Forecasting project. It uses Vite, React Router, and Leaflet.

The frontend is a single-page React application. `index.html` is only Vite's application shell; all screens and content are implemented as React components under `src/`.

## Routes

- `/` — public monitoring dashboard
- `/admin` — administrator console

Navigation uses React Router and does not reload separate HTML pages.

## Development

Requirements: Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

Vite prints the local URL, normally `http://localhost:5173`. Start the FastAPI backend on `http://localhost:8000` for live risk snapshots. If it is unavailable, the UI retains its demonstration values and alert history remains available in browser storage.

## Production build

```bash
npm run build
npm run preview
```

The static output is written to `dist/`. Production servers must route unknown frontend paths, including `/admin`, back to `index.html` so React Router can resolve them.

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
├── App.jsx           component routes
├── main.jsx          React application entry point
└── styles.css        shared dashboard styles
```
