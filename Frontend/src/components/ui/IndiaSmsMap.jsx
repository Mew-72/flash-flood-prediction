import { useMemo, useState } from "react";

const STATE_REGIONS = [
  { name: "Jammu and Kashmir", x: 150, y: 24, w: 64, h: 30 },
  { name: "Ladakh", x: 213, y: 20, w: 66, h: 38 },
  { name: "Himachal Pradesh", x: 196, y: 59, w: 52, h: 27 },
  { name: "Punjab", x: 153, y: 65, w: 38, h: 30 },
  { name: "Uttarakhand", x: 241, y: 72, w: 48, h: 28 },
  { name: "Haryana", x: 178, y: 97, w: 43, h: 29 },
  { name: "Delhi", x: 218, y: 101, w: 16, h: 16 },
  { name: "Rajasthan", x: 103, y: 100, w: 75, h: 82 },
  { name: "Uttar Pradesh", x: 226, y: 108, w: 94, h: 49 },
  { name: "Bihar", x: 318, y: 129, w: 63, h: 36 },
  { name: "Sikkim", x: 375, y: 104, w: 18, h: 20 },
  { name: "Arunachal Pradesh", x: 424, y: 91, w: 74, h: 31 },
  { name: "Assam", x: 397, y: 122, w: 81, h: 27 },
  { name: "Nagaland", x: 468, y: 145, w: 29, h: 24 },
  { name: "Manipur", x: 459, y: 170, w: 28, h: 28 },
  { name: "Mizoram", x: 442, y: 203, w: 27, h: 31 },
  { name: "Tripura", x: 417, y: 190, w: 23, h: 28 },
  { name: "Meghalaya", x: 397, y: 153, w: 44, h: 24 },
  { name: "West Bengal", x: 364, y: 164, w: 38, h: 74 },
  { name: "Jharkhand", x: 316, y: 169, w: 55, h: 39 },
  { name: "Chhattisgarh", x: 267, y: 192, w: 55, h: 75 },
  { name: "Madhya Pradesh", x: 175, y: 169, w: 94, h: 67 },
  { name: "Gujarat", x: 88, y: 181, w: 75, h: 67 },
  { name: "Maharashtra", x: 150, y: 238, w: 111, h: 62 },
  { name: "Odisha", x: 322, y: 217, w: 63, h: 56 },
  { name: "Telangana", x: 241, y: 272, w: 55, h: 48 },
  { name: "Andhra Pradesh", x: 277, y: 307, w: 67, h: 74 },
  { name: "Karnataka", x: 187, y: 302, w: 77, h: 91 },
  { name: "Goa", x: 174, y: 323, w: 17, h: 24 },
  { name: "Kerala", x: 217, y: 397, w: 28, h: 75 },
  { name: "Tamil Nadu", x: 252, y: 391, w: 66, h: 78 },
  { name: "Andaman and Nicobar Islands", x: 428, y: 367, w: 14, h: 92 },
];

function normalizedStateName(value) {
  return String(value || "Unknown").trim().toLowerCase();
}

export default function IndiaSmsMap({ alerts }) {
  const [hoveredState, setHoveredState] = useState(null);
  const counts = useMemo(() => {
    const result = new Map();
    alerts.forEach((alert) => {
      const key = normalizedStateName(alert.state);
      result.set(key, (result.get(key) || 0) + 1);
    });
    return result;
  }, [alerts]);
  const maximum = Math.max(1, ...counts.values());
  const hoveredCount = hoveredState ? counts.get(normalizedStateName(hoveredState)) || 0 : 0;

  function stateColor(name) {
    const count = counts.get(normalizedStateName(name)) || 0;
    if (count === 0) return "#25332d";
    const intensity = count / maximum;
    return intensity > 0.66 ? "#f4511e" : intensity > 0.33 ? "#eab308" : "#4f46e5";
  }

  return (
    <section className="sms-map-card">
      <div className="sms-map-heading">
        <div><span>GEOGRAPHIC DELIVERY</span><h2>State-wise SMS Alert Records</h2></div>
        <p>Hover over a state to inspect sent alert records.</p>
      </div>
      <div className="sms-map-stage">
        <svg viewBox="60 5 455 485" role="img" aria-label="Interactive India SMS records map">
          {STATE_REGIONS.map((state) => (
            <g
              key={state.name}
              className="sms-state"
              tabIndex="0"
              role="button"
              aria-label={`${state.name}: ${counts.get(normalizedStateName(state.name)) || 0} SMS alert records`}
              onMouseEnter={() => setHoveredState(state.name)}
              onMouseLeave={() => setHoveredState(null)}
              onFocus={() => setHoveredState(state.name)}
              onBlur={() => setHoveredState(null)}
            >
              <rect x={state.x} y={state.y} width={state.w} height={state.h} rx="7" fill={stateColor(state.name)} />
              {(counts.get(normalizedStateName(state.name)) || 0) > 0 && (
                <circle cx={state.x + state.w / 2} cy={state.y + state.h / 2} r="4" />
              )}
              <title>{state.name}: {counts.get(normalizedStateName(state.name)) || 0} SMS alert records</title>
            </g>
          ))}
        </svg>
        <div className={`sms-map-tooltip ${hoveredState ? "visible" : ""}`} aria-live="polite">
          <span>STATE</span>
          <strong>{hoveredState || "Hover over the map"}</strong>
          <div><b>{hoveredCount}</b> SMS alert record{hoveredCount === 1 ? "" : "s"}</div>
        </div>
      </div>
      <div className="sms-map-legend"><span><i className="none" />No records</span><span><i className="low" />Low</span><span><i className="medium" />Medium</span><span><i className="high" />High</span></div>
    </section>
  );
}
