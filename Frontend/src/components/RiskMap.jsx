import { useEffect, useRef, useState } from "react";

import { DEFAULT_RISK_ZONES, REGION_CENTER, riskColor } from "../data";

const GOOGLE_MAPS_SCRIPT_ID = "google-maps-javascript-api";
const GOOGLE_MAPS_CALLBACK = "__flashGuardGoogleMapsReady";
let googleMapsPromise;

const OVERLAY_NAMES = [
  "risk",
  "rainfall",
  "soil",
  "slope",
  "elevation",
  "streams",
  "catchments",
  "villages",
];

function loadGoogleMaps(apiKey) {
  if (typeof window.google?.maps?.Map === "function") {
    return Promise.resolve(window.google.maps);
  }
  if (!apiKey) {
    return Promise.reject(
      new Error("Set VITE_GOOGLE_MAPS_API_KEY to display Google Maps."),
    );
  }
  if (googleMapsPromise) return googleMapsPromise;

  googleMapsPromise = new Promise((resolve, reject) => {
    window[GOOGLE_MAPS_CALLBACK] = () => {
      delete window[GOOGLE_MAPS_CALLBACK];
      if (typeof window.google?.maps?.Map === "function") {
        resolve(window.google.maps);
      } else {
        googleMapsPromise = undefined;
        reject(new Error("Google Maps initialized without the required map API."));
      }
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

function addOverlay(groups, groupName, overlay, infoWindow) {
  groups[groupName].push({ overlay, infoWindow });
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

function addStaticOverlays(maps, map, groups) {
  const stream = new maps.Polyline({
    path: [
      [30.77, 79.03],
      [30.7, 79.04],
      [30.63, 79.02],
      [30.56, 79.01],
      [30.49, 78.99],
      [30.41, 79.0],
    ].map(toLatLng),
    strokeColor: "#0284c7",
    strokeWeight: 4,
    strokeOpacity: 0.75,
  });
  addOverlay(groups, "streams", stream);

  [
    { lat: 30.69, lng: 79.06, radius: 19000, value: "90+ mm" },
    { lat: 30.55, lng: 79.02, radius: 15000, value: "70–90 mm" },
    { lat: 30.45, lng: 79.01, radius: 12000, value: "50–70 mm" },
  ].forEach((zone) => {
    const circle = new maps.Circle({
      center: { lat: zone.lat, lng: zone.lng },
      radius: zone.radius,
      strokeColor: "#2563eb",
      fillColor: "#60a5fa",
      fillOpacity: 0.12,
      strokeWeight: 1,
    });
    addOverlay(
      groups,
      "rainfall",
      circle,
      createInfoWindow(maps, map, circle, `Rainfall zone: ${zone.value}`),
    );
  });

  const slope = new maps.Polygon({
    paths: [[30.72, 79.01], [30.75, 79.11], [30.6, 79.1], [30.58, 79.02]].map(
      toLatLng,
    ),
    strokeColor: "#f59e0b",
    fillColor: "#f59e0b",
    fillOpacity: 0.12,
    strokeWeight: 1,
  });
  addOverlay(
    groups,
    "slope",
    slope,
    createInfoWindow(maps, map, slope, "Steep-slope indicator"),
  );

  [
    { lat: 30.71, lng: 79.05, radius: 16000, value: "High Saturation (85–90%)" },
    { lat: 30.52, lng: 79.03, radius: 14000, value: "Moderate Wetness (70–80%)" },
  ].forEach((zone) => {
    const circle = new maps.Circle({
      center: { lat: zone.lat, lng: zone.lng },
      radius: zone.radius,
      strokeColor: "#059669",
      fillColor: "#10b981",
      fillOpacity: 0.16,
      strokeWeight: 1.5,
    });
    addOverlay(
      groups,
      "soil",
      circle,
      createInfoWindow(maps, map, circle, `Soil Moisture: ${zone.value}`),
    );
  });

  [
    [[30.78, 78.95], [30.78, 79.15], [30.7, 79.12], [30.7, 78.98]],
    [[30.7, 78.98], [30.7, 79.12], [30.58, 79.1], [30.58, 78.96]],
  ].forEach((band, index) => {
    const polygon = new maps.Polygon({
      paths: band.map(toLatLng),
      strokeColor: "#8b5cf6",
      fillColor: "#8b5cf6",
      fillOpacity: 0.08 + index * 0.06,
      strokeWeight: 1,
    });
    addOverlay(
      groups,
      "elevation",
      polygon,
      createInfoWindow(
        maps,
        map,
        polygon,
        `Elevation Band: >${3000 - index * 1000}m ASL`,
      ),
    );
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
  const mapsRef = useRef(null);
  const groupsRef = useRef(Object.fromEntries(OVERLAY_NAMES.map((name) => [name, []])));
  const visibleLayersRef = useRef(visibleLayers);
  const selectVillageRef = useRef(onSelectVillage);
  const [ready, setReady] = useState(false);
  const [mapError, setMapError] = useState("");

  useEffect(() => {
    selectVillageRef.current = onSelectVillage;
  }, [onSelectVillage]);

  useEffect(() => {
    visibleLayersRef.current = visibleLayers;
  }, [visibleLayers]);

  useEffect(() => {
    let cancelled = false;

    loadGoogleMaps(import.meta.env.VITE_GOOGLE_MAPS_API_KEY)
      .then((maps) => {
        if (cancelled || !containerRef.current) return;

        const map = new maps.Map(containerRef.current, {
          center: toLatLng(REGION_CENTER),
          zoom: 10,
          mapTypeControl: false,
          fullscreenControl: false,
          streetViewControl: false,
        });
        const groups = Object.fromEntries(OVERLAY_NAMES.map((name) => [name, []]));
        addStaticOverlays(maps, map, groups);
        Object.entries(groups).forEach(([name, group]) => {
          setGroupMap(group, visibleLayersRef.current[name] ? map : null);
        });

        mapsRef.current = maps;
        mapRef.current = map;
        groupsRef.current = groups;
        setReady(true);
      })
      .catch((error) => {
        if (!cancelled) setMapError(error.message);
      });

    return () => {
      cancelled = true;
      setReady(false);
      Object.values(groupsRef.current).forEach(clearGroup);
      mapRef.current = null;
      mapsRef.current = null;
      groupsRef.current = Object.fromEntries(OVERLAY_NAMES.map((name) => [name, []]));
    };
  }, []);

  useEffect(() => {
    if (!ready) return;

    const maps = mapsRef.current;
    const map = mapRef.current;
    const group = groupsRef.current.catchments;
    clearGroup(group);
    catchments.forEach((catchment) => {
      const marker = new maps.Circle({
        center: {
          lat: Number(catchment.centroid_lat),
          lng: Number(catchment.centroid_lon),
        },
        radius: 300,
        strokeColor: "#7c3aed",
        strokeWeight: 2,
        fillColor: "#a78bfa",
        fillOpacity: 0.18,
        map: visibleLayers.catchments ? map : null,
      });
      addOverlay(
        groupsRef.current,
        "catchments",
        marker,
        createInfoWindow(
          maps,
          map,
          marker,
          `${catchment.name} · ${catchment.area_km2} km² · ${catchment.land_use}`,
        ),
      );
    });
  }, [catchments, ready, visibleLayers.catchments]);

  useEffect(() => {
    if (!ready) return;

    const maps = mapsRef.current;
    const map = mapRef.current;
    const color = riskColor(regionalScore);
    clearGroup(groupsRef.current.risk);
    DEFAULT_RISK_ZONES.forEach((zone) => {
      const polygon = new maps.Polygon({
        paths: zone.poly.map(toLatLng),
        strokeColor: color,
        strokeWeight: 2,
        fillColor: color,
        fillOpacity: 0.22,
        map: visibleLayers.risk ? map : null,
      });
      addOverlay(
        groupsRef.current,
        "risk",
        polygon,
        createInfoWindow(
          maps,
          map,
          polygon,
          `Flood Risk Zone: ${zone.name} · ${regionalRisk} (${regionalScore}/100)`,
        ),
      );
    });

    clearGroup(groupsRef.current.villages);
    villages.forEach((village) => {
      const marker = new maps.Circle({
        center: { lat: Number(village.lat), lng: Number(village.lon) },
        radius: 240,
        strokeColor: "#ffffff",
        strokeWeight: 2,
        fillColor: riskColor(village.score),
        fillOpacity: 0.9,
        map: visibleLayers.villages ? map : null,
      });
      marker.addListener("click", () => selectVillageRef.current(village));
      addOverlay(
        groupsRef.current,
        "villages",
        marker,
        createInfoWindow(
          maps,
          map,
          marker,
          `${village.name} · ${village.risk} · ${village.score}/100`,
        ),
      );
    });
  }, [ready, regionalRisk, regionalScore, villages, visibleLayers.risk, visibleLayers.villages]);

  useEffect(() => {
    if (!ready) return;
    Object.entries(groupsRef.current).forEach(([name, group]) => {
      setGroupMap(group, visibleLayers[name] ? mapRef.current : null);
    });
  }, [ready, visibleLayers]);

  useEffect(() => {
    if (!ready || !selectedVillage) return;
    mapRef.current.panTo({
      lat: Number(selectedVillage.lat),
      lng: Number(selectedVillage.lon),
    });
    mapRef.current.setZoom(12);
  }, [ready, selectedVillage]);

  function fitRegion() {
    if (!ready) return;
    const points = [
      ...villages.map((village) => [village.lat, village.lon]),
      ...catchments.map((catchment) => [catchment.centroid_lat, catchment.centroid_lon]),
    ].filter(([lat, lng]) => Number.isFinite(Number(lat)) && Number.isFinite(Number(lng)));

    if (points.length > 1) {
      const bounds = new mapsRef.current.LatLngBounds();
      points.forEach((point) => bounds.extend(toLatLng(point)));
      mapRef.current.fitBounds(bounds, 35);
      mapsRef.current.event.addListenerOnce(mapRef.current, "idle", () => {
        if (mapRef.current.getZoom() > 12) mapRef.current.setZoom(12);
      });
    } else if (points.length === 1) {
      mapRef.current.setCenter(toLatLng(points[0]));
      mapRef.current.setZoom(12);
    } else {
      mapRef.current.setCenter(toLatLng(REGION_CENTER));
      mapRef.current.setZoom(10);
    }
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
      <div id="map" ref={containerRef} aria-label="Interactive flood risk map">
        {mapError && <div className="map-error">{mapError}</div>}
      </div>

      <div className="map-toolbar">
        <button className="tool-btn active" type="button" onClick={fitRegion} disabled={!ready}>
          ⌖ Fit Region
        </button>
        <button className="tool-btn" type="button" onClick={locateUser} disabled={!ready}>
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
