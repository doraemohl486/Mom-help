// 부모님 간편 화면: 큰 글씨, 버튼 3개 이하, 소리로 듣기
const token = location.pathname.split("/").pop();
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

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "ko-KR";
  u.rate = 0.9;
  speechSynthesis.speak(u);
}

async function load() {
  const res = await fetch(`/api/p/${token}`);
  if (!res.ok) {
    app.innerHTML = `<p class="appt">링크가 올바르지 않아요.<small>자녀에게 다시 보내 달라고 해 주세요.</small></p>`;
    return;
  }
  data = await res.json();
  const s = data.current;
  const call = s?.calls?.[s.calls.length - 1];
  // 화면이 바뀌었을 때만 다시 그림 (버튼 누르는 중 깜빡임 방지)
  const key = JSON.stringify([s?.id, s?.status, call?.status, call?.car_number]);
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

function render() {
  const s = data.current;
  const name = data.parent.name;
  if (!s) {
    app.innerHTML = `<p class="hello">${esc(name)}, 안녕하세요</p><p class="appt">예정된 일정이 없어요 😊</p>`;
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
  if (s.status === "chosen" && s.chosen_mode) {
    const t = s.route_options?.options.find((o) => o.mode === s.chosen_mode);
    const msg = s.chosen_mode === "transit"
      ? `버스·지하철로 가세요.<br>약 ${t?.durationMin ?? "?"}분 걸려요.<br>걷는 거리 ${t?.walkMeters ?? "?"}m`
      : "자녀에게 부탁했어요.<br>곧 연락 올 거예요.";
    app.innerHTML = head + `<div class="card"><p class="question" style="margin-top:0">${MODE[s.chosen_mode].icon} ${MODE[s.chosen_mode].t}</p><p class="reason">${msg}</p></div>
      <button class="bigbtn" id="arrived">✅ 도착했어요</button>`;
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
    <button class="bigbtn ghost" id="say">🔊 소리로 듣기</button>`;
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

async function post(action, body, okMsg) {
  if (busy) return;
  busy = true;
  try {
    const res = await fetch(`/api/p/${token}/${action}`, {
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
