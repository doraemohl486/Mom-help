// 부모님 간편 화면: 큰 글씨, 버튼 3개 이하, 소리로 듣기
// 체험판에서는 window.DEMO_PARENT_TOKEN 으로 바꿔 끼울 수 있다
const tok = () => window.DEMO_PARENT_TOKEN || location.pathname.split("/").pop();
const app = document.getElementById("app");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const time = new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Seoul" });
const day = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long", timeZone: "Asia/Seoul" });
const seoulDay = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(d);
const MODE = {
  taxi: { icon: "🚕", t: "택시" },
  transit: { icon: "🚌", t: "버스·지하철" },
  family: { icon: "🚗", t: "자녀가 태워줘" },
};

let data = null;
let lastKey = "";
let busy = false;
let mode = "home"; // home | input — 입력 중에는 자동 새로고침으로 화면을 바꾸지 않음

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  u.rate = 0.9;
  speechSynthesis.speak(u);
}

async function load() {
  const res = await fetch(`/api/p/${tok()}`);
  if (!res.ok) {
    app.innerHTML = `<p class="appt">링크가 올바르지 않아요.<small>자녀에게 다시 보내 달라고 해 주세요.</small></p>`;
    return;
  }
  data = await res.json();
  if (mode !== "home") return;
  const s = data.current;
  const call = s?.calls?.[s.calls.length - 1];
  // 화면이 바뀌었을 때만 다시 그림 (버튼 누르는 중 깜빡임 방지)
  const key = JSON.stringify([data.parent.name, s?.id, s?.status, call?.status, call?.car_number]);
  if (key !== lastKey) {
    lastKey = key;
    render();
  }
}

function whenText(s) {
  const d = new Date(s.start_at);
  const today = seoulDay(new Date()) === seoulDay(d);
  return `${today ? "오늘" : day.format(d)} ${time.format(d)}`;
}

const addBtn = `<button class="bigbtn ghost" id="addSched" style="margin-top:28px">📝 일정 알려주기</button>`;
function bindAdd() {
  const b = document.getElementById("addSched");
  if (b) b.onclick = openInput;
}

function render() {
  renderMain();
  bindAdd();
}

function renderMain() {
  const s = data.current;
  const name = data.parent.name;
  if (!s) {
    app.innerHTML = `<p class="hello">${esc(name)}, 안녕하세요</p><p class="appt">예정된 일정이 없어요 😊</p>` + addBtn;
    return;
  }
  const head = `<p class="hello">${esc(name)}, 안녕하세요</p>
    <p class="appt">${esc(whenText(s))}<br>${esc(s.place_name)}<small>${esc(s.title)}${s.memo ? ` · ${esc(s.memo)}` : ""}</small></p>`;
  const call = s.calls[s.calls.length - 1];

  if (s.status === "calling") {
    app.innerHTML = head + `<div class="card car"><div class="spinner"></div><p class="question">택시 부르는 중이에요</p>
      <p class="reason">AI 비서가 콜택시에 전화하고 있어요.<br>조금만 기다려 주세요.</p></div>`;
    return;
  }
  if (s.status === "dispatched" && call) {
    const arrive = call.eta_minutes ? time.format(new Date(new Date(call.updated_at).getTime() + call.eta_minutes * 60000)) : "";
    app.innerHTML = head + `<div class="card car">
      <p class="question" style="margin:0">🚕 택시가 와요!</p>
      <div class="plate">${esc(call.car_number || "")}</div>
      <p class="reason">${esc(call.car_description || "")}</p>
      ${arrive ? `<p class="eta">${esc(arrive)} 도착</p>` : ""}
    </div>
    <button class="bigbtn ghost" id="say">🔊 소리로 듣기</button>
    <button class="bigbtn" id="arrived">✅ 도착했어요</button>`;
    document.getElementById("say").onclick = () => speak(`택시가 와요. 차 번호는 ${call.car_number}. ${call.car_description || ""}. ${arrive} 도착해요.`);
    document.getElementById("arrived").onclick = () => post("arrived", {}, "자녀에게 알렸어요. 잘 다녀오세요!");
    return;
  }
  if (s.status === "taxi_reserved" && s.taxi_call_at) {
    const at = time.format(new Date(s.taxi_call_at));
    app.innerHTML = head + `<div class="card car">
      <p class="question" style="margin:0">🚕 택시 예약했어요</p>
      <p class="eta" style="margin:14px 0 6px">${esc(at)}에</p>
      <p class="reason">AI 비서가 택시를 불러 드려요.<br>차가 오면 알려 드릴게요.</p>
    </div>
    <button class="bigbtn" id="now">지금 바로 불러줘</button>
    <button class="bigbtn ghost" id="say">🔊 소리로 듣기</button>` + addBtn;
    document.getElementById("now").onclick = () => post("call-now", {}, "지금 택시 불러 드릴게요");
    document.getElementById("say").onclick = () => speak(`${whenText(s)} ${s.place_name} 가시죠. ${at}에 택시 불러 드릴게요.`);
    return;
  }
  if (s.status === "chosen" && s.chosen_mode) {
    const t = s.route_options?.options.find((o) => o.mode === s.chosen_mode);
    const msg = s.chosen_mode === "transit"
      ? `버스·지하철로 가세요.<br>약 ${t?.durationMin ?? "?"}분 걸려요.<br>걷는 거리 ${t?.walkMeters ?? "?"}m`
      : "자녀에게 부탁했어요.<br>곧 연락 올 거예요.";
    app.innerHTML = head + `<div class="card"><p class="question" style="margin-top:0">${MODE[s.chosen_mode].icon} ${MODE[s.chosen_mode].t}</p><p class="reason">${msg}</p></div>
      <button class="bigbtn" id="arrived">✅ 도착했어요</button>` + addBtn;
    document.getElementById("arrived").onclick = () => post("arrived", {}, "자녀에게 알렸어요. 잘 다녀오세요!");
    return;
  }

  // 아직 고르지 않음 (예정 / 물어보는 중 / 무응답 / 호출 실패)
  const cmp = s.route_options;
  const failed = s.status === "call_failed"
    ? `<div class="card" style="border-color:var(--bad)"><p class="reason" style="margin:0">택시를 못 불렀어요. 자녀에게 알렸어요.</p></div>` : "";
  const choices = cmp ? cmp.options.map((o) => {
    const m = MODE[o.mode];
    const detail = o.mode === "family" ? "자녀에게 부탁하기"
      : `${o.durationMin}분${o.costWon ? ` · 약 ${o.costWon.toLocaleString()}원` : ""}${o.walkMeters ? ` · 걷기 ${o.walkMeters}m` : ""}`;
    return `<button class="choice ${o.mode === cmp.recommended ? "rec" : ""}" data-mode="${o.mode}">
      ${o.mode === cmp.recommended ? `<span class="badge">추천</span>` : ""}
      <div class="t">${m.icon} ${m.t}</div><div class="d">${esc(detail)}</div></button>`;
  }).join("") : "";
  app.innerHTML = head + failed + `<p class="question">뭐 타고 가실래요?</p>
    ${cmp ? `<p class="reason">${esc(cmp.reason)}</p>` : ""}
    ${choices}
    <button class="bigbtn ghost" id="say">🔊 소리로 듣기</button>` + addBtn;
  for (const b of app.querySelectorAll(".choice")) {
    b.onclick = () => {
      const mode = b.dataset.mode;
      const msg = { taxi: "택시를 불러 드릴게요", transit: "버스·지하철로 안내해 드릴게요", family: "자녀에게 부탁했어요" }[mode];
      post("choose", { mode }, msg);
    };
  }
  document.getElementById("say").onclick = () => {
    if (!cmp) return;
    const rec = MODE[cmp.recommended].t;
    speak(`${whenText(s)}에 ${s.place_name} 가셔야 해요. 뭐 타고 가실래요? ${cmp.reason} 추천은 ${rec}예요.`);
  };
}

// ---------------- 일정 알려주기 (말하기 또는 글쓰기 → 맞아요/다시) ----------------
const Recognition = window.DEMO_NO_MIC ? null : window.SpeechRecognition || window.webkitSpeechRecognition;
const fullWhen = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Seoul" });

function backHome() {
  mode = "home";
  lastKey = "";
  load();
}

function openInput() {
  mode = "input";
  app.innerHTML = `
    <p class="question" style="margin-top:8px">언제, 어디 가세요?</p>
    <p class="reason">예) 다음주 화요일 오전 10시 서울대병원</p>
    ${Recognition ? `<button class="bigbtn" id="mic" style="min-height:120px">🎤 눌러서 말하기</button>` : ""}
    <textarea id="txt" rows="3" style="font-size:24px;margin-top:14px;border-radius:16px" placeholder="여기에 써도 돼요. 병원 문자를 붙여 넣어도 돼요."></textarea>
    <button class="bigbtn" id="send">알려주기</button>
    <button class="bigbtn ghost" id="back">돌아가기</button>`;
  const txt = document.getElementById("txt");
  document.getElementById("back").onclick = backHome;
  document.getElementById("send").onclick = () => submitText(txt.value);
  const mic = document.getElementById("mic");
  if (mic) {
    mic.onclick = () => {
      const rec = new Recognition();
      rec.lang = "ko-KR";
      rec.interimResults = true;
      mic.textContent = "🎤 듣고 있어요...";
      rec.onresult = (e) => {
        txt.value = [...e.results].map((r) => r[0].transcript).join(" ");
        if (e.results[e.results.length - 1].isFinal) submitText(txt.value);
      };
      rec.onerror = () => { mic.textContent = "🎤 다시 눌러서 말하기"; };
      rec.onend = () => { if (mic.isConnected) mic.textContent = "🎤 다시 눌러서 말하기"; };
      rec.start();
    };
  }
}

async function submitText(text) {
  if (!text.trim() || busy) return;
  busy = true;
  app.innerHTML = `<div class="spinner"></div><p class="question" style="text-align:center">알아보는 중이에요</p>`;
  try {
    const res = await fetch(`/api/p/${tok()}/parse`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || "다시 말씀해 주세요");
    showConfirm(d);
  } catch (e) {
    openInput();
    document.querySelector(".reason").textContent = e.message;
    speak(e.message);
  } finally {
    busy = false;
  }
}

function showConfirm(d) {
  const when = d.start_at ? fullWhen.format(new Date(d.start_at)) : "언제인지 모르겠어요";
  app.innerHTML = `
    <p class="question" style="margin-top:8px">이거 맞아요?</p>
    <div class="card"><p class="appt" style="margin:0">${esc(when)}<br>${esc(d.place_name || "어디인지 모르겠어요")}
      <small>${esc(d.title)}${d.memo ? ` · ${esc(d.memo)}` : ""}</small></p></div>
    ${d.start_at ? `<button class="bigbtn" id="yes">👍 맞아요</button>` : ""}
    <button class="bigbtn ghost" id="again">다시 할게요</button>`;
  speak(`${when}, ${d.place_name || ""}. 맞으세요?`);
  document.getElementById("again").onclick = openInput;
  const yes = document.getElementById("yes");
  if (yes) yes.onclick = () => acceptDraft(d, false);
}

async function acceptDraft(d, force) {
  const res = await fetch(`/api/p/${tok()}/drafts/${d.id}/accept`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force }),
  });
  const out = await res.json().catch(() => ({}));
  if (res.status === 409) return showConflict(d, out.conflicts);
  if (!res.ok) {
    alert(out.error || "다시 해 주세요");
    return openInput();
  }
  const msg = out.handedToGuardian ? "자녀에게 장소 확인을 부탁했어요" : "일정을 넣었어요. 그날 알려 드릴게요";
  app.innerHTML = `<p class="question" style="margin-top:40px;text-align:center">✅ ${msg}</p>`;
  speak(msg);
  setTimeout(backHome, 2500);
}

/** 중복·겹치는 일정 팝업 (큰 글씨, 버튼 2개) */
function showConflict(d, conflicts) {
  const dup = conflicts.some((c) => c.type === "duplicate");
  const c = conflicts[0];
  const title = dup ? "이미 같은 일정이 있어요" : "가까운 시간에 다른 일정이 있어요";
  const modal = document.createElement("div");
  modal.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:18px;z-index:10";
  modal.innerHTML = `<div class="card" style="width:100%;max-width:520px;padding:22px">
    <p class="question" style="margin-top:0">⚠️ ${title}</p>
    <p class="appt" style="font-size:26px">${esc(fullWhen.format(new Date(c.start_at)))}<br>${esc(c.place_name)}</p>
    <button class="bigbtn ghost" id="cNo">${dup ? "👌 안 넣을게요" : "안 넣을게요"}</button>
    <button class="bigbtn" id="cYes">그래도 넣을게요</button>
  </div>`;
  (document.querySelector(".big") || document.body).appendChild(modal);
  speak(`${title}. ${fullWhen.format(new Date(c.start_at))} ${c.place_name}. 그래도 넣을까요?`);
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
