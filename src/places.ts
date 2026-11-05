import { config } from "./config.ts";
import { nominatimSearch, vworldGeocode } from "./geocode.ts";

export interface Place {
  name: string;
  address: string;
  lat: number;
  lng: number;
  /** 정확한 위치를 못 찾아 구·시 단위로 잡은 대략 위치 (입력한 주소 그대로 쓰기) */
  approx?: boolean;
  /** AI가 알고 있는 정보로 찾은 위치 (체험판). 사람이 확인해야 함 */
  ai?: boolean;
}

/** 화면에서 '검색'을 눌렀을 때 더해 볼 찾기 (체험판에서 'Claude에게 물어보기'를 끼워 넣음) */
type ExtraProvider = (query: string) => Promise<Place[]>;
let extraProvider: ExtraProvider | null = null;
export function setExtraPlaceProvider(p: ExtraProvider | null) {
  extraProvider = p;
}

// 카카오 API 키가 없을 때 데모용으로 쓰는 장소 목록 (좌표는 대략값)
const SAMPLE: Place[] = [
  { name: "서울대학교병원", address: "서울 종로구 대학로 101", lat: 37.5796, lng: 126.9990 },
  { name: "세브란스병원", address: "서울 서대문구 연세로 50-1", lat: 37.5622, lng: 126.9410 },
  { name: "서울아산병원", address: "서울 송파구 올림픽로43길 88", lat: 37.5267, lng: 127.1080 },
  { name: "삼성서울병원", address: "서울 강남구 일원로 81", lat: 37.4881, lng: 127.0855 },
  { name: "강남세브란스병원", address: "서울 강남구 언주로 211", lat: 37.4925, lng: 127.0463 },
  { name: "서울성모병원", address: "서울 서초구 반포대로 222", lat: 37.5016, lng: 127.0050 },
  { name: "국민건강보험공단 일산병원", address: "경기 고양시 일산동구 일산로 100", lat: 37.6431, lng: 126.7915 },
  { name: "마포구청", address: "서울 마포구 월드컵로 212", lat: 37.5663, lng: 126.9019 },
  { name: "서울역", address: "서울 용산구 한강대로 405", lat: 37.5547, lng: 126.9707 },
  { name: "종로구 탑골공원", address: "서울 종로구 종로 99", lat: 37.5711, lng: 126.9882 },
  { name: "망원시장", address: "서울 마포구 포은로8길 14", lat: 37.5560, lng: 126.9060 },
  { name: "명동성당", address: "서울 중구 명동길 74", lat: 37.5633, lng: 126.9873 },
  { name: "서울노인복지센터", address: "서울 종로구 삼일대로 467", lat: 37.5718, lng: 126.9890 },
  { name: "롯데마트 서울역점", address: "서울 중구 한강대로 405", lat: 37.5560, lng: 126.9701 },
];

// 주소 글자로 대략 위치 잡기: 서울 25개 구 · 인천 · 경기 주요 시 (구청·시청 근처 좌표)
const REGIONS: [string, number, number][] = [
  ["강남구", 37.5172, 127.0473], ["강동구", 37.5301, 127.1238], ["강북구", 37.6396, 127.0257], ["강서구", 37.5509, 126.8495],
  ["관악구", 37.4784, 126.9516], ["광진구", 37.5385, 127.0823], ["구로구", 37.4954, 126.8874], ["금천구", 37.4569, 126.8955],
  ["노원구", 37.6542, 127.0568], ["도봉구", 37.6688, 127.0471], ["동대문구", 37.5744, 127.0400], ["동작구", 37.5124, 126.9393],
  ["마포구", 37.5663, 126.9019], ["서대문구", 37.5791, 126.9368], ["서초구", 37.4837, 127.0324], ["성동구", 37.5633, 127.0371],
  ["성북구", 37.5894, 127.0167], ["송파구", 37.5145, 127.1059], ["양천구", 37.5170, 126.8665], ["영등포구", 37.5264, 126.8962],
  ["용산구", 37.5324, 126.9900], ["은평구", 37.6027, 126.9291], ["종로구", 37.5735, 126.9790], ["중랑구", 37.6063, 127.0925],
  ["중구", 37.5641, 126.9979],
  ["인천", 37.4563, 126.7052], ["고양", 37.6584, 126.8320], ["성남", 37.4200, 127.1267], ["수원", 37.2636, 127.0286],
  ["용인", 37.2411, 127.1776], ["부천", 37.5034, 126.7660], ["안양", 37.3943, 126.9568], ["남양주", 37.6360, 127.2165],
  ["화성", 37.1995, 126.8312], ["의정부", 37.7381, 127.0337], ["하남", 37.5393, 127.2148], ["광명", 37.4786, 126.8646],
  ["과천", 37.4292, 126.9876], ["구리", 37.5943, 127.1296], ["김포", 37.6152, 126.7156], ["파주", 37.7599, 126.7802],
  ["시흥", 37.3800, 126.8029], ["안산", 37.3219, 126.8309], ["군포", 37.3617, 126.9352], ["의왕", 37.3447, 126.9683],
];
const SEOUL_CENTER: [number, number] = [37.5665, 126.9780];
const ADDRESS_LIKE = /(시|구|군|동|읍|면|리|로|길|번지|아파트|빌라|맨션|타워|마을|단지|\d)/;

/** 검색에 안 나오는 주소도 그대로 쓸 수 있게: 주소 속 구·시 이름으로 대략 위치를 잡는다 */
export function approxPlace(q: string): Place | null {
  const query = q.trim();
  if (query.length < 2 || !ADDRESS_LIKE.test(query)) return null;
  // "중구"는 "동대문구"·"강동구"보다 나중에 봐야 하므로 긴 이름부터
  const hit = [...REGIONS].sort((a, b) => b[0].length - a[0].length).find(([n]) => query.includes(n));
  const [lat, lng] = hit ? [hit[1], hit[2]] : SEOUL_CENTER;
  return { name: query, address: query, lat, lng, approx: true };
}

const norm = (s: string) =>
  s.replace(/\s/g, "").replace(/대학교병원|대학병원|대병원/g, "대병원").replace(/세브란스$/, "세브란스병원");

type KakaoDoc = { place_name?: string; address_name: string; road_address_name?: string; road_address?: { address_name: string } | null; x: string; y: string };

async function kakao(path: string, query: string): Promise<KakaoDoc[] | null> {
  const url = new URL(`https://dapi.kakao.com/v2/local/search/${path}`);
  url.searchParams.set("query", query);
  url.searchParams.set("size", "8");
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${config.kakaoRestApiKey}` } }).catch(() => null);
  if (!res || !res.ok) return null;
  return ((await res.json()) as { documents: KakaoDoc[] }).documents;
}

export interface SearchOptions {
  /** 바깥 무료 서비스(오픈스트리트맵·브이월드)까지 찾기. 입력할 때마다가 아니라 '검색'을 눌렀을 때만 */
  online?: boolean;
  /** 사람이 화면에서 직접 찾는 중 (문자 자동 가져오기가 아님) */
  interactive?: boolean;
}

/** 정확한 장소만 (카카오 → 브이월드·오픈스트리트맵 → 샘플) */
export async function searchExactPlaces(q: string, opts: SearchOptions = {}): Promise<Place[]> {
  const query = q.trim();
  if (!query) return [];
  if (config.kakaoRestApiKey) {
    const places = await kakao("keyword.json", query);
    if (places?.length) {
      return places.map((d) => ({
        name: d.place_name ?? d.address_name, address: d.road_address_name || d.address_name, lat: Number(d.y), lng: Number(d.x),
      }));
    }
    // 장소 이름으로 안 나오면 도로명·지번 주소로
    const addrs = await kakao("address.json", query);
    if (addrs?.length) {
      return addrs.map((d) => ({
        name: d.road_address?.address_name || d.address_name, address: d.road_address?.address_name || d.address_name,
        lat: Number(d.y), lng: Number(d.x),
      }));
    }
    if (places || addrs) return [];
  }
  // "서울대병원" → "서울대학교병원"처럼 흔한 줄임말도 찾기
  const key = norm(query);
  const samples = SAMPLE.filter((p) => {
    const n = norm(p.name);
    return n.includes(key) || key.includes(n) || norm(p.address).includes(key);
  });
  if (!opts.online) return samples;
  const found: Place[] = [];
  if (ADDRESS_LIKE.test(query)) {
    const vw = await vworldGeocode(query);
    if (vw) found.push(vw);
  }
  found.push(...(await nominatimSearch(query)));
  if (!found.length && opts.interactive && extraProvider) {
    found.push(...(await extraProvider(query).catch(() => [])));
  }
  const seen = new Set(found.map((p) => norm(p.name)));
  return [...found, ...samples.filter((p) => !seen.has(norm(p.name)))];
}

/** 화면 검색용: 정확한 결과 + 맨 끝에 '입력한 주소 그대로 쓰기' */
export async function searchPlaces(q: string, opts: SearchOptions = {}): Promise<Place[]> {
  const exact = await searchExactPlaces(q, opts);
  const approx = approxPlace(q);
  const dup = approx && exact.some((p) => norm(p.address) === norm(approx.address) || norm(p.name) === norm(approx.name));
  return approx && !dup ? [...exact, approx] : exact;
}
