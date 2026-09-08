import { useCallback, useEffect, useMemo, useState } from "react";

import {
  flattenSnapshots,
  getAllCatchments,
  getAllVillages,
  getCatchment,
  getHealth,
  getPeakSnapshot,
  getRisk,
  getRiskLevel,
  getRiskSnapshots,
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

const EMPTY_SUMMARY = {
  score: 0,
  risk: "LOW",
  rainfall: "—",
  soil: "—",
  responseTime: "—",
};

function formatApiError(error) {
  if (error?.name === "AbortError") return "";
  return error?.message || "The backend request failed.";
}

function snapshotForVillage(snapshots, villageId) {
  return snapshots.find((snapshot) => snapshot.village_id === villageId);
}

export default function Dashboard() {
  const [state, setState] = useState("Uttarakhand");
  const [district, setDistrict] = useState("");
  const [catchmentId, setCatchmentId] = useState("");
  const [visibleLayers, setVisibleLayers] = useState(DEFAULT_VISIBLE_LAYERS);
  const [health, setHealth] = useState(undefined);
  const [villageRecords, setVillageRecords] = useState([]);
  const [catchments, setCatchments] = useState([]);
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
        const [healthPayload, villageCatalog, catchmentCatalog, risks] = await Promise.all([
          getHealth({ signal: controller.signal }),
          getAllVillages(filters, { signal: controller.signal }),
          getAllCatchments(
            { district: district || undefined },
            { signal: controller.signal },
          ),
          getRiskSnapshots(
            {
              ...filters,
              include_forecast: true,
              limit: 500,
            },
            { signal: controller.signal },
          ),
        ]);

        setHealth(healthPayload);
        setVillageRecords(villageCatalog.items);
        setCatchments(catchmentCatalog.items);
        setSnapshotPayload(risks);
        setLastUpdated(`Updated ${new Date(risks.generated_at).toLocaleString()}`);

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
      } catch (error) {
        if (error.name !== "AbortError") {
          setHealth(null);
          setVillageRecords([]);
          setCatchments([]);
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

  const villages = useMemo(
    () => villageRecords.map((record) => {
      const snapshot = snapshotForVillage(visibleSnapshots, record.id);
      const score = snapshot ? getSnapshotScore(snapshot, 0) : 0;
      const conditions = snapshot ? getSnapshotConditions(snapshot) : {};
      return {
        ...toFrontendVillage(record, {
          score,
          risk: snapshot ? getRiskLevel(snapshot, score) : "LOW",
          rain: conditions.rainfall ?? "—",
          soil: conditions.soil ?? "—",
        }),
        district: record.district,
        record,
        snapshot,
      };
    }),
    [villageRecords, visibleSnapshots],
  );

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
    return {
      score,
      risk: getRiskLevel(peak, score),
      rainfall: conditions.rainfall ?? "—",
      soil: conditions.soil ?? "—",
      responseTime: Number.isFinite(Number(responseMinutes))
        ? `${Math.round(Number(responseMinutes))} min`
        : "—",
    };
  }, [visibleSnapshots]);

  const averageSlope = useMemo(() => {
    const values = villageRecords
      .map((village) => Number(village.slope_deg))
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
    setLastUpdated("Refreshing…");
    setReloadToken((value) => value + 1);
  }, []);

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
              {health?.data_mode === "demo" ? "SYNTHETIC DEMO DATA" : "PUBLIC DATA FIRST"}
            </div>
            <p>Rainfall + antecedent wetness + terrain + historical evidence + optional IoT.</p>
          </div>
        </aside>

        <section className="map-area">
          <RiskMap
            state={state}
            district={district || "All available districts"}
            villages={villages}
            catchments={catchments}
            selectedVillage={selectedVillage}
            regionalScore={summary.score}
            regionalRisk={summary.risk}
            visibleLayers={visibleLayers}
            onSelectVillage={(village) => setSelectedVillageId(village.id)}
            onRefresh={refreshSnapshot}
            refreshing={refreshing}
            backendOnline={Boolean(health)}
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
            <MetricCard symbol="☔" name="Rainfall" value={summary.rainfall} detail="3-hour accumulation" />
            <MetricCard symbol="◉" name="Soil Moisture" value={summary.soil} detail="current wetness" />
            <MetricCard symbol="⌁" name="Slope" value={averageSlope} detail="village average" />
            <MetricCard symbol="↘" name="Response time" value={summary.responseTime} detail="indicative catchment Tc" />
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
                    <span className="village-meta">{village.risk} · {village.catchment}</span>
                  </span>
                  <span className="village-score-wrap">
                    <span className="village-score" style={{ color: riskColor(village.score) }}>{village.score}</span>
                    <span className="village-meta">/100</span>
                  </span>
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
    <div className="metric-card">
      <span className="metric-symbol" aria-hidden="true">{symbol}</span>
      <div>
        <div className="metric-name">{name}</div>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </div>
  );
}
