// 체험판: 서버 없이 브라우저 안에서 실제 앱 로직을 돌린다.
// public/guardian.js, public/parent.js 의 fetch("/api/...") 를 가로채 src/api.ts 의 같은 라우트로 처리한다.
import { openMemDb } from "./memdb.ts";
import { Notifier } from "../notify.ts";
import { RuleBasedCallAgent } from "../call/agent.ts";
import { CallService } from "../call/service.ts";
import { SimulatorProvider } from "../call/simulator.ts";
import { TripFlow, stageTimes, type Stage } from "../flow.ts";
import { Intake } from "../intake.ts";
import { RuleAppointmentParser } from "../parse.ts";
import { buildRoutes, errorResponse, matchRoute } from "../api.ts";
import { formatDate, formatTime, fromSeoulLocal, seoulDateKey } from "../time.ts";

const STORE = "eombba-demo-v1";

function load() {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

const mem = openMemDb(load());
const db = mem.db;
const notifier = new Notifier(db);
const calls = new CallService(db, new RuleBasedCallAgent(), notifier, 2_000);
const simulator = new SimulatorProvider(db, calls, 1_100);
calls.provider = simulator;
const flow = new TripFlow(db, notifier, calls);
const intake = new Intake(db, flow, new RuleAppointmentParser(), notifier);
const routes = buildRoutes({ db, flow, calls, simulator, intake });

// 체험판 시계: '시간 건너뛰기'로 알림 시각을 바로 볼 수 있게
let offsetMs = 0;
try {
  offsetMs = Number(localStorage.getItem(`${STORE}-offset`) ?? 0) || 0;
} catch {
  /* 저장소 없음 */
}
calls.clock = () => new Date(Date.now() + offsetMs);

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(mem.dump()));
    localStorage.setItem(`${STORE}-offset`, String(offsetMs));
  } catch {
    /* 저장소 없음: 새로고침하면 처음부터 */
  }
}
setInterval(save, 1500);

function seed() {
  if (db.listParents().length) return;
  const p = db.createParent({
    name: "엄마", real_name: "김영희", phone: "010-1234-5678", home_address: "서울 마포구 월드컵로 212 (마포구청)",
    home_lat: 37.5663, home_lng: 126.9019, preferred_mode: null, notes: "지팡이를 쓰세요",
  });
  const tomorrow = seoulDateKey(new Date(Date.now() + 86400_000));
  const s = db.createSchedule({
    parent_id: p.id, title: "무릎 정기검진", kind: "병원", place_name: "세브란스병원", place_address: "서울 서대문구 연세로 50-1",
    place_lat: 37.5622, place_lng: 126.941, start_at: fromSeoulLocal(`${tomorrow}T10:30`).toISOString(), memo: "공복으로 가셔야 해요",
  });
  void flow.plan(s.id).then(() => flow.tickOne(s.id)).then(save);
}
seed();

// ---------------------------------------------------------------- fetch 가로채기
const realFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.href);
  if (!url.pathname.startsWith("/api/")) return realFetch(input, init);
  const method = (init?.method ?? "GET").toUpperCase();
  const found = matchRoute(routes, method, url.pathname);
  let result;
  if (!found) {
    result = { status: 404, body: { error: "없는 주소예요." } };
  } else {
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    try {
      result = await found.route.handle({ params: found.params, body, query: Object.fromEntries(url.searchParams) });
    } catch (err) {
      result = errorResponse(err);
    }
  }
  if (method !== "GET") save();
  await new Promise((r) => setTimeout(r, 60)); // 실제 서버처럼 살짝 늦게
  return new Response(result.status === 204 ? null : JSON.stringify(result.body), {
    status: result.status, headers: { "Content-Type": "application/json" },
  });
};

// 알림 주기 확인 (실제 서버는 30초마다)
setInterval(() => void flow.tick().then(save), 10_000);

// ---------------------------------------------------------------- 체험 도구 (페이지에서 사용)
const STAGE_LABEL: Record<Stage | "taxi", string> = {
  evening: "전날 저녁 알림", prep: "준비 알림", ask: "'뭐 타고 가실래요?'", escalate: "무응답 → 자녀 알림", taxi: "예약한 택시 호출",
};

function nextEvent(now: Date) {
  let best: { at: Date; label: string; place: string } | null = null;
  const from = new Date(now.getTime() - 3 * 3600_000).toISOString();
  const to = new Date(now.getTime() + 7 * 86400_000).toISOString();
  for (const s of db.listActiveSchedules(from, to)) {
    if (!s.departure_at) continue;
    const cands: { at: Date; label: string }[] = [];
    if (s.status === "taxi_reserved" && s.taxi_call_at) cands.push({ at: new Date(s.taxi_call_at), label: STAGE_LABEL.taxi });
    if (["scheduled", "asked", "chosen", "taxi_reserved"].includes(s.status)) {
      const sent = JSON.parse(s.stages_sent) as Stage[];
      const times = stageTimes(new Date(s.start_at), new Date(s.departure_at));
      for (const st of ["evening", "prep", "ask", "escalate"] as Stage[]) {
        if (sent.includes(st)) continue;
        if (st === "escalate" && s.status !== "asked") continue;
        if (st === "ask" && !["scheduled", "asked"].includes(s.status)) continue;
        if (st === "evening" && seoulDateKey(now) === seoulDateKey(new Date(s.start_at))) continue;
        cands.push({ at: times[st], label: STAGE_LABEL[st] });
      }
    }
    for (const c of cands) {
      if (c.at.getTime() > now.getTime() && (!best || c.at < best.at)) best = { ...c, place: s.place_name };
    }
  }
  return best;
}

const demo = {
  /** 체험판 시계 */
  now: () => calls.clock(),
  clockText() {
    const n = calls.clock();
    return `${formatDate(n)} ${formatTime(n)}${offsetMs ? " (시간 건너뜀)" : ""}`;
  },
  nextText() {
    const e = nextEvent(calls.clock());
    return e ? `${formatDate(e.at)} ${formatTime(e.at)} · ${e.place} ${e.label}` : "다음 알림 없음";
  },
  /** 다음 알림 시각으로 시계를 옮기고 바로 처리 */
  async skip() {
    const e = nextEvent(calls.clock());
    if (!e) return null;
    offsetMs = e.at.getTime() + 1000 - Date.now();
    await flow.tick();
    save();
    return e.label;
  },
  resetClock() {
    offsetMs = 0;
    save();
  },
  firstParentToken: () => db.listParents()[0]?.token ?? "",
  parents: () => db.listParents().map((p) => ({ name: p.name, token: p.token })),
  parentNotifications: (token: string) => {
    const p = db.getParentByToken(token);
    return p ? db.listNotifications("parent", p.id, 1) : [];
  },
  /** 부모님 폰에 문자가 온 것처럼 */
  async sms(token: string, text: string) {
    const p = db.getParentByToken(token);
    if (!p) throw new Error("부모님을 먼저 등록해 주세요.");
    const r = await intake.fromSms(p.id, text, calls.clock());
    save();
    return r.result;
  },
  reset() {
    try {
      localStorage.removeItem(STORE);
      localStorage.removeItem(`${STORE}-offset`);
    } catch {
      /* 없음 */
    }
    location.reload();
  },
};
(window as unknown as { demo: typeof demo }).demo = demo;
