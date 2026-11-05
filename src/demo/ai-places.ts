import type { Place } from "../places.ts";

/** 답에서 JSON 배열만 꺼내 검사 (한국 안의 좌표, 이름 있는 것, 최대 5개) */
export function parseAiPlaces(text: string): Place[] {
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(m[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr.flatMap((x) => {
    const o = x as { name?: unknown; address?: unknown; lat?: unknown; lng?: unknown };
    const lat = Number(o.lat);
    const lng = Number(o.lng);
    const name = typeof o.name === "string" ? o.name.trim().slice(0, 60) : "";
    const address = typeof o.address === "string" ? o.address.trim().slice(0, 100) : "";
    if (!name || !(lat >= 33 && lat <= 39) || !(lng >= 124 && lng <= 132)) return [];
    return [{ name, address: address || name, lat, lng, ai: true }];
  }).slice(0, 5);
}
