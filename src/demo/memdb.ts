// 체험판용: 브라우저 메모리에서 동작하는 DB (src/db.ts 의 openDb 와 같은 기능)
import type { Call, Db, Draft, Notification, Parent, Schedule, TimelineEvent } from "../db.ts";

interface Tables {
  parents: Parent[];
  schedules: Schedule[];
  calls: Call[];
  events: TimelineEvent[];
  notifications: Notification[];
  drafts: Draft[];
  seq: number;
}

const empty = (): Tables => ({ parents: [], schedules: [], calls: [], events: [], notifications: [], drafts: [], seq: 0 });

function randomToken(): string {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function openMemDb(initial?: Tables): { db: Db; dump: () => Tables } {
  const t: Tables = initial ?? empty();
  const now = () => new Date().toISOString();
  const id = () => ++t.seq;
  const byStart = (a: Schedule, b: Schedule) => a.start_at.localeCompare(b.start_at);
  const copy = <T>(x: T | undefined) => (x ? { ...x } : undefined);

  const db = {
    raw: null,

    createParent(p: Omit<Parent, "id" | "token" | "real_name"> & { real_name?: string }): Parent {
      const row: Parent = { ...p, real_name: p.real_name ?? "", id: id(), token: randomToken() };
      t.parents.push(row);
      return { ...row };
    },
    updateParent(pid: number, p: Partial<Omit<Parent, "id" | "token">>) {
      const row = t.parents.find((x) => x.id === pid);
      if (!row) return undefined;
      Object.assign(row, p);
      return { ...row };
    },
    deleteParent(pid: number) {
      t.parents = t.parents.filter((x) => x.id !== pid);
      const gone = new Set(t.schedules.filter((s) => s.parent_id === pid).map((s) => s.id));
      t.schedules = t.schedules.filter((s) => s.parent_id !== pid);
      t.calls = t.calls.filter((c) => !gone.has(c.schedule_id));
      t.events = t.events.filter((e) => !gone.has(e.schedule_id));
      t.notifications = t.notifications.filter((n) => n.parent_id !== pid);
      t.drafts = t.drafts.filter((d) => d.parent_id !== pid);
    },
    getParent: (pid: number) => copy(t.parents.find((x) => x.id === pid)),
    getParentByToken: (token: string) => copy(t.parents.find((x) => x.token === token)),
    listParents: () => t.parents.map((x) => ({ ...x })),

    createSchedule(s: Parameters<Db["createSchedule"]>[0]): Schedule {
      const row: Schedule = {
        ...s, source: s.source ?? "guardian", id: id(), status: "scheduled", chosen_mode: null, route_options: null,
        departure_at: null, stages_sent: "[]", taxi_call_at: null, created_at: now(),
      };
      t.schedules.push(row);
      return { ...row };
    },
    getSchedule: (sid: number) => copy(t.schedules.find((x) => x.id === sid)),
    listSchedules: (fromIso: string) => t.schedules.filter((s) => s.start_at >= fromIso).sort(byStart).map((s) => ({ ...s })),
    listSchedulesForParent: (pid: number, fromIso: string) =>
      t.schedules.filter((s) => s.parent_id === pid && s.start_at >= fromIso && s.status !== "cancelled").sort(byStart).map((s) => ({ ...s })),
    listActiveSchedules: (fromIso: string, toIso: string) =>
      t.schedules.filter((s) => s.start_at >= fromIso && s.start_at <= toIso && !["cancelled", "arrived"].includes(s.status))
        .sort(byStart).map((s) => ({ ...s })),
    updateSchedule(sid: number, fields: Partial<Omit<Schedule, "id">>) {
      const row = t.schedules.find((x) => x.id === sid);
      if (row) Object.assign(row, fields);
    },
    deleteSchedule(sid: number) {
      t.schedules = t.schedules.filter((x) => x.id !== sid);
    },
    findNearbySchedules(pid: number, startIso: string, windowMin: number, excludeId: number | null = null) {
      const c = new Date(startIso).getTime();
      const from = new Date(c - windowMin * 60_000).toISOString();
      const to = new Date(c + windowMin * 60_000).toISOString();
      return t.schedules
        .filter((s) => s.parent_id === pid && s.start_at >= from && s.start_at <= to && s.status !== "cancelled" && s.id !== (excludeId ?? -1))
        .sort(byStart).map((s) => ({ ...s }));
    },

    createDraft(d: Omit<Draft, "id" | "schedule_id" | "created_at">): Draft {
      const row: Draft = { ...d, id: id(), schedule_id: null, created_at: now() };
      t.drafts.push(row);
      return { ...row };
    },
    getDraft: (did: number) => copy(t.drafts.find((x) => x.id === did)),
    listReviewDrafts: () => t.drafts.filter((d) => d.status === "review").sort((a, b) => b.id - a.id).map((d) => ({ ...d })),
    updateDraft(did: number, fields: Partial<Omit<Draft, "id">>) {
      const row = t.drafts.find((x) => x.id === did);
      if (row) Object.assign(row, fields);
    },

    createCall(c: Pick<Call, "schedule_id" | "provider" | "attempt">): Call {
      const row: Call = {
        ...c, id: id(), provider_call_id: null, status: "dialing", transcript: "[]", car_number: null, car_description: null,
        eta_minutes: null, failure_reason: null, created_at: now(), updated_at: now(),
      };
      t.calls.push(row);
      return { ...row };
    },
    getCall: (cid: number) => copy(t.calls.find((x) => x.id === cid)),
    listCallsForSchedule: (sid: number) => t.calls.filter((c) => c.schedule_id === sid).map((c) => ({ ...c })),
    listRecentCalls: (limit: number) => [...t.calls].reverse().slice(0, limit).map((c) => ({ ...c })),
    updateCall(cid: number, fields: Partial<Omit<Call, "id">>) {
      const row = t.calls.find((x) => x.id === cid);
      if (row) Object.assign(row, fields, { updated_at: now() });
    },

    addEvent(sid: number, type: string, message: string) {
      t.events.push({ id: id(), schedule_id: sid, type, message, created_at: now() });
    },
    listEvents: (sid: number) => t.events.filter((e) => e.schedule_id === sid).map((e) => ({ ...e })),

    addNotification(n: Pick<Notification, "parent_id" | "schedule_id" | "audience" | "kind" | "message">) {
      t.notifications.push({ ...n, id: id(), read: 0, created_at: now() });
    },
    listNotifications: (audience: "parent" | "guardian", pid: number | null, limit = 30) =>
      t.notifications.filter((n) => n.audience === audience && (pid === null || n.parent_id === pid))
        .sort((a, b) => b.id - a.id).slice(0, limit).map((n) => ({ ...n })),
  };
  // 타입 검사: 실제 DB와 같은 기능을 모두 갖췄는지
  const typed: Omit<Db, "raw"> = db;
  return { db: typed as Db, dump: () => t };
}
