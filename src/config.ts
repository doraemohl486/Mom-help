import fs from "node:fs";

// .env 파일을 간단히 읽어 process.env에 채운다 (이미 설정된 값은 덮어쓰지 않음).
function loadDotEnv(path = ".env"): void {
  if (!fs.existsSync(path)) return;
  for (const raw of fs.readFileSync(path, "utf8").split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (value && process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

const env = (k: string, d = ""): string => process.env[k]?.trim() || d;

export const config = {
  port: Number(env("PORT", "3000")),
  publicBaseUrl: env("PUBLIC_BASE_URL"),
  dbPath: env("DB_PATH", "data/app.db"),
  anthropicApiKey: env("ANTHROPIC_API_KEY"),
  kakaoRestApiKey: env("KAKAO_REST_API_KEY"),
  // 무료 주소·장소 찾기
  vworldApiKey: env("VWORLD_API_KEY"), // 브이월드 (국토교통부) 주소 → 좌표, 무료 키
  nominatimUrl: env("NOMINATIM_URL", "https://nominatim.openstreetmap.org"), // 오픈스트리트맵, 키 없음. "off"면 안 씀
  geocoderContact: env("GEOCODER_CONTACT"), // 오픈스트리트맵 이용 규칙: 앱을 알 수 있는 연락처 (이메일 또는 웹사이트)
  odsayApiKey: env("ODSAY_API_KEY"),
  callProvider: env("CALL_PROVIDER", "simulator") as "simulator" | "twilio",
  twilio: {
    accountSid: env("TWILIO_ACCOUNT_SID"),
    authToken: env("TWILIO_AUTH_TOKEN"),
    fromNumber: env("TWILIO_FROM_NUMBER"),
  },
  taxiCenterNumber: env("TAXI_CENTER_NUMBER", "+8218550120"),
  smsProvider: env("SMS_PROVIDER", "log"),
};

export { timing } from "./timing.ts";

// 동행 온다콜택시 운영 시간 (변동 가능 — 서울시 공지 확인)
export const taxiCenterHours = { open: 8, close: 22 };
