import { useEffect, useRef, useState } from "react";

import {
  DISTRICT_MAP_VIEWS,
  INDIA_LAYER_LEVELS,
  INDIA_MAP_BOUNDS,
  INDIA_THEMATIC_ZONES,
  MAP_LAYERS,
  REGION_CENTER,
  STATE_MAP_VIEWS,
  riskColor,
} from "../data";

const GOOGLE_MAPS_SCRIPT_ID = "google-maps-javascript-api";
const GOOGLE_MAPS_CALLBACK = "__flashGuardGoogleMapsReady";
let googleMapsPromise;

function createContinuousHeatOverlay(maps, points) {
  class ContinuousHeatOverlay extends maps.OverlayView {
    constructor() {
      super();
      this.points = points;
      this.canvas = null;
    }

    onAdd() {
      this.canvas = document.createElement("canvas");
      this.canvas.className = "continuous-heat-overlay";
      this.getPanes().overlayLayer.appendChild(this.canvas);
    }

    draw() {
      if (!this.canvas) return;
      const projection = this.getProjection();
      const bounds = this.getMap()?.getBounds();
      if (!projection || !bounds) return;

      const northEast = projection.fromLatLngToDivPixel(bounds.getNorthEast());
      const southWest = projection.fromLatLngToDivPixel(bounds.getSouthWest());
      const width = Math.max(1, Math.ceil(northEast.x - southWest.x));
      const height = Math.max(1, Math.ceil(southWest.y - northEast.y));
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

      this.canvas.style.left = `${southWest.x}px`;
      this.canvas.style.top = `${northEast.y}px`;
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;
      this.canvas.width = Math.ceil(width * pixelRatio);
      this.canvas.height = Math.ceil(height * pixelRatio);

      const context = this.canvas.getContext("2d");
      context.scale(pixelRatio, pixelRatio);
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = "source-over";

      this.points.forEach((point) => {
        const pixel = projection.fromLatLngToDivPixel(new maps.LatLng(point.lat, point.lng));
        const x = pixel.x - southWest.x;
        const y = pixel.y - northEast.y;
        const radius = Math.max(20, Math.min(65, width / 14));
        const hue = 120 - point.weight * 120;
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `hsla(${hue}, 88%, 48%, 0.8)`);
        gradient.addColorStop(0.5, `hsla(${hue}, 88%, 48%, 0.42)`);
        gradient.addColorStop(1, `hsla(${hue}, 88%, 48%, 0)`);
        context.fillStyle = gradient;
        context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
      });
    }

    onRemove() {
      this.canvas?.remove();
      this.canvas = null;
    }
  }

  return new ContinuousHeatOverlay();
}

const OVERLAY_NAMES = ["thematic", "streams", "catchments", "villages"];

const GRID_STEP = 0.6;

function pointInPolygon([lat, lng], polygon) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const [latA, lngA] = polygon[index];
    const [latB, lngB] = polygon[previous];
    const intersects = ((lngA > lng) !== (lngB > lng)) &&
      (lat < ((latB - latA) * (lng - lngA)) / (lngB - lngA) + latA);
    if (intersects) inside = !inside;
  }
  return inside;
}

function seededNoise(lat, lng, layerIndex) {
  const value = Math.sin(lat * 91.71 + lng * 47.13 + layerIndex * 131.9) * 43758.5453;
  return value - Math.floor(value);
}

function buildHeatPoints(activeLayer, coveragePolygon) {
  const levels = INDIA_LAYER_LEVELS[activeLayer] ?? INDIA_LAYER_LEVELS.risk;
  const layerIndex = Math.max(0, MAP_LAYERS.findIndex((item) => item.id === activeLayer));
  const rank = { low: 1, moderate: 2, high: 3 };
  const points = [];

  INDIA_THEMATIC_ZONES.forEach((zone, zoneIndex) => {
    const lats = zone.poly.map(([lat]) => lat);
    const lngs = zone.poly.map(([, lng]) => lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const baseline = rank[levels[zoneIndex]] ?? 2;

    for (let lat = minLat; lat < maxLat; lat += GRID_STEP) {
      for (let lng = minLng; lng < maxLng; lng += GRID_STEP) {
        const center = [lat + GRID_STEP / 2, lng + GRID_STEP / 2];
        if (!pointInPolygon(center, zone.poly)) continue;
        if (coveragePolygon && !pointInPolygon(center, coveragePolygon)) continue;
        const noise = seededNoise(center[0], center[1], layerIndex);
        const variation = noise < 0.16 ? -1 : noise > 0.71 ? 1 : 0;
        const score = Math.max(0, Math.min(4, baseline + variation));
        points.push({ lat: center[0], lng: center[1], weight: 0.2 + score * 0.25 });
      }
    }
  });
  return points;
}


function districtCoverage(villages, catchments, district) {
  const points = [
    ...villages.map((village) => [Number(village.lat), Number(village.lon)]),
    ...catchments.map((catchment) => [Number(catchment.centroid_lat), Number(catchment.centroid_lon)]),
  ].filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng));
  if (points.length === 0) {
    const view = DISTRICT_MAP_VIEWS[district];
    if (!view) return null;
    return [
      [view.center[0] + view.latRadius, view.center[1] - view.lngRadius],
      [view.center[0] + view.latRadius, view.center[1] + view.lngRadius],
      [view.center[0] - view.latRadius, view.center[1] + view.lngRadius],
      [view.center[0] - view.latRadius, view.center[1] - view.lngRadius],
    ];
  }

  const lats = points.map(([lat]) => lat);
  const lngs = points.map(([, lng]) => lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latPadding = Math.max(0.18, (maxLat - minLat) * 0.55);
  const lngPadding = Math.max(0.18, (maxLng - minLng) * 0.55);

  return [
    [maxLat + latPadding, minLng - lngPadding],
    [maxLat + latPadding, maxLng + lngPadding],
    [minLat - latPadding, maxLng + lngPadding],
    [minLat - latPadding, minLng - lngPadding],
  ];
}

function loadGoogleMaps(apiKey) {
  if (typeof window.google?.maps?.Map === "function") {
    return Promise.resolve(window.google.maps);
  }
  if (!apiKey) return Promise.reject(new Error("Set VITE_GOOGLE_MAPS_API_KEY to display Google Maps."));
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    window[GOOGLE_MAPS_CALLBACK] = () => {
      delete window[GOOGLE_MAPS_CALLBACK];
      if (typeof window.google?.maps?.Map === "function") resolve(window.google.maps);
      else reject(new Error("Google Maps initialized without the required map API."));
    };

    let script = document.getElementById(GOOGLE_MAPS_SCRIPT_ID);
    if (!script) {
      script = document.createElement("script");
      script.id = GOOGLE_MAPS_SCRIPT_ID;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${GOOGLE_MAPS_CALLBACK}`;
      script.async = true;
      document.head.appendChild(script);
    }
    script.onerror = () => {
      delete window[GOOGLE_MAPS_CALLBACK];
      googleMapsPromise = undefined;
      reject(new Error("Google Maps could not be loaded."));
    };
  });
  return googleMapsPromise;
}

function toLatLng([lat, lng]) {
  return { lat: Number(lat), lng: Number(lng) };
}

function createInfoWindow(maps, map, overlay, content) {
  const infoWindow = new maps.InfoWindow({ content });
  overlay.addListener("mouseover", (event) => {
    infoWindow.setPosition(event.latLng);
    infoWindow.open({ map });
  });
  overlay.addListener("mouseout", () => infoWindow.close());
  return infoWindow;
}

function clearGroup(group) {
  group.forEach(({ overlay, infoWindow }) => {
    infoWindow?.close();
    overlay.setMap(null);
  });
  group.length = 0;
}

function setGroupMap(group, map) {
  group.forEach(({ overlay }) => overlay.setMap(map));
}

export default function RiskMap({
  state,
  district,
  villages,
  catchments,
  selectedVillage,
  regionalScore,
  visibleLayers,
  activeLayer,
  onSelectVillage,
  onRefresh,
  refreshing,
  backendOnline,
  periodLabel,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const mapsRef = useRef(null);
  const groupsRef = useRef(Object.fromEntries(OVERLAY_NAMES.map((name) => [name, []])));
  const selectVillageRef = useRef(onSelectVillage);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState("");
  const layer = MAP_LAYERS.find((item) => item.id === activeLayer) ?? MAP_LAYERS[0];

  useEffect(() => { selectVillageRef.current = onSelectVillage; }, [onSelectVillage]);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(import.meta.env.VITE_GOOGLE_MAPS_API_KEY)
      .then((maps) => {
        if (cancelled || !containerRef.current) return;
        const map = new maps.Map(containerRef.current, {
          center: toLatLng(REGION_CENTER),
          zoom: 5,
          mapTypeControl: true,
          fullscreenControl: true,
          streetViewControl: false,
          styles: [
            { elementType: "geometry", stylers: [{ color: "#17211d" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#9daaa4" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#17211d" }] },
            { featureType: "road", elementType: "geometry", stylers: [{ color: "#38443f" }] },
            { featureType: "water", elementType: "geometry", stylers: [{ color: "#102d38" }] },
          ],
        });
        mapsRef.current = maps;
        mapRef.current = map;
        groupsRef.current = Object.fromEntries(OVERLAY_NAMES.map((name) => [name, []]));
        setReady(true);
      })
      .catch((error) => { if (!cancelled) setMapError(error.message); });
    return () => {
      cancelled = true;
      Object.values(groupsRef.current).forEach(clearGroup);
      mapRef.current = null;
      mapsRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || district !== "Select a district") return;
    const stateView = STATE_MAP_VIEWS[state];
    if (stateView) {
      mapRef.current.panTo(toLatLng(stateView.center));
      mapRef.current.setZoom(stateView.zoom);
    }
  }, [district, ready, state]);

  useEffect(() => {
    if (!ready) return;
    const maps = mapsRef.current;
    const map = mapRef.current;
    const group = groupsRef.current.thematic;
    clearGroup(group);
    if (!district || district === "Select a district") return;
    const coverage = districtCoverage(villages, catchments, district);
    if (!coverage) return;
    try {
      setMapError("");
      const heatmap = createContinuousHeatOverlay(maps, buildHeatPoints(activeLayer, coverage));
      heatmap.setMap(map);
      group.push({ overlay: heatmap });

      const boundary = new maps.Polygon({
        paths: coverage.map(toLatLng),
        strokeColor: "#f8fafc",
        strokeOpacity: 0.9,
        strokeWeight: 2,
        fillColor: "#22c55e",
        fillOpacity: 0.04,
        map,
      });
      group.push({ overlay: boundary });

      const bounds = new maps.LatLngBounds();
      coverage.forEach((point) => bounds.extend(toLatLng(point)));
      map.fitBounds(bounds, 45);
    } catch (error) {
      setMapError(error?.message || "The continuous heatmap could not be rendered.");
    }
  }, [activeLayer, catchments, district, layer.label, ready, villages]);

  useEffect(() => {
    if (!ready) return;
    const maps = mapsRef.current;
    const map = mapRef.current;
    clearGroup(groupsRef.current.catchments);
    catchments.forEach((catchment) => {
      const marker = new maps.Circle({
        center: { lat: Number(catchment.centroid_lat), lng: Number(catchment.centroid_lon) },
        radius: 300,
        strokeColor: "#a78bfa",
        strokeWeight: 2,
        fillColor: "#7c3aed",
        fillOpacity: 0.25,
        map: visibleLayers.catchments ? map : null,
      });
      groupsRef.current.catchments.push({ overlay: marker });
    });
  }, [catchments, ready, visibleLayers.catchments]);

  useEffect(() => {
    if (!ready) return;
    const maps = mapsRef.current;
    const map = mapRef.current;
    clearGroup(groupsRef.current.streams);
    const stream = new maps.Polyline({
      path: [[30.77, 79.03], [30.7, 79.04], [30.63, 79.02], [30.56, 79.01], [30.49, 78.99], [30.41, 79.0]].map(toLatLng),
      strokeColor: "#38bdf8",
      strokeWeight: 4,
      strokeOpacity: 0.8,
      map: visibleLayers.streams ? map : null,
    });
    groupsRef.current.streams.push({ overlay: stream });
  }, [ready, visibleLayers.streams]);

  useEffect(() => {
    if (!ready) return;
    const maps = mapsRef.current;
    const map = mapRef.current;
    clearGroup(groupsRef.current.villages);
    villages.forEach((village) => {
      const marker = new maps.Circle({
        center: { lat: Number(village.lat), lng: Number(village.lon) },
        radius: 240,
        strokeColor: "#ffffff",
        strokeWeight: 2,
        fillColor: riskColor(village.score),
        fillOpacity: 0.95,
        map: visibleLayers.villages ? map : null,
      });
      marker.addListener("click", () => selectVillageRef.current(village));
      groupsRef.current.villages.push({
        overlay: marker,
        infoWindow: createInfoWindow(maps, map, marker, `${village.name} · ${village.risk} · ${village.score}/100`),
      });
    });
  }, [ready, villages, visibleLayers.villages]);

  useEffect(() => {
    if (!ready) return;
    setGroupMap(groupsRef.current.streams, visibleLayers.streams ? mapRef.current : null);
    setGroupMap(groupsRef.current.catchments, visibleLayers.catchments ? mapRef.current : null);
    setGroupMap(groupsRef.current.villages, visibleLayers.villages ? mapRef.current : null);
  }, [ready, visibleLayers]);

  useEffect(() => {
    if (!ready || !selectedVillage) return;
    mapRef.current.panTo({ lat: Number(selectedVillage.lat), lng: Number(selectedVillage.lon) });
    mapRef.current.setZoom(12);
  }, [ready, selectedVillage]);

  function fitRegion() {
    if (!ready) return;
    const coverage = district !== "Select a district"
      ? districtCoverage(villages, catchments, district)
      : null;
    const bounds = coverage
      ? new mapsRef.current.LatLngBounds()
      : new mapsRef.current.LatLngBounds(
          { lat: INDIA_MAP_BOUNDS.south, lng: INDIA_MAP_BOUNDS.west },
          { lat: INDIA_MAP_BOUNDS.north, lng: INDIA_MAP_BOUNDS.east },
        );
    coverage?.forEach((point) => bounds.extend(toLatLng(point)));
    mapRef.current.fitBounds(bounds, coverage ? 45 : 35);
  }

  function locateUser() {
    if (!ready || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      mapRef.current?.setCenter({ lat: coords.latitude, lng: coords.longitude });
      mapRef.current?.setZoom(12);
    });
  }

  return (
    <>
      <div id="map" ref={containerRef} aria-label={`Google Map showing ${layer.label}`}>
        {mapError && <div className="map-error">{mapError}</div>}
      </div>
      <div className="map-toolbar">
        <button className="tool-btn active" type="button" onClick={fitRegion} disabled={!ready}>⌖ Fit Region</button>
        <button className="tool-btn" type="button" onClick={locateUser} disabled={!ready}>◎ My Location</button>
        <button className="tool-btn" type="button" onClick={onRefresh} disabled={refreshing}>↻ {refreshing ? "Refreshing…" : "Refresh"}</button>
      </div>

      <div className="map-insight-card google-map-legend">
        <span className="insight-kicker"><span className="update-pulse" /> MAP UPDATED</span>
        <strong>{layer.label} layer</strong>
        <div className="insight-row"><span className="mini-swatch very-high" />Very high <b>{layer.high}</b></div>
        <div className="insight-row"><span className="mini-swatch high" />High</div>
        <div className="insight-row"><span className="mini-swatch moderate" />Moderate <b>{layer.moderate}</b></div>
        <div className="insight-row"><span className="mini-swatch low" />Low</div>
        <div className="insight-row"><span className="mini-swatch very-low" />Very low <b>{layer.low}</b></div>
      </div>
      <div className={`map-scale-note ${backendOnline ? "" : "offline"}`}>
        <span className="pulse" /> {backendOnline ? "Google Maps assessment loaded" : "Backend unavailable"}
      </div>
    </>
  );
}
