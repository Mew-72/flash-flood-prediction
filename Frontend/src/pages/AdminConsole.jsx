import { useEffect, useState } from "react";

import {
  fetchRiskSnapshots,
  flattenSnapshots,
  getPeakSnapshot,
  getRiskLevel,
  getSnapshotScore,
  postAlert,
} from "../api";
import Header from "../components/Header";
import { DISTRICTS, STATES } from "../data";

const HISTORY_KEY = "flashguard_alert_history";
const NAV_ITEMS = [
  { id: "send", label: "⚠ Send Alert" },
  { id: "history", label: "◷ Alert History" },
  { id: "monitor", label: "◉ Data Monitor" },
  { id: "system", label: "⚙ System Status" },
];

const MONITORS = [
  { symbol: "☔", name: "Rainfall", value: "72 mm", detail: "3-hour accumulation", status: "LIVE", tone: "online" },
  { symbol: "◉", name: "Soil Moisture", value: "81%", detail: "Antecedent wetness", status: "LIVE", tone: "online" },
  { symbol: "▱", name: "DEM / Slope", value: "Loaded", detail: "Terrain features", status: "READY", tone: "ready" },
  { symbol: "⌁", name: "Streams", value: "Rising", detail: "Exposure indicator", status: "LIVE", tone: "online" },
  { symbol: "◈", name: "Historical Events", value: "Indexed", detail: "Flood + landslide evidence", status: "READY", tone: "ready" },
  { symbol: "◉", name: "IoT", value: "Optional", detail: "Sensor correction layer", status: "SIMULATED", tone: "offline" },
];

const SYSTEM_STATUSES = [
  ["Frontend", "Operational", "online"],
  ["FastAPI backend", "Ready for integration", "ready"],
  ["Runtime storage", "JSON / processed", "ready"],
  ["Risk engine", "SCS-CN + API + terrain", "ready"],
  ["ML calibration", "Future RF / XGBoost", "offline"],
  ["Alert API", "Connect backend endpoint", "offline"],
];

function loadHistory() {
  try {
    const value = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export default function AdminConsole() {
  const [activeSection, setActiveSection] = useState("send");
  const [history, setHistory] = useState(loadHistory);
  const [form, setForm] = useState({
    state: "Uttarakhand",
    district: "Rudraprayag",
    target: "All villages in district",
    severity: "HIGH",
    message: "",
  });
  const [riskSummary, setRiskSummary] = useState({ score: 74, risk: "HIGH" });
  const [sendResult, setSendResult] = useState(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    const controller = new AbortController();

    async function loadRisk() {
      try {
        const payload = await fetchRiskSnapshots(form.district, controller.signal);
        const snapshots = flattenSnapshots(payload);
        if (snapshots.length === 0) return;
        const peak = getPeakSnapshot(snapshots);
        const score = getSnapshotScore(peak);
        setRiskSummary({ score, risk: getRiskLevel(peak, score) });
      } catch (error) {
        if (error.name !== "AbortError") {
          console.info("Using demo admin risk snapshot; backend not reachable.", error.message);
        }
      }
    }

    loadRisk();
    return () => controller.abort();
  }, [form.district]);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
  }

  function recordAlert(alert) {
    setHistory((current) => {
      const next = [alert, ...current].slice(0, 50);
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function sendAlert(event) {
    event.preventDefault();
    const message = form.message.trim();
    if (!message || sending) return;

    const payload = {
      ...form,
      message,
      issued_by: "administrator",
      issued_at: new Date().toISOString(),
    };

    setSending(true);
    setSendResult({ text: "Sending…", tone: "sending" });

    try {
      await postAlert(payload);
      recordAlert({ ...payload, status: "Sent (Backend)" });
      setSendResult({
        text: "Alert sent successfully through the backend.",
        tone: "success",
      });
    } catch (error) {
      if (error.status) {
        recordAlert({ ...payload, status: "Recorded locally (Backend pending)" });
        setSendResult({
          text: `Prototype alert recorded locally. Backend route POST /v1/admin/alerts returned ${error.status}.`,
          tone: "warning",
        });
      } else {
        recordAlert({ ...payload, status: "Recorded locally (Offline)" });
        setSendResult({
          text: "Prototype alert recorded locally in browser storage (backend offline).",
          tone: "warning",
        });
      }
    } finally {
      setSending(false);
    }
  }

  const previewTone = form.severity === "CRITICAL"
    ? "critical-preview"
    : form.severity === "MODERATE"
      ? "moderate-preview"
      : "high-preview";

  return (
    <>
      <Header admin />
      <main className="admin-layout">
        <aside className="admin-sidebar">
          <div className="admin-user">
            <div className="avatar">A</div>
            <div><strong>System Administrator</strong><span>Authorized operator</span></div>
          </div>
          <nav aria-label="Administrator sections">
            {NAV_ITEMS.map((item) => (
              <button
                className={`admin-nav ${activeSection === item.id ? "active" : ""}`}
                type="button"
                key={item.id}
                onClick={() => setActiveSection(item.id)}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="admin-warning">
            Alerts sent here are intended for authorized disaster-management personnel.
          </div>
        </aside>

        <section className="admin-content">
          {activeSection === "send" && (
            <section className="admin-section active">
              <div className="page-heading">
                <div>
                  <div className="eyebrow">ADMINISTRATOR</div>
                  <h1>Send Early Warning Alert</h1>
                  <p>Create and issue a preparedness message to selected locations.</p>
                </div>
                <div className="admin-status-pill">Manual approval required</div>
              </div>

              <div className="admin-grid">
                <form className="form-card" onSubmit={sendAlert}>
                  <div className="form-title">Alert configuration</div>

                  <SelectField label="State" name="state" value={form.state} onChange={updateField} options={STATES} />
                  <SelectField label="District" name="district" value={form.district} onChange={updateField} options={DISTRICTS} />
                  <SelectField
                    label="Target"
                    name="target"
                    value={form.target}
                    onChange={updateField}
                    options={["All villages in district", "Selected high-risk villages", "Selected village"]}
                  />
                  <label>
                    Alert severity
                    <select name="severity" value={form.severity} onChange={updateField} required>
                      <option value="HIGH">High — Prepare / Evacuate</option>
                      <option value="CRITICAL">Critical — Immediate Action</option>
                      <option value="MODERATE">Moderate — Monitor / Prepare</option>
                      <option value="INFO">Information</option>
                    </select>
                  </label>

                  <label>
                    Message
                    <textarea
                      name="message"
                      rows="5"
                      required
                      value={form.message}
                      onChange={updateField}
                      placeholder="Enter clear instructions for the affected community..."
                    />
                  </label>

                  <div className={`preview-alert ${previewTone}`}>
                    <div className="alert-preview-icon">!</div>
                    <div>
                      <strong>{form.severity} Alert Preview</strong>
                      <p>{form.message || "Your message will appear here."}</p>
                    </div>
                  </div>

                  <button className="primary-btn" type="submit" disabled={sending}>
                    {sending ? "Sending…" : "Send Alert"}
                  </button>
                  <div className={`form-result ${sendResult?.tone ?? ""}`} aria-live="polite">
                    {sendResult?.text}
                  </div>
                </form>

                <div className="info-stack">
                  <div className="info-card">
                    <div className="section-heading">CURRENT RISK</div>
                    <div className="big-risk"><span>{riskSummary.score}</span><small>/100</small></div>
                    <div className={`risk-badge ${riskSummary.risk.toLowerCase()}`}>{riskSummary.risk}</div>
                    <p>
                      {form.district} regional risk is currently {riskSummary.risk.toLowerCase()} based on the active forecast snapshot.
                    </p>
                  </div>
                  <div className="info-card">
                    <div className="section-heading">BEFORE SENDING</div>
                    <ul className="check-list">
                      <li>Verify target location.</li>
                      <li>Check current risk snapshot.</li>
                      <li>Use short, actionable instructions.</li>
                      <li>Confirm alert severity.</li>
                      <li>Record the operational reason.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeSection === "history" && (
            <section className="admin-section active">
              <PageHeading title="Alert History" description="Previously issued alerts stored in this browser for the prototype." />
              <div className="table-card">
                <table>
                  <thead><tr><th>Time</th><th>Location</th><th>Severity</th><th>Target</th><th>Message</th><th>Status</th></tr></thead>
                  <tbody>
                    {history.length === 0 ? (
                      <tr><td className="empty-history" colSpan="6">No alerts have been issued from this browser yet.</td></tr>
                    ) : history.map((alert, index) => (
                      <tr key={`${alert.issued_at}-${index}`}>
                        <td>{new Date(alert.issued_at).toLocaleString()}</td>
                        <td>{alert.state} / {alert.district}</td>
                        <td><span className={`risk-badge ${alert.severity.toLowerCase()}`}>{alert.severity}</span></td>
                        <td>{alert.target}</td>
                        <td>{alert.message}</td>
                        <td>{alert.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeSection === "monitor" && (
            <section className="admin-section active">
              <PageHeading title="Data Monitor" description="Overview of the inputs feeding the flood-risk engine." />
              <div className="monitor-grid">
                {MONITORS.map((monitor) => (
                  <div className="monitor-card" key={monitor.name}>
                    <span>{monitor.symbol}</span><strong>{monitor.name}</strong><b>{monitor.value}</b>
                    <small>{monitor.detail}</small><i className={monitor.tone}>{monitor.status}</i>
                  </div>
                ))}
              </div>
            </section>
          )}

          {activeSection === "system" && (
            <section className="admin-section active">
              <PageHeading title="System Status" description="Prototype health and integration status." />
              <div className="status-table">
                {SYSTEM_STATUSES.map(([name, status, tone]) => (
                  <div key={name}><span>{name}</span><b className={tone}>{status}</b></div>
                ))}
              </div>
            </section>
          )}
        </section>
      </main>
    </>
  );
}

function SelectField({ label, name, value, onChange, options }) {
  return (
    <label>
      {label}
      <select name={name} value={value} onChange={onChange} required>
        {options.map((option) => <option key={option}>{option}</option>)}
      </select>
    </label>
  );
}

function PageHeading({ title, description }) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">ADMINISTRATOR</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}
