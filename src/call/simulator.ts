import type { Db } from "../db.ts";
import type { CallProvider, CallService } from "./service.ts";

export type Scenario = "normal" | "ivr" | "no_car";

/**
 * 가상 동행 온다콜택시 콜센터. 실제 전화를 걸지 않고 AI 비서의 대화 흐름을 시험한다.
 * 상담원은 출발지 → 목적지 → 연락처 순서로 묻고, 다 들으면 배차 결과를 알려준다.
 */
export class SimulatedCallCenter {
  private stage: "ivr" | "greet" | "pickup" | "dropoff" | "phone" | "dispatching" | "done" = "greet";
  private scenario: Scenario;
  private expect: { pickup: string; dropoff: string; phoneDigits: string };

  constructor(scenario: Scenario, expect: { pickup: string; dropoff: string; phone: string }) {
    this.scenario = scenario;
    this.expect = { pickup: expect.pickup, dropoff: expect.dropoff, phoneDigits: expect.phone.replace(/\D/g, "") };
    if (scenario === "ivr") this.stage = "ivr";
  }

  get finished() {
    return this.stage === "done";
  }

  /** 전화 연결 직후 첫 발화 */
  answer(): string {
    return this.stage === "ivr"
      ? "안녕하세요, 120 다산콜센터입니다. 동행 온다콜택시 호출은 6번, 그 밖의 문의는 9번을 눌러 주세요."
      : "네, 동행 온다콜택시입니다. 무엇을 도와드릴까요?";
  }

  press(digits: string): string {
    if (this.stage !== "ivr") return "";
    if (digits.includes("6")) {
      this.stage = "greet";
      return "네, 동행 온다콜택시입니다. 무엇을 도와드릴까요?";
    }
    return "잘못 누르셨습니다. 동행 온다콜택시 호출은 6번을 눌러 주세요.";
  }

  /** AI 비서의 말을 듣고 상담원의 다음 말을 돌려준다 (빈 문자열 = 침묵) */
  hear(said: string): string {
    const has = (needle: string) => {
      const words = needle.split(/[\s,]+/).filter((w) => w.length >= 2);
      return words.some((w) => said.includes(w));
    };
    const digits = said.replace(/\D/g, "");
    // "공일공, 일이삼사, 오육칠팔" 처럼 한글로 읽은 번호 (3글자 이상 연속된 것만)
    const spokenDigits = (said.match(/[공영일이삼사오육칠팔구]{3,}/g) ?? [])
      .join("")
      .replace(/[공영일이삼사오육칠팔구]/g, (c) => String("공일이삼사오육칠팔구".indexOf(c === "영" ? "공" : c)));
    switch (this.stage) {
      case "ivr":
        return "동행 온다콜택시 호출은 6번을 눌러 주세요.";
      case "greet":
        if (has(this.expect.pickup)) {
          this.stage = "dropoff";
          return "네, 확인했습니다. 목적지는 어디세요?";
        }
        this.stage = "pickup";
        return "네, 택시 호출이시죠. 출발지가 어디세요?";
      case "pickup":
        if (!has(this.expect.pickup)) return "출발지를 다시 한번 말씀해 주시겠어요?";
        this.stage = "dropoff";
        return "네, 목적지는 어디세요?";
      case "dropoff":
        if (!has(this.expect.dropoff)) return "목적지를 다시 한번 말씀해 주시겠어요?";
        this.stage = "phone";
        return "탑승하실 분 연락처 알려 주세요.";
      case "phone": {
        const tail = this.expect.phoneDigits.slice(-4);
        if (!digits.endsWith(tail) && !spokenDigits.endsWith(tail)) return "연락처를 다시 한번 말씀해 주시겠어요?";
        this.stage = "dispatching";
        return "네, 잠시만 기다려 주세요. 배차 확인하겠습니다.";
      }
      case "dispatching":
      case "done":
        return "";
    }
  }

  /** 침묵 후 상담원이 이어서 하는 말 (배차 결과 등) */
  idle(): string {
    if (this.stage !== "dispatching") return "";
    this.stage = "done";
    if (this.scenario === "no_car") return "죄송합니다. 지금 주변에 배차 가능한 차량이 없습니다.";
    return "서울 32바 1234, 흰색 쏘나타 차량이 7분 후 도착합니다. 탑승하실 분께 문자로도 보내 드릴게요.";
  }
}

/** 시뮬레이터 전화 제공자 */
export class SimulatorProvider implements CallProvider {
  readonly name = "simulator";
  scenario: Scenario = "normal";
  /** 발화 사이 지연(ms) — 화면에서 진행 과정을 볼 수 있도록 */
  turnDelayMs: number;
  private db: Db;
  private service: CallService;

  constructor(db: Db, service: CallService, turnDelayMs = 900) {
    this.db = db;
    this.service = service;
    this.turnDelayMs = turnDelayMs;
  }

  async start(callId: number): Promise<void> {
    const call = this.db.getCall(callId)!;
    const schedule = this.db.getSchedule(call.schedule_id)!;
    const parent = this.db.getParent(schedule.parent_id)!;
    const center = new SimulatedCallCenter(this.scenario, {
      pickup: parent.home_address, dropoff: `${schedule.place_name} ${schedule.place_address}`, phone: parent.phone,
    });
    // 백그라운드에서 대화 진행
    void this.run(callId, center).catch((err) => this.service.onHangup(callId, `시뮬레이터 오류: ${(err as Error).message}`));
  }

  private async run(callId: number, center: SimulatedCallCenter) {
    const wait = () => new Promise((r) => setTimeout(r, this.turnDelayMs));
    let line = center.answer();
    for (let turn = 0; turn < 20; turn++) {
      await wait();
      const step = await this.service.onCenterUtterance(callId, line);
      if (step.outcome !== "in_progress") return;
      let reply = "";
      if (step.press_digits) reply = center.press(step.press_digits);
      if (step.say) reply = center.hear(step.say) || reply;
      if (!reply) reply = center.idle();
      if (!reply && center.finished) {
        await this.service.onHangup(callId, "콜센터가 통화를 종료했어요.");
        return;
      }
      line = reply;
    }
    await this.service.onHangup(callId, "통화가 너무 길어졌어요.");
  }
}
