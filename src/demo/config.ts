// 체험판(브라우저)용 설정 — src/config.ts 대신 번들에 들어간다.
export const config = {
  port: 0,
  publicBaseUrl: "",
  dbPath: ":memory:",
  anthropicApiKey: "",
  kakaoRestApiKey: "",
  vworldApiKey: "",
  nominatimUrl: "off", // 체험판 페이지는 바깥 주소로 요청할 수 없음
  geocoderContact: "",
  odsayApiKey: "",
  callProvider: "simulator" as "simulator" | "twilio",
  twilio: { accountSid: "", authToken: "", fromNumber: "" },
  taxiCenterNumber: "+8218550120",
  smsProvider: "log",
};

export { timing } from "../timing.ts";

// 체험판은 언제든 해볼 수 있게 운영 시간 제한을 두지 않는다 (실제 앱은 8~22시)
export const taxiCenterHours = { open: 0, close: 24 };
