import { useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchRiskSnapshots,
  flattenSnapshots,
  getPeakSnapshot,
  getRiskLevel,
  getSnapshotConditions,
  getSnapshotScore,
} from "../api";
import Header from "../components/Header";
import RiskMap from "../components/RiskMap";
import VillageModal from "../components/VillageModal";
import {
  DEFAULT_VILLAGES,
  DEFAULT_VISIBLE_LAYERS,
  DISTRICTS,
  MAP_LAYERS,
  STATES,
  riskColor,
} from "../data";

const DEFAULT_SUMMARY = {
  score: 74,
  risk: "HIGH",
  rainfall: "72 mm",
  soil: "81%",
};

export default function Dashboard() {
  const [state, setState] = useState("Uttarakhand");
  const [district, setDistrict] = useState("Rudraprayag");
  const [visibleLayers, setVisibleLayers] = useState(DEFAULT_VISIBLE_LAYERS);
  const [summary, setSummary] = useState(DEFAULT_SUMMARY);
  const [villages, setVillages] = useState(() => DEFAULT_VILLAGES.map((village) => ({ ...village })));
  const [selectedVillageId, setSelectedVillageId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState("Updated just now");

  const selectedVillage = useMemo(
    () => villages.find((village) => village.id === selectedVillageId) ?? null,
    [selectedVillageId, villages],
  );

  const sortedVillages = useMemo(
    () => [...villages].sort((left, right) => right.score - left.score),
    [villages],
  );

  const applySnapshots = useCallback((payload) => {
    const snapshots = flattenSnapshots(payload);
    if (snapshots.length === 0) return;

    const peak = getPeakSnapshot(snapshots);
    const score = getSnapshotScore(peak);
    const risk = getRiskLevel(peak, score);
    const conditions = getSnapshotConditions(peak);

    setSummary((current) => ({ ...current, score, risk, ...conditions }));
    setVillages((currentVillages) =>
      currentVillages.map((village) => {
        const snapshot = snapshots.find(
          (item) =>
            item.village_id === village.id ||
            item.village_name?.toLowerCase() === village.name.toLowerCase(),
        );
        if (!snapshot) return village;

        const villageScore = getSnapshotScore(snapshot, village.score);
        const villageConditions = getSnapshotConditions(snapshot);
        return {
          ...village,
          score: villageScore,
          risk: getRiskLevel(snapshot, villageScore),
          rain: villageConditions.rainfall ?? village.rain,
          soil: villageConditions.soil ?? village.soil,
        };
      }),
    );
  }, []);

  const loadSnapshot = useCallback(async (signal) => {
    try {
      const payload = await fetchRiskSnapshots(district, signal);
      applySnapshots(payload);
      return true;
    } catch (error) {
      if (error.name !== "AbortError") {
        console.info("Using demo snapshot; backend not reachable.", error.message);
      }
      return false;
    }
  }, [applySnapshots, district]);

  useEffect(() => {
    const controller = new AbortController();
    loadSnapshot(controller.signal);
    return () => controller.abort();
  }, [loadSnapshot]);

  async function refreshSnapshot() {
    setRefreshing(true);
    setLastUpdated("Refreshing…");
    await loadSnapshot();
    setLastUpdated("Updated just now");
    setRefreshing(false);
  }

  function toggleLayer(layerId) {
    setVisibleLayers((current) => ({
      ...current,
      [layerId]: !current[layerId],
    }));
  }

  function selectVillage(village) {
    setSelectedVillageId(village.id);
  }

  return (
    <div className="app-shell">
      <Header lastUpdated={lastUpdated} />

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
            >
              {STATES.map((item) => <option key={item}>{item}</option>)}
            </select>

            <label className="field-label" htmlFor="district-select">District</label>
            <select
              id="district-select"
              className="select"
              value={district}
              onChange={(event) => setDistrict(event.target.value)}
            >
              {DISTRICTS.map((item) => <option key={item}>{item}</option>)}
            </select>
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
            <div className="legend-item"><span className="legend-box low" />Low <span>0–29</span></div>
            <div className="legend-item"><span className="legend-box moderate" />Moderate <span>30–59</span></div>
            <div className="legend-item"><span className="legend-box high" />High <span>60–79</span></div>
            <div className="legend-item"><span className="legend-box critical" />Critical <span>80–100</span></div>
          </section>

          <div className="side-footer">
            <div className="data-badge">PUBLIC DATA FIRST</div>
            <p>Rainfall + antecedent wetness + terrain + historical evidence + optional IoT.</p>
          </div>
        </aside>

        <section className="map-area">
          <RiskMap
            state={state}
            district={district}
            villages={villages}
            selectedVillage={selectedVillage}
            regionalScore={summary.score}
            regionalRisk={summary.risk}
            visibleLayers={visibleLayers}
            onSelectVillage={selectVillage}
            onRefresh={refreshSnapshot}
            refreshing={refreshing}
          />
        </section>

        <aside className="right-panel">
          <div className="panel-header">
            <div>
              <div className="eyebrow">CURRENT CONDITIONS</div>
              <h2>Risk Summary</h2>
            </div>
            <div className={`risk-badge ${summary.risk.toLowerCase()}`}>{summary.risk}</div>
          </div>

          <div className="score-card">
            <div>
              <div className="small-label">REGIONAL RISK SCORE</div>
              <div className="score">{summary.score}</div>
              <div className="score-caption">out of 100</div>
            </div>
            <div className="gauge" role="meter" aria-label="Regional risk score" aria-valuemin="0" aria-valuemax="100" aria-valuenow={summary.score}>
              <div
                className="gauge-fill"
                style={{ width: `${summary.score}%`, background: riskColor(summary.score) }}
              />
            </div>
          </div>

          <div className="metric-grid">
            <MetricCard symbol="☔" name="Rainfall" value={summary.rainfall} detail="last 3 hours" />
            <MetricCard symbol="◉" name="Soil Moisture" value={summary.soil} detail="antecedent wetness" />
            <MetricCard symbol="⌁" name="Slope" value="31°" detail="terrain average" />
            <MetricCard symbol="↘" name="Stream Response" value="Rising" detail="catchment response" />
          </div>

          <div className="panel-section">
            <div className="section-heading">VILLAGE PRIORITIES</div>
            <div className="village-list">
              {sortedVillages.map((village) => (
                <button
                  className="village-item"
                  type="button"
                  key={village.id}
                  onClick={() => selectVillage(village)}
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
              <p>Public warnings are issued from the separate Administrator page.</p>
            </div>
          </div>
        </aside>
      </main>

      <VillageModal village={selectedVillage} onClose={() => setSelectedVillageId(null)} />
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
