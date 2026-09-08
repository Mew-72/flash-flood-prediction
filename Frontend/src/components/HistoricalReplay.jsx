import { useEffect, useMemo, useRef, useState } from "react";

import { getEventReplay, getReplayEvents } from "../api";

const SPEED_OPTIONS = [0.5, 1, 1.5, 2, 4];
const REPLAY_PREFIX = "[HISTORICAL SIMULATION — NOT LIVE]";

function isAbortError(error) {
  return error?.name === "AbortError";
}

function errorMessage(error) {
  const prefix = error?.status ? `Request failed (${error.status})` : "Request failed";
  return `${prefix}: ${error?.message || "Unknown error"}`;
}

function valueAt(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function firstValue(object, paths, fallback = null) {
  for (const path of paths) {
    const value = valueAt(object, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function firstArray(object, paths) {
  for (const path of paths) {
    const value = valueAt(object, path);
    if (Array.isArray(value)) return value;
  }
  return [];
}

function firstCollection(object, paths) {
  for (const path of paths) {
    const value = valueAt(object, path);
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return Object.values(value);
  }
  return [];
}

function textValue(value, fallback = "—") {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((item) => textValue(item, "")).filter(Boolean).join(", ") || fallback;
  if (typeof value === "object") {
    return textValue(
      value.name ?? value.label ?? value.title ?? value.value ?? value.description,
      fallback,
    );
  }
  return fallback;
}

function formatDate(value) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function formatMetric(value, suffix = "") {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? `${numeric.toFixed(1)}${suffix}` : "—";
}

function riskScorePercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return numeric >= 0 && numeric <= 1 ? numeric * 100 : numeric;
}

function formatAdministrativeArea(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return textValue(value, "Administrative area unavailable");
  }
  return [value.subdistrict, value.district, value.state]
    .filter(Boolean)
    .join(", ") || "Administrative area unavailable";
}

function humanize(value) {
  return String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function severityClass(value) {
  const severity = String(value || "INFO").toLowerCase();
  if (["extreme", "severe"].includes(severity)) return "critical";
  if (["warning", "watch"].includes(severity)) return "high";
  return severity;
}

function alertSeverity(value) {
  const severity = String(value || "INFO").toUpperCase();
  if (["CRITICAL", "EXTREME", "SEVERE"].includes(severity)) return "CRITICAL";
  if (["HIGH", "WARNING", "WATCH"].includes(severity)) return "HIGH";
  if (["MODERATE", "MEDIUM", "ADVISORY"].includes(severity)) return "MODERATE";
  return "INFO";
}

function eventId(event) {
  return String(firstValue(event, ["event_id", "id", "value"], ""));
}

function eventName(event) {
  return textValue(firstValue(event, ["name", "event_name", "title"]), "Unnamed historical event");
}

function eventCases(event) {
  return firstArray(event, ["cases", "forcing_cases", "scenarios", "event.cases"])
    .map((item, index) => {
      if (typeof item === "string" || typeof item === "number") {
        return { case_id: String(item), label: String(item) };
      }
      return {
        ...item,
        case_id: String(firstValue(item, ["case_id", "id", "value"], index)),
        label: textValue(firstValue(item, ["label", "name", "title"]), `Case ${index + 1}`),
      };
    });
}

function normalizeEvents(payload) {
  const items = Array.isArray(payload)
    ? payload
    : firstArray(payload, ["items", "events", "data.items", "data.events", "result.items"]);
  return items.filter((item) => eventId(item));
}

function normalizeReplay(payload) {
  const timeline = firstArray(payload, [
    "timeline",
    "timeline.frames",
    "timeline.items",
    "frames",
    "data.timeline",
    "data.timeline.frames",
    "data.frames",
    "replay.timeline",
    "replay.frames",
    "result.timeline",
  ]);
  return { payload: payload ?? {}, timeline };
}

function normalizeFrame(rawFrame, index) {
  const frame = firstValue(rawFrame, ["frame", "snapshot", "data"], rawFrame) || {};
  const hazard = firstValue(frame, ["hazard", "metrics.hazard", "risk.hazard"], {}) || {};
  const alert = firstValue(frame, ["alert", "alert_state", "output.alert", "hazard.alert"], {}) || {};
  const villages = firstCollection(frame, [
    "villages",
    "village_risks",
    "current_village_risks",
    "hazard.villages",
    "risk.villages",
    "affected_villages",
  ]);

  return {
    raw: frame,
    index: Number(firstValue(frame, ["frame_index", "day_index", "index"], index)),
    date: firstValue(frame, ["date", "valid_at", "timestamp", "day"]),
    phase: textValue(firstValue(frame, ["phase", "stage", "period"]), "Historical frame"),
    label: textValue(firstValue(frame, ["label", "title", "summary"]), `Day ${index + 1}`),
    rainfall: firstValue(frame, ["rainfall_mm", "rainfall.mm", "weather.rainfall_mm", "hazard.rainfall_mm"]),
    cumulativeRainfall: firstValue(frame, [
      "cumulative_3day_rainfall_mm",
      "antecedent_3day_mm",
      "rainfall.cumulative_3day_mm",
      "hazard.cumulative_3day_rainfall_mm",
    ]),
    peakRisk: textValue(firstValue(frame, ["peak_risk_level", "risk_level", "hazard.peak_risk_level"]), "UNKNOWN").toUpperCase(),
    peakScore: riskScorePercent(firstValue(frame, ["peak_composite_score", "composite_score", "risk_score", "hazard.peak_composite_score"])),
    hazard,
    villages,
    alert: {
      severity: textValue(firstValue(alert, ["severity", "level", "risk_level"]), "INFO").toUpperCase(),
      status: textValue(firstValue(alert, ["status", "state"]), "No alert status").toUpperCase(),
      headline: textValue(firstValue(alert, ["headline", "title", "label"]), "Historical replay alert"),
      message: textValue(firstValue(alert, ["message", "description", "body"]), "No alert message was recorded for this frame."),
      actionable: firstValue(alert, ["actionable", "is_actionable", "action_required"]),
      changed: Boolean(firstValue(alert, ["changed_from_previous", "changed", "severity_changed"], false)),
      previousSeverity: textValue(firstValue(alert, ["previous_severity", "previous.level"]), "None"),
    },
  };
}

function metricEntries(value, excludedKeys = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const excluded = new Set(excludedKeys);
  return Object.entries(value)
    .filter(([key, item]) => !excluded.has(key) && (typeof item !== "object" || item === null))
    .slice(0, 12);
}

function itemTitle(item, index) {
  if (typeof item !== "object" || item === null) return `Item ${index + 1}`;
  return textValue(
    firstValue(item, ["name", "label", "title", "village_name", "place", "source"]),
    `Item ${index + 1}`,
  );
}

function ItemList({ title, value, emptyText }) {
  const items = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.entries(value).map(([label, detail]) => ({ label, detail }))
      : value
        ? [value]
        : [];

  return (
    <section className="replay-detail-card">
      <h3>{title}</h3>
      {items.length === 0 ? <p>{emptyText}</p> : (
        <ul className="replay-item-list">
          {items.map((item, index) => {
            const detail = typeof item === "object" && item !== null
              ? firstValue(item, ["detail", "description", "summary", "value", "url", "evidence"])
              : item;
            return (
              <li key={`${itemTitle(item, index)}-${index}`}>
                {typeof item === "object" && item !== null && <strong>{itemTitle(item, index)}</strong>}
                <span>{textValue(detail, textValue(item))}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function ComparisonCard({ comparison, verdict, caveats }) {
  const comparisons = Array.isArray(comparison) ? comparison : [];
  const entries = comparisons.length === 0 ? metricEntries(comparison) : [];
  const caveatItems = Array.isArray(caveats) ? caveats : caveats ? [caveats] : [];
  const verdictReason = textValue(firstValue(verdict, ["reason", "summary", "message"]), "No retrospective verdict supplied");

  return (
    <section className="replay-detail-card replay-comparison">
      <h3>Retrospective vs forecast</h3>
      <div className="replay-verdict">
        <span>Verdict</span>
        <strong>{verdictReason}</strong>
        {verdict && typeof verdict === "object" && (
          <small>
            Retrospective detection: {verdict.retrospective_detection ? "yes" : "no"}
            {" · "}Reliable advance warning: {verdict.reliable_actionable_advance_warning ? "yes" : "no"}
          </small>
        )}
      </div>
      {comparisons.length > 0 && (
        <div className="replay-forecast-comparisons">
          {comparisons.map((item) => (
            <div key={item.lead_hours}>
              <strong>{item.lead_hours}h prior</strong>
              <span>Forecast {formatMetric(item.forecast_rainfall_mm, " mm")}</span>
              <span>Observed analysis {formatMetric(item.event_day_analysis_rainfall_mm, " mm")}</span>
              <span>Shortfall {formatMetric(item.rainfall_shortfall_mm, " mm")}</span>
              <span className={`risk-badge ${severityClass(item.peak_risk_level)}`}>
                {textValue(item.peak_risk_level).toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      )}
      {entries.length > 0 && (
        <dl className="replay-definition-list">
          {entries.map(([key, value]) => (
            <div key={key}><dt>{humanize(key)}</dt><dd>{textValue(value)}</dd></div>
          ))}
        </dl>
      )}
      <h4>Caveats</h4>
      {caveatItems.length === 0 ? <p>No caveats supplied.</p> : (
        <ul className="replay-item-list">
          {caveatItems.map((item, index) => <li key={`${textValue(item)}-${index}`}><span>{textValue(item)}</span></li>)}
        </ul>
      )}
    </section>
  );
}

export default function HistoricalReplay({ onCopyAlert, onRecordAlert }) {
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [eventsError, setEventsError] = useState("");
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [replay, setReplay] = useState(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const [replayError, setReplayError] = useState("");
  const [framePosition, setFramePosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [recording, setRecording] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const requestRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current = controller;
    setEventsLoading(true);
    getReplayEvents({ signal: controller.signal })
      .then((payload) => {
        const normalized = normalizeEvents(payload);
        setEvents(normalized);
        setSelectedEventId((current) => normalized.some((event) => eventId(event) === current)
          ? current
          : eventId(normalized[0]));
        if (normalized.length === 0) setEventsError("No pinned historical events were returned.");
      })
      .catch((error) => {
        if (!isAbortError(error)) setEventsError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setEventsLoading(false);
        if (requestRef.current === controller) requestRef.current = null;
      });
    return () => controller.abort();
  }, []);

  const selectedEvent = useMemo(
    () => events.find((event) => eventId(event) === selectedEventId) ?? null,
    [events, selectedEventId],
  );
  const cases = useMemo(() => eventCases(selectedEvent), [selectedEvent]);

  useEffect(() => {
    const preferredCaseId = String(
      firstValue(selectedEvent, ["default_case_id"], cases[0]?.case_id || ""),
    );
    setSelectedCaseId((current) => cases.some((item) => item.case_id === current)
      ? current
      : preferredCaseId);
    setReplay(null);
    setPlaying(false);
    setFramePosition(0);
    setActionMessage("");
  }, [cases, selectedEvent, selectedEventId]);

  const frames = useMemo(
    () => replay?.timeline.map(normalizeFrame) ?? [],
    [replay],
  );
  const currentFrame = frames[framePosition] ?? null;

  useEffect(() => {
    if (!playing || frames.length === 0) return undefined;
    if (framePosition >= frames.length - 1) {
      setPlaying(false);
      return undefined;
    }
    const timer = window.setTimeout(
      () => setFramePosition((current) => Math.min(current + 1, frames.length - 1)),
      1200 / speed,
    );
    return () => window.clearTimeout(timer);
  }, [framePosition, frames.length, playing, speed]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const selectedCase = cases.find((item) => item.case_id === selectedCaseId);
  const replayDetails = { ...(selectedEvent ?? {}), ...(replay?.payload ?? {}) };
  const eventArea = formatAdministrativeArea(firstValue(replayDetails, [
    "administrative_area",
    "event.administrative_area",
    "location.administrative_area",
    "district",
  ]));
  const replayName = textValue(firstValue(replayDetails, ["name", "event_name", "title"]), eventName(selectedEvent));
  const affectedPlaces = firstValue(replay?.payload, ["affected_places", "event.affected_places", "impact.affected_places", "data.affected_places"], []);
  const evidence = firstValue(replay?.payload, ["reported_evidence", "source_evidence.reported", "evidence", "event.reported_evidence", "data.reported_evidence"], []);
  const sources = firstValue(replay?.payload, ["sources", "source_evidence.sources", "event.sources", "data.sources"], []);
  const comparison = firstValue(replay?.payload, ["forecast_comparison", "pinned_forecast_comparison", "comparison", "analysis.forecast_comparison", "data.forecast_comparison"], {});
  const verdict = firstValue(replay?.payload, ["verdict", "forecast_comparison.verdict", "analysis.verdict", "data.verdict"]);
  const caveats = firstValue(replay?.payload, ["caveats", "forecast_comparison.caveats", "analysis.caveats", "data.caveats"], []);
  const maxRainfall = Math.max(1, ...frames.map((frame) => Number(frame.rainfall) || 0));

  async function loadReplay(event) {
    event.preventDefault();
    if (!selectedEventId) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setReplayLoading(true);
    setReplayError("");
    setActionMessage("");
    setPlaying(false);
    try {
      const payload = await getEventReplay(
        selectedEventId,
        { case_id: selectedCaseId || undefined },
        { signal: controller.signal },
      );
      const normalized = normalizeReplay(payload);
      setReplay(normalized);
      setFramePosition(0);
      if (normalized.timeline.length === 0) setReplayError("This historical event returned no timeline frames.");
    } catch (error) {
      if (!isAbortError(error)) setReplayError(errorMessage(error));
    } finally {
      if (!controller.signal.aborted) setReplayLoading(false);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  function goToFrame(position) {
    setPlaying(false);
    setFramePosition(Math.min(Math.max(position, 0), frames.length - 1));
  }

  function alertContext() {
    if (!currentFrame) return null;
    const message = `${REPLAY_PREFIX} ${currentFrame.alert.headline}: ${currentFrame.alert.message}`;
    return {
      eventId: selectedEventId,
      eventName: replayName,
      area: eventArea,
      caseId: textValue(firstValue(replay?.payload, ["selected_case_id"], selectedCaseId)),
      caseLabel: textValue(firstValue(replay?.payload, ["selected_case_label"], selectedCase?.label), "Default forcing case"),
      date: currentFrame.date,
      severity: alertSeverity(currentFrame.alert.severity),
      message,
      target: `Historical event ${replayName}; ${eventArea}`,
    };
  }

  function copyAlert() {
    const context = alertContext();
    if (!context) return;
    onCopyAlert(context);
  }

  async function recordAlert() {
    const context = alertContext();
    if (!context || recording) return;
    setRecording(true);
    setActionMessage("Recording historical simulation alert…");
    try {
      const created = await onRecordAlert(context);
      setActionMessage(`Historical simulation alert ${created?.id || "record"} added to Alert History.`);
    } catch (error) {
      setActionMessage(errorMessage(error));
    } finally {
      setRecording(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ADMINISTRATOR · HISTORICAL SIMULATION</div>
          <h1>Historical Replay</h1>
          <p>Animate pinned flood events and compare retrospective model alerts with the historical record.</p>
        </div>
        <div className="admin-status-pill replay-simulation-pill">Not live · simulation only</div>
      </div>

      <form className="form-card replay-selector" onSubmit={loadReplay}>
        <div>
          <div className="form-title">Pinned event playback</div>
          <p className="replay-helper">Select a curated event and forcing case. Replay output cannot issue a live warning.</p>
        </div>
        <label>
          Historical event
          <select
            value={selectedEventId}
            onChange={(event) => setSelectedEventId(event.target.value)}
            disabled={eventsLoading || events.length === 0}
            required
          >
            {events.length === 0 && <option value="">No pinned events available</option>}
            {events.map((item) => (
              <option key={eventId(item)} value={eventId(item)}>
                {eventName(item)} · {formatDate(firstValue(item, ["impact_start", "start_date", "date"]))}
              </option>
            ))}
          </select>
        </label>
        <label>
          Forcing case
          <select
            value={selectedCaseId}
            onChange={(event) => setSelectedCaseId(event.target.value)}
            disabled={eventsLoading || cases.length === 0}
          >
            {cases.length === 0 && <option value="">Backend default case</option>}
            {cases.map((item) => <option key={item.case_id} value={item.case_id}>{item.label}</option>)}
          </select>
        </label>
        <button className="primary-btn" type="submit" disabled={replayLoading || !selectedEventId}>
          {replayLoading ? "Loading replay…" : "Load Replay"}
        </button>
        <div className="replay-event-summary">
          {selectedEvent ? (
            <>
              <strong>{eventName(selectedEvent)}</strong>
              <span>{formatDate(firstValue(selectedEvent, ["impact_start", "start_date", "date"]))}</span>
              <span>{formatAdministrativeArea(firstValue(selectedEvent, ["administrative_area", "district", "location"]))}</span>
            </>
          ) : <span>{eventsLoading ? "Loading pinned historical events…" : "No event selected"}</span>}
        </div>
        {(eventsError || replayError) && <div className="form-result warning" role="alert">{eventsError || replayError}</div>}
      </form>

      {replay && frames.length > 0 && currentFrame && (
        <div className="historical-replay-workspace">
          <div className="replay-pinned-banner">
            <span aria-hidden="true">⌖</span>
            <div><strong>{replayName}</strong><small>{eventArea} · {textValue(firstValue(replay.payload, ["selected_case_label"], selectedCase?.label), "Default forcing case")}</small></div>
            <b>Historical simulation</b>
          </div>

          <section className="replay-player" aria-label="Historical event playback controls">
            <div className="replay-controls">
              <button type="button" onClick={() => setPlaying((current) => !current)} aria-label={playing ? "Pause historical replay" : "Play historical replay"}>
                {playing ? "❚❚ Pause" : "▶ Play"}
              </button>
              <button type="button" onClick={() => { setFramePosition(0); setPlaying(true); }} aria-label="Restart historical replay">↺ Restart</button>
              <button type="button" onClick={() => goToFrame(framePosition - 1)} disabled={framePosition === 0} aria-label="Previous replay day">← Previous</button>
              <button type="button" onClick={() => goToFrame(framePosition + 1)} disabled={framePosition === frames.length - 1} aria-label="Next replay day">Next →</button>
              <label>Playback speed
                <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))} aria-label="Historical replay playback speed">
                  {SPEED_OPTIONS.map((value) => <option key={value} value={value}>{value}×</option>)}
                </select>
              </label>
              <span className="replay-counter">Day {framePosition + 1} of {frames.length}</span>
            </div>
            <div className="replay-progress" aria-hidden="true"><span style={{ width: `${((framePosition + 1) / frames.length) * 100}%` }} /></div>
            <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
              Historical replay day {framePosition + 1} of {frames.length}, {formatDate(currentFrame.date)}, alert {currentFrame.alert.severity}, status {currentFrame.alert.status}.
            </div>
          </section>

          <div className="replay-stage" key={`${currentFrame.index}-${currentFrame.date}`}>
            <section className="replay-day-card">
              <div className="replay-day-heading">
                <div><span>{currentFrame.phase}</span><h2>{currentFrame.label}</h2><p>{formatDate(currentFrame.date)}</p></div>
                <div className="replay-peak"><small>Peak risk</small><strong className={severityClass(currentFrame.peakRisk)}>{currentFrame.peakRisk}</strong><b>{formatMetric(currentFrame.peakScore, "/100")}</b></div>
              </div>

              <div className="replay-rainfall-metrics">
                <div><span>Daily rainfall</span><strong>{formatMetric(currentFrame.rainfall, " mm")}</strong></div>
                <div><span>3-day cumulative</span><strong>{formatMetric(currentFrame.cumulativeRainfall, " mm")}</strong></div>
                <div className="replay-rain-gauge" aria-label={`Daily rainfall ${formatMetric(currentFrame.rainfall, " millimetres")}`}><span style={{ width: `${Math.min(((Number(currentFrame.rainfall) || 0) / maxRainfall) * 100, 100)}%` }} /></div>
              </div>

              <div className={`replay-alert replay-alert-${severityClass(currentFrame.alert.severity)}`}>
                <div className="replay-alert-meta">
                  <span className={`risk-badge ${severityClass(currentFrame.alert.severity)}`}>{currentFrame.alert.severity}</span>
                  <span className="replay-alert-status">{currentFrame.alert.status}</span>
                  {currentFrame.alert.changed && <span className="replay-alert-change">Changed from {currentFrame.alert.previousSeverity}</span>}
                  <span>{currentFrame.alert.actionable === true ? "Action required" : currentFrame.alert.actionable === false ? "Informational" : "Actionability not reported"}</span>
                </div>
                <h3>{currentFrame.alert.headline}</h3>
                <p>{currentFrame.alert.message}</p>
                <strong className="historical-only-label">Historical simulation — never a live alert</strong>
              </div>

              <div className="replay-actions">
                <button type="button" onClick={copyAlert}>Copy to Send Alert draft</button>
                <button className="record" type="button" onClick={recordAlert} disabled={recording}>{recording ? "Recording…" : "Record simulated alert"}</button>
              </div>
              <div className="form-result success" aria-live="polite">{actionMessage}</div>
            </section>

            <aside className="replay-metrics-card">
              <h3>Current hazard metrics</h3>
              <dl className="replay-definition-list">
                {metricEntries(currentFrame.hazard, ["alert", "villages"]).length > 0 ? metricEntries(currentFrame.hazard, ["alert", "villages"]).map(([key, value]) => (
                  <div key={key}><dt>{humanize(key)}</dt><dd>{textValue(value)}</dd></div>
                )) : <div><dt>Hazard detail</dt><dd>Not supplied</dd></div>}
              </dl>
              <h3>Village risks</h3>
              {currentFrame.villages.length === 0 ? <p>No village-level risks supplied for this frame.</p> : (
                <div className="replay-villages">
                  {currentFrame.villages.map((village, index) => {
                    const risk = textValue(firstValue(village, ["risk_level", "peak_risk_level", "risk", "severity"]), "UNKNOWN").toUpperCase();
                    const score = riskScorePercent(firstValue(village, ["composite_score", "risk_score", "score"]));
                    return (
                      <div key={`${itemTitle(village, index)}-${index}`}>
                        <span><strong>{itemTitle(village, index)}</strong><small>{textValue(firstValue(village, ["village_id", "id", "administrative_area"]), "")}</small></span>
                        <span className={`risk-badge ${severityClass(risk)}`}>{risk}</span>
                        <b>{formatMetric(score, "/100")}</b>
                      </div>
                    );
                  })}
                </div>
              )}
            </aside>
          </div>

          <section className="replay-rainfall-timeline" aria-label="Selectable rainfall timeline">
            <div className="replay-section-title"><h3>Rainfall timeline</h3><span>Select any day to inspect it</span></div>
            <div className="replay-bars">
              {frames.map((frame, index) => (
                <button
                  type="button"
                  className={`${index === framePosition ? "active" : ""} ${index < framePosition ? "past" : ""}`}
                  key={`${frame.index}-${frame.date}-${index}`}
                  onClick={() => goToFrame(index)}
                  aria-current={index === framePosition ? "step" : undefined}
                  aria-label={`Show ${formatDate(frame.date)}, rainfall ${formatMetric(frame.rainfall, " millimetres")}`}
                >
                  <span className="replay-bar-value">{formatMetric(frame.rainfall)}</span>
                  <i style={{ height: `${Math.max(((Number(frame.rainfall) || 0) / maxRainfall) * 100, 4)}%` }} />
                  <small>{formatDate(frame.date).split(",")[0]}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="table-card replay-table">
            <div className="replay-section-title"><h3>Daily replay frames</h3><span>Historical simulation timeline</span></div>
            <table>
              <thead><tr><th>Frame</th><th>Date</th><th>Phase</th><th>Rainfall</th><th>3-day rain</th><th>Peak risk</th><th>Alert</th><th>Status</th></tr></thead>
              <tbody>
                {frames.map((frame, index) => (
                  <tr className={index === framePosition ? "selected" : ""} key={`${frame.index}-${frame.date}-${index}`} onClick={() => goToFrame(index)}>
                    <td>{frame.index}</td>
                    <td><button className="replay-day-button" type="button" onClick={() => goToFrame(index)} aria-label={`Inspect replay frame for ${formatDate(frame.date)}`}>{formatDate(frame.date)}</button></td>
                    <td>{frame.phase}</td>
                    <td>{formatMetric(frame.rainfall, " mm")}</td>
                    <td>{formatMetric(frame.cumulativeRainfall, " mm")}</td>
                    <td><span className={`risk-badge ${severityClass(frame.peakRisk)}`}>{frame.peakRisk}</span></td>
                    <td><span className={`risk-badge ${severityClass(frame.alert.severity)}`}>{frame.alert.severity}</span></td>
                    <td>{frame.alert.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <div className="replay-context-grid">
            <ItemList title="Affected places" value={affectedPlaces} emptyText="No affected places supplied." />
            <ItemList title="Reported evidence" value={evidence} emptyText="No reported evidence supplied." />
            <ItemList title="Sources" value={sources} emptyText="No sources supplied." />
            <ComparisonCard comparison={comparison} verdict={verdict} caveats={caveats} />
          </div>
        </div>
      )}
    </>
  );
}
