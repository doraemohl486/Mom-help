import { config, taxiCenterHours } from "../config.ts";
import type { Call, Db, Parent, Schedule } from "../db.ts";
import type { Notifier } from "../notify.ts";
import { type AgentStep, type CallAgent, type CallBrief, type Turn } from "./agent.ts";
import { formatTime } from "../time.ts";

export interface CallProvider {
  readonly name: string;
  /** 발신을 시작한다. 이후 콜센터 발화가 들어올 때마다 service.onCenterUtterance()를 호출해야 한다. */
  start(callId: number): Promise<void>;
}

export const MAX_ATTEMPTS = 3;

export function isTaxiCenterOpen(at: Date): boolean {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "Asia/Seoul" }).format(at));
  return h >= taxiCenterHours.open && h < taxiCenterHours.close;
}

export class CallService {
  provider!: CallProvider;
  /** 실패 후 재시도까지 기다릴 시간(ms). 시뮬레이터에선 짧게 */
  retryDelayMs: number;
  private db: Db;
  private agent: CallAgent;
  private notifier: Notifier;
  private busy = new Set<number>();
  /** 현재 시각 (테스트에서 바꿔 끼울 수 있게) */
  clock: () => Date = () => new Date();

  constructor(db: Db, agent: CallAgent, notifier: Notifier, retryDelayMs = 60_000) {
    this.db = db;
    this.agent = agent;
    this.notifier = notifier;
    this.retryDelayMs = retryDelayMs;
  }

  brief(schedule: Schedule, parent: Parent): CallBrief {
    return {
      riderName: parent.real_name,
      riderPhone: parent.phone,
      pickupAddress: parent.home_address,
      pickupHint: "",
      dropoffName: schedule.place_name,
      dropoffAddress: schedule.place_address,
      notes: parent.notes,
    };
  }

  private ctx(callId: number) {
    const call = this.db.getCall(callId);
    if (!call) throw new Error(`call ${callId} not found`);
    const schedule = this.db.getSchedule(call.schedule_id)!;
    const parent = this.db.getParent(schedule.parent_id)!;
    return { call, schedule, parent };
  }

  /** 택시 호출 시작 (부모님이 '택시'를 고르면 호출됨) */
  async requestTaxi(scheduleId: number, attempt = 1): Promise<Call | null> {
    const now = this.clock();
    const schedule = this.db.getSchedule(scheduleId);
    if (!schedule) throw new Error("schedule not found");
    const parent = this.db.getParent(schedule.parent_id)!;
    if (!isTaxiCenterOpen(now)) {
      this.db.updateSchedule(scheduleId, { status: "call_failed" });
      this.db.addEvent(scheduleId, "call_failed", "동행 온다콜택시 운영 시간(8시~22시)이 아니라 AI 호출을 못 했어요.");
      this.notifier.toGuardian(parent, schedule, "call_failed",
        `${parent.name} 택시 호출 실패: 운영 시간이 아니에요. 카카오T '대신 불러주기'로 불러 주세요.`);
      return null;
    }
    const call = this.db.createCall({ schedule_id: scheduleId, provider: this.provider.name, attempt });
    this.db.updateSchedule(scheduleId, { status: "calling" });
    this.db.addEvent(scheduleId, "calling", `AI 비서가 동행 온다콜택시에 전화 중이에요${attempt > 1 ? ` (${attempt}번째 시도)` : ""}.`);
    try {
      await this.provider.start(call.id);
    } catch (err) {
      await this.fail(call.id, `발신 실패: ${(err as Error).message}`);
    }
    return this.db.getCall(call.id)!;
  }

  /** 콜센터 쪽 발화(음성 인식 결과)를 받아 AI 비서의 다음 행동을 돌려준다. */
  async onCenterUtterance(callId: number, text: string): Promise<AgentStep> {
    const { call, schedule, parent } = this.ctx(callId);
    if (call.status === "dispatched" || call.status === "failed") {
      return { say: "", press_digits: "", outcome: call.status, car_number: "", car_description: "", eta_minutes: -1, failure_reason: "" };
    }
    // 같은 통화에 대한 동시 처리 방지
    while (this.busy.has(callId)) await new Promise((r) => setTimeout(r, 50));
    this.busy.add(callId);
    try {
      const transcript = JSON.parse(call.transcript) as Turn[];
      if (text.trim()) transcript.push({ who: "center", text: text.trim() });
      const step = await this.agent.next(this.brief(schedule, parent), transcript);
      if (step.press_digits) transcript.push({ who: "ai", text: `[버튼 ${step.press_digits}]` });
      if (step.say) transcript.push({ who: "ai", text: step.say });
      this.db.updateCall(callId, { transcript: JSON.stringify(transcript), status: "in_progress" });

      if (step.outcome === "dispatched") await this.dispatched(callId, step);
      else if (step.outcome === "failed") await this.fail(callId, step.failure_reason || "콜센터에서 호출이 어렵다고 했어요.");
      else if (transcript.length > 40) await this.fail(callId, "통화가 너무 길어져 종료했어요.");
      return step;
    } finally {
      this.busy.delete(callId);
    }
  }

  private async dispatched(callId: number, step: AgentStep) {
    const { schedule, parent } = this.ctx(callId);
    const eta = step.eta_minutes > 0 ? step.eta_minutes : null;
    this.db.updateCall(callId, {
      status: "dispatched", car_number: step.car_number || null,
      car_description: step.car_description || null, eta_minutes: eta,
    });
    this.db.updateSchedule(schedule.id, { status: "dispatched" });
    const arrival = eta ? formatTime(new Date(Date.now() + eta * 60_000)) : null;
    const car = [step.car_number, step.car_description].filter(Boolean).join(" · ");
    this.db.addEvent(schedule.id, "dispatched", `배차 완료: ${car}${arrival ? ` · ${arrival} 도착 예정` : ""}`);
    this.notifier.toParent(parent, schedule, "dispatched",
      `택시가 와요! ${car}${eta ? `, ${eta}분 뒤 도착해요` : ""}. ${parent.home_address}에서 기다려 주세요.`);
    this.notifier.toGuardian(parent, schedule, "dispatched",
      `${parent.name} 택시 배차 완료: ${car}${eta ? ` (${eta}분 후 도착)` : ""}`);
  }

  /** 통화 실패 처리 + 재시도 / 자녀에게 넘기기 */
  async fail(callId: number, reason: string) {
    const { call, schedule, parent } = this.ctx(callId);
    if (call.status === "failed" || call.status === "dispatched") return;
    this.db.updateCall(callId, { status: "failed", failure_reason: reason });
    if (call.attempt < MAX_ATTEMPTS && !/운영\s*시간|AI\s*전화/.test(reason)) {
      this.db.addEvent(schedule.id, "call_retry", `호출 실패(${reason}). 잠시 후 다시 걸게요.`);
      this.notifier.toGuardian(parent, schedule, "call_retry", `${parent.name} 택시 호출 ${call.attempt}차 실패: ${reason} — 다시 시도 중`);
      setTimeout(() => {
        const cur = this.db.getSchedule(schedule.id);
        if (cur && cur.status === "calling") void this.requestTaxi(schedule.id, call.attempt + 1);
      }, this.retryDelayMs);
      return;
    }
    this.db.updateSchedule(schedule.id, { status: "call_failed" });
    this.db.addEvent(schedule.id, "call_failed", `택시 호출 실패: ${reason}`);
    this.notifier.toParent(parent, schedule, "call_failed", `택시를 못 불렀어요. 자녀분께 알렸어요. 조금만 기다려 주세요.`);
    this.notifier.toGuardian(parent, schedule, "call_failed",
      `${parent.name} 택시 호출 실패: ${reason}. 카카오T '대신 불러주기'나 1855-0120 직접 전화로 불러 주세요.`);
  }

  /** 시뮬레이터/전화 제공자가 상대방이 끊었을 때 호출 */
  async onHangup(callId: number, reason: string) {
    const call = this.db.getCall(callId);
    if (call && call.status !== "dispatched" && call.status !== "failed") await this.fail(callId, reason);
  }

  static centerNumber() {
    return config.taxiCenterNumber;
  }
}
