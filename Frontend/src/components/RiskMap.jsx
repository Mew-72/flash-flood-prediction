import { useEffect, useRef, useState } from "react";
import L from "leaflet";

import { getWeatherTileUrl } from "../api";
import { REGION_CENTER, riskColor } from "../data";

const VILLAGE_ZOOM = 11;
const BOUNDARY_ZOOM = 14;

function hasCoordinates(record) {
  return Number.isFinite(Number(record?.lat)) && Number.isFinite(Number(record?.lon));
}

function textElement(tagName, text, className) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text == null || text === "" ? "—" : String(text);
  return element;
}

function createPopup(title, rows, action) {
  const popup = document.createElement("div");
  popup.className = "map-popup";
  popup.appendChild(textElement("h3", title));

  const list = document.createElement("dl");
  rows.forEach(([label, value]) => {
    list.appendChild(textElement("dt", label));
    list.appendChild(textElement("dd", value));
  });
  popup.appendChild(list);

  if (action) {
    const button = textElement("button", action.label, "map-popup-action");
    button.type = "button";
    button.addEventListener("click", action.onClick);
    popup.appendChild(button);
  }

  L.DomEvent.disableClickPropagation(popup);
  return popup;
}

function createTooltip(text) {
  return textElement("span", text);
}

function formatDateTime(value) {
  if (!value) return "Unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

function geometryFrom(record) {
  const candidate = record?.geometry
    ?? record?.boundary
    ?? record?.geojson
    ?? record?.geometry_geojson
    ?? record?.boundary_geojson
    ?? record?.polygon;
  if (!candidate) return null;
  if (typeof candidate !== "string") return candidate;
  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}

function districtAggregates(villages) {
  const districts = new Map();
  villages.filter(hasCoordinates).forEach((village) => {
    const name = village.district || "District unavailable";
    const current = districts.get(name) ?? { name, villages: [] };
    current.villages.push(village);
    districts.set(name, current);
  });

  return [...districts.values()].map((aggregate) => {
    const assessed = aggregate.villages.filter((village) => village.snapshot);
    const peak = assessed.reduce(
      (current, village) => (!current || village.score > current.score ? village : current),
      null,
    );
    const average = assessed.length
      ? Math.round(assessed.reduce((total, village) => total + village.score, 0) / assessed.length)
      : null;
    const lat = aggregate.villages.reduce((total, village) => total + Number(village.lat), 0)
      / aggregate.villages.length;
    const lon = aggregate.villages.reduce((total, village) => total + Number(village.lon), 0)
      / aggregate.villages.length;

    return { ...aggregate, assessed, peak, average, lat, lon };
  });
}

function districtWeatherSummary(aggregate) {
  const weather = aggregate.peak?.weather;
  if (!weather) return "OpenWeather conditions unavailable";
  return [
    weather.weatherCondition,
    weather.temperature,
    weather.humidity ? `${weather.humidity} humidity` : null,
    weather.wind ? `wind ${weather.wind}` : null,
  ].filter(Boolean).join(" · ") || "OpenWeather conditions unavailable";
}

function districtIcon(score, riskLevel) {
  const wrapper = document.createElement("div");
  wrapper.className = "district-marker";
  wrapper.style.setProperty("--marker-color", riskColor(score ?? 0));
  wrapper.appendChild(textElement("span", riskLevel || "N/A"));
  return L.divIcon({
    html: wrapper,
    className: "district-marker-wrapper",
    iconSize: [64, 64],
    iconAnchor: [32, 32],
  });
}

function setLayerVisibility(map, layer, visible) {
  if (visible && !map.hasLayer(layer)) layer.addTo(map);
  if (!visible && map.hasLayer(layer)) map.removeLayer(layer);
}

export default function RiskMap({
  state,
  district,
  villages,
  catchments,
  villageBoundaries,
  selectedVillage,
  visibleLayers,
  onSelectVillage,
  onRefresh,
  refreshing,
  backendOnline,
  weatherReady,
  periodLabel,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({});
  const selectVillageRef = useRef(onSelectVillage);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(10);

  useEffect(() => {
    selectVillageRef.current = onSelectVillage;
  }, [onSelectVillage]);

  useEffect(() => {
    const map = L.map(containerRef.current, { zoomControl: false }).setView(REGION_CENTER, 10);
    L.control.zoom({ position: "bottomright" }).addTo(map);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap contributors",
      zIndex: 100,
    }).addTo(map);

    const layers = {
      districts: L.layerGroup(),
      risk: L.layerGroup(),
      catchments: L.layerGroup(),
      villages: L.layerGroup(),
      boundaries: L.layerGroup(),
      precipitation: L.tileLayer(getWeatherTileUrl("precipitation_new"), {
        maxZoom: 19,
        opacity: 0.7,
        zIndex: 220,
        attribution: "Weather via backend · OpenWeather",
      }),
      clouds: L.tileLayer(getWeatherTileUrl("clouds_new"), {
        maxZoom: 19,
        opacity: 0.5,
        zIndex: 210,
        attribution: "Weather via backend · OpenWeather",
      }),
    };

    const updateZoom = () => setZoom(map.getZoom());
    map.on("zoomend", updateZoom);
    mapRef.current = map;
    layersRef.current = layers;
    setZoom(map.getZoom());
    setReady(true);

    return () => {
      setReady(false);
      map.off("zoomend", updateZoom);
      map.remove();
      mapRef.current = null;
      layersRef.current = {};
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const districtGroup = layersRef.current.districts;
    districtGroup.clearLayers();

    districtAggregates(villages).forEach((aggregate) => {
      const peakScore = aggregate.peak?.score;
      L.marker([aggregate.lat, aggregate.lon], {
        icon: districtIcon(peakScore, aggregate.peak?.risk),
        keyboard: true,
        title: `${aggregate.name} district risk summary`,
      })
        .bindPopup(createPopup(aggregate.name, [
          ["Villages", aggregate.villages.length],
          ["Peak risk", peakScore == null ? "Unavailable" : `${peakScore}/100 · ${aggregate.peak.risk}`],
          ["Average risk", aggregate.average == null ? "Unavailable" : `${aggregate.average}/100`],
          ["Assessment", aggregate.peak?.snapshot?.assessment_mode === "provisional_defaults" ? "Provisional defaults + live weather" : "Canonical risk inputs"],
          ["Weather", districtWeatherSummary(aggregate)],
        ]), { maxWidth: 320 })
        .addTo(districtGroup);
    });
  }, [ready, villages]);

  useEffect(() => {
    if (!ready) return;
    const catchmentGroup = layersRef.current.catchments;
    catchmentGroup.clearLayers();

    catchments.forEach((catchment) => {
      const geometry = geometryFrom(catchment);
      const popup = createPopup(catchment.name || catchment.id || "Catchment", [
        ["District", catchment.district],
        ["Area", Number.isFinite(Number(catchment.area_km2)) ? `${Number(catchment.area_km2).toFixed(1)} km²` : "Unavailable"],
        ["Land use", catchment.land_use],
      ]);

      if (geometry) {
        L.geoJSON(geometry, {
          style: {
            color: "#7c3aed",
            weight: 2,
            fillColor: "#a78bfa",
            fillOpacity: 0.08,
          },
        }).bindPopup(popup).addTo(catchmentGroup);
      } else if (
        Number.isFinite(Number(catchment.centroid_lat))
        && Number.isFinite(Number(catchment.centroid_lon))
      ) {
        L.circleMarker([Number(catchment.centroid_lat), Number(catchment.centroid_lon)], {
          radius: 9,
          color: "#7c3aed",
          weight: 2,
          fillColor: "#a78bfa",
          fillOpacity: 0.25,
        }).bindPopup(popup).addTo(catchmentGroup);
      }
    });
  }, [catchments, ready]);

  useEffect(() => {
    if (!ready) return;
    const riskGroup = layersRef.current.risk;
    const villageGroup = layersRef.current.villages;
    const boundaryGroup = layersRef.current.boundaries;
    const villagesById = new Map(villages.map((village) => [String(village.id), village]));
    const villagesByName = new Map(
      villages.map((village) => [String(village.name).trim().toLowerCase(), village]),
    );

    riskGroup.clearLayers();
    villageGroup.clearLayers();
    boundaryGroup.clearLayers();

    villages.filter(hasCoordinates).forEach((village) => {
      if (village.snapshot) {
        L.circleMarker([Number(village.lat), Number(village.lon)], {
          radius: 11 + Math.round(village.score / 20),
          stroke: false,
          fillColor: riskColor(village.score),
          fillOpacity: 0.2,
          interactive: false,
        }).addTo(riskGroup);
      }

      const marker = L.circleMarker([Number(village.lat), Number(village.lon)], {
        radius: 7,
        color: "#ffffff",
        weight: 2,
        fillColor: village.snapshot ? riskColor(village.score) : "#64748b",
        fillOpacity: 0.95,
        keyboard: true,
      });
      marker.bindTooltip(createTooltip(`${village.name} · ${village.snapshot ? `${village.risk} · ${village.score}/100` : "risk unavailable"}`));
      marker.bindPopup(createPopup(village.name, [
        ["District", village.district],
        ["Risk", village.snapshot ? `${village.score}/100 · ${village.risk}` : "Unavailable"],
        ["Assessment", village.snapshot?.assessment_mode === "provisional_defaults" ? `Provisional · ${village.assessmentScope}` : "Canonical risk inputs"],
        ["Rain", village.weather?.rainfall],
        ["Temperature", village.weather?.temperature],
        ["Humidity / wind", [village.weather?.humidity, village.weather?.wind].filter(Boolean).join(" · ") || "Unavailable"],
        ["Valid time", formatDateTime(village.snapshot?.valid_at)],
      ], {
        label: "Open full village details",
        onClick: () => selectVillageRef.current(village),
      }), { maxWidth: 310 });
      marker.addTo(villageGroup);
    });

    villageBoundaries.forEach((boundary) => {
      const geometry = geometryFrom(boundary);
      if (!geometry) return;
      const villageId = boundary.village_id ?? boundary.id;
      const matchedVillage = villagesById.get(String(villageId))
        ?? villagesByName.get(String(boundary.name ?? "").trim().toLowerCase());
      const color = matchedVillage?.snapshot ? riskColor(matchedVillage.score) : "#475569";
      const layer = L.geoJSON(geometry, {
        style: {
          color,
          weight: matchedVillage?.snapshot ? 2 : 1,
          fillColor: color,
          fillOpacity: visibleLayers.risk && matchedVillage?.snapshot ? 0.13 : 0.03,
        },
      });
      layer.bindTooltip(createTooltip(`${boundary.name || matchedVillage?.name || "Village boundary"}${matchedVillage?.snapshot ? ` · ${matchedVillage.risk} ${matchedVillage.score}/100` : ""}`));
      if (matchedVillage) {
        layer.on("click", () => selectVillageRef.current(matchedVillage));
      }
      layer.addTo(boundaryGroup);
    });
  }, [ready, villageBoundaries, villages, visibleLayers.risk]);

  useEffect(() => {
    if (!ready) return;
    const map = mapRef.current;
    const layers = layersRef.current;
    const isDistrictView = zoom < VILLAGE_ZOOM;

    setLayerVisibility(map, layers.districts, isDistrictView && (visibleLayers.villages || visibleLayers.risk));
    setLayerVisibility(map, layers.risk, !isDistrictView && visibleLayers.risk);
    setLayerVisibility(map, layers.villages, !isDistrictView && visibleLayers.villages);
    setLayerVisibility(map, layers.boundaries, zoom >= BOUNDARY_ZOOM && visibleLayers.villages);
    setLayerVisibility(map, layers.catchments, visibleLayers.catchments);
    setLayerVisibility(
      map,
      layers.precipitation,
      weatherReady && visibleLayers.precipitation,
    );
    setLayerVisibility(map, layers.clouds, weatherReady && visibleLayers.clouds);
  }, [ready, visibleLayers, weatherReady, zoom]);

  useEffect(() => {
    if (!ready || !selectedVillage || !hasCoordinates(selectedVillage)) return;
    mapRef.current.flyTo(
      [Number(selectedVillage.lat), Number(selectedVillage.lon)],
      BOUNDARY_ZOOM,
      { duration: 0.8 },
    );
  }, [ready, selectedVillage]);

  function fitRegion() {
    const bounds = L.latLngBounds([]);
    villages.filter(hasCoordinates).forEach((village) => bounds.extend([village.lat, village.lon]));
    catchments.forEach((catchment) => {
      const geometry = geometryFrom(catchment);
      if (geometry) bounds.extend(L.geoJSON(geometry).getBounds());
      else if (Number.isFinite(Number(catchment.centroid_lat)) && Number.isFinite(Number(catchment.centroid_lon))) {
        bounds.extend([catchment.centroid_lat, catchment.centroid_lon]);
      }
    });
    villageBoundaries.forEach((boundary) => {
      const geometry = geometryFrom(boundary);
      if (geometry) bounds.extend(L.geoJSON(geometry).getBounds());
    });

    if (bounds.isValid()) mapRef.current?.fitBounds(bounds, { padding: [35, 35], maxZoom: 12 });
    else mapRef.current?.setView(REGION_CENTER, 10);
  }

  function locateUser() {
    mapRef.current?.locate({ setView: true, maxZoom: 12 });
  }

  const liveStatus = !backendOnline
    ? "Backend unavailable"
    : weatherReady
      ? "Live OpenWeather via backend · refreshes every 5 min"
      : "Risk loaded · live weather tiles disabled";

  return (
    <>
      <div id="map" ref={containerRef} aria-label="Interactive live weather and flood risk map" />

      <div className="map-toolbar">
        <button className="tool-btn active" type="button" onClick={fitRegion}>Fit region</button>
        <button className="tool-btn" type="button" onClick={locateUser}>My location</button>
        <button className="tool-btn" type="button" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh data"}
        </button>
      </div>

      <div className="map-title-card">
        <div className="eyebrow">{periodLabel?.toUpperCase()} RISK OVERVIEW</div>
        <h1>{district}, {state}</h1>
        <p>Zoom in for villages at level 11 and verified boundaries at level 14.</p>
      </div>

      <div className={`map-scale-note ${backendOnline && weatherReady ? "" : "offline"}`} role="status">
        <span className="pulse" /> {liveStatus}
      </div>

      <span className="sr-only" aria-live="polite">
        {zoom < VILLAGE_ZOOM
          ? "District aggregate markers are visible. Zoom in to level 11 for villages."
          : zoom < BOUNDARY_ZOOM
            ? "Village markers are visible. Zoom in to level 14 for boundaries."
            : "Village markers and available backend boundaries are visible."}
      </span>
    </>
  );
}
