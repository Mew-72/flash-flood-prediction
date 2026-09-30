import { Link } from "react-router-dom";

export default function Header({ admin = false, health, lastUpdated }) {
  const backendOnline = health?.status === "ok";
  const provider = health?.provider ?? health?.weather_provider ?? health?.weather?.provider;
  const providerIsOpenWeather = !provider || String(provider).toLowerCase() === "openweather";
  const weatherReady = health?.weather_configured !== false && providerIsOpenWeather;
  const operational = backendOnline && weatherReady;
  const statusText = backendOnline
    ? weatherReady
      ? `${health.data_mode === "demo" ? "Demo" : "Production"} backend · OpenWeather live`
      : "Backend online · OpenWeather unavailable"
    : health === null
      ? "Backend unavailable"
      : "Checking backend…";

  return (
    <header className="topbar">
      <Link className="brand" to="/" aria-label="FlashGuard public dashboard">
        <svg className="brand-mark" viewBox="0 0 44 44" aria-hidden="true">
          <path d="M7 29.5c4.2-1.2 7.5-1.1 11 .5 4.2 1.9 8.2 2 12.5.3 2.3-.9 4.5-1.2 6.5-.7" />
          <path d="M7 23.5c4.2-1.2 7.5-1.1 11 .5 4.2 1.9 8.2 2 12.5.3 2.3-.9 4.5-1.2 6.5-.7" />
          <path d="M7 17.5c4.2-1.2 7.5-1.1 11 .5 4.2 1.9 8.2 2 12.5.3 2.3-.9 4.5-1.2 6.5-.7" />
          <path className="brand-mark-drop" d="M22 8.5c-2.4 3.6-3.6 5.9-3.6 7.1a3.6 3.6 0 1 0 7.2 0c0-1.2-1.2-3.5-3.6-7.1Z" />
        </svg>
        <div className="brand-copy">
          <div className="brand-title">FlashGuard</div>
          <div className="brand-subtitle">
            {admin
              ? "Operations Console"
              : "Himalayan Flood Early Warning"}
          </div>
        </div>
      </Link>
      <div className="top-actions">
        <div className={`system-status ${operational ? "online" : "offline"}`}>
          <span className="status-dot" /> {statusText}
        </div>
        {!admin && <div className="last-updated">{lastUpdated}</div>}
        <Link className="admin-link" to={admin ? "/" : "/admin"}>
          <span>{admin ? "Public dashboard" : "Operator console"}</span>
          <span className="link-arrow" aria-hidden="true">→</span>
        </Link>
      </div>
    </header>
  );
}
