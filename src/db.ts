import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export type Mode = "taxi" | "transit" | "family";

export interface Parent {
  id: number;
  name: string; // 호칭, 예: 엄마
  real_name: string; // 실명, 예: 김영희 (콜센터에 알려 줄 이름)
  avatar: string; // 화면에 보일 아이콘 (예: 👵). 비어 있으면 호칭 글자
  phone: string;
  home_address: string;
  home_lat: number;
  home_lng: number;
  preferred_mode: Mode | null;
  notes: string; // 콜센터에 전할 참고사항 (예: 지팡이 사용)
  token: string; // 부모님 간편 화면 링크용
}

export interface Schedule {
  id: number;
  parent_id: number;
  title: string;
  kind: string;
  place_name: string;
  place_address: string;
  place_lat: number;
  place_lng: number;
  start_at: string; // ISO
  memo: string;
  status: ScheduleStatus;
  chosen_mode: Mode | null;
  route_options: string | null; // JSON (RouteOption[])
  departure_at: string | null; // ISO, 예상 출발 시각
  stages_sent: string; // JSON string[]
  taxi_call_at: string | null; // ISO, 택시 예약 호출 시각
  source: ScheduleSource;
  created_at: string;
}

export type ScheduleSource = "guardian" | "parent" | "sms";

/** 문자·부모님 입력에서 읽어낸, 아직 저장 전인 일정 */
export interface Draft {
  id: number;
  parent_id: number;
  source: ScheduleSource;
  raw_text: string;
  title: string;
  kind: string;
  place_name: string;
  place_address: string;
  place_lat: number | null;
  place_lng: number | null;
  start_at: string | null;
  memo: string;
  /** pending: 부모님 확인 대기 / review: 자녀 확인 필요 / accepted / dismissed */
  status: "pending" | "review" | "accepted" | "dismissed";
  schedule_id: number | null;
  created_at: string;
}

export type ScheduleStatus =
  | "scheduled" // 예정
  | "asked" // 교통수단 물어봄
  | "escalated" // 무응답 → 자녀에게 넘김
  | "chosen" // 교통수단 선택됨
  | "taxi_reserved" // 택시 예약됨 (정해진 시각에 AI가 호출)
  | "calling" // AI 통화 중
  | "dispatched" // 배차 완료
  | "call_failed" // 호출 실패
  | "arrived" // 도착
  | "cancelled";

export interface Call {
  id: number;
  schedule_id: number;
  provider: string;
  provider_call_id: string | null;
  status: "dialing" | "in_progress" | "dispatched" | "failed";
  attempt: number;
  transcript: string; // JSON {who:'ai'|'center', text}[]
  car_number: string | null;
  car_description: string | null;
  eta_minutes: number | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface TimelineEvent {
  id: number;
  schedule_id: number;
  type: string;
  message: string;
  created_at: string;
}

export interface Notification {
  id: number;
  parent_id: number;
  schedule_id: number | null;
  audience: "parent" | "guardian";
  kind: string;
  message: string;
  read: number;
  created_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS parents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  real_name TEXT NOT NULL DEFAULT '',
  avatar TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL,
  home_address TEXT NOT NULL,
  home_lat REAL NOT NULL,
  home_lng REAL NOT NULL,
  preferred_mode TEXT,
  notes TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT '기타',
  place_name TEXT NOT NULL,
  place_address TEXT NOT NULL,
  place_lat REAL NOT NULL,
  place_lng REAL NOT NULL,
  start_at TEXT NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'scheduled',
  chosen_mode TEXT,
  route_options TEXT,
  departure_at TEXT,
  stages_sent TEXT NOT NULL DEFAULT '[]',
  taxi_call_at TEXT,
  source TEXT NOT NULL DEFAULT 'guardian',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  raw_text TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '기타',
  place_name TEXT NOT NULL DEFAULT '',
  place_address TEXT NOT NULL DEFAULT '',
  place_lat REAL,
  place_lng REAL,
  start_at TEXT,
  memo TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  schedule_id INTEGER REFERENCES schedules(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_call_id TEXT,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  transcript TEXT NOT NULL DEFAULT '[]',
  car_number TEXT,
  car_description TEXT,
  eta_minutes INTEGER,
  failure_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_id INTEGER NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  parent_id INTEGER NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
  schedule_id INTEGER REFERENCES schedules(id) ON DELETE CASCADE,
  audience TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedules_start ON schedules(start_at);
CREATE INDEX IF NOT EXISTS idx_events_schedule ON events(schedule_id);
`;

export type Db = ReturnType<typeof openDb>;

export function openDb(file: string) {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  // 예전 DB 파일에 새 칸 추가
  for (const col of ["real_name TEXT NOT NULL DEFAULT ''@parents", "avatar TEXT NOT NULL DEFAULT ''@parents", "taxi_call_at TEXT@schedules", "source TEXT NOT NULL DEFAULT 'guardian'@schedules"]) {
    const [def, table] = col.split("@");
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${def}`);
    } catch {
      // 이미 있음
    }
  }
  const now = () => new Date().toISOString();

  const one = <T>(sql: string, ...args: (string | number | null)[]) =>
    db.prepare(sql).get(...args) as T | undefined;
  const all = <T>(sql: string, ...args: (string | number | null)[]) =>
    db.prepare(sql).all(...args) as unknown as T[];
  const run = (sql: string, ...args: (string | number | null)[]) =>
    db.prepare(sql).run(...args);

  return {
    raw: db,

    // ---------- parents ----------
    createParent(p: Omit<Parent, "id" | "token" | "real_name" | "avatar"> & { real_name?: string; avatar?: string }): Parent {
      const token = crypto.randomBytes(12).toString("base64url");
      const r = run(
        `INSERT INTO parents (name, real_name, avatar, phone, home_address, home_lat, home_lng, preferred_mode, notes, token)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        p.name, p.real_name ?? "", p.avatar ?? "", p.phone, p.home_address, p.home_lat, p.home_lng, p.preferred_mode, p.notes, token,
      );
      return this.getParent(Number(r.lastInsertRowid))!;
    },
    updateParent(id: number, p: Partial<Omit<Parent, "id" | "token">>): Parent | undefined {
      const cur = this.getParent(id);
      if (!cur) return undefined;
      const n = { ...cur, ...p };
      run(
        `UPDATE parents SET name=?, real_name=?, avatar=?, phone=?, home_address=?, home_lat=?, home_lng=?, preferred_mode=?, notes=? WHERE id=?`,
        n.name, n.real_name, n.avatar, n.phone, n.home_address, n.home_lat, n.home_lng, n.preferred_mode, n.notes, id,
      );
      return this.getParent(id);
    },
    deleteParent(id: number) {
      run(`DELETE FROM parents WHERE id=?`, id);
    },
    getParent: (id: number) => one<Parent>(`SELECT * FROM parents WHERE id=?`, id),
    getParentByToken: (token: string) => one<Parent>(`SELECT * FROM parents WHERE token=?`, token),
    listParents: () => all<Parent>(`SELECT * FROM parents ORDER BY id`),

    // ---------- schedules ----------
    createSchedule(
      s: Pick<Schedule, "parent_id" | "title" | "kind" | "place_name" | "place_address" | "place_lat" | "place_lng" | "start_at" | "memo">
        & { source?: ScheduleSource },
    ): Schedule {
      const r = run(
        `INSERT INTO schedules (parent_id, title, kind, place_name, place_address, place_lat, place_lng, start_at, memo, source, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        s.parent_id, s.title, s.kind, s.place_name, s.place_address, s.place_lat, s.place_lng, s.start_at, s.memo,
        s.source ?? "guardian", now(),
      );
      return this.getSchedule(Number(r.lastInsertRowid))!;
    },
    getSchedule: (id: number) => one<Schedule>(`SELECT * FROM schedules WHERE id=?`, id),
    listSchedules: (fromIso: string) =>
      all<Schedule>(`SELECT * FROM schedules WHERE start_at >= ? ORDER BY start_at`, fromIso),
    listSchedulesForParent: (parentId: number, fromIso: string) =>
      all<Schedule>(
        `SELECT * FROM schedules WHERE parent_id=? AND start_at >= ? AND status != 'cancelled' ORDER BY start_at`,
        parentId, fromIso,
      ),
    listActiveSchedules: (fromIso: string, toIso: string) =>
      all<Schedule>(
        `SELECT * FROM schedules WHERE start_at BETWEEN ? AND ? AND status NOT IN ('cancelled','arrived') ORDER BY start_at`,
        fromIso, toIso,
      ),
    /** 달력용: 기간 안의 일정 (취소 제외). parentId가 null이면 모든 부모님 */
    listSchedulesBetween: (fromIso: string, toIso: string, parentId: number | null = null) =>
      parentId === null
        ? all<Schedule>(`SELECT * FROM schedules WHERE start_at >= ? AND start_at < ? AND status != 'cancelled' ORDER BY start_at`, fromIso, toIso)
        : all<Schedule>(
            `SELECT * FROM schedules WHERE parent_id=? AND start_at >= ? AND start_at < ? AND status != 'cancelled' ORDER BY start_at`,
            parentId, fromIso, toIso,
          ),
    updateSchedule(id: number, fields: Partial<Omit<Schedule, "id">>) {
      const keys = Object.keys(fields) as (keyof typeof fields)[];
      if (!keys.length) return;
      const sql = `UPDATE schedules SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE id=?`;
      run(sql, ...keys.map((k) => (fields[k] ?? null) as string | number | null), id);
    },
    deleteSchedule(id: number) {
      run(`DELETE FROM schedules WHERE id=?`, id);
    },

    /** 같은 부모님의 앞뒤 windowMin분 안에 있는 일정 (취소·도착 제외) */
    findNearbySchedules(parentId: number, startIso: string, windowMin: number, excludeId: number | null = null) {
      const t = new Date(startIso).getTime();
      const from = new Date(t - windowMin * 60_000).toISOString();
      const to = new Date(t + windowMin * 60_000).toISOString();
      return all<Schedule>(
        `SELECT * FROM schedules WHERE parent_id=? AND start_at BETWEEN ? AND ? AND status != 'cancelled' AND id != ? ORDER BY start_at`,
        parentId, from, to, excludeId ?? -1,
      );
    },

    // ---------- drafts ----------
    createDraft(d: Omit<Draft, "id" | "schedule_id" | "created_at">): Draft {
      const r = run(
        `INSERT INTO drafts (parent_id, source, raw_text, title, kind, place_name, place_address, place_lat, place_lng, start_at, memo, status, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        d.parent_id, d.source, d.raw_text, d.title, d.kind, d.place_name, d.place_address, d.place_lat, d.place_lng, d.start_at, d.memo, d.status, now(),
      );
      return this.getDraft(Number(r.lastInsertRowid))!;
    },
    getDraft: (id: number) => one<Draft>(`SELECT * FROM drafts WHERE id=?`, id),
    listReviewDrafts: () => all<Draft>(`SELECT * FROM drafts WHERE status='review' ORDER BY id DESC`),
    updateDraft(id: number, fields: Partial<Omit<Draft, "id">>) {
      const keys = Object.keys(fields) as (keyof typeof fields)[];
      if (!keys.length) return;
      run(`UPDATE drafts SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE id=?`,
        ...keys.map((k) => (fields[k] ?? null) as string | number | null), id);
    },

    // ---------- calls ----------
    createCall(c: Pick<Call, "schedule_id" | "provider" | "attempt">): Call {
      const t = now();
      const r = run(
        `INSERT INTO calls (schedule_id, provider, status, attempt, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
        c.schedule_id, c.provider, "dialing", c.attempt, t, t,
      );
      return this.getCall(Number(r.lastInsertRowid))!;
    },
    getCall: (id: number) => one<Call>(`SELECT * FROM calls WHERE id=?`, id),
    listCallsForSchedule: (scheduleId: number) =>
      all<Call>(`SELECT * FROM calls WHERE schedule_id=? ORDER BY id`, scheduleId),
    listRecentCalls: (limit: number) => all<Call>(`SELECT * FROM calls ORDER BY id DESC LIMIT ?`, limit),
    updateCall(id: number, fields: Partial<Omit<Call, "id">>) {
      const merged = { ...fields, updated_at: now() };
      const keys = Object.keys(merged) as (keyof typeof merged)[];
      run(
        `UPDATE calls SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE id=?`,
        ...keys.map((k) => (merged[k] ?? null) as string | number | null),
        id,
      );
    },

    // ---------- timeline ----------
    addEvent(scheduleId: number, type: string, message: string) {
      run(`INSERT INTO events (schedule_id, type, message, created_at) VALUES (?,?,?,?)`, scheduleId, type, message, now());
    },
    listEvents: (scheduleId: number) =>
      all<TimelineEvent>(`SELECT * FROM events WHERE schedule_id=? ORDER BY id`, scheduleId),

    // ---------- notifications ----------
    addNotification(n: Pick<Notification, "parent_id" | "schedule_id" | "audience" | "kind" | "message">) {
      run(
        `INSERT INTO notifications (parent_id, schedule_id, audience, kind, message, created_at) VALUES (?,?,?,?,?,?)`,
        n.parent_id, n.schedule_id, n.audience, n.kind, n.message, now(),
      );
    },
    listNotifications: (audience: "parent" | "guardian", parentId: number | null, limit = 30) =>
      parentId === null
        ? all<Notification>(`SELECT * FROM notifications WHERE audience=? ORDER BY id DESC LIMIT ?`, audience, limit)
        : all<Notification>(
            `SELECT * FROM notifications WHERE audience=? AND parent_id=? ORDER BY id DESC LIMIT ?`,
            audience, parentId, limit,
          ),
  };
}
