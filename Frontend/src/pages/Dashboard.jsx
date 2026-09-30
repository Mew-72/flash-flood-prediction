import { useCallback, useEffect, useMemo, useState } from "react";

import {
  flattenSnapshots,
  getAllCatchments,
  getAllRiskSnapshots,
  getAllVillages,
  getAllVillageBoundaries,
  getCatchment,
  getHealth,
  getPeakSnapshot,
  getRisk,
  getRiskLevel,
  getSnapshotConditions,
  getSnapshotScore,
  getVillage,
  toFrontendVillage,
} from "../api";
import Header from "../components/Header";
import RiskMap from "../components/RiskMap";
import VillageModal from "../components/VillageModal";
import {
  DEFAULT_VISIBLE_LAYERS,
  MAP_LAYERS,
  STATES,
  riskColor,
} from "../data";

const AUTO_REFRESH_MS = 5 * 60 * 1000;

const EMPTY_SUMMARY = {
  score: 0,
  risk: "UNAVAILABLE",
  rainfall: "—",
  rainfallLabel: "rainfall unavailable",
  temperature: "—",
  humidity: "—",
  wind: "—",
  soil: "—",
  responseTime: "—",
  responseTimeDetail: "estimated catchment runoff travel time",
};

function formatApiError(error) {
  if (error?.name === "AbortError") return "";
  return error?.message || "The backend request failed.";
}

function snapshotForVillage(snapshots, villageId) {
  return snapshots.find((snapshot) => snapshot.village_id === villageId);
}

function openWeatherReady(health) {
  if (!health || health.weather_configured === false) return false;
  const provider = health.provider ?? health.weather_provider ?? health.weather?.provider;
  return !provider || String(provider).toLowerCase().includes("openweather");
}

function formatUpdatedAt(value) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime())
    ? "Live snapshot loaded"
    : `Updated ${date.toLocaleString()} · auto-refresh 5 min`;
}

export default function Dashboard() {
  const [state, setState] = useState("Uttarakhand");
  const [district, setDistrict] = useState("");
  const [catchmentId, setCatchmentId] = useState("");
  const [visibleLayers, setVisibleLayers] = useState(DEFAULT_VISIBLE_LAYERS);
  const [health, setHealth] = useState(undefined);
  const [villageRecords, setVillageRecords] = useState([]);
  const [catchments, setCatchments] = useState([]);
  const [villageBoundaries, setVillageBoundaries] = useState([]);
  const [availableDistricts, setAvailableDistricts] = useState([]);
  const [snapshotPayload, setSnapshotPayload] = useState(null);
  const [viewPeriod, setViewPeriod] = useState("current");
  const [forecastLead, setForecastLead] = useState(24);
  const [selectedVillageId, setSelectedVillageId] = useState(null);
  const [detailState, setDetailState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [apiError, setApiError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("Connecting to backend…");
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDashboard() {
      setApiError("");
      setLoading(true);
      try {
        const filters = {
          district: district || undefined,
          catchment_id: catchmentId || undefined,
        };
        const healthPayload = await getHealth({ signal: controller.signal });
        setHealth(healthPayload);

        const [villageCatalog, catchmentCatalog] = await Promise.all([
          getAllVillages(filters, { signal: controller.signal }),
          getAllCatchments(
            { district: district || undefined },
            { signal: controller.signal },
          ),
        ]);
        setVillageRecords(villageCatalog.items);
        setCatchments(catchmentCatalog.items);

        if (healthPayload.data_mode === "production" && district) {
          try {
            const boundaryCatalog = await getAllVillageBoundaries(
              { district_name: district, limit: 500 },
              { signal: controller.signal },
            );
            setVillageBoundaries(boundaryCatalog.items);
          } catch (error) {
            if (error.name !== "AbortError") setVillageBoundaries([]);
          }
        } else {
          setVillageBoundaries([]);
        }

        if (!district) {
          const districts = new Set(
            [...villageCatalog.items, ...catchmentCatalog.items]
              .map((item) => item.district)
              .filter(Boolean),
          );
          setAvailableDistricts([...districts].sort((left, right) => left.localeCompare(right)));
        }

        const stateName = villageCatalog.items
          .map((item) => item.admin?.state?.name)
          .find(Boolean);
        if (stateName) setState(stateName);

        try {
          const risks = await getAllRiskSnapshots(
            {
              ...filters,
              include_forecast: true,
              summarize_provisional: false,
            },
            { signal: controller.signal },
          );
          setSnapshotPayload(risks);
          setLastUpdated(formatUpdatedAt(risks.generated_at));
        } catch (error) {
          if (error.name !== "AbortError") {
            setSnapshotPayload(null);
            setApiError(formatApiError(error));
            setLastUpdated("Live OpenWeather risk data unavailable");
          }
        }
      } catch (error) {
        if (error.name !== "AbortError") {
          setHealth(null);
          setVillageRecords([]);
          setCatchments([]);
          setVillageBoundaries([]);
          setSnapshotPayload(null);
          setApiError(formatApiError(error));
          setLastUpdated("Backend unavailable");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }

    loadDashboard();
    return () => controller.abort();
  }, [catchmentId, district, reloadToken]);

  const allSnapshots = useMemo(
    () => flattenSnapshots(snapshotPayload),
    [snapshotPayload],
  );

  const forecastLeads = useMemo(
    () => [...new Set(
      allSnapshots
        .filter((snapshot) => snapshot.period === "forecast")
        .map((snapshot) => Math.round(Number(snapshot.lead_time_hours)))
        .filter(Number.isFinite),
    )].sort((left, right) => left - right),
    [allSnapshots],
  );

  useEffect(() => {
    if (forecastLeads.length === 0) {
      if (viewPeriod === "forecast") setViewPeriod("current");
      return;
    }
    if (!forecastLeads.includes(forecastLead)) {
      const preferred = forecastLeads.includes(24)
        ? 24
        : forecastLeads[0];
      setForecastLead(preferred);
    }
  }, [forecastLead, forecastLeads, viewPeriod]);

  const visibleSnapshots = useMemo(() => {
    if (viewPeriod === "current") {
      return allSnapshots.filter((snapshot) => snapshot.period === "current");
    }
    return allSnapshots.filter(
      (snapshot) =>
        snapshot.period === "forecast" &&
        Math.round(Number(snapshot.lead_time_hours)) === forecastLead,
    );
  }, [allSnapshots, forecastLead, viewPeriod]);

  const villages = useMemo(() => {
    return villageRecords.map((record) => {
      const snapshot = snapshotForVillage(visibleSnapshots, record.id);
      const score = snapshot ? getSnapshotScore(snapshot, 0) : 0;
      const conditions = snapshot ? getSnapshotConditions(snapshot) : {};
      return {
        ...toFrontendVillage(record, {
          score,
          risk: snapshot ? getRiskLevel(snapshot, score) : "UNAVAILABLE",
          rain: conditions.rainfall ?? "—",
          soil: conditions.soil ?? "—",
        }),
        district: record.district,
        record,
        snapshot,
        assessmentScope: snapshot ? "village" : null,
        weather: conditions,
      };
    });
  }, [villageRecords, visibleSnapshots]);

  const selectedVillage = useMemo(
    () => villages.find((village) => village.id === selectedVillageId) ?? null,
    [selectedVillageId, villages],
  );

  const sortedVillages = useMemo(
    () => [...villages].sort((left, right) => right.score - left.score),
    [villages],
  );

  const summary = useMemo(() => {
    const peak = getPeakSnapshot(visibleSnapshots);
    if (!peak) return EMPTY_SUMMARY;
    const score = getSnapshotScore(peak, 0);
    const conditions = getSnapshotConditions(peak);
    const responseMinutes = peak.hazard?.catchment_hydrology?.estimated_response_time_minutes;
    const provisional = peak.assessment_mode === "provisional_defaults";
    return {
      score,
      risk: getRiskLevel(peak, score),
      rainfall: conditions.rainfall ?? "—",
      rainfallLabel: conditions.rainfallLabel,
      temperature: conditions.temperature ?? "—",
      humidity: conditions.humidity ?? "—",
      wind: conditions.wind ?? "—",
      soil: conditions.soil ?? "—",
      responseTime: Number.isFinite(Number(responseMinutes))
        ? `${provisional ? "~" : ""}${Math.round(Number(responseMinutes))} min`
        : "—",
      responseTimeDetail: provisional
        ? "provisional runoff travel time · not warning lead"
        : "estimated runoff travel time · not warning lead",
    };
  }, [visibleSnapshots]);

  const averageSlope = useMemo(() => {
    const values = villageRecords
      .map((village) => village.slope_deg)
      .filter((value) => value != null && value !== "")
      .map(Number)
      .filter(Number.isFinite);
    if (values.length === 0) return "—";
    return `${Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)}°`;
  }, [villageRecords]);

  useEffect(() => {
    if (!selectedVillage) {
      setDetailState(null);
      return undefined;
    }

    const controller = new AbortController();
    setDetailState({ loading: true, error: "" });

    async function loadDetails() {
      try {
        const [village, risk, catchment] = await Promise.all([
          getVillage(selectedVillage.id, { signal: controller.signal }),
          getRisk(selectedVillage.id, { signal: controller.signal }),
          getCatchment(selectedVillage.catchment, { signal: controller.signal }),
        ]);
        setDetailState({ loading: false, error: "", village, risk, catchment });
      } catch (error) {
        if (error.name !== "AbortError") {
          setDetailState({ loading: false, error: formatApiError(error) });
        }
      }
    }

    loadDetails();
    return () => controller.abort();
  }, [selectedVillage]);

  const refreshSnapshot = useCallback(() => {
    setRefreshing(true);
    setLastUpdated("Refreshing live backend data…");
    setReloadToken((value) => value + 1);
  }, []);

  useEffect(() => {
    const intervalId = window.setInterval(refreshSnapshot, AUTO_REFRESH_MS);
    return () => window.clearInterval(intervalId);
  }, [refreshSnapshot]);

  function toggleLayer(layerId) {
    setVisibleLayers((current) => ({
      ...current,
      [layerId]: !current[layerId],
    }));
  }

  function changeDistrict(event) {
    setDistrict(event.target.value);
    setCatchmentId("");
    setSelectedVillageId(null);
  }

  return (
    <div className="app-shell">
      <Header health={health} lastUpdated={lastUpdated} />

      <main className="dashboard">
        <aside className="sidebar">
          <section className="side-section">
            <div className="section-heading">LOCATION</div>
            <label className="field-label" htmlFor="state-select">State</label>
            <select
              id="state-select"
              className="select"
              value={state}
              onChange={(event) => setState(event.target.value)}
              disabled
              title="The backend currently exposes district and catchment filters; state is catalog metadata."
            >
              {[...new Set([state, ...STATES])].map((item) => <option key={item}>{item}</option>)}
            </select>

            <label className="field-label" htmlFor="district-select">District</label>
            <select
              id="district-select"
              className="select"
              value={district}
              onChange={changeDistrict}
            >
              <option value="">All available districts</option>
              {availableDistricts.map((item) => <option key={item}>{item}</option>)}
            </select>

            <label className="field-label" htmlFor="catchment-select">Sub-catchment</label>
            <select
              id="catchment-select"
              className="select"
              value={catchmentId}
              onChange={(event) => {
                setCatchmentId(event.target.value);
                setSelectedVillageId(null);
              }}
            >
              <option value="">All sub-catchments</option>
              {catchments.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </section>

          <section className="side-section">
            <div className="section-heading">ASSESSMENT TIME</div>
            <div className="period-switch" role="group" aria-label="Assessment period">
              <button
                type="button"
                className={viewPeriod === "current" ? "active" : ""}
                onClick={() => setViewPeriod("current")}
              >
                Current
              </button>
              <button
                type="button"
                className={viewPeriod === "forecast" ? "active" : ""}
                onClick={() => setViewPeriod("forecast")}
                disabled={forecastLeads.length === 0}
              >
                Forecast
              </button>
            </div>
            {viewPeriod === "forecast" && (
              <>
                <label className="field-label" htmlFor="forecast-lead">Lead time</label>
                <select
                  id="forecast-lead"
                  className="select"
                  value={forecastLead}
                  onChange={(event) => setForecastLead(Number(event.target.value))}
                >
                  {forecastLeads.map((hours) => (
                    <option key={hours} value={hours}>+{hours} hours</option>
                  ))}
                </select>
              </>
            )}
          </section>

          <section className="side-section">
            <div className="section-heading">MAP LAYERS</div>
            {MAP_LAYERS.map((layer) => (
              <label className="layer-row" key={layer.id}>
                <input
                  type="checkbox"
                  checked={visibleLayers[layer.id]}
                  onChange={() => toggleLayer(layer.id)}
                  disabled={
                    (layer.id === "precipitation" || layer.id === "clouds")
                    && !openWeatherReady(health)
                  }
                />
                <span className={`layer-icon ${layer.iconClass}`} />
                {layer.label}
              </label>
            ))}
          </section>

          <section className="side-section">
            <div className="section-heading">RISK LEGEND</div>
            <div className="legend-item"><span className="legend-box low" />Low <span>0–24</span></div>
            <div className="legend-item"><span className="legend-box moderate" />Moderate <span>25–49</span></div>
            <div className="legend-item"><span className="legend-box high" />High <span>50–74</span></div>
            <div className="legend-item"><span className="legend-box critical" />Critical <span>75–100</span></div>
          </section>

          <div className="side-footer">
            <div className="data-badge">
              {health?.data_mode === "demo" ? "SYNTHETIC DEMO DATA" : "LIVE OPENWEATHER + BACKEND RISK"}
            </div>
            <p>OpenWeather conditions are requested only by the backend; no provider key is exposed here.</p>
          </div>
        </aside>

        <section className="map-area">
          <RiskMap
            state={state}
            district={district || "All available districts"}
            villages={villages}
            catchments={catchments}
            villageBoundaries={villageBoundaries}
            selectedVillage={selectedVillage}
            visibleLayers={visibleLayers}
            onSelectVillage={(village) => setSelectedVillageId(village.id)}
            onRefresh={refreshSnapshot}
            refreshing={refreshing}
            backendOnline={Boolean(health && snapshotPayload)}
            weatherReady={openWeatherReady(health)}
            periodLabel={viewPeriod === "forecast" ? `Forecast +${forecastLead}h` : "Current"}
          />
        </section>

        <aside className="right-panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">{viewPeriod === "forecast" ? `FORECAST +${forecastLead}H` : "CURRENT CONDITIONS"}</div>
              <h2>Risk Summary</h2>
            </div>
            <div className={`risk-badge ${summary.risk.toLowerCase()}`}>{summary.risk}</div>
          </div>

          {apiError && <div className="api-message error" role="alert">{apiError}</div>}
          {!apiError && loading && <div className="api-message">Loading backend data…</div>}
          {!loading && !apiError && villages.length === 0 && (
            <div className="api-message warning">No villages match the selected backend filters.</div>
          )}
          {!loading && !apiError && villages.length > 0 && visibleSnapshots.length === 0 && (
            <div className="api-message warning">
              These catalog villages are not model-ready because hydrology or terrain features are missing. Live map weather remains available, but no risk score is calculated.
            </div>
          )}

          <div className="score-card">
            <div>
              <div className="small-label">REGIONAL PEAK RISK SCORE</div>
              <div className="score">{summary.score}</div>
              <div className="score-caption">out of 100</div>
            </div>
            <div className="gauge" role="meter" aria-label="Regional peak risk score" aria-valuemin="0" aria-valuemax="100" aria-valuenow={summary.score}>
              <div
                className="gauge-fill"
                style={{ width: `${summary.score}%`, background: riskColor(summary.score) }}
              />
            </div>
          </div>

          <div className="metric-grid">
            <MetricCard symbol="RN" name="Rainfall" value={summary.rainfall} detail={summary.rainfallLabel} />
            <MetricCard symbol="°C" name="Temperature" value={summary.temperature} detail="OpenWeather air temperature" />
            <MetricCard symbol="RH" name="Humidity" value={summary.humidity} detail="OpenWeather relative humidity" />
            <MetricCard symbol="WS" name="Wind" value={summary.wind} detail="speed and direction" />
            <MetricCard symbol="SL" name="Slope" value={averageSlope} detail={`terrain · soil ${summary.soil}`} />
            <MetricCard
              symbol="RT"
              name="Catchment response"
              value={summary.responseTime}
              detail={summary.responseTimeDetail}
            />
          </div>

          <div className="panel-section">
            <div className="section-heading">VILLAGE PRIORITIES</div>
            <div className="village-list">
              {sortedVillages.map((village) => (
                <button
                  className="village-item"
                  type="button"
                  key={village.id}
                  onClick={() => setSelectedVillageId(village.id)}
                >
                  <span>
                    <span className="village-name">{village.name}</span>
                    <span className="village-meta">
                      {village.risk} · {village.catchment}
                      {village.snapshot?.assessment_mode === "provisional_defaults" ? " · PROVISIONAL" : ""}
                    </span>
                  </span>
                  {/* <span className="village-score-wrap">
                    <span
                      className="village-score"
                      style={{ color: village.snapshot ? riskColor(village.score) : "#64748b" }}
                    >
                      {village.snapshot ? village.score : "—"}
                    </span>
                    {village.snapshot && <span className="village-meta">/100</span>}
                  </span>*/}
                </button>
              ))}
            </div>
          </div>

          <div className="alert-banner">
            <div className="alert-symbol">!</div>
            <div>
              <strong>Administrator alerts</strong>
              <p>Review batch risk and issue prototype warnings from the Administrator page.</p>
            </div>
          </div>
        </aside>
      </main>

      <VillageModal
        village={selectedVillage}
        details={detailState}
        onClose={() => setSelectedVillageId(null)}
      />
    </div>
  );
}

function MetricCard({ symbol, name, value, detail }) {
  return (
    <div className="metric-card" title={detail}>
      <span className="metric-symbol" aria-hidden="true">{symbol}</span>
      <div>
        <div className="metric-name">{name}</div>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}
