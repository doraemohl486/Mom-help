import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { buildRoutes, errorResponse, type ApiDeps, type ApiResponse } from "./api.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");

export interface AppDeps extends ApiDeps {
  extraRouters?: [string, express.Router][];
}

function send(res: Response, r: ApiResponse) {
  if (r.status === 204) res.sendStatus(204);
  else res.status(r.status).json(r.body);
}

export function createApp({ extraRouters = [], ...deps }: AppDeps) {
  const app = express();
  app.use(express.json());
  app.use(express.text({ type: "text/plain" }));
  for (const [mount, router] of extraRouters) app.use(mount, router);

  for (const route of buildRoutes(deps)) {
    const method = route.method.toLowerCase() as "get" | "post" | "put" | "delete";
    app[method](route.path, (req: Request, res: Response, next: NextFunction) => {
      route
        .handle({ params: req.params as Record<string, string>, body: req.body, query: req.query })
        .then((r) => send(res, r), next);
    });
  }

  app.use(express.static(publicDir));
  // 지도 그리기 도구 (Leaflet, 무료) — CDN 대신 직접 제공
  app.use("/vendor/leaflet", express.static(path.join(here, "..", "node_modules", "leaflet", "dist")));
  app.get("/p/:token", (_req, res) => res.sendFile(path.join(publicDir, "parent.html")));
  app.get("/", (_req, res) => res.sendFile(path.join(publicDir, "guardian.html")));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => send(res, errorResponse(err)));
  return app;
}
