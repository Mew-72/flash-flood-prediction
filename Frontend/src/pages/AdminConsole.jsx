import { useEffect, useMemo, useRef, useState } from "react";

import {
  createAlert,
  createRiskBatch,
  flattenSnapshots,
  getAlerts,
  getAllVillages,
  getHealth,
  getPeakSnapshot,
  getRiskLevel,
  getSnapshotConditions,
  getSnapshotScore,
  simulate,
} from "../api";
import Header from "../components/Header";
import HistoricalReplay from "../components/HistoricalReplay";
import { DISTRICTS, STATES } from "../data";

const NAV_ITEMS = [
  { id: "send", label: "⚠ Send Alert" },
  { id: "history", label: "◷ Alert History" },
  { id: "scenario", label: "◇ Scenario Lab" },
  { id: "replay", label: "↶ Historical Replay" },
  { id: "monitor", label: "◉ Data Monitor" },
  { id: "system", label: "⚙ System Status" },
];

const TARGET_OPTIONS = [
  "All villages in district",
  "Selected high-risk villages",
  "Selected village",
];

const MAX_BATCH_VILLAGES = 500;

function errorMessage(error) {
  const prefix = error?.status ? `Request failed (${error.status})` : "Request failed";
  return `${prefix}: ${error?.message || "Unknown error"}`;
}

function isAbortError(error) {
  return error?.name === "AbortError";
}

function villageLabel(village) {
  return `${village?.name || "Unnamed village"} (${village?.id || "no id"})`;
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function formatNumber(value, suffix = "") {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)}${suffix}` : "—";
}

function batchWarnings(payload) {
  if (!Array.isArray(payload?.errors) || payload.errors.length === 0) return "";
  return payload.errors
    .map((item) => `${item.id}: ${item.error}`)
    .join("; ");
}

export default function AdminConsole() {
  const [activeSection, setActiveSection] = useState("send");
  const [healthState, setHealthState] = useState({ phase: "loading", data: null, error: "" });
  const [villages, setVillages] = useState([]);
  const [villagesLoading, setVillagesLoading] = useState(false);
  const [villagesError, setVillagesError] = useState("");
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState("");
  const [form, setForm] = useState({
    state: "Uttarakhand",
    district: "Rudraprayag",
    target: "All villages in district",
    selectedVillageId: "",
    severity: "HIGH",
    message: "",
  });
  const [currentSnapshots, setCurrentSnapshots] = useState([]);
  const [targetSnapshots, setTargetSnapshots] = useState([]);
  const [targetVillageIds, setTargetVillageIds] = useState([]);
  const [riskBatchMeta, setRiskBatchMeta] = useState(null);
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskError, setRiskError] = useState("");
  const [noTargetMessage, setNoTargetMessage] = useState("");
  const [sendResult, setSendResult] = useState(null);
  const [sending, setSending] = useState(false);
  const [replayDraft, setReplayDraft] = useState(null);
  const [scenarioForm, setScenarioForm] = useState({
    villageId: "",
    rainfall: "",
    soilMoisturePercent: "",
    threshold: "",
  });
  const [scenarioResult, setScenarioResult] = useState(null);
  const [scenarioError, setScenarioError] = useState("");
  const [scenarioLoading, setScenarioLoading] = useState(false);
  const alertControllerRef = useRef(null);
  const historyControllerRef = useRef(null);
  const scenarioControllerRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    setHealthState({ phase: "loading", data: null, error: "" });

    getHealth({ signal: controller.signal })
      .then((data) => setHealthState({ phase: "success", data, error: "" }))
      .catch((error) => {
        if (!isAbortError(error)) {
          setHealthState({ phase: "error", data: null, error: errorMessage(error) });
        }
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (healthState.phase === "loading") return undefined;

    const controller = new AbortController();
    const isDemoMode = healthState.data?.data_mode === "demo";
    const params = isDemoMode ? {} : { district: form.district };

    setVillagesLoading(true);
    setVillagesError("");
    setVillages([]);

    getAllVillages(params, { signal: controller.signal })
      .then((catalog) => {
        const items = Array.isArray(catalog?.items)
          ? catalog.items.filter((item) => item?.id)
          : [];
        setVillages(items);

        const chooseValidVillage = (currentId) => (
          items.some((item) => item.id === currentId) ? currentId : items[0]?.id || ""
        );
        setForm((current) => ({
          ...current,
          selectedVillageId: chooseValidVillage(current.selectedVillageId),
        }));
        setScenarioForm((current) => ({
          ...current,
          villageId: chooseValidVillage(current.villageId),
        }));

        if (items.length === 0) {
          setVillagesError(
            isDemoMode
              ? "The backend returned no demo villages."
              : `The backend returned no villages for ${form.district}.`,
          );
        }
      })
      .catch((error) => {
        if (!isAbortError(error)) setVillagesError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setVillagesLoading(false);
      });

    return () => controller.abort();
  }, [form.district, healthState.data?.data_mode, healthState.phase]);

  useEffect(() => {
    const controller = new AbortController();
    historyControllerRef.current = controller;
    setHistoryLoading(true);
    setHistoryError("");

    getAlerts({ limit: 50 }, { signal: controller.signal })
      .then((payload) => {
        setHistory(Array.isArray(payload?.items) ? payload.items : []);
      })
      .catch((error) => {
        if (!isAbortError(error)) setHistoryError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setHistoryLoading(false);
        if (historyControllerRef.current === controller) historyControllerRef.current = null;
      });

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (villagesLoading) return undefined;

    const controller = new AbortController();
    const allVillageIds = [...new Set(villages.map((village) => village.id).filter(Boolean))];

    setCurrentSnapshots([]);
    setTargetSnapshots([]);
    setTargetVillageIds([]);
    setRiskBatchMeta(null);
    setRiskError("");
    setNoTargetMessage("");

    if (allVillageIds.length === 0) {
      setNoTargetMessage("No villages are available for an exact risk preview.");
      return () => controller.abort();
    }
    if (allVillageIds.length > MAX_BATCH_VILLAGES) {
      setRiskError(
        `This selection contains ${allVillageIds.length} villages; the exact batch limit is ${MAX_BATCH_VILLAGES}. Select a narrower district.`,
      );
      return () => controller.abort();
    }

    async function loadRiskPreview() {
      setRiskLoading(true);
      try {
        const currentBatch = await createRiskBatch(
          { village_ids: allVillageIds, include_forecast: true },
          { signal: controller.signal },
        );
        const snapshots = flattenSnapshots(currentBatch);
        setCurrentSnapshots(snapshots);

        let selectedIds = allVillageIds;
        if (form.target === "Selected village") {
          selectedIds = form.selectedVillageId ? [form.selectedVillageId] : [];
        } else if (form.target === "Selected high-risk villages") {
          selectedIds = [...new Set(
            snapshots
              .filter((snapshot) => {
                const score = getSnapshotScore(snapshot, 0);
                return ["HIGH", "CRITICAL"].includes(getRiskLevel(snapshot, score));
              })
              .map((snapshot) => snapshot?.village_id)
              .filter(Boolean),
          )];
        }

        if (selectedIds.length === 0) {
          setNoTargetMessage(
            form.target === "Selected high-risk villages"
              ? "No current or forecast snapshot is classified high or critical. No alert target will be submitted."
              : "Select a village before previewing or sending an alert.",
          );
          const warning = batchWarnings(currentBatch);
          if (warning) setRiskError(`Risk batch warnings: ${warning}`);
          return;
        }

        let targetBatch = currentBatch;
        const isAllVillages = selectedIds.length === allVillageIds.length
          && selectedIds.every((id, index) => id === allVillageIds[index]);
        if (!isAllVillages) {
          targetBatch = await createRiskBatch(
            { village_ids: selectedIds, include_forecast: true },
            { signal: controller.signal },
          );
        }

        setTargetVillageIds(selectedIds);
        setTargetSnapshots(flattenSnapshots(targetBatch));
        setRiskBatchMeta(targetBatch);
        const warnings = [batchWarnings(currentBatch), batchWarnings(targetBatch)]
          .filter(Boolean);
        if (warnings.length) setRiskError(`Risk batch warnings: ${[...new Set(warnings)].join("; ")}`);
      } catch (error) {
        if (!isAbortError(error)) setRiskError(errorMessage(error));
      } finally {
        if (!controller.signal.aborted) setRiskLoading(false);
      }
    }

    loadRiskPreview();
    return () => controller.abort();
  }, [form.selectedVillageId, form.target, villages, villagesLoading]);

  useEffect(() => () => {
    alertControllerRef.current?.abort();
    historyControllerRef.current?.abort();
    scenarioControllerRef.current?.abort();
  }, []);

  const dataMode = healthState.data?.data_mode || riskBatchMeta?.data_mode;

  const riskSummary = useMemo(() => {
    const peak = getPeakSnapshot(targetSnapshots);
    if (!peak) return null;
    const score = getSnapshotScore(peak, 0);
    return {
      peak,
      score,
      risk: getRiskLevel(peak, score),
      conditions: getSnapshotConditions(peak),
    };
  }, [targetSnapshots]);

  const selectedTargetVillages = useMemo(() => {
    const selectedIds = new Set(targetVillageIds);
    return villages.filter((village) => selectedIds.has(village.id));
  }, [targetVillageIds, villages]);

  const serializedTarget = useMemo(() => {
    if (selectedTargetVillages.length === 0) return "";
    let description = form.target;
    if (form.target === "All villages in district") {
      description = dataMode === "demo"
        ? "All villages in the demo dataset"
        : `All villages in ${form.district}`;
    } else if (form.target === "Selected high-risk villages") {
      description = "Villages with HIGH or CRITICAL backend risk";
    }
    return `${description} (${selectedTargetVillages.length}): ${selectedTargetVillages.map(villageLabel).join(", ")}`;
  }, [dataMode, form.district, form.target, selectedTargetVillages]);

  const effectiveAlertTarget = replayDraft
    ? `HISTORICAL SIMULATION — ${replayDraft.target}; forcing case ${replayDraft.caseLabel}`
    : serializedTarget;

  const monitorSnapshot = useMemo(
    () => getPeakSnapshot(currentSnapshots),
    [currentSnapshots],
  );

  const monitors = useMemo(() => {
    const conditions = getSnapshotConditions(monitorSnapshot);
    const provenance = monitorSnapshot?.provenance || healthState.data?.provenance;
    const exposure = monitorSnapshot?.details?.village_exposure;
    const slope = monitorSnapshot?.details?.supplemental_slope_stability;
    const monitoredVillage = villages.find(
      (village) => village.id === monitorSnapshot?.village_id,
    );
    const hasSnapshot = Boolean(monitorSnapshot);
    const sourceNames = Array.isArray(provenance?.static_sources)
      ? provenance.static_sources.join(", ")
      : "No source metadata returned";

    return [
      {
        symbol: "☔",
        name: "Rainfall",
        value: conditions.rainfall || "Unavailable",
        detail: hasSnapshot ? `Valid ${formatDateTime(monitorSnapshot.valid_at)}` : "No batch snapshot",
        status: hasSnapshot ? "LIVE DATA" : "UNAVAILABLE",
        tone: hasSnapshot ? "online" : "offline",
      },
      {
        symbol: "◉",
        name: "Soil Moisture",
        value: conditions.soil || "Unavailable",
        detail: hasSnapshot ? `For ${monitorSnapshot.village_name}` : "No batch snapshot",
        status: hasSnapshot ? "LIVE DATA" : "UNAVAILABLE",
        tone: hasSnapshot ? "online" : "offline",
      },
      {
        symbol: "▱",
        name: "DEM / Slope",
        value: slope?.risk_class ? `${String(slope.risk_class).toUpperCase()} stability risk` : "Unavailable",
        detail: `Static sources: ${sourceNames}`,
        status: provenance ? "PROVENANCE" : "UNAVAILABLE",
        tone: provenance ? "ready" : "offline",
      },
      {
        symbol: "⌁",
        name: "Streams",
        value: Number.isFinite(Number(exposure?.distance_to_stream_m))
          ? `${Math.round(Number(exposure.distance_to_stream_m))} m`
          : "Unavailable",
        detail: "Village distance to stream",
        status: hasSnapshot ? "SNAPSHOT" : "UNAVAILABLE",
        tone: hasSnapshot ? "ready" : "offline",
      },
      {
        symbol: "◈",
        name: "Historical Events",
        value: Number.isFinite(Number(monitoredVillage?.historical_event_count))
          ? String(monitoredVillage.historical_event_count)
          : "Unavailable",
        detail: monitoredVillage ? `Catalog record for ${monitoredVillage.name}` : sourceNames,
        status: monitoredVillage ? "CATALOG" : "UNAVAILABLE",
        tone: monitoredVillage ? "ready" : "offline",
      },
      {
        symbol: "◉",
        name: "Weather Source",
        value: provenance?.weather_source || "Not reported",
        detail: provenance?.retrieved_at
          ? `Retrieved ${formatDateTime(provenance.retrieved_at)}`
          : `Data mode: ${provenance?.data_mode || dataMode || "unknown"}`,
        status: provenance?.weather_source ? "PROVENANCE" : "UNVERIFIED",
        tone: provenance?.weather_source ? "online" : "offline",
      },
    ];
  }, [dataMode, healthState.data?.provenance, monitorSnapshot, villages]);

  const scenarioSummary = useMemo(() => {
    const result = scenarioResult?.result;
    if (!result) return null;
    const score = getSnapshotScore(result, 0);
    return { result, score, risk: getRiskLevel(result, score) };
  }, [scenarioResult]);

  function updateField(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setSendResult(null);
  }

  async function sendAlert(event) {
    event.preventDefault();
    const message = form.message.trim();
    if (!message || sending) return;
    if (!effectiveAlertTarget) {
      setSendResult({ text: noTargetMessage || "No valid alert target is available.", tone: "warning" });
      return;
    }

    alertControllerRef.current?.abort();
    historyControllerRef.current?.abort();
    const controller = new AbortController();
    alertControllerRef.current = controller;
    const historicalMessage = replayDraft && !message.startsWith("[HISTORICAL SIMULATION")
      ? `[HISTORICAL SIMULATION — NOT LIVE] ${message}`
      : message;
    const payload = {
      state: form.state,
      district: replayDraft?.area || (dataMode === "demo" ? "demo" : form.district),
      target: effectiveAlertTarget,
      severity: form.severity,
      message: historicalMessage,
      issued_by: replayDraft ? "administrator (historical simulation)" : "administrator",
      issued_at: new Date().toISOString(),
    };

    setSending(true);
    setSendResult({
      text: replayDraft ? "Recording historical simulation alert…" : "Sending…",
      tone: "sending",
    });

    try {
      const createdAlert = await createAlert(payload, { signal: controller.signal });
      setHistory((current) => [
        createdAlert,
        ...current.filter((alert) => alert.id !== createdAlert.id),
      ].slice(0, 50));
      setHistoryError("");
      setSendResult({
        text: replayDraft
          ? `Historical simulation alert ${createdAlert.id} was recorded by the backend.`
          : `Alert ${createdAlert.id} was accepted by the backend.`,
        tone: "success",
      });

      setHistoryLoading(true);
      try {
        const refreshed = await getAlerts({ limit: 50 }, { signal: controller.signal });
        setHistory(Array.isArray(refreshed?.items) ? refreshed.items : [createdAlert]);
      } catch (refreshError) {
        if (!isAbortError(refreshError)) {
          setHistoryError(`${replayDraft ? "Historical simulation alert was recorded" : "Alert was sent"}, but history refresh failed. ${errorMessage(refreshError)}`);
        }
      } finally {
        if (!controller.signal.aborted) setHistoryLoading(false);
      }
    } catch (error) {
      if (!isAbortError(error)) {
        setSendResult({ text: errorMessage(error), tone: "warning" });
      }
    } finally {
      if (!controller.signal.aborted) setSending(false);
      if (alertControllerRef.current === controller) alertControllerRef.current = null;
    }
  }

  async function runScenario(event) {
    event.preventDefault();
    scenarioControllerRef.current?.abort();
    setScenarioError("");
    setScenarioResult(null);

    const rainfallParts = scenarioForm.rainfall.split(",").map((item) => item.trim());
    const rainfall = rainfallParts.map(Number);
    if (
      rainfallParts.length === 0
      || rainfallParts.some((item) => item === "")
      || rainfall.some((value) => !Number.isFinite(value) || value < 0)
    ) {
      setScenarioError("Rainfall must be a comma-separated list of nonnegative numbers.");
      return;
    }

    const soilPercent = Number(scenarioForm.soilMoisturePercent);
    if (!Number.isFinite(soilPercent) || soilPercent < 0 || soilPercent > 100) {
      setScenarioError("Soil moisture must be a percentage from 0 to 100.");
      return;
    }
    if (!scenarioForm.villageId) {
      setScenarioError("Select a village for the scenario.");
      return;
    }

    const thresholdText = scenarioForm.threshold.trim();
    const threshold = thresholdText === "" ? null : Number(thresholdText);
    if (threshold !== null && (!Number.isFinite(threshold) || threshold <= 0)) {
      setScenarioError("The optional threshold must be greater than zero.");
      return;
    }

    const controller = new AbortController();
    scenarioControllerRef.current = controller;
    setScenarioLoading(true);
    try {
      const payload = {
        village_id: scenarioForm.villageId,
        daily_rainfall_mm: rainfall,
        current_soil_moisture: soilPercent / 100,
        ...(threshold === null ? {} : { base_threshold_override_mm: threshold }),
      };
      setScenarioResult(await simulate(payload, { signal: controller.signal }));
    } catch (error) {
      if (!isAbortError(error)) setScenarioError(errorMessage(error));
    } finally {
      if (!controller.signal.aborted) setScenarioLoading(false);
      if (scenarioControllerRef.current === controller) scenarioControllerRef.current = null;
    }
  }

  function copyReplayAlertToDraft(context) {
    setReplayDraft(context);
    setForm((current) => ({
      ...current,
      severity: context.severity,
      message: context.message,
    }));
    setSendResult({
      text: "Historical simulation alert copied. Review it before recording; it cannot be labeled live.",
      tone: "success",
    });
    setActiveSection("send");
  }

  function clearReplayDraft() {
    setReplayDraft(null);
    setForm((current) => ({
      ...current,
      message: current.message.startsWith("[HISTORICAL SIMULATION") ? "" : current.message,
    }));
    setSendResult(null);
  }

  async function recordReplayAlert(context) {
    const payload = {
      state: form.state || "Uttarakhand",
      district: context.area || "Historical event",
      target: `HISTORICAL SIMULATION — ${context.target}; forcing case ${context.caseLabel}`,
      severity: context.severity,
      message: context.message.startsWith("[HISTORICAL SIMULATION")
        ? context.message
        : `[HISTORICAL SIMULATION — NOT LIVE] ${context.message}`,
      issued_by: "administrator (historical simulation)",
      issued_at: context.date
        ? `${context.date}T12:00:00+05:30`
        : new Date().toISOString(),
    };
    const createdAlert = await createAlert(payload);
    setHistory((current) => [
      createdAlert,
      ...current.filter((alert) => alert.id !== createdAlert.id),
    ].slice(0, 50));
    setHistoryError("");
    return createdAlert;
  }

  const previewTone = form.severity === "CRITICAL"
    ? "critical-preview"
    : form.severity === "MODERATE"
      ? "moderate-preview"
      : "high-preview";

  const healthOk = healthState.phase === "success" && healthState.data?.status === "ok";
  const systemStatuses = [
    ["Frontend", "Operational", "online"],
    [
      "FastAPI backend",
      healthOk
        ? "Online — /health succeeded"
        : healthState.phase === "loading"
          ? "Checking /health…"
          : "Offline or unverified — /health failed",
      healthOk ? "online" : healthState.phase === "loading" ? "ready" : "offline",
    ],
    [
      "OpenWeather provider",
      healthOk
        ? healthState.data.weather_configured !== false
          ? "Configured through backend"
          : "Backend OpenWeather configuration required"
        : "Unverified",
      healthOk && healthState.data.weather_configured !== false ? "online" : "offline",
    ],
    [
      "Data mode",
      healthOk ? String(healthState.data.data_mode).toUpperCase() : "Unknown until /health succeeds",
      healthOk ? "ready" : "offline",
    ],
    [
      "Runtime storage",
      healthOk ? String(healthState.data.storage).toUpperCase() : "Unverified",
      healthOk ? "ready" : "offline",
    ],
    [
      "Risk engine",
      currentSnapshots.length > 0
        ? `${currentSnapshots.length} forecast-inclusive snapshots loaded`
        : riskLoading
          ? "Batch request in progress"
          : "No successful batch snapshot",
      currentSnapshots.length > 0 ? "ready" : "offline",
    ],
    [
      "Alert API",
      historyError
        ? "Prototype/in-memory — currently unreachable"
        : "Prototype/in-memory — resets on backend restart",
      historyError ? "offline" : "ready",
    ],
    ["Admin authentication", "Not implemented", "offline"],
  ];

  return (
    <>
      <Header
        admin
        health={healthState.phase === "success" ? healthState.data : healthState.phase === "error" ? null : undefined}
      />
      <main className="admin-layout">
        <aside className="admin-sidebar">
          <div className="admin-user">
            <div className="avatar">A</div>
            <div><strong>System Administrator</strong><span>Operator console (no backend auth)</span></div>
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
            Alerts are held in backend process memory and administrator authentication is not implemented.
          </div>
        </aside>

        <section className="admin-content">
          {activeSection === "send" && (
            <section className="admin-section active">
              <div className="page-heading">
                <div>
                  <div className="eyebrow">ADMINISTRATOR</div>
                  <h1>Send Early Warning Alert</h1>
                  <p>Create, risk-check, and issue a preparedness message to exact backend village IDs.</p>
                </div>
                <div className="admin-status-pill">Manual approval required</div>
              </div>

              <div className="bootstrap-status" aria-live="polite">
                <strong>Backend data:</strong>{" "}
                {healthOk
                  ? `${String(dataMode).toUpperCase()} mode; ${villages.length} villages loaded.`
                  : healthState.phase === "loading"
                    ? "Checking /health before loading villages…"
                    : "Health check failed; backend online status is unverified."}
              </div>
              {healthState.error && <div className="form-result warning">{healthState.error}</div>}
              {villagesError && <div className="form-result warning">{villagesError}</div>}

              <div className="admin-grid">
                <form className="form-card" onSubmit={sendAlert}>
                  <div className="form-title">Alert configuration</div>
                  {replayDraft && (
                    <div className="historical-draft-notice" role="status">
                      <div>
                        <strong>Historical simulation draft — never live</strong>
                        <span>{replayDraft.eventName} · {formatDateTime(replayDraft.date)} · {replayDraft.caseLabel}</span>
                      </div>
                      <button type="button" onClick={clearReplayDraft}>Return to live alert draft</button>
                    </div>
                  )}

                  <SelectField label="State" name="state" value={form.state} onChange={updateField} options={STATES} />
                  <SelectField label="District" name="district" value={form.district} onChange={updateField} options={DISTRICTS} />
                  <SelectField
                    label="Target"
                    name="target"
                    value={form.target}
                    onChange={updateField}
                    options={TARGET_OPTIONS}
                  />
                  {form.target === "Selected village" && (
                    <label>
                      Selected village
                      <select
                        name="selectedVillageId"
                        value={form.selectedVillageId}
                        onChange={updateField}
                        required
                        disabled={villagesLoading || villages.length === 0}
                      >
                        {villages.length === 0 && <option value="">No villages available</option>}
                        {villages.map((village) => (
                          <option value={village.id} key={village.id}>{villageLabel(village)}</option>
                        ))}
                      </select>
                    </label>
                  )}
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
                      maxLength="1000"
                      value={form.message}
                      onChange={updateField}
                      placeholder="Enter clear instructions for the affected community..."
                    />
                  </label>

                  <div className={`preview-alert ${previewTone}`}>
                    <div className="alert-preview-icon">!</div>
                    <div>
                      <strong>{replayDraft ? "HISTORICAL SIMULATION Alert Preview" : `${form.severity} Alert Preview`}</strong>
                      <p>{form.message || "Your message will appear here."}</p>
                      <small>{effectiveAlertTarget || noTargetMessage || "Resolving exact backend targets…"}</small>
                    </div>
                  </div>

                  {riskError && <div className="form-result warning">{riskError}</div>}
                  {noTargetMessage && <div className="form-result warning">{noTargetMessage}</div>}
                  <button
                    className="primary-btn"
                    type="submit"
                    disabled={sending || (!replayDraft && riskLoading) || !effectiveAlertTarget}
                  >
                    {sending ? replayDraft ? "Recording simulation…" : "Sending…" : replayDraft ? "Record Historical Simulation Alert" : riskLoading ? "Loading risk preview…" : "Send Alert"}
                  </button>
                  <div className={`form-result ${sendResult?.tone ?? ""}`} aria-live="polite">
                    {sendResult?.text}
                  </div>
                </form>

                <div className="info-stack">
                  <div className="info-card">
                    <div className="section-heading">CURRENT TARGET RISK</div>
                    {riskSummary ? (
                      <>
                        <div className="big-risk"><span>{riskSummary.score}</span><small>/100</small></div>
                        <div className={`risk-badge ${riskSummary.risk.toLowerCase()}`}>{riskSummary.risk}</div>
                        <p>
                          Peak across {targetVillageIds.length} exact target village ID(s), including forecast snapshots.
                          {riskSummary.conditions.rainfall ? ` Rainfall: ${riskSummary.conditions.rainfall}.` : ""}
                          {riskSummary.conditions.soil ? ` Soil moisture: ${riskSummary.conditions.soil}.` : ""}
                        </p>
                        <small>
                          Batch returned {riskBatchMeta?.returned ?? targetSnapshots.length} current/forecast snapshots for {riskBatchMeta?.requested ?? targetVillageIds.length} requested village(s).
                        </small>
                      </>
                    ) : (
                      <p>{riskLoading ? "Loading exact risk batch…" : "No target risk snapshot is available."}</p>
                    )}
                  </div>
                  <div className="info-card">
                    <div className="section-heading">BEFORE SENDING</div>
                    <ul className="check-list">
                      <li>Verify the serialized village names and IDs.</li>
                      <li>Check the forecast-inclusive risk snapshot.</li>
                      <li>Use short, actionable instructions.</li>
                      <li>Confirm alert severity.</li>
                      <li>Remember that alerts reset when the backend restarts.</li>
                    </ul>
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeSection === "history" && (
            <section className="admin-section active">
              <PageHeading title="Alert History" description="Alerts returned by GET /v1/admin/alerts (prototype process-memory storage)." />
              {historyError && <div className="form-result warning">{historyError}</div>}
              <div className="table-card">
                <table>
                  <thead><tr><th>Time</th><th>Location</th><th>Severity</th><th>Target</th><th>Message</th><th>Status</th></tr></thead>
                  <tbody>
                    {historyLoading && history.length === 0 ? (
                      <tr><td className="empty-history" colSpan="6">Loading backend alert history…</td></tr>
                    ) : history.length === 0 ? (
                      <tr><td className="empty-history" colSpan="6">The backend has no alert records.</td></tr>
                    ) : history.map((alert, index) => (
                      <tr key={alert.id || `${alert.issued_at}-${index}`}>
                        <td>{formatDateTime(alert.issued_at)}</td>
                        <td>{alert.state} / {alert.district}</td>
                        <td><span className={`risk-badge ${String(alert.severity).toLowerCase()}`}>{alert.severity}</span></td>
                        <td>{alert.target}</td>
                        <td>{alert.message}</td>
                        <td>
                          {String(alert.issued_by || alert.message || "").toLowerCase().includes("historical simulation")
                            ? <span className="historical-history-label">Historical simulation</span>
                            : alert.status || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {activeSection === "scenario" && (
            <section className="admin-section active">
              <PageHeading title="Scenario Lab" description="Run operator-supplied rainfall and soil conditions through POST /simulate." />
              <div className="admin-grid">
                <form className="form-card" onSubmit={runScenario}>
                  <div className="form-title">Scenario inputs</div>
                  <label>
                    Village
                    <select
                      value={scenarioForm.villageId}
                      onChange={(event) => setScenarioForm((current) => ({ ...current, villageId: event.target.value }))}
                      required
                      disabled={villagesLoading || villages.length === 0}
                    >
                      {villages.length === 0 && <option value="">No villages available</option>}
                      {villages.map((village) => (
                        <option value={village.id} key={village.id}>{villageLabel(village)}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Daily rainfall (mm, comma-separated)
                    <input
                      type="text"
                      value={scenarioForm.rainfall}
                      onChange={(event) => setScenarioForm((current) => ({ ...current, rainfall: event.target.value }))}
                      placeholder="12, 35.5, 80"
                      required
                    />
                  </label>
                  <label>
                    Current soil moisture (%)
                    <input
                      type="number"
                      min="0"
                      max="100"
                      step="any"
                      value={scenarioForm.soilMoisturePercent}
                      onChange={(event) => setScenarioForm((current) => ({ ...current, soilMoisturePercent: event.target.value }))}
                      placeholder="65"
                      required
                    />
                  </label>
                  <label>
                    Base rainfall threshold override (mm, optional)
                    <input
                      type="number"
                      min="0.01"
                      step="any"
                      value={scenarioForm.threshold}
                      onChange={(event) => setScenarioForm((current) => ({ ...current, threshold: event.target.value }))}
                      placeholder="Use catchment default"
                    />
                  </label>
                  <button className="primary-btn" type="submit" disabled={scenarioLoading || villages.length === 0}>
                    {scenarioLoading ? "Running scenario…" : "Run Scenario"}
                  </button>
                  {scenarioError && <div className="form-result warning" aria-live="polite">{scenarioError}</div>}
                </form>

                <div className="info-stack">
                  <div className="info-card scenario-result-card">
                    <div className="section-heading">SCENARIO RESULT</div>
                    {scenarioSummary ? (
                      <>
                        <div className="big-risk"><span>{scenarioSummary.score}</span><small>/100</small></div>
                        <div className={`risk-badge ${scenarioSummary.risk.toLowerCase()}`}>{scenarioSummary.risk}</div>
                        <dl className="result-details">
                          <div><dt>Village ID</dt><dd>{scenarioResult.village_id}</dd></div>
                          <div><dt>Catchment</dt><dd>{scenarioSummary.result.catchment_id || "—"}</dd></div>
                          <div><dt>Direct runoff</dt><dd>{formatNumber(scenarioSummary.result.catchment_hydrology?.runoff_mm, " mm")}</dd></div>
                          <div><dt>Effective threshold</dt><dd>{formatNumber(scenarioSummary.result.rainfall_trigger?.effective_threshold_mm, " mm")}</dd></div>
                          <div>
                            <dt>Threshold exceeded</dt>
                            <dd>
                              {Number.isFinite(Number(scenarioSummary.result.explain?.today_rainfall_mm)) && Number.isFinite(Number(scenarioSummary.result.rainfall_trigger?.effective_threshold_mm))
                                ? Number(scenarioSummary.result.explain.today_rainfall_mm) >= Number(scenarioSummary.result.rainfall_trigger.effective_threshold_mm) ? "Yes" : "No"
                                : "—"}
                            </dd>
                          </div>
                          <div><dt>3-day antecedent rain</dt><dd>{formatNumber(scenarioSummary.result.explain?.antecedent_3day_mm, " mm")}</dd></div>
                          <div><dt>Slope stability</dt><dd>{scenarioSummary.result.supplemental_slope_stability?.risk_class || "—"}</dd></div>
                        </dl>
                        {scenarioSummary.result.explain?.method_note && <p>{scenarioSummary.result.explain.method_note}</p>}
                      </>
                    ) : (
                      <p>Submit valid scenario inputs to view overall risk, score, and model details.</p>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}

          {activeSection === "replay" && (
            <section className="admin-section active replay-admin-section">
              <HistoricalReplay
                onCopyAlert={copyReplayAlertToDraft}
                onRecordAlert={recordReplayAlert}
              />
            </section>
          )}

          {activeSection === "monitor" && (
            <section className="admin-section active">
              <PageHeading title="Data Monitor" description="Conditions and provenance from the latest exact backend risk batch." />
              {riskError && <div className="form-result warning">{riskError}</div>}
              <div className="monitor-grid">
                {monitors.map((monitor) => (
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
              <PageHeading title="System Status" description="Status based on /health and this session's API requests." />
              {healthState.error && <div className="form-result warning">{healthState.error}</div>}
              <div className="status-table">
                {systemStatuses.map(([name, status, tone]) => (
                  <div key={name}><span>{name}</span><b className={tone}>{status}</b></div>
                ))}
              </div>
              <div className="admin-warning system-disclaimer">
                The alert API is a prototype backed only by process memory, and administrator authentication/authorization is not implemented. Do not use this console as a production dispatch authority.
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
