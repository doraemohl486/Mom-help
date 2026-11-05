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
});

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);

export interface AppDeps {
  db: Db;
  flow: TripFlow;
  calls: CallService;
  simulator: SimulatorProvider | null;
  extraRouters?: [string, express.Router][];
}

export function createApp({ db, flow, calls, simulator, extraRouters = [] }: AppDeps) {
  const app = express();
  app.use(express.json());
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
    const { start_local, ...rest } = ScheduleZ.parse(req.body);
    if (!db.getParent(rest.parent_id)) return res.status(400).json({ error: "부모님을 먼저 등록해 주세요." });
    const s = db.createSchedule({ ...rest, start_at: fromSeoulLocal(start_local).toISOString() });
    await flow.plan(s.id);
    await flow.tickOne(s.id); // 이미 알림 시각이 지났으면 바로 보냄
    res.status(201).json(scheduleView(db.getSchedule(s.id)!));
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
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") });
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[api]", err);
    res.status(400).json({ error: msg });
  });
  return app;
}
