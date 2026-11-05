import { timing } from "./config.ts";
import type { Db, Draft, Schedule, ScheduleSource } from "./db.ts";
import type { Notifier } from "./notify.ts";
import type { TripFlow } from "./flow.ts";
import type { AppointmentParser } from "./parse.ts";
import { searchExactPlaces } from "./places.ts";
import { formatDate, formatTime, fromSeoulLocal, iGa } from "./time.ts";

export interface Conflict {
  id: number;
  title: string;
  place_name: string;
  start_at: string;
  /** duplicate: 같은 일정이 이미 있음 / overlap: 시간이 가까워 겹칠 수 있음 */
  type: "duplicate" | "overlap";
}

export class ConflictError extends Error {
  conflicts: Conflict[];
  constructor(conflicts: Conflict[]) {
    super(conflicts.some((c) => c.type === "duplicate") ? "이미 같은 일정이 있어요." : "시간이 겹치는 일정이 있어요.");
    this.conflicts = conflicts;
  }
}

export class IncompleteError extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super(`${missing.join(", ")}을(를) 알려 주세요.`);
    this.missing = missing;
  }
}

export type NewSchedule = Pick<
  Schedule,
  "parent_id" | "title" | "kind" | "place_name" | "place_address" | "place_lat" | "place_lng" | "start_at" | "memo"
> & { source?: ScheduleSource };

const norm = (s: string) => s.replace(/\s|\(.*?\)/g, "");

export function samePlace(a: string, b: string): boolean {
  const x = norm(a);
  const y = norm(b);
  return Boolean(x && y) && (x.includes(y) || y.includes(x));
}

export function describeConflict(c: Conflict): string {
  const d = new Date(c.start_at);
  return `${formatDate(d)} ${formatTime(d)} ${c.place_name}${c.title ? ` (${c.title})` : ""}`;
}

export class Intake {
  private db: Db;
  private flow: TripFlow;
  private parser: AppointmentParser;
  private notifier: Notifier;
  constructor(db: Db, flow: TripFlow, parser: AppointmentParser, notifier: Notifier) {
    this.db = db;
    this.flow = flow;
    this.parser = parser;
    this.notifier = notifier;
  }

  findConflicts(parentId: number, startIso: string, placeName: string, excludeId: number | null = null): Conflict[] {
    const t = new Date(startIso).getTime();
    return this.db.findNearbySchedules(parentId, startIso, timing.overlapWindowMin, excludeId).map((s) => {
      const diffMin = Math.abs(new Date(s.start_at).getTime() - t) / 60_000;
      const dup = diffMin <= timing.duplicateWindowMin && samePlace(s.place_name, placeName);
      return { id: s.id, title: s.title, place_name: s.place_name, start_at: s.start_at, type: dup ? "duplicate" : "overlap" };
    });
  }

  /** 일정 저장 (겹치는 일정이 있으면 force 없이는 ConflictError) */
  async createSchedule(input: NewSchedule, force = false): Promise<Schedule> {
    const conflicts = this.findConflicts(input.parent_id, input.start_at, input.place_name);
    if (conflicts.length && !force) throw new ConflictError(conflicts);
    const s = this.db.createSchedule(input);
    await this.flow.plan(s.id);
    await this.flow.tickOne(s.id); // 이미 알림 시각이 지났으면 바로 보냄
    return this.db.getSchedule(s.id)!;
  }

  /** 글(문자·말)을 읽어 임시 일정을 만든다. 일정이 아니면 null */
  async draftFromText(parentId: number, text: string, source: ScheduleSource, now = new Date()): Promise<Draft | null> {
    const raw = text.trim().slice(0, 2000);
    if (!raw) return null;
    const p = await this.parser.parse(raw, now);
    if (!p.is_appointment) return null;
    let place = { name: p.place_name, address: "", lat: null as number | null, lng: null as number | null };
    if (p.place_name) {
      const found = (await searchExactPlaces(p.place_name, { online: true }).catch(() => []))[0];
      if (found) place = { name: found.name, address: found.address, lat: found.lat, lng: found.lng };
    }
    const startAt = p.date && p.time ? fromSeoulLocal(`${p.date}T${p.time}`).toISOString() : null;
    return this.db.createDraft({
      parent_id: parentId, source, raw_text: raw, title: p.title || p.place_name || "일정", kind: p.kind,
      place_name: place.name, place_address: place.address, place_lat: place.lat, place_lng: place.lng,
      start_at: startAt, memo: p.memo, status: source === "sms" ? "review" : "pending", // 부모님·자녀 입력은 그 화면에서 바로 확인
    });
  }

  missingFields(d: Draft): string[] {
    const missing: string[] = [];
    if (!d.start_at) missing.push("날짜·시간");
    if (!d.place_name) missing.push("장소");
    else if (d.place_lat === null || d.place_lng === null) missing.push("장소 위치");
    return missing;
  }

  draftView(d: Draft) {
    return {
      ...d,
      missing: this.missingFields(d),
      conflicts: d.start_at ? this.findConflicts(d.parent_id, d.start_at, d.place_name) : [],
    };
  }

  /** 임시 일정을 실제 일정으로 저장 */
  async acceptDraft(draftId: number, force = false): Promise<Schedule> {
    const d = this.db.getDraft(draftId);
    if (!d || (d.status !== "pending" && d.status !== "review")) throw new Error("이미 처리된 일정이에요.");
    const missing = this.missingFields(d);
    if (missing.length) throw new IncompleteError(missing);
    const s = await this.createSchedule({
      parent_id: d.parent_id, title: d.title, kind: d.kind, place_name: d.place_name, place_address: d.place_address,
      place_lat: d.place_lat!, place_lng: d.place_lng!, start_at: d.start_at!, memo: d.memo, source: d.source,
    }, force);
    this.db.updateDraft(draftId, { status: "accepted", schedule_id: s.id });
    return s;
  }

  /** 부모님이 알려 준 일정인데 장소를 못 찾았을 때: 자녀가 마무리하도록 넘긴다 */
  handToGuardian(draftId: number) {
    const d = this.db.getDraft(draftId)!;
    const parent = this.db.getParent(d.parent_id)!;
    this.db.updateDraft(draftId, { status: "review" });
    const when = d.start_at ? `${formatDate(new Date(d.start_at))} ${formatTime(new Date(d.start_at))}` : "";
    this.notifier.toGuardian(parent, null, "parent_review",
      `${iGa(parent.name)} 알려 주신 일정: ${when} ${d.place_name || d.raw_text}. 장소를 확인해 주세요.`);
  }

  dismissDraft(draftId: number) {
    this.db.updateDraft(draftId, { status: "dismissed" });
  }

  /**
   * 부모님 폰에서 전달된 예약 문자 처리.
   * - 정보가 다 있고 겹치는 일정이 없으면 바로 저장
   * - 같은 예약 문자가 또 오면 (병원은 확정·전날 안내를 여러 번 보냄) 건너뜀
   * - 그 밖에는 자녀가 확인하도록 남겨 둠
   */
  async fromSms(parentId: number, text: string, now = new Date()) {
    const parent = this.db.getParent(parentId)!;
    const d = await this.draftFromText(parentId, text, "sms", now);
    if (!d) return { result: "ignored" as const };
    const view = this.draftView(d);
    const when = d.start_at ? `${formatDate(new Date(d.start_at))} ${formatTime(new Date(d.start_at))}` : "";

    if (/취소/.test(d.memo)) {
      this.notifier.toGuardian(parent, null, "sms_review", `예약 취소 문자가 왔어요: ${when} ${d.place_name}. 확인해 주세요.`);
      return { result: "review" as const, draft: view };
    }
    if (view.conflicts.some((c) => c.type === "duplicate")) {
      this.dismissDraft(d.id);
      return { result: "duplicate" as const, draft: view };
    }
    if (view.missing.length || view.conflicts.length) {
      const why = view.missing.length ? `${view.missing.join(", ")} 확인 필요` : "다른 일정과 시간이 겹쳐요";
      this.notifier.toGuardian(parent, null, "sms_review", `문자에서 일정을 찾았어요 (${why}): ${when} ${d.place_name}`);
      return { result: "review" as const, draft: view };
    }
    const s = await this.acceptDraft(d.id);
    this.db.addEvent(s.id, "imported", "예약 문자에서 자동으로 가져왔어요");
    this.notifier.toGuardian(parent, s, "sms_imported", `문자에서 ${parent.name} 일정을 가져왔어요: ${when} ${s.place_name}`);
    return { result: "created" as const, schedule: s };
  }
}
