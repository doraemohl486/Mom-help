import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildServices } from "../src/server.ts";
import { createApp } from "../src/app.ts";
import { fromSeoulLocal } from "../src/time.ts";

// 외부 API 키 없이 (추정치 + 규칙 기반 비서 + 시뮬레이터) 전체 흐름을 검증한다.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

// 약속(10:00) 직전이라 택시를 고르면 바로 부르는 시각
const OPEN_HOURS = () => fromSeoulLocal("2026-11-12T09:40");

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

test("미리 택시를 고르면 예약해 두고, 시간이 되면 AI가 부른다", async () => {
  const { svc, sched } = setup();
  svc.calls.clock = () => fromSeoulLocal("2026-11-11T20:00"); // 전날 저녁
  await svc.flow.choose(sched.id, "taxi", "parent");
  let s = svc.db.getSchedule(sched.id)!;
  assert.equal(s.status, "taxi_reserved");
  assert.equal(svc.db.listCallsForSchedule(sched.id).length, 0);
  const callAt = new Date(s.taxi_call_at!);
  assert.ok(callAt < new Date(s.start_at));
  assert.ok(svc.db.listNotifications("parent", null).some((n) => n.kind === "taxi_reserved"));

  // 예약 시각 전: 준비 알림에 택시 예약 안내가 붙는다
  svc.calls.clock = () => new Date(callAt.getTime() - 50 * 60_000);
  await svc.flow.tickOne(sched.id);
  assert.match(svc.db.listNotifications("parent", null)[0].message, /택시 불러 드릴게요/);
  assert.equal(svc.db.getSchedule(sched.id)!.status, "taxi_reserved");

  // 예약 시각: AI가 전화
  svc.calls.clock = () => callAt;
  await svc.flow.tickOne(sched.id);
  await waitFor(() => svc.db.getSchedule(sched.id)!.status === "dispatched");
  s = svc.db.getSchedule(sched.id)!;
  assert.ok(svc.db.listEvents(s.id).some((e) => e.type === "taxi_due"));
});

test("예약을 기다리지 않고 지금 바로 부르기", async () => {
  const { svc, sched } = setup();
  svc.calls.clock = () => fromSeoulLocal("2026-11-12T08:30");
  await svc.flow.choose(sched.id, "taxi", "parent");
  assert.equal(svc.db.getSchedule(sched.id)!.status, "taxi_reserved");
  await svc.flow.callTaxiNow(sched.id);
  await waitFor(() => svc.db.getSchedule(sched.id)!.status === "dispatched");
});

test("중복·겹치는 일정은 저장 전에 알려 준다", async () => {
  const { svc, sched } = setup();
  const base = {
    parent_id: sched.parent_id, title: "검진", kind: "병원", place_name: "세브란스병원", place_address: "서울 서대문구 연세로 50-1",
    place_lat: 37.5622, place_lng: 126.941, memo: "",
  };
  // 같은 장소 20분 차이 → 중복
  await assert.rejects(
    svc.intake.createSchedule({ ...base, start_at: fromSeoulLocal("2026-11-12T10:20").toISOString() }),
    (e: Error & { conflicts?: { type: string }[] }) => e.conflicts?.[0].type === "duplicate",
  );
  // 다른 장소 1시간 차이 → 겹침
  await assert.rejects(
    svc.intake.createSchedule({ ...base, place_name: "서울역", start_at: fromSeoulLocal("2026-11-12T11:00").toISOString() }),
    (e: Error & { conflicts?: { type: string }[] }) => e.conflicts?.[0].type === "overlap",
  );
  // 그래도 저장
  const s = await svc.intake.createSchedule({ ...base, place_name: "서울역", start_at: fromSeoulLocal("2026-11-12T11:00").toISOString() }, true);
  assert.ok(s.id);
  // 하루 다르면 문제없음
  assert.ok(await svc.intake.createSchedule({ ...base, start_at: fromSeoulLocal("2026-11-13T10:00").toISOString() }));
});

const SMS = "[Web발신]\n[세브란스병원] 김영희님 11월 19일(목) 오후 2시 30분 정형외과 진료 예약되었습니다. 30분 전 도착 바랍니다.";

test("예약 문자 자동 가져오기: 저장 → 같은 문자 또 오면 건너뜀 → 광고는 무시", async () => {
  const { svc, parent } = setup();
  const now = fromSeoulLocal("2026-11-12T09:00");
  const r1 = await svc.intake.fromSms(parent.id, SMS, now);
  assert.equal(r1.result, "created");
  const s = svc.db.getSchedule((r1 as { schedule: { id: number } }).schedule.id)!;
  assert.equal(s.source, "sms");
  assert.equal(s.place_name, "세브란스병원");
  assert.equal(s.start_at, fromSeoulLocal("2026-11-19T14:30").toISOString());
  assert.match(s.memo, /30분 전 도착/);
  assert.match(s.title, /정형외과/);
  assert.ok(svc.db.listNotifications("guardian", null).some((n) => n.kind === "sms_imported"));

  // 병원은 전날 안내 문자를 또 보낸다 → 중복이라 건너뜀
  const r2 = await svc.intake.fromSms(parent.id, "[세브란스병원] 내일(11/19) 14:30 진료 예정입니다.", fromSeoulLocal("2026-11-18T10:00"));
  assert.equal(r2.result, "duplicate");

  assert.equal((await svc.intake.fromSms(parent.id, "[광고] 가을 건강검진 할인 이벤트", now)).result, "ignored");
  assert.equal((await svc.intake.fromSms(parent.id, "인증번호 [123456]을 입력해 주세요", now)).result, "ignored");
});

test("장소를 못 찾은 문자는 자녀가 확인하도록 남긴다", async () => {
  const { svc, parent } = setup();
  const r = await svc.intake.fromSms(parent.id, "[하늘정형외과의원] 11/20 10:00 물리치료 예약", fromSeoulLocal("2026-11-12T09:00"));
  assert.equal(r.result, "review");
  assert.equal(svc.db.listReviewDrafts().length, 1);
  assert.ok(svc.db.listNotifications("guardian", null).some((n) => n.kind === "sms_review"));
});

test("API: 부모님이 말로 알려 준 일정 → 확인 → 저장, 중복이면 409", async () => {
  const { svc, parent } = setup();
  const app = createApp(svc);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (url: string, body: unknown) =>
    fetch(base + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    const r = await post(`/api/p/${parent.token}/parse`, { text: "11월 12일 오전 10시 세브란스병원 가요" });
    assert.equal(r.status, 201);
    const draft = await r.json();
    assert.equal(draft.place_name, "세브란스병원");
    assert.equal(draft.conflicts[0].type, "duplicate"); // setup()에 같은 일정이 있음
    const conflict = await post(`/api/p/${parent.token}/drafts/${draft.id}/accept`, {});
    assert.equal(conflict.status, 409);
    assert.ok((await conflict.json()).conflicts.length);
    const forced = await post(`/api/p/${parent.token}/drafts/${draft.id}/accept`, { force: true });
    assert.equal(forced.status, 200);

    // 문자 전달 웹훅 (text/plain)
    const inbox = await fetch(`${base}/api/inbox/${parent.token}`, { method: "POST", headers: { "Content-Type": "text/plain" }, body: SMS });
    assert.equal((await inbox.json()).result, "created");
    assert.equal((await fetch(`${base}/api/inbox/wrong-token`, { method: "POST", body: "x" })).status, 404);
  } finally {
    server.close();
  }
});

test("API: 달력은 기간 안의 일정을 지난 것까지 보여 주고, 부모님 링크는 자기 일정만", async () => {
  const { svc, parent, sched } = setup();
  const other = svc.db.createParent({
    name: "아빠", phone: "010-9999-0000", home_address: "서울역", home_lat: 37.55, home_lng: 126.97, preferred_mode: null, notes: "",
  });
  const mk = (pid: number, local: string) => svc.db.createSchedule({
    parent_id: pid, title: "x", kind: "기타", place_name: "서울역", place_address: "서울", place_lat: 37.55, place_lng: 126.97,
    start_at: fromSeoulLocal(local).toISOString(), memo: "",
  });
  mk(other.id, "2026-11-03T09:00"); // 지난 일정
  const cancelled = mk(parent.id, "2026-11-20T09:00");
  svc.db.updateSchedule(cancelled.id, { status: "cancelled" });
  mk(parent.id, "2026-12-02T09:00"); // 기간 밖
  const app = createApp(svc);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const range = `from=${encodeURIComponent(fromSeoulLocal("2026-11-01T00:00").toISOString())}&to=${encodeURIComponent(fromSeoulLocal("2026-12-01T00:00").toISOString())}`;
  try {
    const all = await (await fetch(`${base}/api/calendar?${range}`)).json();
    assert.deepEqual(all.map((s: { parent_id: number }) => s.parent_id).sort(), [parent.id, other.id].sort());
    assert.ok(all.some((s: { id: number }) => s.id === sched.id));
    const mine = await (await fetch(`${base}/api/p/${parent.token}/calendar?${range}`)).json();
    assert.deepEqual(mine.map((s: { id: number }) => s.id), [sched.id]);
    assert.equal((await fetch(`${base}/api/calendar?from=x&to=y`)).status, 400);
    const tooLong = `from=${encodeURIComponent(fromSeoulLocal("2026-01-01T00:00").toISOString())}&to=${encodeURIComponent(fromSeoulLocal("2026-12-01T00:00").toISOString())}`;
    assert.equal((await fetch(`${base}/api/calendar?${tooLong}`)).status, 400);
  } finally {
    server.close();
  }
});
