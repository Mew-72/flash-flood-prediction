import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const SERIES = [
  { key: "rainfall", label: "Rainfall (mm)", color: "#38bdf8", dash: undefined },
  { key: "soil", label: "Soil moisture (%)", color: "#84cc16", dash: "6 3" },
  { key: "wind", label: "Wind speed (km/h)", color: "#f97316", dash: "3 3" },
];

function AnalysisTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="analysis-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => (
        <div key={item.dataKey}>
          <span style={{ background: item.color }} />
          {item.name}: <b>{item.value ?? "Unavailable"}</b>
        </div>
      ))}
    </div>
  );
}

export default function DistrictAnalysisChart({ data, district }) {
  return (
    <section className="district-chart-card" aria-label={`${district} weather analysis chart`}>
      <div className="district-chart-heading">
        <div>
          <span>ENVIRONMENTAL ANALYSIS</span>
          <h2>{district}</h2>
          <p>Current and forecast conditions returned by the district risk assessment.</p>
        </div>
        <div className="chart-live-badge"><i /> Analysis ready</div>
      </div>
      <div className="district-chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 12, right: 18, left: 0, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.08)" />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#7f8d86", fontSize: 10 }} tickMargin={10} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: "#7f8d86", fontSize: 10 }} width={42} />
            <Tooltip content={<AnalysisTooltip />} cursor={{ stroke: "rgba(255,255,255,.16)" }} />
            <Legend verticalAlign="top" align="right" height={42} iconType="circle" wrapperStyle={{ color: "#aab7b0", fontSize: 10 }} />
            {SERIES.map((series) => (
              <Line
                key={series.key}
                connectNulls={false}
                dataKey={series.key}
                name={series.label}
                stroke={series.color}
                strokeDasharray={series.dash}
                strokeWidth={2.5}
                dot={{ r: 3, fill: series.color, stroke: "#101715", strokeWidth: 2 }}
                activeDot={{ r: 5 }}
                type="monotone"
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      {data.every((item) => item.wind == null) && (
        <p className="chart-data-note">Wind speed is not included in the current backend snapshot schema, so the wind series remains unavailable.</p>
      )}
    </section>
  );
}
