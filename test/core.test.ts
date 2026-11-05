import { test } from "node:test";
import assert from "node:assert/strict";
import { estimateOptions, estimateTaxiFare, recommend, type RouteOption } from "../src/routes/compare.ts";
import { dueStages, stageTimes } from "../src/flow.ts";
import { eveningBefore, fromSeoulLocal, iGa, seoulDateKey } from "../src/time.ts";
import { extractDispatch, RuleBasedCallAgent, type CallBrief } from "../src/call/agent.ts";
import { isTaxiCenterOpen } from "../src/call/service.ts";
import { stepToTwiml, validTwilioSignature } from "../src/call/twilio.ts";
import crypto from "node:crypto";

test("한국 시간 변환", () => {
  const d = fromSeoulLocal("2026-11-12T10:00");
  assert.equal(d.toISOString(), "2026-11-12T01:00:00.000Z");
  assert.equal(seoulDateKey(new Date("2026-11-11T16:00:00Z")), "2026-11-12"); // KST 01:00
  assert.equal(eveningBefore(d, 19).toISOString(), "2026-11-11T10:00:00.000Z"); // 전날 19시 KST
});

test("택시 요금 추정: 기본 거리 이내는 기본요금", () => {
  assert.equal(estimateTaxiFare(1.0), 4800);
  assert.ok(estimateTaxiFare(10) > 10000);
});

test("경로 추정치는 세 가지 수단을 준다", () => {
  const opts = estimateOptions({ lat: 37.5665, lng: 126.978 }, { lat: 37.5796, lng: 126.999 });
  assert.deepEqual(opts.map((o) => o.mode), ["taxi", "transit", "family"]);
  assert.ok(opts.every((o) => o.durationMin > 0));
});

test("추천: 걷는 거리가 길면 택시", () => {
  const base: RouteOption[] = [
    { mode: "taxi", label: "", durationMin: 15, costWon: 9000, walkMeters: 0, transfers: 0, source: "estimate" },
    { mode: "transit", label: "", durationMin: 25, costWon: 1550, walkMeters: 900, transfers: 0, source: "estimate" },
  ];
  assert.equal(recommend(base, null).recommended, "taxi");
  base[1].walkMeters = 200;
  assert.equal(recommend(base, null).recommended, "transit");
  assert.equal(recommend(base, "taxi").recommended, "taxi");
});

test("알림 단계: 시간 순서와 건너뛰기", () => {
  const start = fromSeoulLocal("2026-11-12T10:00");
  const dep = new Date(start.getTime() - 25 * 60_000); // 09:35 출발
  const t = stageTimes(start, dep);
  // 전날 20시: evening만
  assert.deepEqual(dueStages(fromSeoulLocal("2026-11-11T20:00"), start, t, [], "scheduled"), { send: ["evening"], skip: [] });
  // 당일 09:10 (ask 09:05 지남), 아무것도 안 보냈음: ask만 보내고 prep은 건너뜀, 당일이라 evening도 건너뜀
  const r = dueStages(fromSeoulLocal("2026-11-12T09:10"), start, t, [], "scheduled");
  assert.deepEqual(r.send, ["ask"]);
  assert.deepEqual(r.skip.sort(), ["evening", "prep"]);
  // 물어본 뒤 10분 넘게 무응답이면 자녀에게
  const e = dueStages(fromSeoulLocal("2026-11-12T09:16"), start, t, ["evening", "prep", "ask"], "asked");
  assert.deepEqual(e.send, ["escalate"]);
  // 이미 골랐으면 escalate 안 함
  assert.deepEqual(dueStages(fromSeoulLocal("2026-11-12T09:16"), start, t, ["evening", "prep", "ask"], "chosen").send, []);
});

test("운영 시간 (8시~22시 KST)", () => {
  assert.equal(isTaxiCenterOpen(fromSeoulLocal("2026-11-12T07:59")), false);
  assert.equal(isTaxiCenterOpen(fromSeoulLocal("2026-11-12T08:00")), true);
  assert.equal(isTaxiCenterOpen(fromSeoulLocal("2026-11-12T21:59")), true);
  assert.equal(isTaxiCenterOpen(fromSeoulLocal("2026-11-12T22:00")), false);
});

test("이/가 조사", () => {
  assert.equal(iGa("엄마"), "엄마가");
  assert.equal(iGa("민준"), "민준이");
});

test("배차 정보 추출", () => {
  const d = extractDispatch("서울 32바 1234, 흰색 쏘나타 차량이 7분 후 도착합니다.");
  assert.deepEqual(d, { car_number: "서울32바1234", eta_minutes: 7, car_description: "흰색 쏘나타" });
  assert.equal(extractDispatch("잠시만 기다려 주세요"), null);
});

const brief: CallBrief = {
  riderName: "김영희", riderPhone: "010-1234-5678", pickupAddress: "서울 마포구 월드컵로 212",
  pickupHint: "", dropoffName: "세브란스병원", dropoffAddress: "서울 서대문구 연세로 50-1", notes: "",
};

test("규칙 기반 비서: 먼저 AI임을 밝히고, 물은 것에 답한다", async () => {
  const a = new RuleBasedCallAgent();
  const s1 = await a.next(brief, [{ who: "center", text: "네, 동행 온다콜택시입니다." }]);
  assert.match(s1.say, /AI 비서/);
  assert.match(s1.say, /김영희 어르신/);
  const t = [{ who: "center" as const, text: "네" }, { who: "ai" as const, text: s1.say }, { who: "center" as const, text: "목적지는 어디세요?" }];
  assert.match((await a.next(brief, t)).say, /세브란스병원/);
  const ivr = await a.next(brief, [{ who: "center", text: "동행 온다콜택시 호출은 6번, 그 밖의 문의는 9번을 눌러 주세요." }]);
  assert.equal(ivr.press_digits, "6");
  const no = await a.next(brief, [{ who: "ai", text: "AI 비서입니다" }, { who: "center", text: "죄송합니다. 지금 배차 가능한 차량이 없습니다." }]);
  assert.equal(no.outcome, "failed");
});

test("Twilio TwiML 생성과 서명 검증", () => {
  const xml = stepToTwiml(5, { say: "안녕 <하세요>", press_digits: "", outcome: "in_progress", car_number: "", car_description: "", eta_minutes: -1, failure_reason: "" });
  assert.match(xml, /<Say language="ko-KR"[^>]*>안녕 &lt;하세요&gt;<\/Say>/);
  assert.match(xml, /<Gather input="speech"/);
  const end = stepToTwiml(5, { say: "감사합니다", press_digits: "", outcome: "dispatched", car_number: "", car_description: "", eta_minutes: -1, failure_reason: "" });
  assert.match(end, /<Hangup\/>/);
  assert.doesNotMatch(end, /Gather/);

  const url = "https://x.test/twilio/turn/5";
  const params = { SpeechResult: "네", CallSid: "CA1" };
  const sig = crypto.createHmac("sha1", "tok").update(url + "CallSidCA1SpeechResult네").digest("base64");
  assert.equal(validTwilioSignature("tok", url, params, sig), true);
  assert.equal(validTwilioSignature("tok", url, params, "bad"), false);
});
