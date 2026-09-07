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

const ADMIN_API = getApiBase();
const historyKey = "flashguard_alert_history";

document.addEventListener("DOMContentLoaded",()=>{
  document.querySelectorAll(".admin-nav").forEach(btn=>{
    btn.addEventListener("click",()=>{
      document.querySelectorAll(".admin-nav").forEach(x=>x.classList.remove("active"));
      document.querySelectorAll(".admin-section").forEach(x=>x.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("section-"+btn.dataset.section).classList.add("active");
      if(btn.dataset.section==="history") renderHistory();
    });
  });

  const message=document.getElementById("alertMessage");
  const severity=document.getElementById("alertSeverity");
  function updatePreview(){
    const preview=document.getElementById("alertPreview");
    preview.style.background=severity.value==="CRITICAL"?"#fee2e2":severity.value==="MODERATE"?"#fffbeb":"#fff7ed";
    preview.style.borderColor=severity.value==="CRITICAL"?"#fecaca":severity.value==="MODERATE"?"#fde68a":"#fed7aa";
    preview.querySelector("strong").textContent=`${severity.value} Alert Preview`;
    preview.querySelector("p").textContent=message.value || "Your message will appear here.";
  }
  message.addEventListener("input",updatePreview);
  severity.addEventListener("change",updatePreview);
  document.getElementById("alertForm").addEventListener("submit",sendAlert);
  renderHistory();

  loadAdminRiskSnapshot();
  const districtEl = document.getElementById("alertDistrict");
  if (districtEl) {
    districtEl.addEventListener("change", loadAdminRiskSnapshot);
  }
});

async function loadAdminRiskSnapshot() {
  try {
    const districtEl = document.getElementById("alertDistrict");
    const district = districtEl ? districtEl.value : "Rudraprayag";
    const res = await fetch(`${ADMIN_API}/v1/risk/snapshots?district=${encodeURIComponent(district)}`);
    if (!res.ok) return;
    const json = await res.json();

    let snapshots = [];
    if (json && Array.isArray(json.catchments)) {
      snapshots = json.catchments.flatMap(c => (Array.isArray(c.snapshots) ? c.snapshots : []));
    } else if (Array.isArray(json)) {
      snapshots = json;
    } else if (json && Array.isArray(json.items)) {
      snapshots = json.items;
    }

    if (snapshots.length > 0) {
      const peak = snapshots.reduce((max, s) => {
        const sScore = s.composite_score ?? (s.risk_score != null ? s.risk_score / 100 : (s.score != null ? (s.score > 1 ? s.score / 100 : s.score) : 0));
        const mScore = max?.composite_score ?? (max?.risk_score != null ? max.risk_score / 100 : (max?.score != null ? (max.score > 1 ? max.score / 100 : max.score) : -1));
        return sScore > mScore ? s : max;
      }, snapshots[0]);

      let score = 74;
      if (peak.composite_score != null) {
        score = peak.composite_score <= 1 ? Math.round(peak.composite_score * 100) : Math.round(peak.composite_score);
      } else if (peak.risk_score != null) {
        score = Math.round(peak.risk_score);
      }
      score = Math.min(Math.max(score, 0), 100);

      const risk = (peak.overall_risk_level || peak.risk_level || (score >= 80 ? "CRITICAL" : score >= 60 ? "HIGH" : score >= 30 ? "MODERATE" : "LOW")).toUpperCase();

      const scoreEl = document.getElementById("adminRiskScore");
      if (scoreEl) scoreEl.textContent = score;

      const badgeEl = document.querySelector(".info-card .risk-badge");
      if (badgeEl) {
        badgeEl.textContent = risk;
        badgeEl.className = `risk-badge ${risk.toLowerCase()}`;
      }

      const descEl = document.querySelector(".info-card p");
      if (descEl) {
        descEl.textContent = `${district} regional risk is currently ${risk.toLowerCase()} based on active forecast snapshot.`;
      }
    }
  } catch (e) {
    // Keep fallback values if backend is unreachable
  }
}

async function sendAlert(e){
  e.preventDefault();
  const payload={
    state:document.getElementById("alertState").value,
    district:document.getElementById("alertDistrict").value,
    target:document.getElementById("alertTarget").value,
    severity:document.getElementById("alertSeverity").value,
    message:document.getElementById("alertMessage").value.trim(),
    issued_by:"administrator",
    issued_at:new Date().toISOString()
  };
  if(!payload.message){return;}
  const result=document.getElementById("sendResult");
  result.textContent="Sending…";
  result.style.color="#2563eb";

  try{
    const res=await fetch(`${ADMIN_API}/v1/admin/alerts`,{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(payload)
    });
    if(res.ok){
      saveHistory({...payload,status:"Sent (Backend)"});
      result.textContent="Alert sent successfully through the backend.";
      result.style.color="#15803d";
    } else {
      // Endpoint returned 404/405 (route pending implementation in backend)
      saveHistory({...payload,status:"Recorded locally (Backend pending)"});
      result.textContent=`Prototype alert recorded locally. Backend route POST /v1/admin/alerts returned ${res.status}.`;
      result.style.color="#a16207";
    }
  }catch(err){
    // Network offline or server unreachable
    saveHistory({...payload,status:"Recorded locally (Offline)"});
    result.textContent="Prototype alert recorded locally in browser storage (backend offline).";
    result.style.color="#a16207";
  }
  renderHistory();
}

function saveHistory(alert){
  const existing=JSON.parse(localStorage.getItem(historyKey)||"[]");
  existing.unshift(alert);
  localStorage.setItem(historyKey,JSON.stringify(existing.slice(0,50)));
}

function renderHistory(){
  const body=document.getElementById("historyBody");
  if(!body) return;
  const items=JSON.parse(localStorage.getItem(historyKey)||"[]");
  if(!items.length){
    body.innerHTML=`<tr><td colspan="6" style="color:#94a3b8;text-align:center;padding:30px">No alerts have been issued from this browser yet.</td></tr>`;
    return;
  }
  body.innerHTML=items.map(a=>`
    <tr>
      <td>${new Date(a.issued_at).toLocaleString()}</td>
      <td>${escapeHtml(a.state)} / ${escapeHtml(a.district)}</td>
      <td><span class="risk-badge ${a.severity.toLowerCase()}">${escapeHtml(a.severity)}</span></td>
      <td>${escapeHtml(a.target)}</td>
      <td>${escapeHtml(a.message)}</td>
      <td>${escapeHtml(a.status)}</td>
    </tr>`).join("");
}
function escapeHtml(value){
  return String(value).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
}

