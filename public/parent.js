// 부모님 간편 화면: 큰 글씨, 한 화면에 한 가지 질문, 버튼 3개 이하, 소리로 듣기·말로 하기
// 폰 한 화면 틀: 위(날짜·말하기) 고정 · 가운데만 스크롤 · 아래(달력·일정 알려주기) 고정
// 체험판에서는 window.DEMO_PARENT_TOKEN 으로 바꿔 끼울 수 있다
const tok = () => window.DEMO_PARENT_TOKEN || location.pathname.split("/").pop();
const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ic = (name) => (window.ICONS && window.ICONS[name]) || "";
const TZ = "Asia/Seoul";
const time = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", timeZone: TZ });
const longDay = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long", timeZone: TZ });
const shortDay = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", timeZone: TZ });
const fullWhen = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short", hour: "numeric", minute: "2-digit", timeZone: TZ });
const seoulDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const nowDate = () => (window.demo?.now ? window.demo.now() : new Date());
const MODE = {
  taxi: { icon: "taxi", t: "택시" },
  transit: { icon: "transit", t: "버스·지하철" },
  family: { icon: "family", t: "자녀가 태워줘" },
};

let data = null;
let lastKey = "";
let busy = false;
let mode = "home"; // home | input | calendar — home이 아닐 때는 자동 새로고침으로 화면을 바꾸지 않음
let sayText = ""; // 🔊 버튼으로 읽어 줄 말 (화면마다 바뀜)

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ko-KR";
    u.rate = 0.9;
    speechSynthesis.speak(u);
  } catch {
    /* 소리 안 됨 */
  }
}

function splitTime(d) {
  const parts = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: TZ }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value ?? "";
  return { ampm: get("dayPeriod"), hm: `${get("hour")}:${get("minute")}` };
}

function dayWord(d) {
  const n = nowDate();
  if (seoulDay(d) === seoulDay(n)) return "오늘";
  if (seoulDay(d) === seoulDay(new Date(n.getTime() + 86400000))) return "내일";
  return longDay.format(d);
}

function countdown(d) {
  const min = Math.round((d.getTime() - nowDate().getTime()) / 60000);
  if (min <= 0) return "";
  if (min < 60) return `${min}분 뒤`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 ${min % 60 ? `${min % 60}분 ` : ""}뒤`;
  return `${Math.round(h / 24)}일 뒤`;
}

// ---------------------------------------------------------------- 시작 화면
const splash = document.createElement("div");
splash.className = "splash";
splash.setAttribute("aria-hidden", "true");
splash.innerHTML = `<div class="splash-in">
  <div class="splash-road"><span class="splash-car">${ic("taxi")}</span></div>
  <div class="splash-logo">엄빠<b>어디가</b></div>
  <div class="splash-tag">오늘 갈 곳, 같이 챙겨 드려요</div>
</div>`;
app.parentElement.insertBefore(splash, app);
const splashStart = Date.now();
let splashFrom = splashStart;
function hideSplash() {
  if (splash.classList.contains("done")) return;
  setTimeout(() => splash.classList.add("done"), Math.max(0, 1200 - (Date.now() - splashFrom)));
}
// 다른 앱에 갔다가 다시 열면 시작 화면부터
let hiddenAt = 0;
function replaySplash() {
  splash.classList.remove("done");
  splashFrom = Date.now();
  void load().finally(hideSplash);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 1500) replaySplash();
});
window.addEventListener("pageshow", (e) => { if (e.persisted) replaySplash(); });

async function load() {
  let res;
  try {
    res = await fetch(`/api/p/${tok()}`);
  } catch {
    return;
  }
  hideSplash();
  if (!res.ok) {
    app.innerHTML = `<div class="p-app"><main class="app-main p-main"><div class="card status"><h2>링크가 올바르지 않아요</h2><p>자녀에게 다시 보내 달라고 해 주세요.</p></div></main></div>`;
    return;
  }
  data = await res.json();
  if (mode !== "home") return;
  const s = data.current;
  const call = s?.calls?.[s.calls.length - 1];
  // 화면이 바뀌었을 때만 다시 그림 (버튼 누르는 중 깜빡임 방지)
  const key = JSON.stringify([data.parent.name, data.parent.avatar, s?.id, s?.status, s?.taxi_call_at, call?.status, call?.car_number,
    data.upcoming.map((u) => u.id), Math.floor(nowDate().getTime() / 60000)]);
  if (key !== lastKey) {
    lastKey = key;
    render();
  }
}

// ---------------------------------------------------------------- 틀
function micBtn() {
  return `<button class="p-mic" type="button" data-mic aria-label="말로 하기">${ic("mic")}<span>말하기</span></button>`;
}

/** 위: 제목 + 🔊 + 🎤 / 가운데: 내용 / 아래: 버튼 줄 */
function frame({ title, sub = "", main, bottom = "", back = false }) {
  app.innerHTML = `<div class="p-app">
    <header class="app-top">
      ${back ? `<button class="round-btn" id="hdrBack" type="button" data-voice="back" aria-label="돌아가기">${ic("back")}</button>` : ""}
      <div class="p-title">${sub ? `<div class="p-date">${sub}</div>` : ""}<div class="p-hello">${title}</div></div>
      <div class="p-tools">
        <button class="round-btn" id="say" type="button" data-voice="repeat" aria-label="소리로 듣기">${ic("speaker")}</button>
        ${micBtn()}
      </div>
    </header>
    <main class="app-main p-main">${main}</main>
    ${bottom ? `<nav class="app-bottom p-bottom">${bottom}</nav>` : ""}
  </div>`;
  document.getElementById("say").onclick = () => speak(sayText || "말하기 버튼을 누르고 말씀해 주세요.");
  const hb = document.getElementById("hdrBack");
  if (hb) hb.onclick = backHome;
}

const HOME_BOTTOM = `
  <button class="bigbtn ghost" id="openCal" type="button" data-voice="calendar">${ic("cal")}달력</button>
  <button class="bigbtn ghost" id="addSched" type="button" data-voice="add">${ic("edit")}일정 알려주기</button>`;

function shell(main, foot = true) {
  // 아이콘은 날짜 줄에 (인사말이 한 줄에 들어가게)
  const face = window.PEOPLE ? `<span class="mini-face">${window.PEOPLE.faceSvg(window.PEOPLE.resolve(data.parent.avatar, data.parent.name), 22)}</span>` : "";
  const sub = `${face}${esc(longDay.format(nowDate()))}`;
  frame({ sub, title: `${esc(data.parent.name)}, 안녕하세요`, main, bottom: foot ? HOME_BOTTOM : "" });
  const b = document.getElementById("addSched");
  if (b) b.onclick = () => openInput();
  const c = document.getElementById("openCal");
  if (c) c.onclick = () => openCalendar();
}

function apptCard(s) {
  const d = new Date(s.start_at);
  const t = splitTime(d);
  const cd = countdown(d);
  return `<div class="card appt">
    <div class="appt-when"><span class="appt-day">${esc(dayWord(d))} ${esc(t.ampm)}</span><span class="num">${esc(t.hm)}</span>${cd ? `<span class="tag count">${esc(cd)}</span>` : ""}</div>
    <div class="appt-place">${ic(s.kind) || ic("기타")}<span>${esc(s.place_name)}</span></div>
    <div class="appt-meta"><span>${esc(s.title)}</span>${s.memo ? `<span class="tag memo">${esc(s.memo)}</span>` : ""}${s.shared === 0 ? `<span class="tag lock">🔒 나만 보기</span>` : ""}</div>
  </div>`;
}

function upcomingList() {
  if (!data.upcoming.length) return "";
  return `<div class="card next-list"><h3>다음 일정</h3>${data.upcoming.map((u) => {
    const d = new Date(u.start_at);
    return `<div class="next-row"><span class="num">${esc(seoulDay(d) === seoulDay(nowDate()) ? time.format(d) : shortDay.format(d))}</span><span>${esc(u.place_name)}</span></div>`;
  }).join("")}</div>`;
}

const whenSay = (s) => `${dayWord(new Date(s.start_at))} ${time.format(new Date(s.start_at))} ${s.place_name}`;

// ---------------------------------------------------------------- 화면
function render() {
  const s = data.current;
  if (!s) {
    // 일정 없는 날: 즐거운 하루 그림 (날마다 바뀜)
    const today = seoulDay(nowDate());
    const sc = window.SCENES ? window.SCENES.sceneSvg(`${data.parent.name}-${today}`, data.parent.avatar, data.parent.name) : null;
    sayText = `오늘은 일정이 없어요. ${sc ? `${sc.caption}이에요. ` : ""}즐거운 하루 보내세요. 갈 곳이 생기면 일정 알려주기를 눌러 주세요.`;
    shell(sc
      ? `<div class="card rest-card">${sc.html}
          <div class="rest-text"><b>오늘은 일정이 없어요</b><span>${esc(sc.caption)}</span></div></div>
        <div class="card status"><h2>즐거운 하루 보내세요 😊</h2>
          <p>약속이나 갈 곳이 생기면<br>아래 '일정 알려주기'를 눌러 주세요.</p></div>`
      : `<div class="card status"><div class="big-ic ok">${ic("check")}</div><h2>예정된 일정이 없어요</h2>
      <p>약속이나 갈 곳이 생기면<br>아래 '일정 알려주기'를 눌러 주세요.</p></div>`);
    return;
  }
  const call = s.calls[s.calls.length - 1];

  if (s.status === "calling") {
    sayText = "AI 비서가 콜택시에 전화하고 있어요. 조금만 기다려 주세요.";
    shell(apptCard(s) + `<div class="card status"><div class="big-ic ring">${ic("phone")}</div>
      <h2>택시 부르는 중이에요</h2><p>AI 비서가 콜택시에 전화하고 있어요.<br>조금만 기다려 주세요.</p></div>`, false);
    return;
  }

  if (s.status === "dispatched" && call) {
    const arrive = call.eta_minutes ? new Date(new Date(call.updated_at).getTime() + call.eta_minutes * 60000) : null;
    const at = arrive ? splitTime(arrive) : null;
    sayText = `택시가 와요. 차 번호는 ${call.car_number}. ${call.car_description || ""}. ${arrive ? time.format(arrive) : ""} 도착해요.`;
    shell(`<div class="card status">
        <div class="big-ic">${ic("taxi")}</div>
        <h2>택시가 와요!</h2>
        <div class="plate">${esc(call.car_number || "")}</div>
        <p>${esc(call.car_description || "")}</p>
        ${at ? `<div class="eta"><span>${esc(at.ampm)}</span><span class="num">${esc(at.hm)}</span><span>도착</span></div>` : ""}
        <p>${esc(s.place_name)}까지 모셔다 드려요</p>
      </div>`, false);
    // 아래 버튼 줄: 도착했어요
    app.querySelector(".p-app").insertAdjacentHTML("beforeend",
      `<nav class="app-bottom"><button class="bigbtn" id="arrived" type="button" data-voice="arrived">${ic("check")}도착했어요</button></nav>`);
    document.getElementById("arrived").onclick = () => post("arrived", {}, "자녀에게 알렸어요. 잘 다녀오세요!");
    return;
  }

  if (s.status === "taxi_reserved" && s.taxi_call_at) {
    const c = splitTime(new Date(s.taxi_call_at));
    sayText = `${whenSay(s)} 가시죠. ${time.format(new Date(s.taxi_call_at))}에 택시 불러 드릴게요.`;
    shell(apptCard(s) + `<div class="card status">
        <div class="big-ic ok">${ic("clock")}</div>
        <h2>택시 예약했어요</h2>
        <div class="clock"><span>${esc(c.ampm)}</span><span class="num">${esc(c.hm)}</span></div>
        <p>이 시간에 AI 비서가 택시를 불러 드려요.</p>
      </div>
      <button class="bigbtn" id="now" type="button" data-voice="now taxi">${ic("taxi")}지금 바로 불러줘</button>` + upcomingList());
    document.getElementById("now").onclick = () => post("call-now", {}, "지금 택시 불러 드릴게요");
    return;
  }

  if (s.status === "chosen" && s.chosen_mode) {
    const t = s.route_options?.options.find((o) => o.mode === s.chosen_mode);
    const transit = s.chosen_mode === "transit";
    sayText = transit ? `버스나 지하철로 가세요. 약 ${t?.durationMin ?? ""}분 걸려요.` : "자녀에게 부탁했어요. 곧 연락 올 거예요.";
    const msg = transit
      ? `약 ${t?.durationMin ?? "?"}분 · 걷기 ${t?.walkMeters ?? "?"}m${s.departure_at ? `<br>${esc(time.format(new Date(s.departure_at)))}쯤 나가세요` : ""}`
      : "자녀에게 부탁했어요.<br>곧 연락 올 거예요.";
    shell(apptCard(s) + `<div class="card status"><div class="big-ic ok">${ic(MODE[s.chosen_mode].icon)}</div>
        <h2>${MODE[s.chosen_mode].t}${transit ? "로 가요" : ""}</h2><p>${msg}</p></div>
      <button class="bigbtn" id="arrived" type="button" data-voice="arrived">${ic("check")}도착했어요</button>` + upcomingList());
    document.getElementById("arrived").onclick = () => post("arrived", {}, "자녀에게 알렸어요. 잘 다녀오세요!");
    return;
  }

  // 아직 고르지 않음 (예정 / 물어보는 중 / 무응답 / 호출 실패)
  const cmp = s.route_options;
  const failed = s.status === "call_failed"
    ? `<div class="card status bad"><div class="big-ic sm bad">${ic("warn")}</div><h2>택시를 못 불렀어요</h2><p>자녀에게 알렸어요. 다른 방법을 골라도 돼요.</p></div>` : "";
  const choices = cmp ? cmp.options.map((o) => {
    const m = MODE[o.mode];
    const detail = o.mode === "family" ? "자녀에게 부탁하기"
      : `${o.durationMin}분${o.costWon ? ` · 약 ${o.costWon.toLocaleString()}원` : ""}${o.walkMeters ? ` · 걷기 ${o.walkMeters}m` : ""}`;
    return `<button class="choice ${o.mode === cmp.recommended ? "rec" : ""}" data-mode="${o.mode}" data-voice="${o.mode}" type="button">
      ${o.mode === cmp.recommended ? `<span class="badge">추천</span>` : ""}
      <span class="ic">${ic(m.icon)}</span>
      <span><span class="t">${m.t}</span><span class="d">${esc(detail)}</span></span></button>`;
  }).join("") : "";
  sayText = cmp ? `${whenSay(s)} 가셔야 해요. 뭐 타고 가실래요? ${cmp.reason} 추천은 ${MODE[cmp.recommended].t}예요.` : whenSay(s);
  shell(apptCard(s) + failed + `<p class="question">뭐 타고 가실래요?</p>
    ${cmp ? `<p class="p-reason">${esc(cmp.reason)}</p>` : ""}
    ${choices}
    <p class="voice-hint">${ic("mic")}말로 해도 돼요: "택시", "버스", "아들이 태워줘"</p>` + upcomingList());
  for (const b of app.querySelectorAll(".choice")) {
    b.onclick = () => {
      const m = b.dataset.mode;
      const msg = { taxi: "택시를 불러 드릴게요", transit: "버스·지하철로 안내해 드릴게요", family: "자녀에게 부탁했어요" }[m];
      post("choose", { mode: m }, msg);
    };
  }
}

// ---------------- 달력 (큰 글씨) ----------------
let pcY = 0;
let pcM = 0;
let pcSel = "";
const pKey = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const pMidnight = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, -9));
};

async function openCalendar(y, m) {
  mode = "calendar";
  const today = seoulDay(nowDate());
  if (!y) {
    pcY = Number(today.slice(0, 4));
    pcM = Number(today.slice(5, 7));
    pcSel = today;
  } else {
    pcY = y;
    pcM = m;
  }
  const first = pMidnight(pKey(pcY, pcM, 1));
  const firstWd = new Date(first.getTime() + 9 * 3600000).getUTCDay();
  const start = new Date(first.getTime() - firstWd * 86400000);
  const end = new Date(start.getTime() + 42 * 86400000);
  const res = await fetch(`/api/p/${tok()}/calendar?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`);
  const list = res.ok ? await res.json() : [];
  const byDay = new Map();
  for (const s of list) {
    const k = seoulDay(new Date(s.start_at));
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(s);
  }
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const row = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start.getTime() + (w * 7 + i) * 86400000);
      const k = seoulDay(d);
      const [, mm, dd] = k.split("-").map(Number);
      const has = (byDay.get(k) || []).length;
      row.push(`<button type="button" class="pc-cell ${mm !== pcM ? "out" : ""} ${k === today ? "today" : ""} ${k === pcSel ? "sel" : ""} ${i === 0 ? "sun" : i === 6 ? "sat" : ""}" data-day="${k}"
        aria-label="${mm}월 ${dd}일${has ? ` 일정 ${has}개` : ""}"><span>${dd}</span>${has ? `<i></i>` : ""}</button>`);
    }
    // 마지막 줄이 모두 다음 달이면 생략
    if (w === 5 && row.every((c) => c.includes(" out "))) break;
    weeks.push(row.join(""));
  }
  /** 고른 날의 일정 (달력 바로 아래) */
  const dayPanel = (k) => {
    const list = byDay.get(k) || [];
    const d = new Date(pMidnight(k).getTime() + 12 * 3600000);
    sayText = `${longDay.format(d)}. ${list.length ? list.map((s) => `${time.format(new Date(s.start_at))} ${s.place_name}`).join(", ") : "일정 없어요"}`;
    return `<h3>${esc(longDay.format(d))}</h3>` + (list.length
      ? list.map((s) => `<div class="next-row"><span class="num">${esc(time.format(new Date(s.start_at)))}</span>
          <span><b>${esc(s.place_name)}</b><small>${esc(s.title)}${s.memo ? ` · ${esc(s.memo)}` : ""}</small></span></div>`).join("")
      : `<div class="next-row none">이날은 일정이 없어요</div>`);
  };
  const yearPrefix = pcY !== Number(today.slice(0, 4)) ? `${pcY}년 ` : "";
  frame({
    title: "달력",
    main: `
      <div class="card pc">
        <div class="pc-head">
          <button type="button" class="round-btn sm" id="prevM" data-voice="prev" aria-label="이전 달">${ic("back")}</button>
          <span class="pc-month">${yearPrefix}${pcM}월</span>
          <button type="button" class="round-btn sm" id="nextM" data-voice="next" aria-label="다음 달">${ic("chevron")}</button>
        </div>
        <div class="pc-grid pc-wd">${["일", "월", "화", "수", "목", "금", "토"].map((w, i) => `<span class="${i === 0 ? "sun" : i === 6 ? "sat" : ""}">${w}</span>`).join("")}</div>
        <div class="pc-grid" id="pcGrid">${weeks.join("")}</div>
      </div>
      <div class="card next-list" id="pcDay" aria-live="polite">${dayPanel(pcSel)}</div>`,
    // 홈의 [달력] 자리에 [달력 접기]: 같은 자리를 다시 누르면 닫힘
    bottom: `<button class="bigbtn dark" id="calClose" type="button" data-voice="back">${ic("up")}달력 접기</button>
      <button class="bigbtn ghost" id="addSched" type="button" data-voice="add">${ic("edit")}일정 알려주기</button>`,
  });
  document.getElementById("calClose").onclick = backHome;
  document.getElementById("addSched").onclick = () => openInput();
  document.getElementById("prevM").onclick = () => openCalendar(pcM === 1 ? pcY - 1 : pcY, pcM === 1 ? 12 : pcM - 1);
  document.getElementById("nextM").onclick = () => openCalendar(pcM === 12 ? pcY + 1 : pcY, pcM === 12 ? 1 : pcM + 1);
  document.getElementById("pcGrid").onclick = (e) => {
    const cell = e.target.closest("[data-day]");
    if (!cell) return;
    pcSel = cell.dataset.day;
    const [yy, mm] = pcSel.split("-").map(Number);
    if (yy !== pcY || mm !== pcM) return openCalendar(yy, mm).then(() => speak(sayText));
    // 같은 달: 다시 그리지 않고 고른 날 표시와 아래 일정만 바꿈 (화면이 움직이지 않게)
    for (const c of app.querySelectorAll(".pc-cell.sel")) c.classList.remove("sel");
    cell.classList.add("sel");
    const panel = document.getElementById("pcDay");
    panel.innerHTML = dayPanel(pcSel);
    panel.scrollIntoView({ block: "nearest", behavior: "smooth" }); // 아주 작은 화면이면 일정이 보이게
    speak(sayText);
  };
}

// ---------------- 일정 알려주기 (말하기 또는 글쓰기 → 맞아요/다시) ----------------
const Recognition = window.DEMO_NO_MIC ? null : window.SpeechRecognition || window.webkitSpeechRecognition;

// ---------------- 음성으로 하기 ----------------
// 화면의 버튼마다 data-voice="taxi" 처럼 알아들을 말을 붙여 두고, 말하면 그 버튼을 누른 것처럼 동작한다.
const VOICE_WORD = {
  taxi: "택시", transit: "버스", family: "아들이 태워줘", now: "지금 불러줘", arrived: "도착했어", yes: "맞아요", no: "아니요",
  calendar: "달력", add: "일정 알려줄게", back: "돌아가", prev: "지난달", next: "다음 달", repeat: "다시 말해줘",
};


function voiceRoot() {
  return document.querySelector(".modal-back") || app;
}

/** 지금 화면에서 할 수 있는 말 예시 */
function voiceExamples() {
  const root = voiceRoot();
  if (root.querySelector("[data-voice-any]")) return [INPUT_EXAMPLES[0], INPUT_EXAMPLES[1], "돌아가"];
  // 화면의 주된 행동을 먼저, 공통 버튼(다시 듣기·달력·일정)은 뒤에
  const later = ["repeat", "calendar", "add", "back"];
  const keys = [...root.querySelectorAll("[data-voice]")].map((b) => b.dataset.voice.split(" ")[0]);
  keys.sort((a, b) => later.includes(a) - later.includes(b));
  const words = [];
  for (const k of keys) {
    const w = VOICE_WORD[k];
    if (w && !words.includes(w)) words.push(w);
  }
  return words.slice(0, 5);
}

function handleVoice(text) {
  const said = String(text || "").trim();
  if (!said) return;
  const root = voiceRoot();
  const intents = window.voiceIntent ? window.voiceIntent(said) : [];
  for (const it of intents) {
    const btn = [...root.querySelectorAll("[data-voice]")].find((b) => b.dataset.voice.split(" ").includes(it) && !b.disabled);
    if (btn) return btn.click();
  }
  // 일정 입력 화면: 말한 내용을 그대로 일정으로
  if (root.querySelector("[data-voice-any]")) {
    const txt = document.getElementById("txt");
    if (txt) txt.value = said;
    return submitText(said);
  }
  if (root === app) {
    if (intents.includes("schedule")) return submitText(said); // "내일 3시 치과" → 바로 확인 화면
    if (intents.includes("add")) return openInput();
    if (intents.includes("calendar")) return openCalendar();
    if (intents.includes("back")) return backHome();
  }
  const ex = voiceExamples();
  const msg = `잘 못 알아들었어요.${ex.length ? ` "${ex.slice(0, 3).join('", "')}" 처럼 말씀해 주세요.` : ""}`;
  speak(msg);
  showHeard(said, msg);
}

function showHeard(said, msg) {
  const box = document.createElement("div");
  box.className = "heard";
  box.innerHTML = `<b>"${esc(said)}"</b><span>${esc(msg)}</span>`;
  (document.querySelector(".big") || document.body).appendChild(box);
  setTimeout(() => box.remove(), 5000);
}

let listening = null;

function closeListen() {
  if (listening?.rec) {
    try { listening.rec.abort(); } catch { /* 이미 끝남 */ }
  }
  listening?.el.remove();
  listening = null;
}

/** 말하기 시작: 마이크가 되면 음성 인식, 안 되면 글로 쓰기 */
function listen() {
  if (listening) return;
  const el = document.createElement("div");
  el.className = "voice-back";
  const ex = voiceExamples();
  const typed = !Recognition;
  el.innerHTML = `<div class="card voice-card" role="dialog" aria-label="말로 하기">
    <div class="voice-orb ${typed ? "" : "on"}">${ic("mic")}</div>
    <p class="question" id="vTitle">${typed ? "말할 내용을 써 주세요" : "듣고 있어요"}</p>
    <p class="voice-live" id="vLive">${typed ? (window.DEMO_NO_MIC ? "체험판 화면에서는 마이크를 쓸 수 없어서, 말할 내용을 글로 보내요." : "이 기기에서는 마이크를 쓸 수 없어요.") : "말씀이 끝나면 알아서 넘어가요"}</p>
    ${ex.length ? `<div class="voice-ex">${ex.map((w) => `<button type="button" class="chip" data-say="${esc(w)}">"${esc(w)}"</button>`).join("")}</div>` : ""}
    ${typed ? `<input id="vText" class="voice-input" placeholder="예) 택시" aria-label="말할 내용" /><button class="bigbtn" id="vSend" type="button">${ic("check")}보내기</button>` : ""}
    <button class="bigbtn ghost" id="vClose" type="button">그만하기</button>
  </div>`;
  (document.querySelector(".big") || document.body).appendChild(el);
  listening = { el, rec: null };
  const done = (text) => {
    closeListen();
    handleVoice(text);
  };
  el.querySelector("#vClose").onclick = closeListen;
  for (const c of el.querySelectorAll("[data-say]")) c.onclick = () => done(c.dataset.say);
  if (typed) {
    const input = el.querySelector("#vText");
    input.focus();
    el.querySelector("#vSend").onclick = () => done(input.value);
    input.onkeydown = (e) => { if (e.key === "Enter") done(input.value); };
    return;
  }
  const rec = new Recognition();
  listening.rec = rec;
  rec.lang = "ko-KR";
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let finalText = "";
  rec.onresult = (e) => {
    const t = [...e.results].map((r) => r[0].transcript).join(" ");
    el.querySelector("#vLive").textContent = `"${t}"`;
    if (e.results[e.results.length - 1].isFinal) finalText = t;
  };
  rec.onerror = (e) => {
    const blocked = e.error === "not-allowed" || e.error === "service-not-allowed";
    el.querySelector(".voice-orb").classList.remove("on");
    el.querySelector("#vTitle").textContent = blocked ? "마이크를 쓸 수 없어요" : "잘 안 들렸어요";
    el.querySelector("#vLive").textContent = blocked ? "설정에서 마이크를 허용하거나, 아래 예시를 눌러 주세요." : "다시 눌러서 말씀해 주세요.";
  };
  rec.onend = () => {
    if (finalText) done(finalText);
    else if (listening?.el === el) el.querySelector(".voice-orb")?.classList.remove("on");
  };
  try {
    rec.start();
    speak("");
  } catch {
    el.querySelector("#vTitle").textContent = "마이크를 쓸 수 없어요";
  }
}

// 말하기 버튼 (화면이 바뀌어도 동작하도록 위임)
(document.querySelector(".big") || document.body).addEventListener("click", (e) => {
  if (e.target.closest("[data-mic]")) {
    e.preventDefault();
    listen();
  }
});

function backHome() {
  mode = "home";
  lastKey = "";
  load();
}

function inputShell(main, bottom = "") {
  frame({ title: "일정 알려주기", main, bottom });
  const bar = app.querySelector(".p-bottom");
  if (bar && bar.children.length === 1) bar.classList.add("one");
}

// 말하기 예시: 병원만이 아니라 여러 곳
const INPUT_EXAMPLES = [
  "토요일 낮 12시 종로에서 동창 모임",
  "내일 오전 10시 서울대병원",
  "수요일 오후 2시 복지관 노래교실",
  "모레 오후 3시 망원시장 장보기",
  "일요일 오전 11시 명동성당",
];

function openInput(message) {
  mode = "input";
  const ex = INPUT_EXAMPLES[Math.floor(Math.random() * INPUT_EXAMPLES.length)];
  sayText = `언제, 어디 가세요? 말하기 버튼을 누르고 말씀해 주세요. 예를 들면, ${ex}.`;
  inputShell(`
    <p class="question">언제, 어디 가세요?</p>
    <p class="p-reason">${esc(typeof message === "string" ? message : `예) ${ex}`)}</p>
    <button class="bigbtn tall" type="button" data-mic>${ic("mic")}<span>눌러서 말하기</span></button>
    <div class="p-input"><textarea id="txt" aria-label="일정 내용" placeholder="여기에 써도 돼요. 받은 문자를 붙여 넣어도 돼요."></textarea></div>`,
  `<button class="bigbtn ghost" id="back" type="button" data-voice="back">${ic("back")}돌아가기</button>
   <button class="bigbtn" id="send" type="button" data-voice-any>${ic("check")}알려주기</button>`);
  const txt = document.getElementById("txt");
  document.getElementById("back").onclick = backHome;
  document.getElementById("send").onclick = () => submitText(txt.value);
}

async function submitText(text) {
  if (!text.trim() || busy) return;
  busy = true;
  mode = "input";
  inputShell(`<div class="card status"><div class="spinner"></div><h2>알아보는 중이에요</h2></div>`);
  try {
    const res = await fetch(`/api/p/${tok()}/parse`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "다시 말씀해 주세요");
    showConfirm(d);
  } catch (e) {
    openInput(e.message);
    speak(e.message);
  } finally {
    busy = false;
  }
}

function showConfirm(d) {
  const start = d.start_at ? new Date(d.start_at) : null;
  const t = start ? splitTime(start) : null;
  sayText = `${start ? fullWhen.format(start) : "언제인지 모르겠어요"}, ${d.place_name || "어디인지 모르겠어요"}. 맞으세요?`;
  inputShell(`
    <p class="question">이거 맞아요?</p>
    <div class="card appt">
      ${start ? `<div class="appt-when"><span class="appt-day">${esc(dayWord(start))} ${esc(t.ampm)}</span><span class="num">${esc(t.hm)}</span></div>`
        : `<div class="appt-day">언제인지 모르겠어요</div>`}
      <div class="appt-place">${ic(d.kind) || ic("기타")}<span>${esc(d.place_name || "어디인지 모르겠어요")}</span></div>
      <div class="appt-meta"><span>${esc(start ? longDay.format(start) : "")}</span>${d.memo ? `<span class="tag memo">${esc(d.memo)}</span>` : ""}</div>
    </div>
    <p class="voice-hint">${ic("mic")}"맞아요" 또는 "아니요"라고 말해도 돼요</p>`,
  `<button class="bigbtn ghost" id="again" type="button" data-voice="no">다시 할게요</button>
   ${start ? `<button class="bigbtn" id="yes" type="button" data-voice="yes">${ic("check")}맞아요</button>` : ""}`);
  speak(sayText);
  document.getElementById("again").onclick = () => openInput();
  const yes = document.getElementById("yes");
  if (yes) yes.onclick = () => acceptDraft(d, false);
}

async function acceptDraft(d, force) {
  const res = await fetch(`/api/p/${tok()}/drafts/${d.id}/accept`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force }),
  });
  const out = await res.json().catch(() => ({}));
  if (res.status === 409) return showConflict(d, out.conflicts);
  if (!res.ok) return openInput(out.error || "다시 해 주세요");
  const msg = out.handedToGuardian ? "자녀에게 장소 확인을 부탁했어요" : "일정을 넣었어요";
  sayText = msg;
  inputShell(`<div class="card status"><div class="big-ic ok">${ic("check")}</div><h2>${msg}</h2><p>그날 아침에 알려 드릴게요.</p></div>`);
  speak(msg);
  setTimeout(backHome, 2500);
}

/** 중복·겹치는 일정 팝업 (큰 글씨, 버튼 2개) */
function showConflict(d, conflicts) {
  const dup = conflicts.some((c) => c.type === "duplicate");
  const c = conflicts[0];
  const title = dup ? "이미 같은 일정이 있어요" : "가까운 시간에 다른 일정이 있어요";
  const when = new Date(c.start_at);
  const t = splitTime(when);
  const modal = document.createElement("div");
  modal.className = "modal-back";
  modal.innerHTML = `<div class="card" role="alertdialog" aria-label="${esc(title)}">
    <div class="modal-title"><span class="big-ic sm warn">${ic("warn")}</span><p class="question">${title}</p></div>
    <div class="card sunk appt">
      <div class="appt-when"><span class="appt-day">${esc(dayWord(when))} ${esc(t.ampm)}</span><span class="num">${esc(t.hm)}</span></div>
      <div class="appt-place">${esc(c.place_name)}</div>
    </div>
    <button class="bigbtn" id="cNo" type="button" data-voice="no">안 넣을게요</button>
    <button class="bigbtn ghost" id="cYes" type="button" data-voice="yes">그래도 넣을게요</button>
    <button class="bigbtn dark" type="button" data-mic>${ic("mic")}말로 대답하기</button>
  </div>`;
  (document.querySelector(".big") || document.body).appendChild(modal);
  speak(`${title}. ${fullWhen.format(when)} ${c.place_name}. 그래도 넣을까요?`);
  modal.querySelector("#cNo").onclick = async () => {
    modal.remove();
    await fetch(`/api/p/${tok()}/drafts/${d.id}/dismiss`, { method: "POST" });
    backHome();
  };
  modal.querySelector("#cYes").onclick = () => {
    modal.remove();
    acceptDraft(d, true);
  };
}

async function post(action, body, okMsg) {
  if (busy) return;
  busy = true;
  try {
    const res = await fetch(`/api/p/${tok()}/${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scheduleId: data.current.id, ...body }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || "다시 눌러 주세요");
    speak(okMsg);
  } catch (e) {
    alert(e.message);
  } finally {
    busy = false;
    lastKey = "";
    load();
  }
}

load();
setInterval(load, 2500);
