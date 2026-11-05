import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildServices } from "../src/server.ts";
import { createApp } from "../src/app.ts";
import { fromSeoulLocal } from "../src/time.ts";

// 외부 API 키 없이 (추정치 + 규칙 기반 비서 + 시뮬레이터) 전체 흐름을 검증한다.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const OPEN_HOURS = () => fromSeoulLocal("2026-11-12T09:00");

function setup() {
  const svc = buildServices(":memory:", "simulator");
  svc.simulator!.turnDelayMs = 1;
  svc.calls.retryDelayMs = 5;
  svc.calls.clock = OPEN_HOURS;
  const parent = svc.db.createParent({
    name: "엄마", real_name: "김영희", phone: "010-1234-5678", home_address: "서울 마포구 월드컵로 212", home_lat: 37.5663, home_lng: 126.9019,
    preferred_mode: null, notes: "지팡이를 쓰세요",
  });
  const sched = svc.db.createSchedule({
    parent_id: parent.id, title: "정기검진", kind: "병원", place_name: "세브란스병원", place_address: "서울 서대문구 연세로 50-1",
    place_lat: 37.5622, place_lng: 126.941, start_at: fromSeoulLocal("2026-11-12T10:00").toISOString(), memo: "공복",
  });
  return { svc, parent, sched };
}

async function waitFor(cond: () => boolean, ms = 3000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("택시 선택 → AI가 가상 콜센터와 통화 → 배차 → 부모님·자녀 알림", async () => {
  const { svc, sched } = setup();
  await svc.flow.askNow(sched.id);
  assert.equal(svc.db.getSchedule(sched.id)!.status, "asked");
  await svc.flow.choose(sched.id, "taxi", "parent");
  await waitFor(() => svc.db.getSchedule(sched.id)!.status === "dispatched");
  const call = svc.db.listCallsForSchedule(sched.id)[0];
  assert.equal(call.car_number, "서울32바1234");
  assert.equal(call.eta_minutes, 7);
  const transcript = JSON.parse(call.transcript) as { who: string; text: string }[];
  assert.match(transcript.find((t) => t.who === "ai")!.text, /김영희 어르신.*AI 비서/);
  assert.ok(svc.db.listNotifications("parent", null).some((n) => n.kind === "dispatched"));
  assert.ok(svc.db.listNotifications("guardian", null).some((n) => n.kind === "dispatched"));
});

test("ARS 메뉴가 나오면 6번을 누르고 진행한다", async () => {
  const { svc, sched } = setup();
  svc.simulator!.scenario = "ivr";
  await svc.flow.choose(sched.id, "taxi", "guardian");
  await waitFor(() => svc.db.getSchedule(sched.id)!.status === "dispatched");
  const t = JSON.parse(svc.db.listCallsForSchedule(sched.id)[0].transcript) as { text: string }[];
  assert.ok(t.some((x) => x.text === "[버튼 6]"));
});

test("배차 불가면 3번까지 다시 걸고, 그래도 안 되면 자녀에게 넘긴다", async () => {
  const { svc, sched } = setup();
  svc.simulator!.scenario = "no_car";
  await svc.flow.choose(sched.id, "taxi", "parent");
  await waitFor(() => svc.db.getSchedule(sched.id)!.status === "call_failed");
  assert.equal(svc.db.listCallsForSchedule(sched.id).length, 3);
  const g = svc.db.listNotifications("guardian", null);
  assert.ok(g.some((n) => n.kind === "call_failed" && /카카오T/.test(n.message)));
});

test("운영 시간 밖이면 전화하지 않고 자녀에게 알린다", async () => {
  const { svc, sched } = setup();
  svc.calls.clock = () => fromSeoulLocal("2026-11-12T23:00");
  await svc.flow.choose(sched.id, "taxi", "parent");
  assert.equal(svc.db.getSchedule(sched.id)!.status, "call_failed");
  assert.equal(svc.db.listCallsForSchedule(sched.id).length, 0);
});

test("자동 알림: 전날 저녁 → 당일 물어보기 → 무응답 시 자녀에게", async () => {
  const { svc, sched } = setup();
  await svc.flow.tickOne(sched.id, fromSeoulLocal("2026-11-11T19:05"));
  let s = svc.db.getSchedule(sched.id)!;
  assert.deepEqual(JSON.parse(s.stages_sent), ["evening"]);
  const dep = new Date(s.departure_at!);
  await svc.flow.tickOne(sched.id, new Date(dep.getTime() - 29 * 60_000));
  s = svc.db.getSchedule(sched.id)!;
  assert.equal(s.status, "asked");
  await svc.flow.tickOne(sched.id, new Date(dep.getTime() - 15 * 60_000));
  assert.equal(svc.db.getSchedule(sched.id)!.status, "escalated");
  const kinds = svc.db.listNotifications("guardian", null).map((n) => n.kind);
  assert.ok(kinds.includes("escalate"));
});

test("API: 부모님 링크로 다른 사람 일정은 고를 수 없다", async () => {
  const { svc, sched } = setup();
  const other = svc.db.createParent({
    name: "아빠", phone: "010-9999-0000", home_address: "서울역", home_lat: 37.55, home_lng: 126.97, preferred_mode: null, notes: "",
  });
  const app = createApp(svc);
  const server = app.listen(0);
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const bad = await fetch(`${base}/api/p/${other.token}/choose`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scheduleId: sched.id, mode: "transit" }),
    });
    assert.equal(bad.status, 404);
    const me = svc.db.getParent(sched.parent_id)!;
    const ok = await fetch(`${base}/api/p/${me.token}/choose`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scheduleId: sched.id, mode: "transit" }),
    });
    assert.equal(ok.status, 200);
    assert.equal(svc.db.getSchedule(sched.id)!.chosen_mode, "transit");
    const view = await (await fetch(`${base}/api/p/${me.token}`)).json();
    assert.equal(view.current.id, sched.id);
    const invalid = await fetch(`${base}/api/parents`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "" }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    server.close();
  }
});
