export const REGION_CENTER = [30.2849, 78.9811];

export const STATES = [
  "Uttarakhand",
  "Himachal Pradesh",
  "Sikkim",
  "Kerala",
  "Karnataka",
];

export const DISTRICTS = ["Rudraprayag", "Chamoli", "Tehri Garhwal"];

export const MAP_LAYERS = [
  { id: "risk", label: "Backend flood risk", iconClass: "risk-icon", defaultVisible: true },
  { id: "precipitation", label: "Live precipitation", iconClass: "rain-icon", defaultVisible: true },
  { id: "clouds", label: "Live cloud cover", iconClass: "cloud-icon" },
  { id: "catchments", label: "Backend catchments", iconClass: "catch-icon", defaultVisible: true },
  { id: "villages", label: "Villages & boundaries", iconClass: "village-icon", defaultVisible: true },
];

export const DEFAULT_VISIBLE_LAYERS = Object.fromEntries(
  MAP_LAYERS.map((layer) => [layer.id, Boolean(layer.defaultVisible)]),
);

export function riskColor(score) {
  if (score >= 75) return "#dc2626";
  if (score >= 50) return "#f97316";
  if (score >= 25) return "#eab308";
  return "#22c55e";
}
