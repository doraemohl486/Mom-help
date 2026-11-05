const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Seoul" });
const fmtTime = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Seoul" });
const MODE = { taxi: "🚕 택시", transit: "🚌 버스·지하철", family: "🚗 자녀 차량" };
const STATUS = {
  scheduled: ["예정", ""], asked: ["물어보는 중", "brand"], escalated: ["답이 없으세요", "warn"],
  chosen: ["선택 완료", "ok"], calling: ["AI가 택시 부르는 중", "brand"], dispatched: ["택시 배차 완료", "ok"],
  call_failed: ["택시 호출 실패", "bad"], arrived: ["도착", "ok"], cancelled: ["취소됨", ""],
};

let state = null;

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.style.display = "none"), 2500);
}

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
  return data;
}

async function refresh() {
  try {
    state = await api("GET", "/api/state");
    render();
  } catch (e) {
    console.error(e);
  }
}

function render() {
  const { parents, schedules, notifications } = state;
  $("#setupHint").style.display = parents.length ? "none" : "block";
  $("#provider").textContent = state.callProvider === "simulator" ? "시뮬레이터 (가상 콜센터)" : state.callProvider;
  $("#simBox").style.display = state.callProvider === "simulator" ? "block" : "none";
  for (const b of $("#scenario").children) b.classList.toggle("on", b.dataset.v === state.simulatorScenario);

  const byId = Object.fromEntries(parents.map((p) => [p.id, p]));
  $("#schedules").innerHTML = schedules.length
    ? schedules.map((s) => scheduleCard(s, byId[s.parent_id])).join("")
    : `<div class="card muted">등록된 일정이 없어요. 오른쪽 위 '+ 일정 추가'를 눌러 주세요.</div>`;

  $("#notifs").innerHTML = notifications.length
    ? notifications.slice(0, 8).map((n) => `<div class="notif"><span class="muted">${fmtTime.format(new Date(n.created_at))}</span> ${esc(n.message)}</div>`).join("")
    : `<span class="muted">아직 알림이 없어요.</span>`;

  $("#parents").innerHTML = parents.map((p) => `
    <div class="card">
      <div class="row between"><b>${esc(p.name)}</b><span class="muted">${esc(p.phone)}</span></div>
      <div class="muted">${esc(p.home_address)}</div>
      <div class="row" style="margin-top:8px">
        <a class="btn small" href="/p/${esc(p.token)}" target="_blank">${esc(p.name)} 화면 열기</a>
        <button class="btn small" onclick="copyLink('${esc(p.token)}')">링크 복사</button>
      </div>
    </div>`).join("");
}

function scheduleCard(s, p) {
  const [label, tone] = STATUS[s.status] || [s.status, ""];
  const cmp = s.route_options;
  const call = s.calls[s.calls.length - 1];
  const active = !["calling", "dispatched", "arrived", "cancelled"].includes(s.status);
  const opts = cmp ? `
    <div class="options">${cmp.options.map((o) => `
      <button class="opt ${o.mode === cmp.recommended ? "rec" : ""}" ${active ? "" : "disabled"} onclick="choose(${s.id}, '${o.mode}')">
        <b>${MODE[o.mode]}</b><br>${o.durationMin}분${o.costWon ? ` · ${o.costWon.toLocaleString()}원` : ""}
        ${o.walkMeters ? `<br><span class="muted">걷기 ${o.walkMeters}m</span>` : ""}
      </button>`).join("")}
    </div>
    <div class="muted" style="margin-top:6px">추천: ${MODE[cmp.recommended]} — ${esc(cmp.reason)}
      ${cmp.options.some((o) => o.source === "estimate") ? " (일부 추정치)" : ""}</div>` : "";
  const car = call && call.status === "dispatched"
    ? `<div class="card" style="background:#f2fbf5;margin-top:10px"><b>🚕 ${esc(call.car_number)}</b> ${esc(call.car_description || "")}
         ${call.eta_minutes ? `· ${call.eta_minutes}분 후 도착` : ""}</div>` : "";
  const transcript = call ? `
    <details style="margin-top:8px"><summary class="muted">AI 통화 내용 (${call.transcript.length}줄)</summary>
      <div class="transcript">${call.transcript.map((t) => `<p class="${t.who}"><b>${t.who === "ai" ? "AI 비서" : "콜센터"}</b>: ${esc(t.text)}</p>`).join("")}</div>
    </details>` : "";
  return `
  <div class="card sched">
    <div class="row between">
      <span class="when">${esc(p?.name ?? "")} · ${fmt.format(new Date(s.start_at))}</span>
      <span class="pill ${tone}">${label}</span>
    </div>
    <div class="where">${esc(s.title)} — ${esc(s.place_name)}</div>
    ${s.memo ? `<div class="muted">메모: ${esc(s.memo)}</div>` : ""}
    ${s.departure_at ? `<div class="muted">예상 출발 ${fmtTime.format(new Date(s.departure_at))}</div>` : ""}
    ${opts}
    ${car}
    ${s.events.length ? `<ul class="timeline">${s.events.map((e) => `<li><time>${fmtTime.format(new Date(e.created_at))}</time>${esc(e.message)}</li>`).join("")}</ul>` : ""}
    ${transcript}
    <div class="row" style="margin-top:10px">
      ${["scheduled", "call_failed", "escalated"].includes(s.status) ? `<button class="btn small" onclick="askNow(${s.id})">지금 물어보기 (데모)</button>` : ""}
      ${s.status !== "cancelled" && s.status !== "arrived" ? `<button class="btn small" onclick="cancelSched(${s.id})">취소</button>` : ""}
    </div>
  </div>`;
}

async function choose(id, mode) {
  if (mode === "taxi" && !confirm("AI 비서가 동행 온다콜택시에 전화해서 택시를 부를까요?")) return;
  try {
    await api("POST", `/api/schedules/${id}/choose`, { mode });
    toast(mode === "taxi" ? "AI 비서가 전화를 걸고 있어요" : "전달했어요");
  } catch (e) { toast(e.message); }
  refresh();
}
async function askNow(id) {
  try { await api("POST", `/api/schedules/${id}/ask-now`); toast("부모님께 물어봤어요"); } catch (e) { toast(e.message); }
  refresh();
}
async function cancelSched(id) {
  if (!confirm("이 일정을 취소할까요?")) return;
  await api("DELETE", `/api/schedules/${id}`);
  refresh();
}
function copyLink(token) {
  const url = `${location.origin}/p/${token}`;
  navigator.clipboard?.writeText(url).then(() => toast("링크를 복사했어요. 부모님 폰으로 보내 주세요."), () => prompt("링크", url));
}

// ---------------- 장소 검색 ----------------
function bindPlaceSearch(form, resultsEl, onPick) {
  let timer;
  form.placeQuery.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = form.placeQuery.value.trim();
      if (!q) return (resultsEl.style.display = "none");
      const places = await api("GET", `/api/places?q=${encodeURIComponent(q)}`);
      resultsEl.innerHTML = places.length
        ? places.map((p, i) => `<div data-i="${i}"><b>${esc(p.name)}</b><br><span class="muted">${esc(p.address)}</span></div>`).join("")
        : `<div class="muted">검색 결과가 없어요</div>`;
      resultsEl.style.display = "block";
      resultsEl.onclick = (ev) => {
        const i = ev.target.closest("[data-i]")?.dataset.i;
        if (i === undefined) return;
        onPick(places[Number(i)]);
        resultsEl.style.display = "none";
      };
    }, 250);
  });
}

function segment(el, input) {
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    for (const x of el.children) x.classList.toggle("on", x === b);
    if (input) input.value = b.dataset.v;
  });
}

// ---------------- 부모님 등록 ----------------
const parentDlg = $("#parentDlg");
const parentForm = $("#parentForm");
segment($("#pNameSeg"), parentForm.pname);
bindPlaceSearch(parentForm, $("#homeResults"), (p) => {
  parentForm.home_address.value = `${p.address} (${p.name})`;
  parentForm.home_lat.value = p.lat;
  parentForm.home_lng.value = p.lng;
});
function openParentDialog() {
  parentForm.reset();
  parentDlg.showModal();
}
parentForm.addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  e.preventDefault();
  const f = parentForm;
  if (!f.home_lat.value) return toast("집 주소를 검색해서 골라 주세요");
  try {
    await api("POST", "/api/parents", {
      name: f.pname.value.trim(), real_name: f.real_name.value.trim(), phone: f.phone.value.trim(), home_address: f.home_address.value,
      home_lat: Number(f.home_lat.value), home_lng: Number(f.home_lng.value),
      preferred_mode: f.preferred_mode.value || null, notes: f.notes.value.trim(),
    });
    parentDlg.close();
    toast("등록했어요");
    refresh();
  } catch (err) { toast(err.message); }
});

// ---------------- 일정 추가 ----------------
const schedDlg = $("#schedDlg");
const schedForm = $("#schedForm");
let schedKind = "병원";
let schedWho = null;
$("#kindSeg").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) schedKind = b.dataset.v; });
segment($("#kindSeg"));
bindPlaceSearch(schedForm, $("#placeResults"), (p) => {
  schedForm.place_name.value = p.name;
  schedForm.place_address.value = p.address;
  schedForm.place_lat.value = p.lat;
  schedForm.place_lng.value = p.lng;
});
$("#addSchedBtn").onclick = () => {
  if (!state?.parents.length) return openParentDialog();
  schedForm.reset();
  const who = $("#whoSeg");
  who.innerHTML = state.parents.map((p, i) => `<button type="button" data-v="${p.id}" class="${i === 0 ? "on" : ""}">${esc(p.name)}</button>`).join("");
  schedWho = state.parents[0].id;
  who.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    schedWho = Number(b.dataset.v);
    for (const x of who.children) x.classList.toggle("on", x === b);
  };
  schedDlg.showModal();
};
schedForm.addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  e.preventDefault();
  const f = schedForm;
  if (!f.place_lat.value) return toast("장소를 검색해서 골라 주세요");
  try {
    await api("POST", "/api/schedules", {
      parent_id: schedWho, title: f.title.value.trim(), kind: schedKind, start_local: f.start_local.value,
      place_name: f.place_name.value, place_address: f.place_address.value,
      place_lat: Number(f.place_lat.value), place_lng: Number(f.place_lng.value), memo: f.memo.value.trim(),
    });
    schedDlg.close();
    toast("일정을 저장했어요");
    refresh();
  } catch (err) { toast(err.message); }
});

// ---------------- 시뮬레이터 ----------------
$("#scenario").addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  await api("POST", "/api/simulator/scenario", { scenario: b.dataset.v });
  refresh();
});

refresh();
setInterval(refresh, 2500);
