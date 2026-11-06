import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { buildRoutes, errorResponse, type ApiDeps, type ApiResponse } from "./api.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "..", "public");

export interface AppDeps extends ApiDeps {
  extraRouters?: [string, express.Router][];
}

/**
 * 화면 HTML: 우리 JS/CSS 주소 뒤에 파일 수정 시각(?v=)을 붙여 보낸다.
 * 고친 뒤에도 폰 브라우저가 예전 파일을 계속 쓰는 일을 막는다.
 */
function sendPage(res: Response, file: string) {
  const html = fs.readFileSync(path.join(publicDir, file), "utf8").replace(
    /(src|href)="\/([\w-]+\.(?:js|css))"/g,
    (all, attr: string, name: string) => {
      try {
        return `${attr}="/${name}?v=${Math.floor(fs.statSync(path.join(publicDir, name)).mtimeMs)}"`;
      } catch {
        return all;
      }
    },
  );
  res.set("Cache-Control", "no-cache").type("html").send(html);
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

  app.get(["/", "/guardian.html"], (_req, res) => sendPage(res, "guardian.html"));
  app.get(["/p/:token", "/parent.html"], (_req, res) => sendPage(res, "parent.html"));
  app.use(express.static(publicDir, { index: false, setHeaders: (res) => res.setHeader("Cache-Control", "no-cache") }));
  // 지도 그리기 도구 (Leaflet, 무료) — CDN 대신 직접 제공
  app.use("/vendor/leaflet", express.static(path.join(here, "..", "node_modules", "leaflet", "dist")));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => send(res, errorResponse(err)));
  return app;
}
