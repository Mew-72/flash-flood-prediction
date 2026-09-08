function trimTrailingSlash(value) {
  return value === "/" ? "" : value.replace(/\/$/, "");
}

export function getApiBase() {
  if (typeof window === "undefined") return "http://localhost:8000";

  const runtimeBase =
    window.FLASHGUARD_API_BASE ?? window.__API_BASE__ ?? window.API_BASE;
  if (runtimeBase != null) return trimTrailingSlash(String(runtimeBase));

  const queryBase = new URLSearchParams(window.location.search).get("api_base");
  if (queryBase != null) return trimTrailingSlash(queryBase);

  const storedBase =
    window.localStorage.getItem("FLASHGUARD_API_BASE") ??
    window.localStorage.getItem("API_BASE");
  if (storedBase) return trimTrailingSlash(storedBase);

  const buildBase = import.meta.env.VITE_API_BASE_URL;
  if (buildBase != null && buildBase !== "") {
    return trimTrailingSlash(buildBase);
  }

  if (!["localhost", "127.0.0.1"].includes(window.location.hostname)) {
    return "";
  }

  return "http://localhost:8000";
}

const API_BASE = getApiBase();

async function request(path, options) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    const error = new Error(`API HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response;
}

export async function fetchRiskSnapshots(district, signal) {
  const response = await request(
    `/v1/risk/snapshots?district=${encodeURIComponent(district)}`,
    { signal },
  );
  return response.json();
}

export async function postAlert(payload) {
  const response = await request("/v1/admin/alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return response.json().catch(() => null);
}

export function flattenSnapshots(payload) {
  if (Array.isArray(payload?.catchments)) {
    return payload.catchments.flatMap((catchment) =>
      Array.isArray(catchment.snapshots) ? catchment.snapshots : [],
    );
  }
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  return payload && typeof payload === "object" ? [payload] : [];
}

export function normalizeScore(rawScore, fallback = 74) {
  if (rawScore == null || Number.isNaN(Number(rawScore))) return fallback;
  const numericScore = Number(rawScore);
  const percentage = numericScore >= 0 && numericScore <= 1
    ? numericScore * 100
    : numericScore;
  return Math.min(Math.max(Math.round(percentage), 0), 100);
}

export function getRiskLevel(snapshot, score) {
  const providedLevel =
    snapshot?.overall_risk_level ?? snapshot?.risk_level ?? snapshot?.risk;
  if (providedLevel) return String(providedLevel).toUpperCase();
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 30) return "MODERATE";
  return "LOW";
}

export function getSnapshotScore(snapshot, fallback = 74) {
  if (snapshot?.composite_score != null) {
    return normalizeScore(snapshot.composite_score, fallback);
  }
  return normalizeScore(snapshot?.risk_score ?? snapshot?.score, fallback);
}

export function getPeakSnapshot(snapshots) {
  return snapshots.reduce((peak, snapshot) => {
    return getSnapshotScore(snapshot, 0) > getSnapshotScore(peak, -1)
      ? snapshot
      : peak;
  }, snapshots[0]);
}

export function getSnapshotConditions(snapshot) {
  const rainValue =
    snapshot?.precipitation_3h_mm ??
    snapshot?.details?.explain?.today_rainfall_mm ??
    snapshot?.rainfall_3h ??
    snapshot?.rainfall;
  const soilValue =
    snapshot?.details?.explain?.current_soil_moisture ??
    snapshot?.soil_moisture ??
    snapshot?.soil;

  const rainfall = rainValue == null
    ? undefined
    : typeof rainValue === "number"
      ? `${Math.round(rainValue)} mm`
      : rainValue;

  const soil = soilValue == null
    ? undefined
    : typeof soilValue === "number"
      ? `${Math.round(soilValue <= 1 ? soilValue * 100 : soilValue)}%`
      : soilValue;

  return { rainfall, soil };
}
