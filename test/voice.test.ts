import { test } from "node:test";
import assert from "node:assert/strict";
import "../public/voice-intents.js";

const intent = (t: string) => (globalThis as unknown as { voiceIntent: (t: string) => string[] }).voiceIntent(t);
const first = (t: string, allowed: string[]) => intent(t).find((i) => allowed.includes(i));

test("교통수단 고르기", () => {
  const choose = ["taxi", "transit", "family"];
  assert.equal(first("택시", choose), "taxi");
  assert.equal(first("택시 불러줘", choose), "taxi");
  assert.equal(first("지금 택시 불러 줘", choose), "taxi");
  assert.equal(first("버스 타고 갈게", choose), "transit");
  assert.equal(first("지하철로 갈래", choose), "transit");
  assert.equal(first("아들이 태워 준대", choose), "family");
  assert.equal(first("딸한테 데려다 달라고 해", choose), "family");
  assert.equal(first("몰라", choose), undefined);
});

test("예/아니요 — '안 넣어'는 아니요", () => {
  const yn = ["yes", "no"];
  assert.equal(first("네", yn), "yes");
  assert.equal(first("응 맞아", yn), "yes");
  assert.equal(first("맞아요", yn), "yes");
  assert.equal(first("그래도 넣어", yn), "yes");
  assert.equal(first("아니요", yn), "no");
  assert.equal(first("안 넣어", yn), "no");
  assert.equal(first("다시 할게", yn), "no");
  assert.equal(first("어디야", yn), undefined); // '어'로 시작해도 대답이 아님
});

test("예약 택시·도착·달력·돌아가기", () => {
  assert.equal(first("지금 바로 불러줘", ["now"]), "now");
  assert.equal(first("다 왔어", ["arrived"]), "arrived");
  assert.equal(first("병원 도착했어", ["arrived"]), "arrived");
  assert.equal(first("달력 보여줘", ["calendar"]), "calendar");
  assert.equal(first("다음 달", ["next", "calendar"]), "next");
  assert.equal(first("지난달 보여줘", ["prev"]), "prev");
  assert.equal(first("돌아가", ["back"]), "back");
  assert.equal(first("뭐라고? 다시 말해줘", ["repeat"]), "repeat");
});

test("일정 문장이면 바로 일정으로", () => {
  assert.ok(intent("다음주 화요일 오전 10시 서울대병원").includes("schedule"));
  assert.ok(intent("내일 세 시에 치과 가").includes("schedule"));
  assert.ok(intent("11월 20일 안과").includes("schedule"));
  assert.ok(!intent("택시").includes("schedule"));
  assert.ok(intent("일정 알려줄게").includes("add"));
});

test("자녀에게 보여줄까요? — 보여줘 / 나만 볼게", () => {
  const yn = ["yes", "no"];
  assert.equal(first("보여줘", yn), "yes");
  assert.equal(first("응 보여줄게", yn), "yes");
  assert.equal(first("나만 볼게", yn), "no");
  assert.equal(first("안 보여줘도 돼", yn), "no");
  assert.equal(first("보여주지 마", yn), "no");
});

test("달력 접기", () => {
  assert.equal(first("달력 접어", ["back"]), "back");
  assert.equal(first("달력 접기", ["back"]), "back");
});
