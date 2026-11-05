// 무료 주소·장소 찾기
// - 오픈스트리트맵 Nominatim: 키 없음. 공개 서버 규칙(1초에 1번, 앱 이름·연락처 표시, 결과 저장, 입력할 때마다 찾기 금지)을 지킨다
// - 브이월드(국토교통부) 지오코더: 무료 키. 도로명·지번 주소 → 좌표
import { config } from "./config.ts";
import type { Place } from "./places.ts";

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
let http: FetchLike = (url, init) => fetch(url, init);
/** 테스트용: 바깥 요청 바꿔 끼우기 */
export function setGeocodeFetch(f: FetchLike | null) {
  http = f ?? ((url, init) => fetch(url, init));
  cache.clear();
  lastCall = 0;
}

const TIMEOUT_MS = 6000;
const cache = new Map<string, { at: number; places: Place[] }>();
const CACHE_MS = 24 * 3600_000;
const CACHE_MAX = 500;

function cached(key: string): Place[] | null {
  const hit = cache.get(key);
  if (!hit || Date.now() - hit.at > CACHE_MS) return null;
  return hit.places;
}
function remember(key: string, places: Place[]) {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { at: Date.now(), places });
}

// ---------------------------------------------------------------- 오픈스트리트맵
let lastCall = 0;
let queue: Promise<unknown> = Promise.resolve();
/** 공개 서버 규칙: 요청 사이 1초 넘게 띄우기 (서버 전체에서 한 줄로) */
function spaced<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const wait = lastCall + 1100 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  queue = run.catch(() => undefined);
  return run;
}

export function nominatimEnabled() {
  return Boolean(config.nominatimUrl) && config.nominatimUrl !== "off";
}

function userAgent() {
  return `eombba-eodi-ga/0.1${config.geocoderContact ? ` (${config.geocoderContact})` : ""}`;
}

interface NominatimResult {
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
}

/** "212, 월드컵로, 성산동, 마포구, 서울, 03937, 대한민국" → "서울 마포구 성산동 월드컵로 212" */
export function koreanAddress(display: string): string {
  return display.split(",").map((p) => p.trim())
    .filter((p) => p && p !== "대한민국" && p !== "South Korea" && !/^\d{5}$/.test(p))
    .reverse().join(" ");
}

export async function nominatimSearch(query: string): Promise<Place[]> {
  if (!nominatimEnabled()) return [];
  const key = `osm:${query}`;
  const hit = cached(key);
  if (hit) return hit;
  const url = new URL("/search", config.nominatimUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("countrycodes", "kr");
  url.searchParams.set("accept-language", "ko");
  url.searchParams.set("limit", "6");
  const res = await spaced(() =>
    http(url.toString(), { headers: { "User-Agent": userAgent(), Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) }),
  ).catch(() => null);
  if (!res || !res.ok) return [];
  const body = (await res.json().catch(() => [])) as NominatimResult[];
  const places = (Array.isArray(body) ? body : []).map((r) => {
    const address = koreanAddress(r.display_name);
    return { name: r.name || address, address, lat: Number(r.lat), lng: Number(r.lon) };
  }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
  remember(key, places);
  return places;
}

// ---------------------------------------------------------------- 브이월드
interface VworldCoord {
  response?: { status?: string; result?: { point?: { x: string; y: string } } };
}

/** 도로명 주소로 먼저, 없으면 지번 주소로 좌표 찾기 */
export async function vworldGeocode(address: string): Promise<Place | null> {
  if (!config.vworldApiKey) return null;
  const key = `vw:${address}`;
  const hit = cached(key);
  if (hit) return hit[0] ?? null;
  for (const type of ["road", "parcel"]) {
    const url = new URL("https://api.vworld.kr/req/address");
    url.search = new URLSearchParams({
      service: "address", request: "GetCoord", version: "2.0", crs: "EPSG:4326",
      address, type, format: "json", key: config.vworldApiKey,
    }).toString();
    const res = await http(url.toString(), { signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => null);
    if (!res || !res.ok) continue;
    const body = (await res.json().catch(() => ({}))) as VworldCoord;
    const pt = body.response?.result?.point;
    if (pt && Number.isFinite(Number(pt.x)) && Number.isFinite(Number(pt.y))) {
      const place = { name: address, address, lat: Number(pt.y), lng: Number(pt.x) };
      remember(key, [place]);
      return place;
    }
  }
  remember(key, []);
  return null;
}
