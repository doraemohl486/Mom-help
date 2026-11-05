import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.ts";
import { koreanAddress, nominatimSearch, setGeocodeFetch, vworldGeocode } from "../src/geocode.ts";
import { searchPlaces } from "../src/places.ts";

// 바깥 서비스 대신 미리 저장한 모양의 응답으로 시험 (실제 서버 응답으로는 시험하지 못함)
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("오픈스트리트맵 주소를 한국식 순서로", () => {
  assert.equal(koreanAddress("212, 월드컵로, 성산동, 마포구, 서울, 03937, 대한민국"), "서울 마포구 성산동 월드컵로 212");
});

test("오픈스트리트맵: 요청 모양, 앱 이름, 결과 저장, 1초 간격", async () => {
  config.nominatimUrl = "https://nominatim.example";
  config.geocoderContact = "me@example.com";
  const calls: { url: string; ua: string | null; at: number }[] = [];
  setGeocodeFetch(async (url, init) => {
    calls.push({ url, ua: new Headers(init?.headers).get("User-Agent"), at: Date.now() });
    return json([{ lat: "37.6027", lon: "126.9291", name: "은평구청", display_name: "195, 은평로, 녹번동, 은평구, 서울, 03383, 대한민국" }]);
  });
  const r = await nominatimSearch("은평구청");
  assert.deepEqual(r, [{ name: "은평구청", address: "서울 은평구 녹번동 은평로 195", lat: 37.6027, lng: 126.9291 }]);
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/search");
  assert.equal(u.searchParams.get("format"), "jsonv2");
  assert.equal(u.searchParams.get("countrycodes"), "kr");
  assert.equal(u.searchParams.get("accept-language"), "ko");
  assert.match(calls[0].ua!, /eombba-eodi-ga.*me@example\.com/);
  await nominatimSearch("은평구청"); // 저장된 결과
  assert.equal(calls.length, 1);
  await Promise.all([nominatimSearch("가"), nominatimSearch("나")]);
  assert.equal(calls.length, 3);
  assert.ok(calls[2].at - calls[1].at >= 1000, "요청 사이 1초 이상");
  setGeocodeFetch(null);
});

test("브이월드: 도로명으로 없으면 지번으로 다시", async () => {
  config.vworldApiKey = "test-key";
  const types: string[] = [];
  setGeocodeFetch(async (url) => {
    const u = new URL(url);
    types.push(u.searchParams.get("type")!);
    assert.equal(u.searchParams.get("request"), "GetCoord");
    assert.equal(u.searchParams.get("crs"), "EPSG:4326");
    if (u.searchParams.get("type") === "road") return json({ response: { status: "NOT_FOUND" } });
    return json({ response: { status: "OK", result: { point: { x: "126.9019", y: "37.5663" } } } });
  });
  const p = await vworldGeocode("서울 마포구 성산동 370");
  assert.deepEqual(types, ["road", "parcel"]);
  assert.equal(p?.lat, 37.5663);
  assert.equal(p?.lng, 126.9019);
  config.vworldApiKey = "";
  setGeocodeFetch(null);
});

test("화면 검색: 입력 중에는 바깥 서비스를 부르지 않고, '검색'을 누르면 부른다", async () => {
  config.nominatimUrl = "https://nominatim.example";
  let n = 0;
  setGeocodeFetch(async () => {
    n++;
    return json([{ lat: "37.6", lon: "126.9", name: "진관동주민센터", display_name: "진관동주민센터, 진관동, 은평구, 서울, 대한민국" }]);
  });
  const typing = await searchPlaces("은평구 진관동");
  assert.equal(n, 0);
  assert.ok(typing.every((p) => p.approx));
  const submitted = await searchPlaces("은평구 진관동", { online: true });
  assert.equal(n, 1);
  assert.equal(submitted[0].name, "진관동주민센터");
  assert.equal(submitted[submitted.length - 1].approx, true); // '그대로 쓰기'는 여전히 맨 끝
  // 서비스가 안 되면 조용히 넘어감
  setGeocodeFetch(async () => json({}, 503));
  const down = await searchPlaces("은평구 녹번동", { online: true });
  assert.ok(down.length >= 1 && down[down.length - 1].approx);
  config.nominatimUrl = "off";
  setGeocodeFetch(null);
});

test("체험판 AI 장소 답 검사: 한국 밖 좌표·이름 없는 것·형식 틀린 답은 버림", async () => {
  const { parseAiPlaces } = await import("../src/demo/ai-places.ts");
  const good = parseAiPlaces('네, 찾았어요.\n[{"name":"은평구청","address":"서울 은평구 은평로 195","lat":37.6027,"lng":126.9291},{"name":"","lat":37,"lng":127},{"name":"도쿄역","lat":35.68,"lng":139.76}]');
  assert.deepEqual(good, [{ name: "은평구청", address: "서울 은평구 은평로 195", lat: 37.6027, lng: 126.9291, ai: true }]);
  assert.deepEqual(parseAiPlaces("모르겠어요"), []);
  assert.deepEqual(parseAiPlaces("[{oops"), []);
  assert.equal(parseAiPlaces(JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ name: `곳${i}`, lat: 37.5, lng: 127 })))).length, 5);
});
