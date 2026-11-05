import { config } from "./config.ts";

export interface Place {
  name: string;
  address: string;
  lat: number;
  lng: number;
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
];

const norm = (s: string) =>
  s.replace(/\s/g, "").replace(/대학교병원|대학병원|대병원/g, "대병원").replace(/세브란스$/, "세브란스병원");

export async function searchPlaces(q: string): Promise<Place[]> {
  const query = q.trim();
  if (!query) return [];
  if (config.kakaoRestApiKey) {
    const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
    url.searchParams.set("query", query);
    url.searchParams.set("size", "8");
    const res = await fetch(url, { headers: { Authorization: `KakaoAK ${config.kakaoRestApiKey}` } });
    if (res.ok) {
      const body = (await res.json()) as {
        documents: { place_name: string; road_address_name: string; address_name: string; x: string; y: string }[];
      };
      return body.documents.map((d) => ({
        name: d.place_name, address: d.road_address_name || d.address_name, lat: Number(d.y), lng: Number(d.x),
      }));
    }
  }
  // "서울대병원" → "서울대학교병원"처럼 흔한 줄임말도 찾기
  const key = norm(query);
  return SAMPLE.filter((p) => {
    const n = norm(p.name);
    return n.includes(key) || key.includes(n) || norm(p.address).includes(key);
  });
}
