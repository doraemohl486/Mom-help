// 체험판(서버 없이 브라우저에서 동작하는 한 장짜리 HTML) 만들기
//   node scripts/build-demo.mjs   →  dist/demo.html
import fs from "node:fs";
import path from "node:path";
import * as esbuild from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const r = (...p) => path.join(root, ...p);

const aliasPlugin = {
  name: "demo-alias",
  setup(build) {
    // Claude SDK 대신 빈 모듈 (체험판은 규칙 기반)
    build.onResolve({ filter: /^@anthropic-ai\/sdk/ }, () => ({ path: r("src/demo/stubs.ts") }));
    // 서버 설정(.env, node:fs) 대신 브라우저용 설정
    build.onResolve({ filter: /\/config\.ts$/ }, () => ({ path: r("src/demo/config.ts") }));
  },
};

const result = await esbuild.build({
  entryPoints: [r("src/demo/main.ts")],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  plugins: [aliasPlugin],
  logLevel: "warning",
});
const bundle = result.outputFiles[0].text;

const read = (p) => fs.readFileSync(r(p), "utf8");
const guardianHtml = read("public/guardian.html");
const guardianBody = guardianHtml.slice(guardianHtml.indexOf('<div class="g-app"'), guardianHtml.indexOf('<script src="/icons.js">'));
// 체험판 틀이 이름을 보여 주므로 자녀 화면의 큰 제목 줄은 그대로 둔다

const inlineJs = (js) => js.replace(/<\/script/gi, "<\\/script");
let html = read("scripts/demo-shell.html")
  .replace("/*__STYLE__*/", () => read("public/style.css"))
  .replace("<!--__GUARDIAN__-->", () => guardianBody)
  .replace("/*__BUNDLE__*/", () => inlineJs(bundle))
  .replace("/*__ICONS_JS__*/", () => inlineJs(read("public/icons.js")))
  .replace("/*__GUARDIAN_JS__*/", () => inlineJs(read("public/guardian.js")))
  .replace("/*__PARENT_JS__*/", () => inlineJs(read("public/parent.js")))
  .replace("/*__SHELL_JS__*/", () => inlineJs(read("scripts/demo-shell.js")));

fs.mkdirSync(r("dist"), { recursive: true });
fs.writeFileSync(r("dist/demo.html"), html);
console.log(`dist/demo.html (${(html.length / 1024).toFixed(0)} KB)`);
