import { useEffect, useRef } from "react";

import { getRiskLevel, getSnapshotConditions, getSnapshotScore } from "../api";

function formatNumber(value, suffix = "", digits = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(digits)}${suffix}` : "—";
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

  const risk = details?.risk ?? village.snapshot;
  const record = details?.village ?? village.record;
  const catchment = details?.catchment;
  const score = risk ? getSnapshotScore(risk, village.score) : village.score;
  const riskLevel = risk ? getRiskLevel(risk, score) : village.risk;
  const conditions = risk ? getSnapshotConditions(risk) : {};
  const hydrology = risk?.hazard?.catchment_hydrology ?? risk?.details?.catchment_hydrology;
  const exposure = risk?.details?.village_exposure;

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
        <div className="eyebrow">VERIFIED VILLAGE DETAILS</div>
        <h2 id="village-modal-title">{record?.name ?? village.name}</h2>
        <div className={`risk-badge ${riskLevel.toLowerCase()}`}>{riskLevel}</div>

        {details?.loading && <div className="api-message">Loading village, risk, and catchment routes…</div>}
        {details?.error && <div className="api-message error" role="alert">{details.error}</div>}

        <div className="detail-grid">
          <div><span>Current risk score</span><strong>{score}/100</strong></div>
          <div><span>3-hour rainfall</span><strong>{conditions.rainfall ?? village.rain}</strong></div>
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

        {risk?.provenance && (
          <div className="modal-provenance">
            <strong>Data provenance</strong>
            <span>
              {risk.provenance.data_mode} · {risk.provenance.weather_source ?? "weather source unavailable"}
              {risk.valid_at ? ` · valid ${new Date(risk.valid_at).toLocaleString()}` : ""}
            </span>
          </div>
        )}
        <div className="modal-note">
          Risk is a preparedness indicator, not a claim of exact inundation at the village.
          Catchment response time is indicative and is not a guaranteed evacuation lead time.
        </div>
      </div>
    </div>
  );
}
