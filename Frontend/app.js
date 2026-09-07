function getApiBase() {
  if (typeof window !== "undefined") {
    if (window.FLASHGUARD_API_BASE) return window.FLASHGUARD_API_BASE;
    if (window.__API_BASE__) return window.__API_BASE__;
    if (window.API_BASE) return window.API_BASE;
    const urlParam = new URLSearchParams(window.location.search).get("api_base");
    if (urlParam !== null) return urlParam;
    const stored = localStorage.getItem("FLASHGUARD_API_BASE") || localStorage.getItem("API_BASE");
    if (stored) return stored;
    if (window.location && window.location.origin && window.location.origin.startsWith("http")) {
      const hostname = window.location.hostname;
      if (hostname !== "localhost" && hostname !== "127.0.0.1") {
        return ""; // Relative path for production deployment
      }
    }
  }
  return "http://localhost:8000";
}

const API_BASE = getApiBase();
let map, villageMarkers = {}, demoLayerGroups = {};
const regionCenter = [30.2849, 78.9811];

const villages = [
  {id:"kedarnath",name:"Kedar Valley",lat:30.735,lon:79.066,score:88,risk:"CRITICAL",rain:"91 mm",soil:"89%",stream:"0.8 km",slope:"34°",catchment:"KV-01"},
  {id:"tilwara",name:"Tilwara",lat:30.405,lon:78.999,score:76,risk:"HIGH",rain:"72 mm",soil:"81%",stream:"1.1 km",slope:"31°",catchment:"RV-03"},
  {id:"augustmuni",name:"Augustmuni",lat:30.527,lon:79.041,score:68,risk:"HIGH",rain:"68 mm",soil:"78%",stream:"1.6 km",slope:"27°",catchment:"RV-04"},
  {id:"ukhimath",name:"Ukhimath",lat:30.526,lon:79.078,score:53,risk:"MODERATE",rain:"52 mm",soil:"65%",stream:"2.4 km",slope:"22°",catchment:"UV-02"},
  {id:"guptkashi",name:"Guptkashi",lat:30.568,lon:79.082,score:42,risk:"MODERATE",rain:"44 mm",soil:"59%",stream:"2.8 km",slope:"19°",catchment:"GV-02"}
];

const defaultRiskZones = [
  {
    poly: [[30.76, 78.98], [30.76, 79.10], [30.68, 79.11], [30.63, 79.01]],
    name: "Upper Kedar Corridor", level: "CRITICAL", score: 88, color: "#dc2626"
  },
  {
    poly: [[30.63, 78.95], [30.63, 79.02], [30.50, 79.05], [30.45, 78.96]],
    name: "Mandakini Inundation Corridor", level: "HIGH", score: 76, color: "#f97316"
  },
  {
    poly: [[30.50, 78.96], [30.50, 79.06], [30.40, 79.07], [30.38, 78.96]],
    name: "Lower Catchment Zone", level: "MODERATE", score: 53, color: "#eab308"
  }
];

document.addEventListener("DOMContentLoaded", () => {
  initMap();
  renderVillages();
  setupLayers();
  setupControls();
  updateDashboard();
  loadBackendSnapshot();
});

function initMap(){
  map = L.map("map", {zoomControl:false}).setView(regionCenter, 10);
  L.control.zoom({position:"bottomright"}).addTo(map);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom:19, attribution:"© OpenStreetMap contributors"
  }).addTo(map);

  // Initialize all layer groups (visibility is governed by setupLayers from checkboxes)
  demoLayerGroups.risk = L.layerGroup();
  demoLayerGroups.rainfall = L.layerGroup();
  demoLayerGroups.soil = L.layerGroup();
  demoLayerGroups.slope = L.layerGroup();
  demoLayerGroups.elevation = L.layerGroup();
  demoLayerGroups.streams = L.layerGroup();
  demoLayerGroups.catchments = L.layerGroup();
  demoLayerGroups.villages = L.layerGroup();

  addDemoOverlays();
}

function riskColor(score){
  if(score >= 80) return "#dc2626";
  if(score >= 60) return "#f97316";
  if(score >= 30) return "#eab308";
  return "#22c55e";
}

function addDemoOverlays(){
  // 1. Flood Risk Layer (Hazard zones)
  defaultRiskZones.forEach(r => {
    L.polygon(r.poly, {
      color: r.color, weight: 2, dashArray: "4, 4", fillColor: r.color, fillOpacity: 0.22
    }).bindTooltip(`Flood Risk Zone: ${r.name} · ${r.level} (${r.score}/100)`).addTo(demoLayerGroups.risk);
  });

  // 2. Villages Layer
  villages.forEach(v=>{
    const marker = L.circleMarker([v.lat,v.lon],{
      radius:8, color:"#fff", weight:2, fillColor:riskColor(v.score), fillOpacity:.9
    }).bindTooltip(`${v.name} · ${v.risk} · ${v.score}/100`);
    marker.on("click",()=>openVillage(v));
    demoLayerGroups.villages.addLayer(marker);
    villageMarkers[v.id] = marker;
  });

  // 3. Streams Layer
  const stream = L.polyline([
    [30.77,79.03],[30.70,79.04],[30.63,79.02],[30.56,79.01],[30.49,78.99],[30.41,79.00]
  ],{color:"#0284c7",weight:4,opacity:.75});
  demoLayerGroups.streams.addLayer(stream);

  // 4. Sub-catchments Layer
  const catchmentPolys = [
    [[30.76,78.98],[30.76,79.10],[30.66,79.12],[30.62,79.01]],
    [[30.62,78.94],[30.62,79.01],[30.52,79.05],[30.47,78.95]],
    [[30.52,78.95],[30.52,79.05],[30.42,79.07],[30.38,78.96]]
  ];
  catchmentPolys.forEach((p,i)=>{
    L.polygon(p,{color:"#7c3aed",weight:1.5,fillColor:"#a78bfa",fillOpacity:.08})
      .bindTooltip(`Sub-catchment ${i+1}`).addTo(demoLayerGroups.catchments);
  });

  // 5. Rainfall Layer
  const rainfallCircles = [
    {lat:30.69,lon:79.06,r:19000,val:"90+ mm"},
    {lat:30.55,lon:79.02,r:15000,val:"70–90 mm"},
    {lat:30.45,lon:79.01,r:12000,val:"50–70 mm"}
  ];
  rainfallCircles.forEach(x=>{
    L.circle([x.lat,x.lon],{radius:x.r,color:"#2563eb",fillColor:"#60a5fa",fillOpacity:.12,weight:1})
      .bindTooltip(`Rainfall zone: ${x.val}`).addTo(demoLayerGroups.rainfall);
  });

  // 6. Slope Layer
  const slope = L.polygon([[30.72,79.01],[30.75,79.11],[30.60,79.10],[30.58,79.02]],{
    color:"#f59e0b",fillColor:"#f59e0b",fillOpacity:.12,weight:1
  }).bindTooltip("Steep-slope indicator");
  demoLayerGroups.slope.addLayer(slope);

  // 7. Soil Moisture Saturation Layer
  const soilZones = [
    { lat: 30.71, lon: 79.05, r: 16000, val: "High Saturation (85–90%)" },
    { lat: 30.52, lon: 79.03, r: 14000, val: "Moderate Wetness (70–80%)" }
  ];
  soilZones.forEach(s => {
    L.circle([s.lat, s.lon], {
      radius: s.r, color: "#059669", fillColor: "#10b981", fillOpacity: 0.16, weight: 1.5
    }).bindTooltip(`Soil Moisture: ${s.val}`).addTo(demoLayerGroups.soil);
  });

  // 8. Elevation / DEM Terrain Layer
  const elevBands = [
    [[30.78, 78.95], [30.78, 79.15], [30.70, 79.12], [30.70, 78.98]],
    [[30.70, 78.98], [30.70, 79.12], [30.58, 79.10], [30.58, 78.96]]
  ];
  elevBands.forEach((band, idx) => {
    L.polygon(band, {
      color: "#8b5cf6", fillColor: "#8b5cf6", fillOpacity: 0.08 + idx * 0.06, weight: 1
    }).bindTooltip(`Elevation Band: >${3000 - idx * 1000}m ASL`).addTo(demoLayerGroups.elevation);
  });
}

function setupLayers(){
  document.querySelectorAll("[data-layer]").forEach(cb=>{
    const layerName = cb.dataset.layer;
    const group = demoLayerGroups[layerName];

    // Synchronize initial layer visibility with HTML checkbox state
    if (group) {
      if (cb.checked) {
        if (!map.hasLayer(group)) group.addTo(map);
      } else {
        if (map.hasLayer(group)) map.removeLayer(group);
      }
    }

    // Toggle layer on checkbox change
    cb.addEventListener("change",()=>{
      const g = demoLayerGroups[cb.dataset.layer];
      if(!g) return;
      if(cb.checked) {
        if (!map.hasLayer(g)) g.addTo(map);
      } else {
        if (map.hasLayer(g)) map.removeLayer(g);
      }
    });
  });
}

function renderVillages(){
  const list = document.getElementById("villageList");
  list.innerHTML = villages.sort((a,b)=>b.score-a.score).map(v=>`
    <div class="village-item" data-id="${v.id}">
      <div><div class="village-name">${v.name}</div><div class="village-meta">${v.risk} · ${v.catchment}</div></div>
      <div style="text-align:right"><div class="village-score" style="color:${riskColor(v.score)}">${v.score}</div><div class="village-meta">/100</div></div>
    </div>`).join("");
  list.querySelectorAll(".village-item").forEach(el=>{
    el.addEventListener("click",()=>openVillage(villages.find(v=>v.id===el.dataset.id)));
  });
}

function openVillage(v){
  if(!v) return;
  document.getElementById("modalVillageName").textContent=v.name;
  const badge=document.getElementById("modalRiskBadge");
  badge.textContent=v.risk; badge.className=`risk-badge ${v.risk.toLowerCase()}`;
  document.getElementById("modalScore").textContent=v.score+"/100";
  document.getElementById("modalRain").textContent=v.rain;
  document.getElementById("modalSoil").textContent=v.soil;
  document.getElementById("modalStream").textContent=v.stream;
  document.getElementById("modalSlope").textContent=v.slope;
  document.getElementById("modalCatchment").textContent=v.catchment;
  document.getElementById("villageModal").classList.remove("hidden");
  map.flyTo([v.lat,v.lon],12,{duration:.8});
}
document.getElementById("closeModal").addEventListener("click",()=>document.getElementById("villageModal").classList.add("hidden"));
document.getElementById("villageModal").addEventListener("click",e=>{if(e.target.id==="villageModal")e.currentTarget.classList.add("hidden")});

function setupControls(){
  document.getElementById("fitMapBtn").onclick=()=>map.setView(regionCenter,10);
  document.getElementById("refreshBtn").onclick=async()=>{
    document.getElementById("lastUpdated").textContent="Refreshing…";
    await loadBackendSnapshot();
    document.getElementById("lastUpdated").textContent="Updated just now";
  };
  document.getElementById("locateBtn").onclick=()=>{
    map.locate({setView:true,maxZoom:12});
  };
  document.getElementById("stateSelect").onchange=e=>{
    document.getElementById("mapTitle").textContent=`${document.getElementById("districtSelect").value}, ${e.target.value}`;
  };
  document.getElementById("districtSelect").onchange=e=>{
    document.getElementById("mapTitle").textContent=`${e.target.value}, ${document.getElementById("stateSelect").value}`;
    loadBackendSnapshot();
  };
}

function normalizeScore(rawScore) {
  if (rawScore == null) return 74;
  const num = Number(rawScore);
  if (isNaN(num)) return 74;
  // If in range 0.0 to 1.0 (backend composite_score format), convert to 0-100
  if (num >= 0 && num <= 1) {
    return Math.round(num * 100);
  }
  return Math.min(Math.max(Math.round(num), 0), 100);
}

function updateDashboard(data={}){
  const score = normalizeScore(data.score);
  const rawRisk = data.risk;
  const risk = (rawRisk ? String(rawRisk).toUpperCase() : (score>=80?"CRITICAL":score>=60?"HIGH":score>=30?"MODERATE":"LOW"));
  
  const scoreEl = document.getElementById("riskScore");
  if (scoreEl) scoreEl.textContent = score;

  const overallRiskEl = document.getElementById("overallRisk");
  if (overallRiskEl) {
    overallRiskEl.textContent = risk;
    overallRiskEl.className = `risk-badge ${risk.toLowerCase()}`;
  }

  const gaugeFill = document.getElementById("gaugeFill");
  if (gaugeFill) {
    gaugeFill.style.width = Math.min(Math.max(score, 0), 100) + "%";
    gaugeFill.style.background = riskColor(score);
  }

  if (data.rainfall) {
    const el = document.getElementById("rainfallValue");
    if (el) el.textContent = data.rainfall;
  }
  if (data.soil) {
    const el = document.getElementById("soilValue");
    if (el) el.textContent = data.soil;
  }
}

async function loadBackendSnapshot(){
  try{
    const districtEl = document.getElementById("districtSelect");
    const district = districtEl ? districtEl.value : "Rudraprayag";
    const res = await fetch(`${API_BASE}/v1/risk/snapshots?district=${encodeURIComponent(district)}`);
    if(!res.ok) throw new Error(`API HTTP ${res.status}`);
    const json = await res.json();
    
    // Flatten snapshots: backend GET /v1/risk/snapshots returns catchments[].snapshots[]
    let snapshots = [];
    if (json && Array.isArray(json.catchments)) {
      snapshots = json.catchments.flatMap(c => (Array.isArray(c.snapshots) ? c.snapshots : []));
    } else if (Array.isArray(json)) {
      snapshots = json;
    } else if (json && Array.isArray(json.items)) {
      snapshots = json.items;
    } else if (json && typeof json === "object") {
      snapshots = [json];
    }

    if (snapshots.length > 0) {
      // Pick highest risk snapshot to represent peak regional risk
      const peak = snapshots.reduce((max, s) => {
        const sScore = s.composite_score ?? (s.risk_score != null ? s.risk_score / 100 : (s.score != null ? (s.score > 1 ? s.score / 100 : s.score) : 0));
        const mScore = max?.composite_score ?? (max?.risk_score != null ? max.risk_score / 100 : (max?.score != null ? (max.score > 1 ? max.score / 100 : max.score) : -1));
        return sScore > mScore ? s : max;
      }, snapshots[0]);

      // Normalize composite_score (0-1) to 0-100
      const score = peak.composite_score != null ? normalizeScore(peak.composite_score) : normalizeScore(peak.risk_score ?? peak.score);
      const risk = (peak.overall_risk_level || peak.risk_level || peak.risk || (score >= 80 ? "CRITICAL" : score >= 60 ? "HIGH" : score >= 30 ? "MODERATE" : "LOW")).toUpperCase();

      let rainfall;
      if (peak.precipitation_3h_mm != null) {
        rainfall = `${Math.round(peak.precipitation_3h_mm)} mm`;
      } else if (peak.details?.explain?.today_rainfall_mm != null) {
        rainfall = `${Math.round(peak.details.explain.today_rainfall_mm)} mm`;
      } else if (peak.rainfall != null) {
        rainfall = typeof peak.rainfall === "number" ? `${Math.round(peak.rainfall)} mm` : peak.rainfall;
      } else if (peak.rainfall_3h != null) {
        rainfall = typeof peak.rainfall_3h === "number" ? `${Math.round(peak.rainfall_3h)} mm` : peak.rainfall_3h;
      }

      let soil;
      if (peak.details?.explain?.current_soil_moisture != null) {
        soil = `${Math.round(peak.details.explain.current_soil_moisture * 100)}%`;
      } else if (peak.soil_moisture != null) {
        soil = typeof peak.soil_moisture === "number"
          ? `${peak.soil_moisture <= 1 ? Math.round(peak.soil_moisture * 100) : Math.round(peak.soil_moisture)}%`
          : peak.soil_moisture;
      } else if (peak.soil != null) {
        soil = peak.soil;
      }

      updateDashboard({ score, risk, rainfall, soil });

      // Update village priorities list and map markers if matching villages are returned from backend
      let updatedAnyVillage = false;
      snapshots.forEach(s => {
        const v = villages.find(item =>
          item.id === s.village_id ||
          (s.village_name && item.name.toLowerCase() === s.village_name.toLowerCase())
        );
        if (v) {
          if (s.composite_score != null) v.score = normalizeScore(s.composite_score);
          if (s.overall_risk_level) v.risk = s.overall_risk_level.toUpperCase();
          if (s.precipitation_3h_mm != null) v.rain = `${Math.round(s.precipitation_3h_mm)} mm`;
          if (s.details?.explain?.current_soil_moisture != null) {
            v.soil = `${Math.round(s.details.explain.current_soil_moisture * 100)}%`;
          }

          // Update Leaflet map marker live
          const marker = villageMarkers[v.id];
          if (marker) {
            marker.setStyle({ fillColor: riskColor(v.score) });
            marker.setTooltipContent(`${v.name} · ${v.risk} · ${v.score}/100`);
          }
          updatedAnyVillage = true;
        }
      });
      if (updatedAnyVillage) {
        renderVillages();
      }

      // Update Flood Risk Layer with regional peak risk color
      if (demoLayerGroups.risk) {
        demoLayerGroups.risk.clearLayers();
        defaultRiskZones.forEach(r => {
          const zoneColor = riskColor(score);
          L.polygon(r.poly, {
            color: zoneColor, weight: 2, dashArray: "4, 4", fillColor: zoneColor, fillOpacity: 0.22
          }).bindTooltip(`Flood Risk Zone: ${r.name} · ${risk} (${score}/100)`).addTo(demoLayerGroups.risk);
        });
      }
    }
  }catch(e){
    console.info("Using demo snapshot; backend not reachable.",e.message);
  }
}

