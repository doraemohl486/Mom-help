import { timing } from "./config.ts";
import type { Db, Mode, Parent, Schedule } from "./db.ts";
import type { Notifier } from "./notify.ts";
import type { CallService } from "./call/service.ts";
import { compareRoutes, type Comparison } from "./routes/compare.ts";
import { eveningBefore, formatDate, formatTime, iGa, seoulDateKey } from "./time.ts";

export type Stage = "evening" | "prep" | "ask" | "escalate";
const MIN = 60_000;

export const MODE_LABEL: Record<Mode, string> = { taxi: "택시", transit: "버스·지하철", family: "자녀 차량" };

/** 일정 하나의 알림 시각들을 계산한다 */
export function stageTimes(startAt: Date, departureAt: Date): Record<Stage, Date> {
  const ask = new Date(departureAt.getTime() - timing.askBeforeDepartureMin * MIN);
  return {
    evening: eveningBefore(startAt, timing.eveningHour),
    prep: new Date(departureAt.getTime() - timing.prepBeforeDepartureMin * MIN),
    ask,
    escalate: new Date(ask.getTime() + timing.escalateAfterAskMin * MIN),
  };
}

/** 지금 보내야 할 알림 단계. 늦게 등록된 일정이면 지나간 단계는 건너뛴다. */
export function dueStages(now: Date, start: Date, times: Record<Stage, Date>, sent: Stage[], status: Schedule["status"]): { send: Stage[]; skip: Stage[] } {
  const order: Stage[] = ["evening", "prep", "ask"];
  const send: Stage[] = [];
  const skip: Stage[] = [];
  // 당일에 등록된 일정이면 '내일 ~ 가셔요' 전날 알림은 의미가 없으니 건너뛴다
  if (!sent.includes("evening") && seoulDateKey(now) === seoulDateKey(start)) skip.push("evening");
  const due = order.filter((s) => !sent.includes(s) && !skip.includes(s) && now >= times[s]);
  if (due.length) {
    // 가장 최근 단계만 보낸다
    send.push(due[due.length - 1]);
    skip.push(...due.slice(0, -1));
  }
  const asked = sent.includes("ask") || send.includes("ask");
  if (asked && !sent.includes("escalate") && status === "asked" && now >= times.escalate) send.push("escalate");
  return { send, skip };
}

export class TripFlow {
  private db: Db;
  private notifier: Notifier;
  private calls: CallService;
  constructor(db: Db, notifier: Notifier, calls: CallService) {
    this.db = db;
    this.notifier = notifier;
    this.calls = calls;
  }

  private parentOf(s: Schedule): Parent {
    return this.db.getParent(s.parent_id)!;
  }

  /** 경로를 비교하고 예상 출발 시각을 저장한다 */
  async plan(scheduleId: number): Promise<Comparison> {
    const s = this.db.getSchedule(scheduleId)!;
    const p = this.parentOf(s);
    const cmp = await compareRoutes({ lat: p.home_lat, lng: p.home_lng }, { lat: s.place_lat, lng: s.place_lng }, p.preferred_mode);
    const rec = cmp.options.find((o) => o.mode === cmp.recommended)!;
    const departure = new Date(new Date(s.start_at).getTime() - (rec.durationMin + timing.arriveEarlyMin) * MIN);
    this.db.updateSchedule(scheduleId, { route_options: JSON.stringify(cmp), departure_at: departure.toISOString() });
    return cmp;
  }

  /** 주기적으로 호출: 보낼 알림이 있으면 보낸다 */
  async tick(now = new Date()) {
    const from = new Date(now.getTime() - 3 * 3600_000).toISOString();
    const to = new Date(now.getTime() + 2 * 24 * 3600_000).toISOString();
    for (const s of this.db.listActiveSchedules(from, to)) {
      try {
        await this.tickOne(s.id, now);
      } catch (err) {
        console.error(`[flow] schedule ${s.id}:`, err);
      }
    }
  }

  async tickOne(scheduleId: number, now = new Date()) {
    let s = this.db.getSchedule(scheduleId)!;
    if (!s.departure_at) {
      await this.plan(s.id);
      s = this.db.getSchedule(s.id)!;
    }
    if (!["scheduled", "asked"].includes(s.status)) return;
    const sent = JSON.parse(s.stages_sent) as Stage[];
    const times = stageTimes(new Date(s.start_at), new Date(s.departure_at!));
    const { send, skip } = dueStages(now, new Date(s.start_at), times, sent, s.status);
    if (!send.length && !skip.length) return;
    this.db.updateSchedule(s.id, { stages_sent: JSON.stringify([...sent, ...skip, ...send]) });
    for (const stage of send) await this.sendStage(s.id, stage);
  }

  async sendStage(scheduleId: number, stage: Stage) {
    const s = this.db.getSchedule(scheduleId)!;
    const p = this.parentOf(s);
    const start = new Date(s.start_at);
    const dep = new Date(s.departure_at!);
    const memo = s.memo ? ` (${s.memo})` : "";
    switch (stage) {
      case "evening":
        this.notifier.toParent(p, s, "evening",
          `${p.name}, 내일 ${formatTime(start)} ${s.place_name} 가셔요.${memo} ${formatTime(dep)}쯤 나가시면 돼요.`);
        this.notifier.toGuardian(p, s, "evening", `내일 ${formatTime(start)} ${p.name} ${s.title} (${s.place_name})`);
        this.db.addEvent(s.id, "evening", "전날 알림 보냄");
        break;
      case "prep":
        this.notifier.toParent(p, s, "prep", `${p.name}, 이제 준비하실 시간이에요. ${formatTime(start)} ${s.place_name}${memo}`);
        this.db.addEvent(s.id, "prep", "준비 알림 보냄");
        break;
      case "ask": {
        const cmp = await this.plan(s.id); // 실시간 정보로 다시 계산
        const rec = cmp.options.find((o) => o.mode === cmp.recommended)!;
        this.db.updateSchedule(s.id, { status: "asked" });
        this.notifier.toParent(p, s, "ask",
          `${p.name}, 오늘 ${formatTime(start)} ${s.place_name} 뭐 타고 가실래요? 추천: ${rec.label} (${rec.durationMin}분). ${cmp.reason}`);
        this.db.addEvent(s.id, "ask", "'뭐 타고 가실래요?' 물어봄");
        break;
      }
      case "escalate":
        this.db.updateSchedule(s.id, { status: "escalated" });
        this.notifier.toGuardian(p, s, "escalate",
          `${iGa(p.name)} 아직 답이 없으세요. ${formatTime(start)} ${s.place_name} — 대신 골라 주세요.`);
        this.db.addEvent(s.id, "escalate", `${timing.escalateAfterAskMin}분간 응답이 없어 자녀에게 알림`);
        break;
    }
  }

  /** 테스트/데모용: 지금 바로 '뭐 타고 가실래요?'를 보낸다 */
  async askNow(scheduleId: number) {
    const s = this.db.getSchedule(scheduleId)!;
    const sent = JSON.parse(s.stages_sent) as Stage[];
    this.db.updateSchedule(scheduleId, {
      status: "scheduled",
      stages_sent: JSON.stringify([...new Set([...sent, "evening", "prep", "ask"])]),
    });
    await this.sendStage(scheduleId, "ask");
  }

  /** 교통수단 선택 (부모님 또는 자녀) */
  async choose(scheduleId: number, mode: Mode, by: "parent" | "guardian") {
    let s = this.db.getSchedule(scheduleId);
    if (!s) throw new Error("일정을 찾을 수 없어요.");
    if (["calling", "dispatched", "arrived", "cancelled"].includes(s.status)) {
      throw new Error("이미 진행 중이거나 끝난 일정이에요.");
    }
    if (!s.route_options || !s.departure_at) {
      await this.plan(scheduleId);
      s = this.db.getSchedule(scheduleId)!;
    }
    const p = this.parentOf(s);
    const who = by === "parent" ? p.name : "자녀";
    this.db.updateSchedule(scheduleId, { status: "chosen", chosen_mode: mode });
    this.db.addEvent(scheduleId, "chosen", `${iGa(who)} '${MODE_LABEL[mode]}' 선택`);

    if (mode === "taxi") {
      await this.calls.requestTaxi(scheduleId);
    } else if (mode === "transit") {
      const cmp = JSON.parse(s.route_options!) as Comparison;
      const t = cmp.options.find((o) => o.mode === "transit")!;
      this.notifier.toParent(p, s, "transit",
        `버스·지하철로 가세요. 약 ${t.durationMin}분, 걷는 거리 ${t.walkMeters}m. ${formatTime(new Date(s.departure_at!))}쯤 나가세요.`);
      if (by === "parent") this.notifier.toGuardian(p, s, "chosen", `${p.name}: 버스·지하철로 가신대요.`);
    } else {
      this.notifier.toGuardian(p, s, "family",
        `${iGa(p.name)} 태워 달라고 하세요! ${formatTime(new Date(s.start_at))} ${s.place_name}, ${formatTime(new Date(s.departure_at!))} 출발`);
      this.notifier.toParent(p, s, "family", "자녀에게 부탁했어요. 곧 연락 올 거예요.");
    }
  }

  async arrived(scheduleId: number) {
    const s = this.db.getSchedule(scheduleId)!;
    const p = this.parentOf(s);
    this.db.updateSchedule(scheduleId, { status: "arrived" });
    this.db.addEvent(scheduleId, "arrived", "도착했어요");
    this.notifier.toGuardian(p, s, "arrived", `${p.name} ${s.place_name}에 잘 도착하셨어요.`);
  }

  async cancel(scheduleId: number) {
    this.db.updateSchedule(scheduleId, { status: "cancelled" });
    this.db.addEvent(scheduleId, "cancelled", "일정 취소");
  }

  describe(s: Schedule) {
    return `${formatDate(new Date(s.start_at))} ${formatTime(new Date(s.start_at))}`;
  }
}
