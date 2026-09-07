const API_BASE = "http://localhost:8000";
let map, villageMarkers = [], demoLayerGroups = {};
const regionCenter = [30.2849, 78.9811];

const villages = [
  {id:"kedarnath",name:"Kedar Valley",lat:30.735,lon:79.066,score:88,risk:"CRITICAL",rain:"91 mm",soil:"89%",stream:"0.8 km",slope:"34°",catchment:"KV-01"},
  {id:"tilwara",name:"Tilwara",lat:30.405,lon:78.999,score:76,risk:"HIGH",rain:"72 mm",soil:"81%",stream:"1.1 km",slope:"31°",catchment:"RV-03"},
  {id:"augustmuni",name:"Augustmuni",lat:30.527,lon:79.041,score:68,risk:"HIGH",rain:"68 mm",soil:"78%",stream:"1.6 km",slope:"27°",catchment:"RV-04"},
  {id:"ukhimath",name:"Ukhimath",lat:30.526,lon:79.078,score:53,risk:"MODERATE",rain:"52 mm",soil:"65%",stream:"2.4 km",slope:"22°",catchment:"UV-02"},
  {id:"guptkashi",name:"Guptkashi",lat:30.568,lon:79.082,score:42,risk:"MODERATE",rain:"44 mm",soil:"59%",stream:"2.8 km",slope:"19°",catchment:"GV-02"}
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

  demoLayerGroups.rainfall = L.layerGroup().addTo(map);
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
  villages.forEach(v=>{
    const marker = L.circleMarker([v.lat,v.lon],{
      radius:8, color:"#fff", weight:2, fillColor:riskColor(v.score), fillOpacity:.9
    }).bindTooltip(`${v.name} · ${v.risk} · ${v.score}/100`);
    marker.on("click",()=>openVillage(v));
    demoLayerGroups.villages.addLayer(marker);
  });
  demoLayerGroups.villages.addTo(map);

  const stream = L.polyline([
    [30.77,79.03],[30.70,79.04],[30.63,79.02],[30.56,79.01],[30.49,78.99],[30.41,79.00]
  ],{color:"#0284c7",weight:4,opacity:.75});
  demoLayerGroups.streams.addLayer(stream);

  const catchmentPolys = [
    [[30.76,78.98],[30.76,79.10],[30.66,79.12],[30.62,79.01]],
    [[30.62,78.94],[30.62,79.01],[30.52,79.05],[30.47,78.95]],
    [[30.52,78.95],[30.52,79.05],[30.42,79.07],[30.38,78.96]]
  ];
  catchmentPolys.forEach((p,i)=>{
    L.polygon(p,{color:"#7c3aed",weight:1.5,fillColor:"#a78bfa",fillOpacity:.08})
      .bindTooltip(`Sub-catchment ${i+1}`).addTo(demoLayerGroups.catchments);
  });

  const rainfallCircles = [
    {lat:30.69,lon:79.06,r:19000,val:"90+ mm"},
    {lat:30.55,lon:79.02,r:15000,val:"70–90 mm"},
    {lat:30.45,lon:79.01,r:12000,val:"50–70 mm"}
  ];
  rainfallCircles.forEach(x=>{
    L.circle([x.lat,x.lon],{radius:x.r,color:"#2563eb",fillColor:"#60a5fa",fillOpacity:.12,weight:1})
      .bindTooltip(`Rainfall zone: ${x.val}`).addTo(demoLayerGroups.rainfall);
  });

  const slope = L.polygon([[30.72,79.01],[30.75,79.11],[30.60,79.10],[30.58,79.02]],{
    color:"#f59e0b",fillColor:"#f59e0b",fillOpacity:.12,weight:1
  }).bindTooltip("Steep-slope indicator");
  demoLayerGroups.slope.addLayer(slope);
}

function setupLayers(){
  document.querySelectorAll("[data-layer]").forEach(cb=>{
    cb.addEventListener("change",()=>{
      const group = demoLayerGroups[cb.dataset.layer];
      if(!group) return;
      if(cb.checked) group.addTo(map); else map.removeLayer(group);
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
  };
}

function updateDashboard(data={}){
  const score=data.score ?? 74;
  const risk=data.risk ?? (score>=80?"CRITICAL":score>=60?"HIGH":score>=30?"MODERATE":"LOW");
  document.getElementById("riskScore").textContent=score;
  document.getElementById("overallRisk").textContent=risk;
  document.getElementById("overallRisk").className=`risk-badge ${risk.toLowerCase()}`;
  document.getElementById("gaugeFill").style.width=score+"%";
  document.getElementById("gaugeFill").style.background=riskColor(score);
  if(data.rainfall) document.getElementById("rainfallValue").textContent=data.rainfall;
  if(data.soil) document.getElementById("soilValue").textContent=data.soil;
}

async function loadBackendSnapshot(){
  try{
    const res=await fetch(`${API_BASE}/v1/risk/snapshots?district=${encodeURIComponent(document.getElementById("districtSelect").value)}`);
    if(!res.ok) throw new Error("API unavailable");
    const json=await res.json();
    // Adapter: map the backend response into the dashboard.
    // Keep demo values when a field is absent.
    const item=Array.isArray(json)?json[0]:(json.items?.[0]||json);
    if(item){
      updateDashboard({
        score:item.risk_score ?? item.score,
        risk:item.risk_level ?? item.risk,
        rainfall:item.rainfall ?? item.rainfall_3h,
        soil:item.soil_moisture
      });
    }
  }catch(e){
    console.info("Using demo snapshot; backend not reachable.",e.message);
  }
}
