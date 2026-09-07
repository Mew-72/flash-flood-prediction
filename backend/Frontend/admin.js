const ADMIN_API = "http://localhost:8000";
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
});

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
    if(!res.ok) throw new Error("Alert endpoint unavailable");
    saveHistory({...payload,status:"Sent"});
    result.textContent="Alert sent successfully through the backend.";
    result.style.color="#15803d";
  }catch(err){
    // Prototype fallback: preserve the workflow locally until the alert API is implemented.
    saveHistory({...payload,status:"Prototype / API not connected"});
    result.textContent="Prototype alert recorded locally. Connect POST /v1/admin/alerts to deliver it.";
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
