import { useEffect, useRef, useState } from "react";
import L from "leaflet";

import { DEFAULT_RISK_ZONES, REGION_CENTER, riskColor } from "../data";

function addStaticOverlays(groups) {
  L.polyline(
    [
      [30.77, 79.03],
      [30.70, 79.04],
      [30.63, 79.02],
      [30.56, 79.01],
      [30.49, 78.99],
      [30.41, 79.00],
    ],
    { color: "#0284c7", weight: 4, opacity: 0.75 },
  ).addTo(groups.streams);


  [
    { lat: 30.69, lon: 79.06, radius: 19000, value: "90+ mm" },
    { lat: 30.55, lon: 79.02, radius: 15000, value: "70–90 mm" },
    { lat: 30.45, lon: 79.01, radius: 12000, value: "50–70 mm" },
  ].forEach((zone) => {
    L.circle([zone.lat, zone.lon], {
      radius: zone.radius,
      color: "#2563eb",
      fillColor: "#60a5fa",
      fillOpacity: 0.12,
      weight: 1,
    })
      .bindTooltip(`Rainfall zone: ${zone.value}`)
      .addTo(groups.rainfall);
  });

  L.polygon(
    [[30.72, 79.01], [30.75, 79.11], [30.60, 79.10], [30.58, 79.02]],
    {
      color: "#f59e0b",
      fillColor: "#f59e0b",
      fillOpacity: 0.12,
      weight: 1,
    },
  )
    .bindTooltip("Steep-slope indicator")
    .addTo(groups.slope);

  [
    { lat: 30.71, lon: 79.05, radius: 16000, value: "High Saturation (85–90%)" },
    { lat: 30.52, lon: 79.03, radius: 14000, value: "Moderate Wetness (70–80%)" },
  ].forEach((zone) => {
    L.circle([zone.lat, zone.lon], {
      radius: zone.radius,
      color: "#059669",
      fillColor: "#10b981",
      fillOpacity: 0.16,
      weight: 1.5,
    })
      .bindTooltip(`Soil Moisture: ${zone.value}`)
      .addTo(groups.soil);
  });

  [
    [[30.78, 78.95], [30.78, 79.15], [30.70, 79.12], [30.70, 78.98]],
    [[30.70, 78.98], [30.70, 79.12], [30.58, 79.10], [30.58, 78.96]],
  ].forEach((band, index) => {
    L.polygon(band, {
      color: "#8b5cf6",
      fillColor: "#8b5cf6",
      fillOpacity: 0.08 + index * 0.06,
      weight: 1,
    })
      .bindTooltip(`Elevation Band: >${3000 - index * 1000}m ASL`)
      .addTo(groups.elevation);
  });
}

export default function RiskMap({
  state,
  district,
  villages,
  catchments,
  selectedVillage,
  regionalScore,
  regionalRisk,
  visibleLayers,
  onSelectVillage,
  onRefresh,
  refreshing,
  backendOnline,
  periodLabel,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const groupsRef = useRef({});
  const selectVillageRef = useRef(onSelectVillage);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    selectVillageRef.current = onSelectVillage;
  }, [onSelectVillage]);

  useEffect(() => {
    const map = L.map(containerRef.current, { zoomControl: false }).setView(
      REGION_CENTER,
      10,
    );
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
    }).addTo(map);

    const groups = Object.fromEntries(
      ["risk", "rainfall", "soil", "slope", "elevation", "streams", "catchments", "villages"]
        .map((name) => [name, L.layerGroup()]),
    );
    addStaticOverlays(groups);

    mapRef.current = map;
    groupsRef.current = groups;
    setReady(true);

    return () => {
      setReady(false);
      map.remove();
      mapRef.current = null;
      groupsRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!ready) return;

    const catchmentGroup = groupsRef.current.catchments;
    catchmentGroup.clearLayers();
    catchments.forEach((catchment) => {
      L.circleMarker([catchment.centroid_lat, catchment.centroid_lon], {
        radius: 12,
        color: "#7c3aed",
        weight: 2,
        fillColor: "#a78bfa",
        fillOpacity: 0.18,
      })
        .bindTooltip(
          `${catchment.name} · ${catchment.area_km2} km² · ${catchment.land_use}`,
        )
        .addTo(catchmentGroup);
    });
  }, [catchments, ready]);

  useEffect(() => {
    if (!ready) return;

    const riskGroup = groupsRef.current.risk;
    const villageGroup = groupsRef.current.villages;
    const color = riskColor(regionalScore);

    riskGroup.clearLayers();
    DEFAULT_RISK_ZONES.forEach((zone) => {
      L.polygon(zone.poly, {
        color,
        weight: 2,
        dashArray: "4, 4",
        fillColor: color,
        fillOpacity: 0.22,
      })
        .bindTooltip(
          `Flood Risk Zone: ${zone.name} · ${regionalRisk} (${regionalScore}/100)`,
        )
        .addTo(riskGroup);
    });

    villageGroup.clearLayers();
    villages.forEach((village) => {
      L.circleMarker([village.lat, village.lon], {
        radius: 8,
        color: "#fff",
        weight: 2,
        fillColor: riskColor(village.score),
        fillOpacity: 0.9,
      })
        .bindTooltip(`${village.name} · ${village.risk} · ${village.score}/100`)
        .on("click", () => selectVillageRef.current(village))
        .addTo(villageGroup);
    });
  }, [ready, regionalRisk, regionalScore, villages]);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;

    Object.entries(groupsRef.current).forEach(([name, group]) => {
      const shouldShow = Boolean(visibleLayers[name]);
      if (shouldShow && !map.hasLayer(group)) group.addTo(map);
      if (!shouldShow && map.hasLayer(group)) map.removeLayer(group);
    });
  }, [ready, visibleLayers]);

  useEffect(() => {
    if (!ready || !selectedVillage) return;
    mapRef.current.flyTo(
      [selectedVillage.lat, selectedVillage.lon],
      12,
      { duration: 0.8 },
    );
  }, [ready, selectedVillage]);

  function fitRegion() {
    const points = [
      ...villages.map((village) => [village.lat, village.lon]),
      ...catchments.map((catchment) => [catchment.centroid_lat, catchment.centroid_lon]),
    ].filter(([lat, lon]) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lon)));
    if (points.length > 1) {
      mapRef.current?.fitBounds(points, { padding: [35, 35], maxZoom: 12 });
    } else if (points.length === 1) {
      mapRef.current?.setView(points[0], 12);
    } else {
      mapRef.current?.setView(REGION_CENTER, 10);
    }
  }

  function locateUser() {
    mapRef.current?.locate({ setView: true, maxZoom: 12 });
  }

  return (
    <>
      <div id="map" ref={containerRef} aria-label="Interactive flood risk map" />

      <div className="map-toolbar">
        <button className="tool-btn active" type="button" onClick={fitRegion}>
          ⌖ Fit Region
        </button>
        <button className="tool-btn" type="button" onClick={locateUser}>
          ◎ My Location
        </button>
        <button className="tool-btn" type="button" onClick={onRefresh} disabled={refreshing}>
          ↻ {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="map-title-card">
        <div className="eyebrow">{periodLabel?.toUpperCase()} RISK OVERVIEW</div>
        <h1>{district}, {state}</h1>
        <p>Sub-catchment hazard mapped to village-level preparedness.</p>
      </div>

      <div className={`map-scale-note ${backendOnline ? "" : "offline"}`}>
        <span className="pulse" /> {backendOnline ? "Backend assessment loaded" : "Backend unavailable"}
      </div>

      <span className="sr-only" aria-live="polite">
        Select a village from the priority list to focus it on the map.
      </span>
    </>
  );
}
