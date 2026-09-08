export const REGION_CENTER = [30.2849, 78.9811];

export const STATES = [
  "Uttarakhand",
  "Himachal Pradesh",
  "Sikkim",
  "Kerala",
  "Karnataka",
];

export const DISTRICTS = ["Rudraprayag", "Chamoli", "Tehri Garhwal"];

export const DEFAULT_VILLAGES = [
  { id: "kedarnath", name: "Kedar Valley", lat: 30.735, lon: 79.066, score: 88, risk: "CRITICAL", rain: "91 mm", soil: "89%", stream: "0.8 km", slope: "34°", catchment: "KV-01" },
  { id: "tilwara", name: "Tilwara", lat: 30.405, lon: 78.999, score: 76, risk: "HIGH", rain: "72 mm", soil: "81%", stream: "1.1 km", slope: "31°", catchment: "RV-03" },
  { id: "augustmuni", name: "Augustmuni", lat: 30.527, lon: 79.041, score: 68, risk: "HIGH", rain: "68 mm", soil: "78%", stream: "1.6 km", slope: "27°", catchment: "RV-04" },
  { id: "ukhimath", name: "Ukhimath", lat: 30.526, lon: 79.078, score: 53, risk: "MODERATE", rain: "52 mm", soil: "65%", stream: "2.4 km", slope: "22°", catchment: "UV-02" },
  { id: "guptkashi", name: "Guptkashi", lat: 30.568, lon: 79.082, score: 42, risk: "MODERATE", rain: "44 mm", soil: "59%", stream: "2.8 km", slope: "19°", catchment: "GV-02" },
];

export const DEFAULT_RISK_ZONES = [
  {
    poly: [[30.76, 78.98], [30.76, 79.10], [30.68, 79.11], [30.63, 79.01]],
    name: "Upper Kedar Corridor",
  },
  {
    poly: [[30.63, 78.95], [30.63, 79.02], [30.50, 79.05], [30.45, 78.96]],
    name: "Mandakini Inundation Corridor",
  },
  {
    poly: [[30.50, 78.96], [30.50, 79.06], [30.40, 79.07], [30.38, 78.96]],
    name: "Lower Catchment Zone",
  },
];

export const MAP_LAYERS = [
  { id: "risk", label: "Flood Risk", iconClass: "risk-icon", defaultVisible: true },
  { id: "rainfall", label: "Rainfall", iconClass: "rain-icon" },
  { id: "soil", label: "Soil Moisture", iconClass: "soil-icon" },
  { id: "slope", label: "Slope", iconClass: "slope-icon" },
  { id: "elevation", label: "Elevation / DEM", iconClass: "elev-icon" },
  { id: "streams", label: "Streams", iconClass: "stream-icon" },
  { id: "catchments", label: "Sub-catchments", iconClass: "catch-icon" },
  { id: "villages", label: "Villages", iconClass: "village-icon", defaultVisible: true },
];

export const DEFAULT_VISIBLE_LAYERS = Object.fromEntries(
  MAP_LAYERS.map((layer) => [layer.id, Boolean(layer.defaultVisible)]),
);

export function riskColor(score) {
  if (score >= 80) return "#dc2626";
  if (score >= 60) return "#f97316";
  if (score >= 30) return "#eab308";
  return "#22c55e";
}
