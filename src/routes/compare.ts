import { config } from "../config.ts";
import type { Mode } from "../db.ts";

export interface LatLng {
  lat: number;
  lng: number;
}

export interface RouteOption {
  mode: Mode;
  label: string;
  durationMin: number;
  costWon: number | null;
  walkMeters: number;
  transfers: number;
  source: "kakao" | "odsay" | "estimate";
}

export interface Comparison {
  options: RouteOption[];
  recommended: Mode;
  reason: string;
}

const R = 6371; // km
export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 서울 중형택시 기본요금 4,800원(1.6km) + 131m당 100원 (주간 기준, 추정용)
export function estimateTaxiFare(roadKm: number): number {
  const base = 4800;
  const extraM = Math.max(0, roadKm * 1000 - 1600);
  return Math.round((base + Math.ceil(extraM / 131) * 100) / 100) * 100;
}

/** API 키가 없을 때 쓰는 직선거리 기반 추정치 */
export function estimateOptions(from: LatLng, to: LatLng): RouteOption[] {
  const roadKm = haversineKm(from, to) * 1.3;
  const carMin = Math.max(5, Math.round((roadKm / 22) * 60 + 3));
  return [
    {
      mode: "taxi", label: "택시", durationMin: carMin, costWon: estimateTaxiFare(roadKm),
      walkMeters: 0, transfers: 0, source: "estimate",
    },
    {
      mode: "transit", label: "버스·지하철", durationMin: Math.round((roadKm / 18) * 60 + 12),
      costWon: 1550, walkMeters: Math.round(Math.min(1200, 400 + roadKm * 60) / 50) * 50,
      transfers: roadKm > 6 ? 1 : 0, source: "estimate",
    },
    {
      mode: "family", label: "자녀가 태워드리기", durationMin: carMin, costWon: null,
      walkMeters: 0, transfers: 0, source: "estimate",
    },
  ];
}

async function kakaoCar(from: LatLng, to: LatLng): Promise<{ durationMin: number; taxiFare: number } | null> {
  if (!config.kakaoRestApiKey) return null;
  const url = new URL("https://apis-navi.kakaomobility.com/v1/directions");
  url.searchParams.set("origin", `${from.lng},${from.lat}`);
  url.searchParams.set("destination", `${to.lng},${to.lat}`);
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${config.kakaoRestApiKey}` } });
  if (!res.ok) return null;
  const body = (await res.json()) as { routes?: { result_code: number; summary?: { duration: number; fare?: { taxi: number } } }[] };
  const s = body.routes?.[0];
  if (!s || s.result_code !== 0 || !s.summary) return null;
  return { durationMin: Math.round(s.summary.duration / 60), taxiFare: s.summary.fare?.taxi ?? 0 };
}

async function odsayTransit(from: LatLng, to: LatLng): Promise<Omit<RouteOption, "mode" | "label" | "source"> | null> {
  if (!config.odsayApiKey) return null;
  const url = new URL("https://api.odsay.com/v1/api/searchPubTransPathT");
  url.searchParams.set("SX", String(from.lng));
  url.searchParams.set("SY", String(from.lat));
  url.searchParams.set("EX", String(to.lng));
  url.searchParams.set("EY", String(to.lat));
  url.searchParams.set("apiKey", config.odsayApiKey);
  const res = await fetch(url);
  if (!res.ok) return null;
  const body = (await res.json()) as {
    result?: { path?: { info: { totalTime: number; payment: number; totalWalk: number; busTransitCount: number; subwayTransitCount: number } }[] };
  };
  // 걷는 거리가 가장 짧은 경로를 고른다 (어르신 기준)
  const paths = body.result?.path ?? [];
  if (!paths.length) return null;
  const best = [...paths].sort((a, b) => a.info.totalWalk - b.info.totalWalk)[0].info;
  return {
    durationMin: best.totalTime,
    costWon: best.payment,
    walkMeters: best.totalWalk,
    transfers: Math.max(0, best.busTransitCount + best.subwayTransitCount - 1),
  };
}

export function recommend(options: RouteOption[], preferred: Mode | null): { recommended: Mode; reason: string } {
  const taxi = options.find((o) => o.mode === "taxi")!;
  const transit = options.find((o) => o.mode === "transit");
  if (!transit) return { recommended: "taxi", reason: "대중교통 경로를 찾지 못했어요." };
  if (transit.walkMeters >= 700)
    return { recommended: "taxi", reason: `버스·지하철은 ${transit.walkMeters}m를 걸으셔야 해서 택시를 추천해요.` };
  if (transit.transfers >= 2)
    return { recommended: "taxi", reason: `갈아타기를 ${transit.transfers}번 하셔야 해서 택시를 추천해요.` };
  if (transit.durationMin >= taxi.durationMin * 2 && transit.durationMin - taxi.durationMin >= 20)
    return { recommended: "taxi", reason: `택시가 ${transit.durationMin - taxi.durationMin}분 더 빨라요.` };
  if (preferred && preferred !== "family")
    return { recommended: preferred, reason: "평소 좋아하시는 방법이에요." };
  return { recommended: "transit", reason: "걷는 거리가 짧고 시간 차이가 크지 않아요." };
}

export async function compareRoutes(from: LatLng, to: LatLng, preferred: Mode | null = null): Promise<Comparison> {
  const options = estimateOptions(from, to);
  const [car, transit] = await Promise.all([
    kakaoCar(from, to).catch(() => null),
    odsayTransit(from, to).catch(() => null),
  ]);
  if (car) {
    for (const o of options) {
      if (o.mode === "taxi") Object.assign(o, { durationMin: car.durationMin, costWon: car.taxiFare || o.costWon, source: "kakao" });
      if (o.mode === "family") Object.assign(o, { durationMin: car.durationMin, source: "kakao" });
    }
  }
  if (transit) Object.assign(options.find((o) => o.mode === "transit")!, transit, { source: "odsay" });
  return { options, ...recommend(options, preferred) };
}
