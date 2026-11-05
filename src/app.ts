import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import type { Comparison } from "./routes/compare.ts";
import type { Db, Parent, Schedule } from "./db.ts";
import type { TripFlow } from "./flow.ts";
import type { CallService } from "./call/service.ts";
import type { SimulatorProvider } from "./call/simulator.ts";
import { searchPlaces } from "./places.ts";
import { ConflictError, IncompleteError, type Intake } from "./intake.ts";
import { fromSeoulLocal } from "./time.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");

const ModeZ = z.enum(["taxi", "transit", "family"]);
const ParentZ = z.object({
  name: z.string().min(1).max(20),
  real_name: z.string().max(20).default(""),
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
  kind: z.string().max(10).default("기타"),
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

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);

export interface AppDeps {
  db: Db;
  flow: TripFlow;
  calls: CallService;
  simulator: SimulatorProvider | null;
  intake: Intake;
  extraRouters?: [string, express.Router][];
}

export function createApp({ db, flow, calls, simulator, intake, extraRouters = [] }: AppDeps) {
  const app = express();
  app.use(express.json());
  app.use(express.text({ type: "text/plain" }));
  for (const [mount, router] of extraRouters) app.use(mount, router);

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
  app.get("/api/state", (_req, res) => {
    res.json({
      parents: db.listParents().map(parentPublic),
      schedules: db.listSchedules(since()).map(scheduleView),
      notifications: db.listNotifications("guardian", null),
      drafts: db.listReviewDrafts().map((d) => intake.draftView(d)),
      callProvider: calls.provider.name,
      simulatorScenario: simulator?.scenario ?? null,
    });
  });

  app.post("/api/parents", (req, res) => {
    res.status(201).json(db.createParent(ParentZ.parse(req.body)));
  });
  app.put("/api/parents/:id", (req, res) => {
    const p = db.updateParent(Number(req.params.id), ParentZ.partial().parse(req.body));
    if (!p) return res.status(404).json({ error: "부모님 정보를 찾을 수 없어요." });
    res.json(p);
  });
  app.delete("/api/parents/:id", (req, res) => {
    db.deleteParent(Number(req.params.id));
    res.sendStatus(204);
  });

  app.post("/api/schedules", h(async (req, res) => {
    const { start_local, force, draft_id, ...rest } = ScheduleZ.parse(req.body);
    if (!db.getParent(rest.parent_id)) return res.status(400).json({ error: "부모님을 먼저 등록해 주세요." });
    const draft = draft_id ? db.getDraft(draft_id) : undefined;
    const s = await intake.createSchedule(
      { ...rest, start_at: fromSeoulLocal(start_local).toISOString(), source: draft?.source ?? "guardian" }, force);
    if (draft) db.updateDraft(draft.id, { status: "accepted", schedule_id: s.id });
    res.status(201).json(scheduleView(s));
  }));
  app.post("/api/schedules/:id/call-now", h(async (req, res) => {
    await flow.callTaxiNow(Number(req.params.id));
    res.json(scheduleView(db.getSchedule(Number(req.params.id))!));
  }));

  // 문자 붙여넣기 → 임시 일정
  app.post("/api/parse", h(async (req, res) => {
    const { text } = TextZ.parse(req.body);
    const parentId = Number(req.body?.parent_id);
    if (!db.getParent(parentId)) return res.status(400).json({ error: "누구 일정인지 골라 주세요." });
    const d = await intake.draftFromText(parentId, text, "guardian");
    if (!d) return res.status(422).json({ error: "일정 내용을 찾지 못했어요. 날짜·시간·장소가 들어 있는지 확인해 주세요." });
    res.status(201).json(intake.draftView(d));
  }));
  app.post("/api/drafts/:id/accept", h(async (req, res) => {
    const s = await intake.acceptDraft(Number(req.params.id), req.body?.force === true);
    res.json(scheduleView(s));
  }));
  app.put("/api/drafts/:id", (req, res) => {
    const { start_local, ...rest } = DraftEditZ.parse(req.body);
    const id = Number(req.params.id);
    if (!db.getDraft(id)) return res.status(404).json({ error: "없는 일정이에요." });
    db.updateDraft(id, { ...rest, ...(start_local ? { start_at: fromSeoulLocal(start_local).toISOString() } : {}) });
    res.json(intake.draftView(db.getDraft(id)!));
  });
  app.post("/api/drafts/:id/dismiss", (req, res) => {
    intake.dismissDraft(Number(req.params.id));
    res.sendStatus(204);
  });

  // 부모님 폰의 문자 자동 전달 (안드로이드 문자 전달 앱, 아이폰 단축어 자동화)
  // 본문: JSON {"text": "..."} 또는 text/plain
  app.post("/api/inbox/:token", h(async (req, res) => {
    const p = db.getParentByToken(String(req.params.token));
    if (!p) return res.status(404).json({ error: "링크가 올바르지 않아요." });
    const text = typeof req.body === "string" ? req.body : String(req.body?.text ?? req.body?.message ?? "");
    if (!text.trim()) return res.status(400).json({ error: "문자 내용이 비어 있어요." });
    res.json(await intake.fromSms(p.id, text));
  }));
  app.delete("/api/schedules/:id", h(async (req, res) => {
    await flow.cancel(Number(req.params.id));
    res.sendStatus(204);
  }));
  app.post("/api/schedules/:id/ask-now", h(async (req, res) => {
    await flow.askNow(Number(req.params.id));
    res.json(scheduleView(db.getSchedule(Number(req.params.id))!));
  }));
  app.post("/api/schedules/:id/choose", h(async (req, res) => {
    const mode = ModeZ.parse(req.body?.mode);
    await flow.choose(Number(req.params.id), mode, "guardian");
    res.json(scheduleView(db.getSchedule(Number(req.params.id))!));
  }));

  app.get("/api/places", h(async (req, res) => {
    res.json(await searchPlaces(String(req.query.q ?? "")));
  }));

  app.post("/api/simulator/scenario", (req, res) => {
    if (!simulator) return res.status(400).json({ error: "시뮬레이터 모드가 아니에요." });
    simulator.scenario = z.enum(["normal", "ivr", "no_car"]).parse(req.body?.scenario);
    res.json({ scenario: simulator.scenario });
  });

  // ------------------------------------------------------------------ 부모님 (간편 화면)
  const parentByToken = (req: Request) => db.getParentByToken(String(req.params.token));

  app.get("/api/p/:token", (req, res) => {
    const p = parentByToken(req);
    if (!p) return res.status(404).json({ error: "링크가 올바르지 않아요." });
    const upcoming = db.listSchedulesForParent(p.id, since()).filter((s) => s.status !== "arrived");
    res.json({
      parent: { name: p.name },
      current: upcoming[0] ? scheduleView(upcoming[0]) : null,
      upcoming: upcoming.slice(1, 4).map((s) => ({ id: s.id, title: s.title, place_name: s.place_name, start_at: s.start_at })),
      notifications: db.listNotifications("parent", p.id, 5),
    });
  });

  const ownSchedule = (req: Request) => {
    const p = parentByToken(req);
    const s = db.getSchedule(Number(req.body?.scheduleId));
    if (!p || !s || s.parent_id !== p.id) return null;
    return s;
  };

  app.post("/api/p/:token/choose", h(async (req, res) => {
    const s = ownSchedule(req);
    if (!s) return res.status(404).json({ error: "일정을 찾을 수 없어요." });
    await flow.choose(s.id, ModeZ.parse(req.body?.mode), "parent");
    res.json({ ok: true });
  }));
  app.post("/api/p/:token/call-now", h(async (req, res) => {
    const s = ownSchedule(req);
    if (!s) return res.status(404).json({ error: "일정을 찾을 수 없어요." });
    await flow.callTaxiNow(s.id);
    res.json({ ok: true });
  }));

  // 부모님이 말·글로 일정 알려주기 → 확인 → 저장
  app.post("/api/p/:token/parse", h(async (req, res) => {
    const p = parentByToken(req);
    if (!p) return res.status(404).json({ error: "링크가 올바르지 않아요." });
    const { text } = TextZ.parse(req.body);
    const d = await intake.draftFromText(p.id, text, "parent");
    if (!d) return res.status(422).json({ error: "언제, 어디 가시는지 다시 한번 말씀해 주세요." });
    res.status(201).json(intake.draftView(d));
  }));
  const ownDraft = (req: Request) => {
    const p = parentByToken(req);
    const d = db.getDraft(Number(req.params.id));
    return p && d && d.parent_id === p.id ? { p, d } : null;
  };
  app.post("/api/p/:token/drafts/:id/accept", h(async (req, res) => {
    const own = ownDraft(req);
    if (!own) return res.status(404).json({ error: "일정을 찾을 수 없어요." });
    try {
      const s = await intake.acceptDraft(own.d.id, req.body?.force === true);
      res.json({ ok: true, scheduleId: s.id });
    } catch (err) {
      // 장소를 못 찾았으면 자녀에게 넘김
      if (err instanceof IncompleteError && !err.missing.includes("날짜·시간")) {
        intake.handToGuardian(own.d.id);
        return res.json({ ok: true, handedToGuardian: true });
      }
      throw err;
    }
  }));
  app.post("/api/p/:token/drafts/:id/dismiss", (req, res) => {
    const own = ownDraft(req);
    if (!own) return res.status(404).json({ error: "일정을 찾을 수 없어요." });
    intake.dismissDraft(own.d.id);
    res.sendStatus(204);
  });

  app.post("/api/p/:token/arrived", h(async (req, res) => {
    const s = ownSchedule(req);
    if (!s) return res.status(404).json({ error: "일정을 찾을 수 없어요." });
    await flow.arrived(s.id);
    res.json({ ok: true });
  }));

  // ------------------------------------------------------------------ 화면
  app.use(express.static(publicDir));
  app.get("/p/:token", (_req, res) => res.sendFile(path.join(publicDir, "parent.html")));
  app.get("/", (_req, res) => res.sendFile(path.join(publicDir, "guardian.html")));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ConflictError) {
      return res.status(409).json({ error: err.message, conflicts: err.conflicts });
    }
    if (err instanceof IncompleteError) {
      return res.status(422).json({ error: err.message, missing: err.missing });
    }
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[api]", err);
    res.status(400).json({ error: msg });
  });
  return app;
}
