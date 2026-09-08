export const REGION_CENTER = [22.9, 79.5];

export const INDIA_MAP_BOUNDS = {
  north: 36.0,
  south: 6.5,
  west: 67.5,
  east: 97.5,
};

export const STATES = [
  "Uttarakhand",
  "Himachal Pradesh",
  "Sikkim",
  "Kerala",
  "Karnataka",
];

export const STATE_MAP_VIEWS = {
  Uttarakhand: { center: [30.07, 79.02], zoom: 7 },
  "Himachal Pradesh": { center: [31.82, 77.17], zoom: 7 },
  Sikkim: { center: [27.53, 88.51], zoom: 9 },
  Kerala: { center: [10.16, 76.64], zoom: 7 },
  Karnataka: { center: [15.32, 75.71], zoom: 7 },
};

export const DISTRICT_MAP_VIEWS = {
  Rudraprayag: { center: [30.28, 79.0], latRadius: 0.48, lngRadius: 0.42 },
  Chamoli: { center: [30.52, 79.56], latRadius: 0.62, lngRadius: 0.7 },
  "Tehri Garhwal": { center: [30.38, 78.48], latRadius: 0.52, lngRadius: 0.55 },
};

export const DISTRICTS = ["Rudraprayag", "Chamoli", "Tehri Garhwal"];

export const DEFAULT_VILLAGES = [
  { id: "kedarnath", name: "Kedar Valley", lat: 30.735, lon: 79.066, score: 88, risk: "CRITICAL", rain: "91 mm", soil: "89%", stream: "0.8 km", slope: "34°", catchment: "KV-01" },
  { id: "tilwara", name: "Tilwara", lat: 30.405, lon: 78.999, score: 76, risk: "HIGH", rain: "72 mm", soil: "81%", stream: "1.1 km", slope: "31°", catchment: "RV-03" },
  { id: "augustmuni", name: "Augustmuni", lat: 30.527, lon: 79.041, score: 68, risk: "HIGH", rain: "68 mm", soil: "78%", stream: "1.6 km", slope: "27°", catchment: "RV-04" },
  { id: "ukhimath", name: "Ukhimath", lat: 30.526, lon: 79.078, score: 53, risk: "MODERATE", rain: "52 mm", soil: "65%", stream: "2.4 km", slope: "22°", catchment: "UV-02" },
  { id: "guptkashi", name: "Guptkashi", lat: 30.568, lon: 79.082, score: 42, risk: "MODERATE", rain: "44 mm", soil: "59%", stream: "2.8 km", slope: "19°", catchment: "GV-02" },
];

export const INDIA_THEMATIC_ZONES = [
  {
    name: "Northern Himalayas",
    poly: [[35.6, 73.8], [35.9, 78.5], [34.2, 83.0], [31.5, 81.2], [29.2, 77.0], [31.1, 74.2]],
  },
  {
    name: "North West India",
    poly: [[31.1, 74.2], [29.2, 77.0], [27.0, 79.0], [23.5, 75.5], [22.3, 69.5], [27.8, 68.8]],
  },
  {
    name: "North Central India",
    poly: [[29.2, 77.0], [31.5, 81.2], [27.8, 84.8], [23.8, 83.0], [23.5, 75.5], [27.0, 79.0]],
  },
  {
    name: "North East India",
    poly: [[28.3, 88.0], [29.2, 96.7], [26.2, 97.4], [22.0, 92.8], [23.0, 88.0], [26.0, 86.5]],
  },
  {
    name: "Western India",
    poly: [[23.5, 75.5], [23.8, 83.0], [19.0, 80.5], [15.5, 75.5], [18.0, 72.5], [22.3, 69.5]],
  },
  {
    name: "Central India",
    poly: [[23.8, 83.0], [23.0, 88.0], [19.5, 88.0], [17.0, 82.0], [19.0, 80.5]],
  },
  {
    name: "Eastern India",
    poly: [[27.8, 84.8], [26.0, 86.5], [23.0, 88.0], [19.5, 88.0], [18.0, 84.0], [23.8, 83.0]],
  },
  {
    name: "South West India",
    poly: [[19.0, 80.5], [17.0, 82.0], [12.5, 79.0], [8.0, 77.0], [10.0, 74.8], [15.5, 75.5]],
  },
  {
    name: "South Central India",
    poly: [[17.0, 82.0], [18.0, 84.0], [13.5, 82.2], [8.0, 77.0], [12.5, 79.0]],
  },
  {
    name: "South East India",
    poly: [[19.5, 88.0], [18.0, 84.0], [13.5, 82.2], [11.0, 80.2], [15.0, 79.5]],
  },
];

export const MAP_LAYERS = [
  { id: "risk", label: "Flood Risk", iconClass: "risk-icon", unit: "risk index", high: "> 74", moderate: "25–74", low: "0–24" },
  { id: "rainfall", label: "Rainfall", iconClass: "rain-icon", unit: "mm / 3h", high: "> 80 mm", moderate: "40–80 mm", low: "< 40 mm" },
  { id: "soil", label: "Soil Moisture", iconClass: "soil-icon", unit: "saturation", high: "> 80%", moderate: "55–80%", low: "< 55%" },
  { id: "slope", label: "Slope", iconClass: "slope-icon", unit: "degrees", high: "> 30°", moderate: "15–30°", low: "< 15°" },
  { id: "elevation", label: "Elevation / DEM", iconClass: "elev-icon", unit: "metres ASL", high: "> 3,000 m", moderate: "1,000–3,000 m", low: "< 1,000 m" },
];

export const SUPPORT_LAYERS = [
  { id: "streams", label: "Streams", iconClass: "stream-icon" },
  { id: "catchments", label: "Sub-catchments", iconClass: "catch-icon" },
  { id: "villages", label: "Villages", iconClass: "village-icon" },
];

export const DEFAULT_VISIBLE_LAYERS = {
  risk: true,
  rainfall: false,
  soil: false,
  slope: false,
  elevation: false,
  streams: false,
  catchments: false,
  villages: true,
};

export const INDIA_HEAT_REGIONS = [
  { id: "north", name: "Northern Himalayas", path: "M155 48 L231 41 L289 68 L272 111 L224 122 L178 98 Z" },
  { id: "northwest", name: "North West", path: "M72 103 L155 48 L178 98 L164 159 L112 181 L65 148 Z" },
  { id: "northcentral", name: "North Central", path: "M164 159 L178 98 L224 122 L259 163 L229 205 L169 209 Z" },
  { id: "northeast", name: "North East", path: "M272 111 L346 102 L396 131 L366 164 L302 157 L259 163 L224 122 Z" },
  { id: "west", name: "Western India", path: "M65 148 L112 181 L169 209 L163 272 L118 301 L78 260 L49 207 Z" },
  { id: "central", name: "Central India", path: "M169 209 L229 205 L270 237 L249 292 L196 309 L163 272 Z" },
  { id: "east", name: "Eastern India", path: "M229 205 L259 163 L302 157 L337 201 L314 250 L270 237 Z" },
  { id: "southwest", name: "South West", path: "M118 301 L163 272 L196 309 L184 376 L154 437 L126 390 L105 337 Z" },
  { id: "southcentral", name: "South Central", path: "M196 309 L249 292 L273 334 L244 393 L190 435 L184 376 Z" },
  { id: "southeast", name: "South East", path: "M249 292 L314 250 L309 312 L273 334 Z" },
];

export const INDIA_LAYER_LEVELS = {
  risk: ["high", "moderate", "moderate", "high", "low", "moderate", "high", "low", "moderate", "moderate"],
  rainfall: ["high", "low", "moderate", "high", "low", "moderate", "high", "moderate", "moderate", "high"],
  soil: ["moderate", "low", "moderate", "high", "low", "moderate", "high", "moderate", "moderate", "high"],
  slope: ["high", "moderate", "low", "high", "moderate", "moderate", "moderate", "high", "moderate", "low"],
  elevation: ["high", "moderate", "low", "high", "low", "moderate", "low", "moderate", "low", "low"],
};

export function riskColor(score) {
  if (score >= 75) return "#dc2626";
  if (score >= 50) return "#f97316";
  if (score >= 25) return "#eab308";
  return "#22c55e";
}
