import { Link } from "react-router-dom";

export default function Header({ admin = false, health, lastUpdated }) {
  const backendOnline = health?.status === "ok";
  const weatherReady = health?.weather_configured !== false;
  const operational = backendOnline && weatherReady;
  const statusText = backendOnline
    ? weatherReady
      ? `${health.data_mode === "demo" ? "Demo" : "Production"} backend · IMD ready`
      : "Backend online · IMD token missing"
    : health === null
      ? "Backend unavailable"
      : "Checking backend…";

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">🌧</div>
        <div>
          <div className="brand-title">FLASHGUARD</div>
          <div className="brand-subtitle">
            {admin
              ? "Administrator Console"
              : "Village-Level Flash-Flood Risk Forecasting"}
          </div>
        </div>
      </div>
      <div className="top-actions">
        <div className={`system-status ${operational ? "online" : "offline"}`}>
          <span className="status-dot" /> {statusText}
        </div>
        {!admin && <div className="last-updated">{lastUpdated}</div>}
        <Link className="admin-link" to={admin ? "/" : "/admin"}>
          {admin ? "← Public Dashboard" : "Administrator ↗"}
        </Link>
      </div>
    </header>
  );
}
