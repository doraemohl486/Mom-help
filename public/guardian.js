// 자녀(보호자) 화면
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ic = (name) => (window.ICONS && window.ICONS[name]) || "";
const TZ = "Asia/Seoul";
const fmt = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short", hour: "numeric", minute: "2-digit", timeZone: TZ });
const fmtTime = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", timeZone: TZ });
const fmtDay = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short", timeZone: TZ });
const dayKey = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const nowDate = () => (window.demo?.now ? window.demo.now() : new Date());

/** "오전 10:30" → { ampm: "오전", hm: "10:30" } */
function splitTime(d) {
  const parts = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ }).formatToParts(d);
  const ampm = parts.find((p) => p.type === "dayPeriod")?.value ?? "";
  const h = parts.find((p) => p.type === "hour")?.value ?? "";
  const m = parts.find((p) => p.type === "minute")?.value ?? "";
  return { ampm, hm: `${h}:${m}` };
}

const MODE = {
  taxi: { name: "택시", icon: "taxi" },
  transit: { name: "버스·지하철", icon: "transit" },
  family: { name: "자녀 차량", icon: "family" },
};
const STATUS = {
  scheduled: ["예정", ""], asked: ["물어보는 중", "brand"], escalated: ["답이 없으세요", "warn"],
  chosen: ["선택 완료", "ok"], taxi_reserved: ["택시 예약", "ok"], calling: ["AI 통화 중", "brand"],
  dispatched: ["배차 완료", "ok"], call_failed: ["호출 실패", "bad"], arrived: ["도착", "ok"], cancelled: ["취소", ""],
};
const SOURCE = { sms: "문자에서 가져옴", parent: "부모님이 알려 주심", guardian: "" };
const NOTIF_KIND = {
  dispatched: ["taxi", "ok"], arrived: ["check", "ok"], call_failed: ["warn", "bad"], escalate: ["warn", "warn"],
  call_retry: ["phone", "warn"], sms_imported: ["sms", ""], sms_review: ["sms", "warn"], parent_review: ["edit", "warn"],
  taxi_reserved: ["clock", ""], family: ["family", "warn"], chosen: ["check", ""], evening: ["bell", ""],
};

let state = null;
let lastJson = "";
const openIds = new Set(); // 펼친 일정
const openTranscripts = new Set();
let seenNotif = 0;
let view = "home";
// 달력
const todayKey0 = () => dayKey(nowDate());
let calY = Number(todayKey0().slice(0, 4));
let calM = Number(todayKey0().slice(5, 7)); // 1~12
let selDay = todayKey0();
let homeMode = "cal";
let calData = [];
let calLoaded = "";

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.style.display = "none"), 2600);
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

function paintIcons(root = document) {
  for (const el of root.querySelectorAll("[data-ic]")) {
    if (!el.firstChild) el.innerHTML = ic(el.dataset.ic);
  }
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
  $("#conflictTitle").textContent = dup ? "이미 같은 일정이 있어요" : "시간이 겹치는 일정이 있어요";
  $("#conflictList").innerHTML = conflicts.map((c) => `
    <div class="card row" style="box-shadow:none">
      <span class="pill ${c.type === "duplicate" ? "bad" : "warn"}">${c.type === "duplicate" ? "같은 일정" : "2시간 안"}</span>
      <div><b>${fmt.format(new Date(c.start_at))}</b><br><span class="muted">${esc(c.place_name)}${c.title ? ` · ${esc(c.title)}` : ""}</span></div>
    </div>`).join("") + `<p class="muted" style="margin:0">${dup ? "같은 예약이 두 번 들어간 것 같아요." : "이동 시간이 빠듯할 수 있어요."}</p>`;
  dlg.showModal();
  return new Promise((resolve) => {
    $("#conflictForce").onclick = () => { dlg.close(); resolve(true); };
    $("#conflictCancel").onclick = () => { dlg.close(); resolve(false); };
    dlg.oncancel = () => resolve(false);
  });
}

/** 한국 날짜 "YYYY-MM-DD" 의 0시 → Date */
const kstMidnight = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, -9));
};
const keyOf = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
/** 달력에 보이는 6주(일요일 시작) */
function calRange() {
  const first = kstMidnight(keyOf(calY, calM, 1));
  const firstWd = new Date(first.getTime() + 9 * 3600000).getUTCDay();
  const start = new Date(first.getTime() - firstWd * 86400000);
  return { start, end: new Date(start.getTime() + 42 * 86400000) };
}

async function refresh(force = false) {
  try {
    const { start, end } = calRange();
    const [next, cal] = await Promise.all([
      api("GET", "/api/state"),
      api("GET", `/api/calendar?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`),
    ]);
    const json = JSON.stringify([next, cal, calY, calM]);
    if (!force && json === lastJson) return; // 바뀐 게 없으면 다시 그리지 않음 (펼친 내용 유지)
    lastJson = json;
    state = next;
    calData = cal;
    render();
  } catch (e) {
    console.error(e);
  }
}

// ---------------------------------------------------------------- 화면 그리기
const ACTIVE = ["asked", "escalated", "calling", "dispatched", "call_failed", "taxi_reserved", "chosen"];

function isNow(s) {
  if (!ACTIVE.includes(s.status)) return false;
  // 오늘 일정이거나 지금 처리 중인 것
  return dayKey(new Date(s.start_at)) === dayKey(nowDate()) || ["asked", "escalated", "calling", "dispatched", "call_failed"].includes(s.status);
}

function render() {
  const { parents, schedules, notifications } = state;
  const byId = Object.fromEntries(parents.map((p, i) => [p.id, { ...p, idx: i }]));

  $("#setupHint").hidden = parents.length > 0;
  $("#famChips").innerHTML = parents.map((p, i) => `<span class="avatar a${i % 3}" title="${esc(p.name)}">${esc(p.name.slice(-1))}</span>`).join("");

  // 요약 한 줄
  const live = schedules.filter((s) => !["cancelled"].includes(s.status));
  const today = live.filter((s) => dayKey(new Date(s.start_at)) === dayKey(nowDate()) && s.status !== "arrived");
  const need = live.filter((s) => ["escalated", "call_failed"].includes(s.status)).length + (state.drafts || []).length;
  $("#summary").textContent = !parents.length ? "부모님을 등록하고 시작해요"
    : need ? `확인할 일이 ${need}개 있어요`
      : today.length ? `오늘 일정 ${today.length}개, 잘 챙기고 있어요` : "오늘은 예정된 일정이 없어요";

  // 지금 (진행 중)
  const nowList = live.filter(isNow);
  $("#nowBox").innerHTML = nowList.map((s) => scheduleCard(s, byId[s.parent_id], true)).join("");

  // 확인 필요
  const drafts = state.drafts || [];
  $("#draftsBox").hidden = !drafts.length;
  $("#draftCount").textContent = drafts.length;
  $("#drafts").innerHTML = drafts.map((d) => draftCard(d, byId[d.parent_id])).join("");

  // 다가오는 일정 (날짜별)
  const rest = live.filter((s) => !isNow(s) && s.status !== "arrived");
  const done = schedules.filter((s) => s.status === "arrived" || s.status === "cancelled");
  const groups = new Map();
  for (const s of rest) {
    const k = dayKey(new Date(s.start_at));
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  const todayKey = dayKey(nowDate());
  const tomorrowKey = dayKey(new Date(nowDate().getTime() + 86400000));
  const dayName = (k, d) => (k === todayKey ? "오늘" : k === tomorrowKey ? "내일" : fmtDay.format(d));
  $("#calWrap").hidden = homeMode !== "cal";
  $("#schedules").hidden = homeMode !== "list";
  for (const b of $("#homeMode").children) b.classList.toggle("on", b.dataset.v === homeMode);
  renderCalendar(byId, nowList);
  $("#schedules").innerHTML = (rest.length || done.length)
    ? [...groups.entries()].map(([k, list]) => `
        <div class="day"><div class="day-label">${dayName(k, new Date(list[0].start_at))}</div>
          ${list.map((s) => scheduleCard(s, byId[s.parent_id], false)).join("")}</div>`).join("")
      + (done.length ? `<details class="more"><summary>끝난 일정 ${done.length}개</summary><div class="stack" style="margin-top:8px">${done.map((s) => scheduleCard(s, byId[s.parent_id], false)).join("")}</div></details>` : "")
    : (parents.length && !nowList.length ? `<div class="card empty"><b>등록된 일정이 없어요</b>아래 노란 + 버튼으로 추가하거나, 병원 예약 문자를 붙여 넣어 보세요.</div>` : "");

  // 알림
  $("#notifs").innerHTML = notifications.length
    ? notifications.slice(0, 30).map((n) => {
      const [icon, tone] = NOTIF_KIND[n.kind] || ["bell", ""];
      return `<div class="notif ${tone ? `k-${tone}` : ""}"><span class="ic">${ic(icon)}</span><div>${esc(n.message)}</div><time>${fmtTime.format(new Date(n.created_at))}</time></div>`;
    }).join("")
    : `<div class="empty"><b>아직 알림이 없어요</b>부모님 일정 알림과 택시 배차 소식이 여기에 모여요.</div>`;
  const newest = notifications[0]?.id ?? 0;
  if (view === "alerts") seenNotif = newest;
  $("#alertDot").hidden = !(newest > seenNotif);

  // 가족
  $("#parents").innerHTML = parents.map((p, i) => `
    <div class="card parent-card">
      <span class="avatar a${i % 3}">${esc(p.name.slice(-1))}</span>
      <div>
        <div class="row between"><b style="font-size:17px">${esc(p.name)}${p.real_name ? ` <span class="muted">(${esc(p.real_name)})</span>` : ""}</b><span class="muted">${esc(p.phone)}</span></div>
        <div class="muted">${esc(p.home_address)}</div>
        ${p.notes ? `<div class="muted">참고: ${esc(p.notes)}</div>` : ""}
        <div class="row" style="margin-top:10px">
          <a class="btn small primary" href="/p/${esc(p.token)}" target="_blank">${esc(p.name)} 화면 열기</a>
          <button class="btn small" type="button" onclick="copyLink('${esc(p.token)}')">링크 복사</button>
        </div>
      </div>
    </div>`).join("");
  $("#inboxBox").innerHTML = parents.length ? inboxHelp(parents) : `<span class="muted">부모님을 먼저 등록해 주세요.</span>`;

  // 설정
  $("#provider").textContent = state.callProvider === "simulator" ? "시뮬레이터 (가상 콜센터)" : state.callProvider;
  $("#simBox").hidden = state.callProvider !== "simulator";
  for (const b of $("#scenario").children) b.classList.toggle("on", b.dataset.v === state.simulatorScenario);
}

// ---------------------------------------------------------------- 달력
function renderCalendar(byId, nowList) {
  const { start } = calRange();
  const tKey = todayKey0();
  const byDay = new Map();
  for (const s of calData) {
    const k = dayKey(new Date(s.start_at));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  }
  const cells = [];
  // 마지막 줄이 모두 다음 달이면 5줄만
  const rows = dayKey(new Date(start.getTime() + 35 * 86400000)).slice(5, 7) === String(calM).padStart(2, "0") ? 6 : 5;
  for (let i = 0; i < rows * 7; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    const k = dayKey(d);
    const [, mm, dd] = k.split("-").map(Number);
    const list = byDay.get(k) || [];
    const cls = [
      mm !== calM ? "out" : "", k === tKey ? "today" : "", k === selDay ? "sel" : "", k < tKey ? "past" : "",
      i % 7 === 0 ? "sun" : i % 7 === 6 ? "sat" : "",
    ].join(" ");
    const dots = list.slice(0, 3).map((s) => `<i class="dot-p a${(byId[s.parent_id]?.idx ?? 0) % 3}"></i>`).join("");
    const evs = list.slice(0, 2).map((s) => `<span class="cal-ev a${(byId[s.parent_id]?.idx ?? 0) % 3}">${esc(splitTime(new Date(s.start_at)).hm)} ${esc(s.place_name)}</span>`).join("");
    cells.push(`<button type="button" class="cal-cell ${cls}" data-day="${k}" aria-label="${esc(k)} 일정 ${list.length}개">
      <span class="cal-num">${dd}</span>
      <span class="cal-dots">${dots}${list.length > 3 ? `<b>+${list.length - 3}</b>` : ""}</span>
      <span class="cal-evs">${evs}${list.length > 2 ? `<span class="cal-more">+${list.length - 2}</span>` : ""}</span>
    </button>`);
  }
  $("#calBox").innerHTML = `
    <div class="cal-head">
      <button type="button" class="btn small ghost" data-nav="-1" aria-label="이전 달">${ic("chevron").replace("<svg", '<svg style="transform:scaleX(-1)"')}</button>
      <b class="cal-title">${calY}년 ${calM}월</b>
      <button type="button" class="btn small ghost" data-nav="1" aria-label="다음 달">${ic("chevron")}</button>
      <button type="button" class="btn small" data-nav="0" style="margin-left:auto">오늘</button>
    </div>
    <div class="cal-grid cal-wd">${["일", "월", "화", "수", "목", "금", "토"].map((w, i) => `<span class="${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${w}</span>`).join("")}</div>
    <div class="cal-grid">${cells.join("")}</div>
    ${state.parents.length > 1 ? `<div class="cal-legend">${state.parents.map((p, i) => `<span><i class="dot-p a${i % 3}"></i>${esc(p.name)}</span>`).join("")}</div>` : ""}`;

  // 고른 날의 일정
  const sel = new Date(kstMidnight(selDay).getTime() + 12 * 3600000);
  const heroIds = new Set(nowList.map((s) => s.id));
  const dayList = (byDay.get(selDay) || []).filter((s) => !heroIds.has(s.id));
  const title = `${selDay === tKey ? "오늘 · " : ""}${fmtDay.format(sel)}`;
  $("#dayBox").innerHTML = `<div class="day-label">${esc(title)}</div>` + (dayList.length
    ? dayList.map((s) => scheduleCard(s, byId[s.parent_id], false)).join("")
    : `<div class="card empty" style="padding:18px"><b>${(byDay.get(selDay) || []).length ? "위에 보이는 일정뿐이에요" : "이날은 일정이 없어요"}</b>
        <button type="button" class="btn small" onclick="openScheduleDialog(undefined, '${selDay}')" ${selDay < tKey ? "hidden" : ""}>${ic("plus")}이날 일정 추가</button></div>`);
}

function moveMonth(delta) {
  if (delta === 0) {
    const k = todayKey0();
    calY = Number(k.slice(0, 4));
    calM = Number(k.slice(5, 7));
    selDay = k;
  } else {
    calM += delta;
    if (calM < 1) { calM = 12; calY--; }
    if (calM > 12) { calM = 1; calY++; }
    selDay = keyOf(calY, calM, 1);
  }
  refresh(true);
}

$("#calBox").addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (nav) return moveMonth(Number(nav.dataset.nav));
  const cell = e.target.closest("[data-day]");
  if (!cell) return;
  selDay = cell.dataset.day;
  const [y, m] = selDay.split("-").map(Number);
  if (y !== calY || m !== calM) { calY = y; calM = m; return refresh(true); }
  render();
});
$("#homeMode").addEventListener("click", (e) => {
  const b = e.target.closest("[data-v]");
  if (!b) return;
  homeMode = b.dataset.v;
  render();
});

function steps(s) {
  const names = ["알림", "교통수단", "택시 호출", "배차", "도착"];
  const taxi = s.chosen_mode === "taxi" || ["calling", "dispatched", "call_failed", "taxi_reserved"].includes(s.status);
  if (!taxi && s.chosen_mode) names.splice(2, 2, "출발");
  const at = {
    scheduled: 0, asked: 1, escalated: 1, chosen: 2, taxi_reserved: 2, calling: 2, call_failed: 2, dispatched: 3, arrived: names.length,
  }[s.status] ?? 0;
  const sent = (s.stages_sent || []).length > 0 || s.status !== "scheduled";
  return `<div class="steps" style="grid-template-columns:repeat(${names.length},1fr)">${names.map((n, i) => {
    let cls = i < at ? "done" : i === at ? "now" : "";
    if (i === 0 && sent && at === 0) cls = "now";
    if (s.status === "call_failed" && i === 2) cls = "bad";
    if (s.status === "taxi_reserved" && i === 2) cls = "now";
    return `<div class="step ${cls}"><i></i>${n}</div>`;
  }).join("")}</div>`;
}

function modesBlock(s) {
  const cmp = s.route_options;
  if (!cmp) return "";
  const can = !["calling", "dispatched", "arrived", "cancelled"].includes(s.status);
  const est = cmp.options.some((o) => o.source === "estimate");
  return `<div>
    <div class="modes">${cmp.options.map((o) => `
      <button type="button" class="mode ${o.mode === cmp.recommended ? "rec" : ""} ${s.chosen_mode === o.mode ? "chosen" : ""}" ${can ? "" : "disabled"} onclick="choose(${s.id}, '${o.mode}')">
        <span class="m-name">${ic(MODE[o.mode].icon)}${MODE[o.mode].name}</span>
        <span class="m-time num">${o.durationMin}분</span>
        <span class="m-sub">${o.costWon ? `${o.costWon.toLocaleString()}원` : "비용 없음"}${o.walkMeters ? ` · 걷기 ${o.walkMeters}m` : ""}</span>
      </button>`).join("")}
    </div>
    <p class="reason" style="margin-top:8px">${esc(cmp.reason)}${est ? " (거리로 추정한 값)" : ""}</p>
  </div>`;
}

function scheduleCard(s, p, hero) {
  const [label, tone] = STATUS[s.status] || [s.status, ""];
  const start = new Date(s.start_at);
  const t = splitTime(start);
  const open = hero || openIds.has(s.id);
  const call = s.calls[s.calls.length - 1];
  const attention = ["escalated"].includes(s.status);
  const bad = s.status === "call_failed";

  const banners = [];
  if (s.status === "escalated") {
    banners.push(`<div class="banner-warn">${ic("warn")}<span><b>${esc(p?.name ?? "")}</b> 답이 없으세요. 대신 골라 주세요.</span></div>`);
  }
  if (s.status === "taxi_reserved" && s.taxi_call_at) {
    banners.push(`<div class="banner-ok">${ic("clock")}<span><b class="num" style="font-size:18px">${fmtTime.format(new Date(s.taxi_call_at))}</b>에 AI 비서가 택시를 불러요</span>
      <button class="btn small dark" type="button" onclick="callNow(${s.id})" style="margin-left:auto">지금 바로 부르기</button></div>`);
  }
  if (s.status === "calling") {
    banners.push(`<div class="banner-ok" style="background:var(--brand-soft)">${ic("phone")}<span>AI 비서가 동행 온다콜택시와 통화하고 있어요${call && call.attempt > 1 ? ` (${call.attempt}번째)` : ""}</span></div>`);
  }
  if (call && call.status === "dispatched") {
    banners.push(`<div class="banner-ok">${ic("taxi")}<span class="plate-sm">${esc(call.car_number)}</span><span>${esc(call.car_description || "")}${call.eta_minutes ? ` · <b>${call.eta_minutes}분</b> 뒤 도착` : ""}</span></div>`);
  }
  if (bad) {
    banners.push(`<div class="banner-bad">${ic("warn")}<span>택시를 못 불렀어요. 카카오T '대신 불러주기'나 1855-0120으로 불러 주세요.</span></div>`);
  }

  const transcript = call ? `
    <details class="more" ${openTranscripts.has(s.id) ? "open" : ""} ontoggle="toggleTranscript(${s.id}, this.open)">
      <summary>AI 통화 내용 ${call.transcript.length}줄</summary>
      <div class="transcript" style="margin-top:8px">${call.transcript.map((x) => `<p><span class="who-${x.who}">${x.who === "ai" ? "AI 비서" : "콜센터"}</span> ${esc(x.text)}</p>`).join("")}</div>
    </details>` : "";

  const body = open ? `
    <div class="sched-body">
      ${steps(s)}
      ${banners.join("")}
      <div class="facts">
        ${s.departure_at ? `<span>${ic("clock")}출발 <b>${fmtTime.format(new Date(s.departure_at))}</b></span>` : ""}
        ${s.memo ? `<span>${ic("edit")}<b>${esc(s.memo)}</b></span>` : ""}
        ${SOURCE[s.source] ? `<span>${ic(s.source === "sms" ? "sms" : "users")}${SOURCE[s.source]}</span>` : ""}
      </div>
      ${["dispatched", "arrived", "cancelled"].includes(s.status) ? "" : modesBlock(s)}
      ${s.events.length ? `<details class="more"><summary>진행 기록 ${s.events.length}개</summary><ul class="timeline" style="margin-top:8px">${s.events.map((e) => `<li><time>${fmtTime.format(new Date(e.created_at))}</time><span>${esc(e.message)}</span></li>`).join("")}</ul></details>` : ""}
      ${transcript}
      <div class="actions">
        ${["scheduled", "call_failed", "escalated", "taxi_reserved"].includes(s.status) ? `<button class="btn small" type="button" onclick="askNow(${s.id})">${ic("bell")}지금 물어보기 (데모)</button>` : ""}
        ${!["cancelled", "arrived"].includes(s.status) ? `<button class="btn small ghost" type="button" onclick="cancelSched(${s.id})">일정 취소</button>` : ""}
      </div>
    </div>` : "";

  return `
  <div class="card sched ${hero ? "hero" : ""} ${attention ? "attention" : ""} ${bad ? "badstate" : ""}">
    <button type="button" class="sched-head" ${hero ? "" : `onclick="toggleSched(${s.id})"`} aria-expanded="${open}">
      <span class="sched-time"><small>${esc(t.ampm)}</small><span class="num">${esc(t.hm)}</span></span>
      <span class="sched-main">
        <span class="sched-title">${ic(s.kind) || ic("기타")}${esc(s.title)}</span>
        <span class="sched-place">${esc(s.place_name)}${!hero && s.memo ? ` · ${esc(s.memo)}` : ""}</span>
      </span>
      <span class="sched-side"><span class="pill ${tone}">${label}</span><span class="who">${esc(p?.name ?? "")}</span></span>
    </button>
    ${body}
  </div>`;
}

function draftCard(d, p) {
  const when = d.start_at ? fmt.format(new Date(d.start_at)) : "날짜·시간을 모르겠어요";
  const warn = [
    ...d.missing.map((m) => `<span class="pill bad">${esc(m)} 확인</span>`),
    ...d.conflicts.map((c) => `<span class="pill warn">${c.type === "duplicate" ? "같은 일정 있음" : "겹치는 일정"} · ${fmtTime.format(new Date(c.start_at))} ${esc(c.place_name)}</span>`),
  ].join(" ");
  return `
  <div class="card stripe-warn stack" style="gap:8px">
    <div class="row between"><b>${esc(p?.name ?? "")} · ${esc(when)}</b><span class="pill">${ic(d.source === "sms" ? "sms" : "users")}${SOURCE[d.source] || "직접 입력"}</span></div>
    <div>${esc(d.title)} · ${esc(d.place_name || "장소를 모르겠어요")}${d.memo ? ` <span class="muted">· ${esc(d.memo)}</span>` : ""}</div>
    ${warn ? `<div class="row">${warn}</div>` : ""}
    <details class="more"><summary>받은 내용</summary><div class="transcript" style="margin-top:6px">${esc(d.raw_text)}</div></details>
    <div class="actions">
      ${d.missing.length ? "" : `<button class="btn small primary" type="button" onclick="acceptDraft(${d.id})">저장</button>`}
      <button class="btn small" type="button" onclick="editDraft(${d.id})">고쳐서 저장</button>
      <button class="btn small ghost" type="button" onclick="dismissDraft(${d.id})">무시</button>
    </div>
  </div>`;
}

function inboxHelp(parents) {
  return `<p class="muted" style="margin-top:0">부모님 폰에 온 병원 예약 문자를 이 주소로 넘기면 일정이 알아서 생겨요. 같은 예약 문자가 또 오면 건너뛰고, 애매하면 '확인이 필요해요'에 올려요.</p>`
    + parents.map((p) => {
      const url = `${location.origin}/api/inbox/${p.token}`;
      return `<div class="stack" style="gap:6px;margin-bottom:12px"><b>${esc(p.name)} 폰</b><div class="mono">${esc(url)}</div>
        <div><button class="btn small" type="button" onclick="copyText('${esc(url)}')">주소 복사</button></div></div>`;
    }).join("") + `
    <details class="more"><summary>폰 설정 방법</summary>
      <p class="muted"><b>아이폰</b> · 단축어 → 자동화 → 메시지 → '예약' 또는 '진료' 포함 → 즉시 실행 → 'URL 콘텐츠 가져오기'에 위 주소, 방법 POST, 본문에 '메시지'</p>
      <p class="muted"><b>안드로이드</b> · 문자 웹훅 전달 앱에서 '예약'이 들어간 문자를 위 주소로 POST</p>
    </details>`;
}

// ---------------------------------------------------------------- 동작
function toggleSched(id) {
  if (openIds.has(id)) openIds.delete(id);
  else openIds.add(id);
  render();
}
function toggleTranscript(id, open) {
  if (open) openTranscripts.add(id);
  else openTranscripts.delete(id);
}
async function choose(id, mode) {
  if (mode === "taxi" && !confirm("AI 비서가 동행 온다콜택시에 전화해서 택시를 부를까요?")) return;
  try {
    await api("POST", `/api/schedules/${id}/choose`, { mode });
    toast(mode === "taxi" ? "택시를 맡았어요" : "전달했어요");
  } catch (e) { toast(e.message); }
  refresh(true);
}
async function callNow(id) {
  try { await api("POST", `/api/schedules/${id}/call-now`); toast("AI 비서가 전화를 걸고 있어요"); } catch (e) { toast(e.message); }
  refresh(true);
}
async function acceptDraft(id) {
  try {
    const r = await saveWithConflictCheck((force) => api("POST", `/api/drafts/${id}/accept`, { force }));
    if (r) toast("일정을 저장했어요");
  } catch (e) { toast(e.message); }
  refresh(true);
}
async function dismissDraft(id) {
  await api("POST", `/api/drafts/${id}/dismiss`);
  refresh(true);
}
function editDraft(id) {
  const d = state.drafts.find((x) => x.id === id);
  openScheduleDialog(d.parent_id);
  fillFromDraft(d);
}
function copyText(t) {
  navigator.clipboard?.writeText(t).then(() => toast("복사했어요"), () => toast("복사하지 못했어요. 길게 눌러 복사해 주세요."));
}
async function askNow(id) {
  try { await api("POST", `/api/schedules/${id}/ask-now`); toast("부모님께 물어봤어요"); } catch (e) { toast(e.message); }
  refresh(true);
}
async function cancelSched(id) {
  if (!confirm("이 일정을 취소할까요?")) return;
  await api("DELETE", `/api/schedules/${id}`);
  refresh(true);
}
function copyLink(token) {
  const url = `${location.origin}/p/${token}`;
  navigator.clipboard?.writeText(url).then(() => toast("링크를 복사했어요. 부모님 폰으로 보내 주세요."), () => toast("복사하지 못했어요."));
}

// 아래 탭
function showView(name) {
  view = name;
  for (const b of document.querySelectorAll("#gTabs [data-view]")) b.classList.toggle("on", b.dataset.view === name);
  for (const v of document.querySelectorAll(".g-view")) v.classList.toggle("on", v.id === `view-${name}`);
  if (name === "alerts" && state) {
    seenNotif = state.notifications[0]?.id ?? 0;
    $("#alertDot").hidden = true;
  }
  ($("#gApp").closest(".pane") || window).scrollTo?.(0, 0);
}
$("#gTabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-view]");
  if (b) showView(b.dataset.view);
});

// ---------------- 장소 검색 ----------------
function bindPlaceSearch(form, resultsEl, onPick) {
  let timer;
  form.placeQuery.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = form.placeQuery.value.trim();
      if (!q) return (resultsEl.hidden = true);
      const places = await api("GET", `/api/places?q=${encodeURIComponent(q)}`);
      resultsEl.innerHTML = places.length
        ? places.map((p, i) => `<div data-i="${i}"><b>${esc(p.name)}</b><br><span class="muted">${esc(p.address)}</span></div>`).join("")
        : `<div class="muted">검색 결과가 없어요</div>`;
      resultsEl.hidden = false;
      resultsEl.onclick = (ev) => {
        const i = ev.target.closest("[data-i]")?.dataset.i;
        if (i === undefined) return;
        onPick(places[Number(i)]);
        resultsEl.hidden = true;
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
  $("#homeResults").hidden = true;
  parentDlg.showModal();
}
$("#setupBtn").onclick = openParentDialog;
$("#addParentBtn").onclick = openParentDialog;
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
    refresh(true);
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
  timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
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
  toast(missing.length ? `${missing.join(", ")}을(를) 채워 주세요` : "채웠어요. 확인하고 저장해 주세요");
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

function openScheduleDialog(parentId, dateKey) {
  if (!state?.parents.length) return openParentDialog();
  schedForm.reset();
  schedForm.draft_id.value = "";
  $("#placeResults").hidden = true;
  $("#pasteBox").open = false;
  const who = $("#whoSeg");
  schedWho = parentId ?? state.parents[0].id;
  who.innerHTML = state.parents.map((p) => `<button type="button" data-v="${p.id}" class="${p.id === schedWho ? "on" : ""}">${esc(p.name)}</button>`).join("");
  who.onclick = (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    schedWho = Number(b.dataset.v);
    for (const x of who.children) x.classList.toggle("on", x === b);
  };
  schedKind = "병원";
  for (const b of $("#kindSeg").children) b.classList.toggle("on", b.dataset.v === schedKind);
  if (dateKey) schedForm.start_local.value = `${dateKey}T10:00`;
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
    showView("home");
    refresh(true);
  } catch (err) { toast(err.message); }
});

// ---------------- 시뮬레이터 ----------------
$("#scenario").addEventListener("click", async (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  await api("POST", "/api/simulator/scenario", { scenario: b.dataset.v });
  refresh(true);
});

paintIcons();
refresh(true);
setInterval(refresh, 2500);
