const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmt = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Seoul" });
const fmtTime = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Seoul" });
const MODE = { taxi: "🚕 택시", transit: "🚌 버스·지하철", family: "🚗 자녀 차량" };
const STATUS = {
  scheduled: ["예정", ""], asked: ["물어보는 중", "brand"], escalated: ["답이 없으세요", "warn"],
  chosen: ["선택 완료", "ok"], calling: ["AI가 택시 부르는 중", "brand"], dispatched: ["택시 배차 완료", "ok"],
  call_failed: ["택시 호출 실패", "bad"], arrived: ["도착", "ok"], cancelled: ["취소됨", ""],
  taxi_reserved: ["택시 예약됨", "ok"],
};
const SOURCE = { sms: "📩 문자에서 가져옴", parent: "🗣 부모님이 알려 주심", guardian: "" };

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
  if (!res.ok) {
    const err = new Error(data.error || `요청 실패 (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** 저장하다 중복·겹치는 일정이 있으면 팝업으로 물어보고, '그래도 저장'이면 force로 다시 보낸다 */
async function saveWithConflictCheck(send) {
  try {
    return await send(false);
  } catch (e) {
    if (e.status !== 409) throw e;
    const ok = await askConflict(e.data.conflicts);
    if (!ok) return null;
    return send(true);
  }
}

function askConflict(conflicts) {
  const dlg = $("#conflictDlg");
  const dup = conflicts.some((c) => c.type === "duplicate");
  $("#conflictTitle").textContent = dup ? "⚠️ 이미 같은 일정이 있어요" : "⚠️ 시간이 겹치는 일정이 있어요";
  $("#conflictList").innerHTML = conflicts.map((c) => `
    <div class="card" style="margin:8px 0">
      <span class="pill ${c.type === "duplicate" ? "bad" : "warn"}">${c.type === "duplicate" ? "같은 일정" : "2시간 안"}</span>
      <b>${fmt.format(new Date(c.start_at))}</b><br>${esc(c.place_name)} ${c.title ? `· ${esc(c.title)}` : ""}
    </div>`).join("") + `<p class="muted">${dup ? "같은 예약이 두 번 들어간 것 같아요." : "이동 시간이 빠듯할 수 있어요."}</p>`;
  dlg.showModal();
  return new Promise((resolve) => {
    $("#conflictForce").onclick = () => { dlg.close(); resolve(true); };
    $("#conflictCancel").onclick = () => { dlg.close(); resolve(false); };
    dlg.oncancel = () => resolve(false);
  });
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

  const drafts = state.drafts || [];
  $("#draftsBox").style.display = drafts.length ? "block" : "none";
  $("#drafts").innerHTML = drafts.map((d) => draftCard(d, byId[d.parent_id])).join("");

  $("#inboxBox").innerHTML = parents.length ? inboxHelp(parents) : `<span class="muted">부모님을 먼저 등록해 주세요.</span>`;

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

function draftCard(d, p) {
  const when = d.start_at ? fmt.format(new Date(d.start_at)) : "날짜·시간 모름";
  const warn = [
    ...d.missing.map((m) => `<span class="pill bad">${esc(m)} 확인</span>`),
    ...d.conflicts.map((c) => `<span class="pill warn">${c.type === "duplicate" ? "같은 일정 있음" : "겹치는 일정"}: ${fmt.format(new Date(c.start_at))} ${esc(c.place_name)}</span>`),
  ].join(" ");
  return `
  <div class="card">
    <div class="row between"><b>${esc(p?.name ?? "")} · ${esc(when)}</b><span class="muted">${SOURCE[d.source] || ""}</span></div>
    <div>${esc(d.title)} — ${esc(d.place_name || "장소 모름")}</div>
    ${d.memo ? `<div class="muted">메모: ${esc(d.memo)}</div>` : ""}
    <div style="margin-top:6px">${warn}</div>
    <details style="margin-top:6px"><summary class="muted">받은 내용</summary><div class="transcript">${esc(d.raw_text)}</div></details>
    <div class="row" style="margin-top:10px">
      ${d.missing.length ? "" : `<button class="btn small primary" onclick="acceptDraft(${d.id})">저장</button>`}
      <button class="btn small" onclick="editDraft(${d.id})">고쳐서 저장</button>
      <button class="btn small" onclick="dismissDraft(${d.id})">무시</button>
    </div>
  </div>`;
}

function inboxHelp(parents) {
  return parents.map((p) => {
    const url = `${location.origin}/api/inbox/${p.token}`;
    return `<div style="margin-bottom:12px">
      <b>${esc(p.name)} 폰</b>
      <div class="transcript" style="word-break:break-all">${esc(url)}</div>
      <button class="btn small" onclick="copyText('${esc(url)}')">주소 복사</button>
    </div>`;
  }).join("") + `
    <details><summary class="muted">설정 방법</summary>
      <p class="muted"><b>아이폰</b>: 단축어 앱 → 자동화 → '메시지' → 메시지에 <b>예약</b>(또는 <b>진료</b>) 포함 →
        '즉시 실행' → 동작 'URL 콘텐츠 가져오기'에서 위 주소, 방법 POST, 본문 '파일'에 <b>메시지</b>를 넣어 주세요.</p>
      <p class="muted"><b>안드로이드</b>: 'SMS 전달(웹훅)' 앱에서 '예약'이 들어간 문자를 위 주소로 POST 하도록 설정해 주세요.</p>
      <p class="muted">같은 예약 문자가 또 오면(확정·전날 안내) 중복으로 보고 건너뛰어요. 날짜나 장소가 불확실하면 위 '확인이 필요한 일정'에 올라와요.</p>
    </details>`;
}

function scheduleCard(s, p) {
  const [label, tone] = STATUS[s.status] || [s.status, ""];
  const cmp = s.route_options;
  const call = s.calls[s.calls.length - 1];
  const active = !["calling", "dispatched", "arrived", "cancelled"].includes(s.status);
  const reserved = s.status === "taxi_reserved" && s.taxi_call_at
    ? `<div class="card" style="background:#f2fbf5;margin-top:10px">🚕 <b>${fmt.format(new Date(s.taxi_call_at))}</b>에 AI 비서가 택시를 불러요
         <button class="btn small" style="margin-left:6px" onclick="callNow(${s.id})">지금 바로 부르기</button></div>` : "";
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
    ${SOURCE[s.source] ? `<div class="muted">${SOURCE[s.source]}</div>` : ""}
    ${s.departure_at ? `<div class="muted">예상 출발 ${fmtTime.format(new Date(s.departure_at))}</div>` : ""}
    ${opts}
    ${reserved}
    ${car}
    ${s.events.length ? `<ul class="timeline">${s.events.map((e) => `<li><time>${fmtTime.format(new Date(e.created_at))}</time>${esc(e.message)}</li>`).join("")}</ul>` : ""}
    ${transcript}
    <div class="row" style="margin-top:10px">
      ${["scheduled", "call_failed", "escalated", "taxi_reserved"].includes(s.status) ? `<button class="btn small" onclick="askNow(${s.id})">지금 물어보기 (데모)</button>` : ""}
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
async function callNow(id) {
  try { await api("POST", `/api/schedules/${id}/call-now`); toast("AI 비서가 전화를 걸고 있어요"); } catch (e) { toast(e.message); }
  refresh();
}
async function acceptDraft(id) {
  try {
    const r = await saveWithConflictCheck((force) => api("POST", `/api/drafts/${id}/accept`, { force }));
    if (r) toast("일정을 저장했어요");
  } catch (e) { toast(e.message); }
  refresh();
}
async function dismissDraft(id) {
  await api("POST", `/api/drafts/${id}/dismiss`);
  refresh();
}
function editDraft(id) {
  const d = state.drafts.find((x) => x.id === id);
  openScheduleDialog(d.parent_id);
  fillFromDraft(d);
}
function copyText(t) {
  navigator.clipboard?.writeText(t).then(() => toast("복사했어요"), () => prompt("주소", t));
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
$("#addSchedBtn").onclick = () => openScheduleDialog();

const toLocalInput = (iso) => new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
}).format(new Date(iso)).replace(" ", "T");

function fillFromDraft(d) {
  const f = schedForm;
  f.draft_id.value = d.id;
  f.title.value = d.title || "";
  if (d.start_at) f.start_local.value = toLocalInput(d.start_at);
  f.placeQuery.value = d.place_name || "";
  if (d.place_lat !== null) {
    f.place_name.value = d.place_name;
    f.place_address.value = d.place_address;
    f.place_lat.value = d.place_lat;
    f.place_lng.value = d.place_lng;
  } else {
    f.place_name.value = "";
    f.place_lat.value = "";
    f.placeQuery.dispatchEvent(new Event("input")); // 비슷한 장소 검색
  }
  f.memo.value = d.memo || "";
  schedKind = d.kind || "기타";
  for (const b of $("#kindSeg").children) b.classList.toggle("on", b.dataset.v === schedKind);
  const missing = d.missing.filter((m) => m !== "장소 위치");
  toast(missing.length ? `${missing.join(", ")}을(를) 채워 주세요` : "채웠어요. 확인 후 저장해 주세요");
}

$("#parseBtn").onclick = async () => {
  const text = schedForm.smsText.value.trim();
  if (!text) return toast("문자를 붙여 넣어 주세요");
  $("#parseBtn").disabled = true;
  try {
    const d = await api("POST", "/api/parse", { parent_id: schedWho, text });
    fillFromDraft(d);
    $("#pasteBox").open = false;
  } catch (e) { toast(e.message); }
  $("#parseBtn").disabled = false;
};

function openScheduleDialog(parentId) {
  if (!state?.parents.length) return openParentDialog();
  schedForm.reset();
  schedForm.draft_id.value = "";
  $("#placeResults").style.display = "none";
  const who = $("#whoSeg");
  schedWho = parentId ?? state.parents[0].id;
  who.innerHTML = state.parents.map((p) => `<button type="button" data-v="${p.id}" class="${p.id === schedWho ? "on" : ""}">${esc(p.name)}</button>`).join("");
  who.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    schedWho = Number(b.dataset.v);
    for (const x of who.children) x.classList.toggle("on", x === b);
  };
  schedDlg.showModal();
}
schedForm.addEventListener("submit", async (e) => {
  if (e.submitter?.value !== "ok") return;
  e.preventDefault();
  const f = schedForm;
  if (!f.place_lat.value) return toast("장소를 검색해서 골라 주세요");
  const body = {
    parent_id: schedWho, title: f.title.value.trim(), kind: schedKind, start_local: f.start_local.value,
    place_name: f.place_name.value, place_address: f.place_address.value,
    place_lat: Number(f.place_lat.value), place_lng: Number(f.place_lng.value), memo: f.memo.value.trim(),
    draft_id: f.draft_id.value ? Number(f.draft_id.value) : null,
  };
  try {
    const r = await saveWithConflictCheck((force) => api("POST", "/api/schedules", { ...body, force }));
    if (!r) return;
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
