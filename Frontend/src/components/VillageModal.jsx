import { useEffect, useRef } from "react";

import { getRiskLevel, getSnapshotConditions, getSnapshotScore } from "../api";

function formatNumber(value, suffix = "", digits = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(digits)}${suffix}` : "—";
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function humanize(value) {
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatComponentValue(value) {
  if (value && typeof value === "object") {
    const score = value.score ?? value.value ?? value.contribution;
    const weight = value.weight;
    if (score != null) {
      const formattedScore = formatComponentValue(score);
      return weight == null ? formattedScore : `${formattedScore} · weight ${formatComponentValue(weight)}`;
    }
    return "Returned by backend";
  }
  const numericValue = Number(value);
  if (Number.isFinite(numericValue)) return numericValue.toFixed(2).replace(/\.00$/, "");
  return value == null || value === "" ? "—" : String(value);
}

function riskComponents(risk) {
  const source = risk?.score_components
    ?? risk?.risk_components
    ?? risk?.components
    ?? risk?.details?.score_components
    ?? risk?.details?.explain?.score_components
    ?? risk?.details?.explain?.components;

  if (source && typeof source === "object" && !Array.isArray(source)) {
    return Object.entries(source).map(([name, value]) => [humanize(name), formatComponentValue(value)]);
  }

  const explain = risk?.details?.explain ?? {};
  const knownKeys = [
    "rainfall_score",
    "rainfall_component",
    "antecedent_wetness_score",
    "wetness_component",
    "soil_moisture_score",
    "terrain_score",
    "terrain_component",
    "exposure_score",
    "historical_score",
    "historical_component",
    "iot_score",
    "iot_component",
  ];
  return knownKeys
    .map((key) => [key, risk?.[key] ?? explain?.[key]])
    .filter(([, value]) => value != null)
    .map(([name, value]) => [humanize(name), formatComponentValue(value)]);
}

export default function VillageModal({ village, details, onClose }) {
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!village) return undefined;
    closeButtonRef.current?.focus();

    function closeOnEscape(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [village, onClose]);

  if (!village) return null;

  const detailRisk = details?.risk?.snapshot ?? details?.risk;
  const risk = detailRisk ?? village.snapshot;
  const record = details?.village ?? village.record;
  const catchment = details?.catchment;
  const hasRisk = Boolean(risk);
  const score = hasRisk ? getSnapshotScore(risk, village.score) : null;
  const riskLevel = hasRisk ? getRiskLevel(risk, score) : "UNAVAILABLE";
  const conditions = risk ? getSnapshotConditions(risk) : village.weather ?? {};
  const hydrology = risk?.hazard?.catchment_hydrology ?? risk?.details?.catchment_hydrology;
  const exposure = risk?.details?.village_exposure;
  const components = riskComponents(risk);
  const district = record?.district ?? record?.admin?.district?.name ?? village.district ?? "—";
  const provenance = risk?.provenance ?? {};

  return (
    <div
      className="modal"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true" aria-labelledby="village-modal-title">
        <button
          ref={closeButtonRef}
          className="modal-close"
          type="button"
          aria-label="Close village details"
          onClick={onClose}
        >
          ×
        </button>
        <div className="eyebrow">BACKEND VILLAGE RISK DETAILS</div>
        <h2 id="village-modal-title">{record?.name ?? village.name}</h2>
        <div className={`risk-badge ${riskLevel.toLowerCase()}`}>{riskLevel}</div>

        {details?.loading && <div className="api-message">Loading village, risk, and catchment routes…</div>}
        {details?.error && <div className="api-message error" role="alert">{details.error}</div>}
        {risk?.assessment_mode === "provisional_defaults" && (
          <div className="api-message warning" role="note">
            {risk.assessment_note ?? provenance.risk_input_note ?? "This screening score uses provisional terrain and hydrology defaults with live OpenWeather data."}
          </div>
        )}

        <section className="modal-section" aria-labelledby="risk-context-heading">
          <h3 id="risk-context-heading">Risk and terrain context</h3>
          <div className="detail-grid">
            <div><span>District</span><strong>{district}</strong></div>
            <div>
              <span>Risk score</span>
              <strong>{hasRisk ? `${score}/100 · ${riskLevel}` : "Unavailable"}</strong>
            </div>
            <div><span>Soil moisture</span><strong>{conditions.soil ?? village.soil}</strong></div>
            <div><span>Stream distance</span><strong>{formatNumber(record?.distance_to_stream_m, " m")}</strong></div>
            <div><span>Village slope</span><strong>{formatNumber(record?.slope_deg, "°", 1)}</strong></div>
            <div><span>Terrain class</span><strong>{record?.terrain_class ?? "—"}</strong></div>
            <div><span>Catchment</span><strong>{catchment?.name ?? village.catchment}</strong></div>
            <div><span>Catchment area</span><strong>{formatNumber(catchment?.area_km2, " km²", 1)}</strong></div>
            <div><span>Runoff</span><strong>{formatNumber(hydrology?.runoff_mm, " mm", 1)}</strong></div>
            <div><span>Response time</span><strong>{formatNumber(hydrology?.estimated_response_time_minutes, " min")}</strong></div>
            <div><span>Exposure score</span><strong>{formatNumber(Number(exposure?.score) * 100, "/100")}</strong></div>
            <div><span>Historical events</span><strong>{record?.historical_event_count ?? 0}</strong></div>
          </div>
        </section>

        <section className="modal-section" aria-labelledby="risk-components-heading">
          <h3 id="risk-components-heading">Risk score components</h3>
          {components.length > 0 ? (
            <dl className="component-list">
              {components.map(([name, value]) => (
                <div key={name}><dt>{name}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          ) : (
            <p className="modal-empty">This snapshot does not include a component breakdown.</p>
          )}
        </section>

        <section className="modal-section" aria-labelledby="openweather-heading">
          <h3 id="openweather-heading">OpenWeather conditions</h3>
          <div className="detail-grid weather-detail-grid">
            <div><span>Condition</span><strong>{conditions.weatherCondition ?? "—"}</strong></div>
            <div><span>{conditions.rainfallLabel ?? "Rainfall"}</span><strong>{conditions.rainfall ?? village.rain}</strong></div>
            <div><span>Temperature</span><strong>{conditions.temperature ?? "—"}</strong></div>
            <div><span>Feels like</span><strong>{conditions.feelsLike ?? "—"}</strong></div>
            <div><span>Humidity</span><strong>{conditions.humidity ?? "—"}</strong></div>
            <div><span>Wind</span><strong>{conditions.wind ?? "—"}</strong></div>
            <div><span>Pressure</span><strong>{conditions.pressure ?? "—"}</strong></div>
            <div><span>Cloud cover</span><strong>{conditions.cloudCover ?? "—"}</strong></div>
            <div><span>Visibility</span><strong>{conditions.visibility ?? "—"}</strong></div>
            <div><span>Valid time</span><strong>{formatDateTime(risk?.valid_at)}</strong></div>
          </div>
        </section>

        <div className="modal-provenance">
          <strong>Weather provenance</strong>
          <span>
            OpenWeather via FlashGuard backend
            {provenance.weather_source ? ` · source ${provenance.weather_source}` : ""}
            {provenance.data_mode ? ` · ${provenance.data_mode} mode` : ""}
            {provenance.retrieved_at ? ` · retrieved ${formatDateTime(provenance.retrieved_at)}` : ""}
            {risk?.valid_at ? ` · valid ${formatDateTime(risk.valid_at)}` : ""}
          </span>
          <span>No OpenWeather credential or keyed provider URL is sent to this browser.</span>
        </div>
        <div className="modal-note">
          Risk is a preparedness indicator, not a claim of exact inundation at the village.
          Catchment response time is indicative and is not a guaranteed evacuation lead time.
        </div>
      </div>
    </div>
  );
}
