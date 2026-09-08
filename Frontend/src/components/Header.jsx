export default function Header({ admin = false, lastUpdated }) {
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
        <div className="system-status">
          <span className="status-dot" /> {admin ? "Admin Console" : "System Online"}
        </div>
        {!admin && <div className="last-updated">{lastUpdated}</div>}
        <a className="admin-link" href={admin ? "index.html" : "admin.html"}>
          {admin ? "← Public Dashboard" : "Administrator ↗"}
        </a>
      </div>
    </header>
  );
}
