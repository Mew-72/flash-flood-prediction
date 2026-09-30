const MAX_CATALOG_PAGE_SIZE = 500;
const MAX_CATALOG_PAGES = 10_000;

function trimTrailingSlash(value) {
  return value === "/" ? "" : value.replace(/\/+$/, "");
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

  const buildBase = import.meta.env?.VITE_API_BASE_URL;
  if (buildBase != null && buildBase !== "") {
    return trimTrailingSlash(String(buildBase));
  }

  if (!['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return "";
  }

  return "http://localhost:8000";
}

const API_BASE = getApiBase();

function hasValue(value) {
  return value != null &&
    !(typeof value === "string" && value.trim() === "");
}

function appendQueryValue(searchParams, key, value) {
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (hasValue(item)) searchParams.append(key, String(item));
    });
    return;
  }

  if (hasValue(value)) searchParams.append(key, String(value));
}

function withQuery(path, params) {
  const searchParams = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([key, value]) => {
    appendQueryValue(searchParams, key, value);
  });
  const query = searchParams.toString();
  return query ? `${path}?${query}` : path;
}

function pathSegment(value, name) {
  if (!hasValue(value)) throw new TypeError(`${name} is required`);
  return encodeURIComponent(String(value));
}

function parseBody(response) {
  return response.text().then((text) => {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  });
}

function detailMessage(detail, status) {
  if (typeof detail === "string" && detail) return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((item) => item?.msg)
      .filter((message) => typeof message === "string" && message);
    if (messages.length) return messages.join("; ");
  }
  return `API request failed with status ${status}`;
}

export class ApiError extends Error {
  constructor(status, detail, response, payload) {
    super(detailMessage(detail, status));
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.response = response;
    this.payload = payload;
  }
}

export async function apiRequest(
  path,
  { params, headers: callerHeaders, json, ...options } = {},
) {
  const headers = new Headers({ Accept: "application/json" });
  new Headers(callerHeaders).forEach((value, key) => headers.set(key, value));

  if (json !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_BASE}${withQuery(path, params)}`, {
    ...options,
    headers,
    ...(json === undefined ? {} : { body: JSON.stringify(json) }),
  });
  const payload = await parseBody(response);

  if (!response.ok) {
    const detail =
      payload && typeof payload === "object" && "detail" in payload
        ? payload.detail
        : payload ?? response.statusText;
    throw new ApiError(response.status, detail, response, payload);
  }

  return payload;
}

export function getHealth(options = {}) {
  return apiRequest("/health", options);
}

const WEATHER_TILE_LAYERS = new Set(["precipitation_new", "clouds_new"]);

export function getWeatherTileUrl(layer) {
  if (!WEATHER_TILE_LAYERS.has(layer)) {
    throw new TypeError(`Unsupported weather tile layer: ${layer}`);
  }
  return `${API_BASE}/v1/weather/tiles/${layer}/{z}/{x}/{y}.png`;
}

export function getVillages(
  { district, catchment_id, q, offset, limit } = {},
  options = {},
) {
  return apiRequest("/v1/villages", {
    ...options,
    params: { district, catchment_id, q, offset, limit },
  });
}

export function getVillage(villageId, options = {}) {
  return apiRequest(`/v1/villages/${pathSegment(villageId, "villageId")}`, options);
}

export function getVillageBoundaries(
  { state_code, district_code, district_name, q, offset, limit } = {},
  options = {},
) {
  return apiRequest("/v1/villages/boundaries", {
    ...options,
    params: { state_code, district_code, district_name, q, offset, limit },
  });
}

export function getCatchments(
  { district, q, offset, limit } = {},
  options = {},
) {
  return apiRequest("/v1/catchments", {
    ...options,
    params: { district, q, offset, limit },
  });
}

export function getCatchment(catchmentId, options = {}) {
  return apiRequest(
    `/v1/catchments/${pathSegment(catchmentId, "catchmentId")}`,
    options,
  );
}

export function getRiskSnapshots(
  {
    district,
    catchment_id,
    include_forecast,
    summarize_provisional,
    offset,
    limit,
  } = {},
  options = {},
) {
  return apiRequest("/v1/risk/snapshots", {
    ...options,
    params: {
      district,
      catchment_id,
      include_forecast,
      summarize_provisional,
      offset,
      limit,
    },
  });
}

export async function getAllRiskSnapshots(params = {}, options = {}) {
  const catchmentsById = new Map();
  let offset = 0;

  for (let page = 0; page < MAX_CATALOG_PAGES; page += 1) {
    const payload = await getRiskSnapshots(
      { ...params, offset, limit: MAX_CATALOG_PAGE_SIZE },
      options,
    );
    const catchments = Array.isArray(payload?.catchments) ? payload.catchments : [];
    const villageIds = new Set();

    catchments.forEach((catchment) => {
      const snapshots = Array.isArray(catchment?.snapshots) ? catchment.snapshots : [];
      snapshots.forEach((snapshot) => villageIds.add(snapshot.village_id));
      const existing = catchmentsById.get(catchment.catchment_id);
      if (existing) {
        existing.snapshots.push(...snapshots);
      } else {
        catchmentsById.set(catchment.catchment_id, { ...catchment, snapshots: [...snapshots] });
      }
    });

    if (villageIds.size < MAX_CATALOG_PAGE_SIZE) {
      return { ...payload, catchments: [...catchmentsById.values()] };
    }
    offset += villageIds.size;
  }

  throw new Error("Risk snapshot pagination exceeded the configured page limit.");
}

export function getRisk(villageId, options = {}) {
  return apiRequest(`/v1/risk/${pathSegment(villageId, "villageId")}`, options);
}

export function createRiskBatch(selectors, options = {}) {
  return apiRequest("/v1/risk/batch", {
    ...options,
    method: "POST",
    json: selectors,
  });
}

export function simulate(payload, options = {}) {
  return apiRequest("/simulate", {
    ...options,
    method: "POST",
    json: payload,
  });
}

export function getReplay(
  villageId,
  { start_date, end_date } = {},
  options = {},
) {
  return apiRequest(`/replay/${pathSegment(villageId, "villageId")}`, {
    ...options,
    params: { start_date, end_date },
  });
}

export function getReplayEvents(options = {}) {
  return apiRequest("/replay/events", options);
}

export function getEventReplay(eventId, { case_id } = {}, options = {}) {
  return apiRequest(`/replay/events/${pathSegment(eventId, "eventId")}`, {
    ...options,
    params: { case_id },
  });
}

export function createAlert(payload, options = {}) {
  return apiRequest("/v1/admin/alerts", {
    ...options,
    method: "POST",
    json: payload,
  });
}

export function getAlerts({ limit } = {}, options = {}) {
  return apiRequest("/v1/admin/alerts", {
    ...options,
    params: { limit },
  });
}

function pageSize(value) {
  if (!hasValue(value)) return MAX_CATALOG_PAGE_SIZE;
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 1) {
    throw new TypeError("limit must be a positive integer");
  }
  return Math.min(numericValue, MAX_CATALOG_PAGE_SIZE);
}

function startOffset(value) {
  if (!hasValue(value)) return 0;
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 0) {
    throw new TypeError("offset must be a non-negative integer");
  }
  return numericValue;
}

async function getAllCatalogPages(getPage, params = {}, options = {}) {
  const { offset: requestedOffset, limit: requestedLimit, ...filters } = params;
  const offset = startOffset(requestedOffset);
  const limit = pageSize(requestedLimit);
  const items = [];
  let nextOffset = offset;
  let total;

  for (let pageNumber = 0; pageNumber < MAX_CATALOG_PAGES; pageNumber += 1) {
    const page = await getPage(
      { ...filters, offset: nextOffset, limit },
      options,
    );
    if (!page || !Array.isArray(page.items)) {
      throw new TypeError("Catalog response must contain an items array");
    }

    const pageTotal = Number(page.total);
    if (total === undefined && Number.isFinite(pageTotal) && pageTotal >= 0) {
      total = pageTotal;
    }

    if (page.items.length === 0) break;
    items.push(...page.items);

    const advancedOffset = nextOffset + page.items.length;
    if (advancedOffset <= nextOffset) {
      throw new Error("Catalog pagination did not advance");
    }
    nextOffset = advancedOffset;

    if (total !== undefined && nextOffset >= total) break;
    if (page.items.length < limit) break;
  }

  if (
    items.length > 0 &&
    items.length % limit === 0 &&
    (total === undefined || nextOffset < total)
  ) {
    throw new Error("Catalog pagination exceeded its safety limit");
  }

  return {
    items,
    total: total ?? offset + items.length,
    offset,
    limit,
  };
}

export function getAllVillages(params = {}, options = {}) {
  return getAllCatalogPages(getVillages, params, options);
}

export function getAllVillageBoundaries(params = {}, options = {}) {
  return getAllCatalogPages(getVillageBoundaries, params, options);
}

export function getAllCatchments(params = {}, options = {}) {
  return getAllCatalogPages(getCatchments, params, options);
}

function isAbortSignal(value) {
  return value != null &&
    typeof value === "object" &&
    typeof value.aborted === "boolean" &&
    typeof value.addEventListener === "function";
}

function requestOptions(value) {
  return isAbortSignal(value) ? { signal: value } : value ?? {};
}

export function fetchRiskSnapshots(paramsOrDistrict = {}, optionsOrSignal = {}) {
  if (typeof paramsOrDistrict === "string") {
    const district = paramsOrDistrict.toLowerCase() === "demo"
      ? undefined
      : paramsOrDistrict;
    return getRiskSnapshots(
      { district },
      requestOptions(optionsOrSignal),
    );
  }

  return getRiskSnapshots(paramsOrDistrict, requestOptions(optionsOrSignal));
}

export function fetchVillageCatalog(paramsOrSignal = {}, options = {}) {
  if (isAbortSignal(paramsOrSignal)) {
    return getAllVillages({}, { signal: paramsOrSignal });
  }
  return getAllVillages(paramsOrSignal, options);
}

export function postAlert(payload, optionsOrSignal = {}) {
  return createAlert(payload, requestOptions(optionsOrSignal));
}

export function toFrontendVillage(record, defaults = {}) {
  const distanceToStream = Number(record?.distance_to_stream_m);
  const slope = Number(record?.slope_deg);

  return {
    id: record?.id,
    name: record?.name,
    lat: record?.lat,
    lon: record?.lon,
    score: defaults.score ?? 0,
    risk: defaults.risk ?? "LOW",
    rain: defaults.rain ?? "—",
    soil: defaults.soil ?? "—",
    stream: Number.isFinite(distanceToStream)
      ? `${(distanceToStream / 1000).toFixed(1)} km`
      : defaults.stream ?? "—",
    slope: Number.isFinite(slope)
      ? `${Math.round(slope)}°`
      : defaults.slope ?? "—",
    catchment: record?.catchment_id,
  };
}

export function flattenSnapshots(payload) {
  if (Array.isArray(payload?.catchments)) {
    return payload.catchments.flatMap((catchment) =>
      Array.isArray(catchment?.snapshots) ? catchment.snapshots : [],
    );
  }
  if (Array.isArray(payload?.snapshots)) return payload.snapshots;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload)) return payload;
  return payload && typeof payload === "object" ? [payload] : [];
}

export function normalizeScore(rawScore, fallback = 74) {
  if (rawScore == null) return fallback;
  const numericScore = Number(rawScore);
  if (!Number.isFinite(numericScore)) return fallback;
  const percentage = numericScore >= 0 && numericScore <= 1
    ? numericScore * 100
    : numericScore;
  return Math.min(Math.max(Math.round(percentage), 0), 100);
}

export function getRiskLevel(snapshot, score) {
  const providedLevel =
    snapshot?.overall_risk_level ?? snapshot?.risk_level ?? snapshot?.risk;
  if (providedLevel) return String(providedLevel).toUpperCase();
  if (score >= 75) return "CRITICAL";
  if (score >= 50) return "HIGH";
  if (score >= 25) return "MODERATE";
  return "LOW";
}

export function getSnapshotScore(snapshot, fallback = 74) {
  if (snapshot?.composite_score != null) {
    return normalizeScore(snapshot.composite_score, fallback);
  }
  return normalizeScore(snapshot?.risk_score ?? snapshot?.score, fallback);
}

export function getPeakSnapshot(snapshots) {
  if (!Array.isArray(snapshots) || snapshots.length === 0) return undefined;
  return snapshots.reduce((peak, snapshot) =>
    getSnapshotScore(snapshot, 0) > getSnapshotScore(peak, -1)
      ? snapshot
      : peak,
  );
}

function formatMeasurement(value, suffix, digits = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(digits)}${suffix}` : undefined;
}

function windDirection(degrees) {
  const value = Number(degrees);
  if (!Number.isFinite(value)) return undefined;
  const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return directions[Math.round((((value % 360) + 360) % 360) / 45) % directions.length];
}

export function getSnapshotConditions(snapshot) {
  const weatherSource = String(snapshot?.provenance?.weather_source ?? "");
  const currentObservationHasNoRainField = weatherSource.includes(
    "openweather-current:no-rain-field=0",
  );
  const hasOneHourRainfall = snapshot?.precipitation_1h_mm != null;
  const hasThreeHourRainfall = snapshot?.precipitation_3h_mm != null;
  const hasSixHourRainfall = snapshot?.precipitation_6h_mm != null;
  const hasTwentyFourHourRainfall = snapshot?.precipitation_24h_mm != null;
  const rainValue = hasThreeHourRainfall
    ? snapshot.precipitation_3h_mm
    : hasOneHourRainfall
      ? snapshot.precipitation_1h_mm
      : hasSixHourRainfall
        ? snapshot.precipitation_6h_mm
        : hasTwentyFourHourRainfall
          ? snapshot.precipitation_24h_mm
          : snapshot?.details?.explain?.today_rainfall_mm
            ?? snapshot?.rainfall_3h
            ?? snapshot?.rainfall;
  const soilValue =
    snapshot?.details?.explain?.current_soil_moisture ??
    snapshot?.soil_moisture ??
    snapshot?.soil;
  const rainfall = rainValue == null
    ? undefined
    : typeof rainValue === "number"
      ? `${rainValue.toFixed(1)} mm`
      : String(rainValue);
  const soil = soilValue == null
    ? undefined
    : typeof soilValue === "number"
      ? `${Math.round(soilValue <= 1 ? soilValue * 100 : soilValue)}%`
      : String(soilValue);
  const windSpeed = formatMeasurement(snapshot?.wind_speed_mps, " m/s", 1);
  const windCompass = windDirection(snapshot?.wind_direction_deg);
  const weatherDescription = snapshot?.weather_description ?? snapshot?.weather_condition;

  return {
    rainfall,
    rainfallLabel: currentObservationHasNoRainField
      ? "current observation · no recent rain field"
      : hasThreeHourRainfall
        ? "3-hour accumulation"
        : hasOneHourRainfall
          ? "1-hour accumulation"
          : hasSixHourRainfall
            ? "6-hour accumulation"
            : rainValue == null
              ? "rainfall unavailable"
              : "24-hour accumulation",
    soil,
    temperature: formatMeasurement(snapshot?.temperature_c, " °C", 1),
    feelsLike: formatMeasurement(snapshot?.feels_like_c, " °C", 1),
    humidity: formatMeasurement(snapshot?.humidity_percent, "%"),
    pressure: formatMeasurement(snapshot?.pressure_hpa, " hPa"),
    wind: windSpeed ? `${windSpeed}${windCompass ? ` ${windCompass}` : ""}` : undefined,
    windSpeed,
    windDirection: windCompass,
    cloudCover: formatMeasurement(snapshot?.cloud_cover_percent, "%"),
    visibility: Number.isFinite(Number(snapshot?.visibility_m))
      ? Number(snapshot.visibility_m) >= 1000
        ? `${(Number(snapshot.visibility_m) / 1000).toFixed(1)} km`
        : `${Math.round(Number(snapshot.visibility_m))} m`
      : undefined,
    weatherCondition: weatherDescription ? String(weatherDescription) : undefined,
    weatherIcon: snapshot?.weather_icon ? String(snapshot.weather_icon) : undefined,
  };
}
