import { z } from "zod";
import type { Comparison } from "./routes/compare.ts";
import type { Db, Parent, Schedule } from "./db.ts";
import type { TripFlow } from "./flow.ts";
import type { CallService } from "./call/service.ts";
import type { SimulatorProvider } from "./call/simulator.ts";
import { searchPlaces } from "./places.ts";
import { ConflictError, IncompleteError, type Intake } from "./intake.ts";
import { fromSeoulLocal } from "./time.ts";
import { guessKind } from "./parse.ts";

/**
 * API 라우트 정의. Express 서버(src/app.ts)와 브라우저 체험판(src/demo)이 같은 코드를 쓴다.
 */
export interface ApiRequest {
  params: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  query: Record<string, unknown>;
}
export interface ApiResponse {
  status: number;
  body?: unknown;
}
export type Method = "GET" | "POST" | "PUT" | "DELETE";
export interface Route {
  method: Method;
  path: string;
  handle(req: ApiRequest): Promise<ApiResponse>;
}

export interface ApiDeps {
  db: Db;
  flow: TripFlow;
  calls: CallService;
  simulator: SimulatorProvider | null;
  intake: Intake;
}

export const ModeZ = z.enum(["taxi", "transit", "family"]);
const ParentZ = z.object({
  name: z.string().min(1).max(20),
  real_name: z.string().max(20).default(""),
  avatar: z.string().max(16).default(""),
  phone: z.string().regex(/^0\d{1,2}-?\d{3,4}-?\d{4}$/, "전화번호 형식을 확인해 주세요"),
  home_address: z.string().min(2),
  home_lat: z.number().min(33).max(39),
  home_lng: z.number().min(124).max(132),
  preferred_mode: ModeZ.nullable().default(null),
  notes: z.string().max(200).default(""),
});
const ScheduleZ = z.object({
  parent_id: z.number().int(),
  title: z.string().min(1).max(50),
  kind: z.string().max(10).default(""), // 비우면 제목·장소로 알아서 고름
  place_name: z.string().min(1),
  place_address: z.string().min(1),
  place_lat: z.number().min(33).max(39),
  place_lng: z.number().min(124).max(132),
  start_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/),
  memo: z.string().max(200).default(""),
  force: z.boolean().default(false),
  draft_id: z.number().int().nullable().default(null),
});
const DraftEditZ = z.object({
  title: z.string().min(1).max(50),
  place_name: z.string().min(1),
  place_address: z.string(),
  place_lat: z.number().min(33).max(39),
  place_lng: z.number().min(124).max(132),
  start_local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/),
  memo: z.string().max(200),
}).partial();
const TextZ = z.object({ text: z.string().min(1).max(2000) });
// 달력 기간 (최대 6주)
const RangeZ = z.object({ from: z.iso.datetime(), to: z.iso.datetime() }).refine(
  (r) => new Date(r.to).getTime() - new Date(r.from).getTime() <= 43 * 86400_000 && r.to > r.from,
  "기간이 올바르지 않아요",
);

export function buildRoutes({ db, flow, calls, simulator, intake }: ApiDeps): Route[] {
  const routes: Route[] = [];
  const r = (method: Method, path: string, handle: (req: ApiRequest) => Promise<ApiResponse>) =>
    routes.push({ method, path, handle });
  const reply = (status: number, body?: unknown): ApiResponse => ({ status, body });

  const scheduleView = (s: Schedule) => ({
    ...s,
    route_options: s.route_options ? (JSON.parse(s.route_options) as Comparison) : null,
    stages_sent: JSON.parse(s.stages_sent),
    events: db.listEvents(s.id),
    calls: db.listCallsForSchedule(s.id).map((c) => ({ ...c, transcript: JSON.parse(c.transcript) })),
  });
  const since = () => new Date(Date.now() - 12 * 3600_000).toISOString();
  const parentPublic = (p: Parent) => ({ ...p });

  // ------------------------------------------------------------------ 자녀(보호자)
  r("GET", "/api/state", async (req) => {
    return reply(200, {
      parents: db.listParents().map(parentPublic),
      schedules: db.listSchedules(since()).map(scheduleView),
      notifications: db.listNotifications("guardian", null),
      drafts: db.listReviewDrafts().map((d) => intake.draftView(d)),
      callProvider: calls.provider.name,
      simulatorScenario: simulator?.scenario ?? null,
    });
  });

  // 달력: 기간 안의 모든 부모님 일정 (지난 일정 포함)
  r("GET", "/api/calendar", async (req) => {
    const { from, to } = RangeZ.parse(req.query);
    return reply(200, db.listSchedulesBetween(from, to).map(scheduleView));
  });

  r("POST", "/api/parents", async (req) => {
    return reply(201, db.createParent(ParentZ.parse(req.body)));
  });
  r("PUT", "/api/parents/:id", async (req) => {
    // 보낸 칸만 바꾼다 (partial()이 기본값을 채워 넣어 다른 칸을 지우지 않게)
    const parsed = ParentZ.partial().parse(req.body);
    const sent = new Set(Object.keys(req.body ?? {}));
    const fields = Object.fromEntries(Object.entries(parsed).filter(([k]) => sent.has(k)));
    const p = db.updateParent(Number(req.params.id), fields);
    if (!p) return reply(404, { error: "부모님 정보를 찾을 수 없어요." });
    return reply(200, p);
  });
  r("DELETE", "/api/parents/:id", async (req) => {
    db.deleteParent(Number(req.params.id));
    return reply(204);
  });

  r("POST", "/api/schedules", async (req) => {
    const { start_local, force, draft_id, ...rest } = ScheduleZ.parse(req.body);
    if (!db.getParent(rest.parent_id)) return reply(400, { error: "부모님을 먼저 등록해 주세요." });
    const draft = draft_id ? db.getDraft(draft_id) : undefined;
    const kind = rest.kind || guessKind(`${rest.title} ${rest.place_name}`);
    const s = await intake.createSchedule(
      { ...rest, kind, start_at: fromSeoulLocal(start_local).toISOString(), source: draft?.source ?? "guardian" }, force);
    if (draft) db.updateDraft(draft.id, { status: "accepted", schedule_id: s.id });
    return reply(201, scheduleView(s));
  });
  r("POST", "/api/schedules/:id/call-now", async (req) => {
    await flow.callTaxiNow(Number(req.params.id));
    return reply(200, scheduleView(db.getSchedule(Number(req.params.id))!));
  });

  // 문자 붙여넣기 → 임시 일정
  r("POST", "/api/parse", async (req) => {
    const { text } = TextZ.parse(req.body);
    const parentId = Number(req.body?.parent_id);
    if (!db.getParent(parentId)) return reply(400, { error: "누구 일정인지 골라 주세요." });
    const d = await intake.draftFromText(parentId, text, "guardian");
    if (!d) return reply(422, { error: "일정 내용을 찾지 못했어요. 날짜·시간·장소가 들어 있는지 확인해 주세요." });
    return reply(201, intake.draftView(d));
  });
  r("POST", "/api/drafts/:id/accept", async (req) => {
    const s = await intake.acceptDraft(Number(req.params.id), req.body?.force === true);
    return reply(200, scheduleView(s));
  });
  r("PUT", "/api/drafts/:id", async (req) => {
    const { start_local, ...rest } = DraftEditZ.parse(req.body);
    const id = Number(req.params.id);
    if (!db.getDraft(id)) return reply(404, { error: "없는 일정이에요." });
    db.updateDraft(id, { ...rest, ...(start_local ? { start_at: fromSeoulLocal(start_local).toISOString() } : {}) });
    return reply(200, intake.draftView(db.getDraft(id)!));
  });
  r("POST", "/api/drafts/:id/dismiss", async (req) => {
    intake.dismissDraft(Number(req.params.id));
    return reply(204);
  });

  // 부모님 폰의 문자 자동 전달 (안드로이드 문자 전달 앱, 아이폰 단축어 자동화)
  // 본문: JSON {"text": "..."} 또는 text/plain
  r("POST", "/api/inbox/:token", async (req) => {
    const p = db.getParentByToken(String(req.params.token));
    if (!p) return reply(404, { error: "링크가 올바르지 않아요." });
    const text = typeof req.body === "string" ? req.body : String(req.body?.text ?? req.body?.message ?? "");
    if (!text.trim()) return reply(400, { error: "문자 내용이 비어 있어요." });
    return reply(200, await intake.fromSms(p.id, text));
  });
  r("DELETE", "/api/schedules/:id", async (req) => {
    await flow.cancel(Number(req.params.id));
    return reply(204);
  });
  r("POST", "/api/schedules/:id/ask-now", async (req) => {
    await flow.askNow(Number(req.params.id));
    return reply(200, scheduleView(db.getSchedule(Number(req.params.id))!));
  });
  r("POST", "/api/schedules/:id/choose", async (req) => {
    const mode = ModeZ.parse(req.body?.mode);
    await flow.choose(Number(req.params.id), mode, "guardian");
    return reply(200, scheduleView(db.getSchedule(Number(req.params.id))!));
  });

  r("GET", "/api/places", async (req) => {
    // full=1: '검색' 버튼을 눌렀을 때만 바깥 무료 서비스까지 찾음 (오픈스트리트맵 이용 규칙)
    return reply(200, await searchPlaces(String(req.query.q ?? ""), { online: req.query.full === "1", interactive: true }));
  });

  r("POST", "/api/simulator/scenario", async (req) => {
    if (!simulator) return reply(400, { error: "시뮬레이터 모드가 아니에요." });
    simulator.scenario = z.enum(["normal", "ivr", "no_car"]).parse(req.body?.scenario);
    return reply(200, { scenario: simulator.scenario });
  });

  // ------------------------------------------------------------------ 부모님 (간편 화면)
  const parentByToken = (req: ApiRequest) => db.getParentByToken(String(req.params.token));

  r("GET", "/api/p/:token", async (req) => {
    const p = parentByToken(req);
    if (!p) return reply(404, { error: "링크가 올바르지 않아요." });
    const upcoming = db.listSchedulesForParent(p.id, since()).filter((s) => s.status !== "arrived");
    return reply(200, {
      parent: { name: p.name, avatar: p.avatar },
      current: upcoming[0] ? scheduleView(upcoming[0]) : null,
      upcoming: upcoming.slice(1, 4).map((s) => ({ id: s.id, title: s.title, place_name: s.place_name, start_at: s.start_at })),
      notifications: db.listNotifications("parent", p.id, 5),
    });
  });

  const ownSchedule = (req: ApiRequest) => {
    const p = parentByToken(req);
    const s = db.getSchedule(Number(req.body?.scheduleId));
    if (!p || !s || s.parent_id !== p.id) return null;
    return s;
  };

  r("GET", "/api/p/:token/calendar", async (req) => {
    const p = parentByToken(req);
    if (!p) return reply(404, { error: "링크가 올바르지 않아요." });
    const { from, to } = RangeZ.parse(req.query);
    return reply(200, db.listSchedulesBetween(from, to, p.id).map((s) => ({
      id: s.id, title: s.title, kind: s.kind, place_name: s.place_name, start_at: s.start_at, memo: s.memo, status: s.status,
    })));
  });

  r("POST", "/api/p/:token/choose", async (req) => {
    const s = ownSchedule(req);
    if (!s) return reply(404, { error: "일정을 찾을 수 없어요." });
    await flow.choose(s.id, ModeZ.parse(req.body?.mode), "parent");
    return reply(200, { ok: true });
  });
  r("POST", "/api/p/:token/call-now", async (req) => {
    const s = ownSchedule(req);
    if (!s) return reply(404, { error: "일정을 찾을 수 없어요." });
    await flow.callTaxiNow(s.id);
    return reply(200, { ok: true });
  });

  // 부모님이 말·글로 일정 알려주기 → 확인 → 저장
  r("POST", "/api/p/:token/parse", async (req) => {
    const p = parentByToken(req);
    if (!p) return reply(404, { error: "링크가 올바르지 않아요." });
    const { text } = TextZ.parse(req.body);
    const d = await intake.draftFromText(p.id, text, "parent");
    if (!d) return reply(422, { error: "언제, 어디 가시는지 다시 한번 말씀해 주세요." });
    return reply(201, intake.draftView(d));
  });
  const ownDraft = (req: ApiRequest) => {
    const p = parentByToken(req);
    const d = db.getDraft(Number(req.params.id));
    return p && d && d.parent_id === p.id ? { p, d } : null;
  };
  r("POST", "/api/p/:token/drafts/:id/accept", async (req) => {
    const own = ownDraft(req);
    if (!own) return reply(404, { error: "일정을 찾을 수 없어요." });
    try {
      const s = await intake.acceptDraft(own.d.id, req.body?.force === true);
      return reply(200, { ok: true, scheduleId: s.id });
    } catch (err) {
      // 장소를 못 찾았으면 자녀에게 넘김
      if (err instanceof IncompleteError && !err.missing.includes("날짜·시간")) {
        intake.handToGuardian(own.d.id);
        return reply(200, { ok: true, handedToGuardian: true });
      }
      throw err;
    }
  });
  r("POST", "/api/p/:token/drafts/:id/dismiss", async (req) => {
    const own = ownDraft(req);
    if (!own) return reply(404, { error: "일정을 찾을 수 없어요." });
    intake.dismissDraft(own.d.id);
    return reply(204);
  });

  r("POST", "/api/p/:token/arrived", async (req) => {
    const s = ownSchedule(req);
    if (!s) return reply(404, { error: "일정을 찾을 수 없어요." });
    await flow.arrived(s.id);
    return reply(200, { ok: true });
  });

  return routes;
}

export function errorResponse(err: unknown): ApiResponse {
  if (err instanceof ConflictError) return { status: 409, body: { error: err.message, conflicts: err.conflicts } };
  if (err instanceof IncompleteError) return { status: 422, body: { error: err.message, missing: err.missing } };
  if (err instanceof z.ZodError) {
    return { status: 400, body: { error: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") } };
  }
  console.error("[api]", err);
  return { status: 400, body: { error: err instanceof Error ? err.message : String(err) } };
}

/** "/api/p/:token/drafts/:id/accept" 같은 경로 찾기 */
export function matchRoute(routes: Route[], method: string, pathname: string): { route: Route; params: Record<string, string> } | null {
  const parts = pathname.split("/").filter(Boolean);
  for (const route of routes) {
    if (route.method !== method) continue;
    const pat = route.path.split("/").filter(Boolean);
    if (pat.length !== parts.length) continue;
    const params: Record<string, string> = {};
    if (pat.every((p, i) => (p.startsWith(":") ? ((params[p.slice(1)] = decodeURIComponent(parts[i])), true) : p === parts[i]))) {
      return { route, params };
    }
  }
  return null;
}
