const TZ = "Asia/Seoul";

/** 예: "오전 9:05" */
export function formatTime(d: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { hour: "numeric", minute: "2-digit", timeZone: TZ }).format(d);
}

/** 예: "11월 12일 (화)" */
export function formatDate(d: Date): string {
  return new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "short", timeZone: TZ }).format(d);
}

/** 한국 시간 기준 날짜 문자열 YYYY-MM-DD */
export function seoulDateKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
}

/** "2026-11-12T10:00" (한국 시간) → Date */
export function fromSeoulLocal(local: string): Date {
  const m = local.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) throw new Error(`잘못된 날짜 형식: ${local}`);
  const [, y, mo, d, h, mi] = m.map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 9, mi));
}

/** 약속 전날 저녁 hour시 (한국 시간) */
export function eveningBefore(start: Date, hour: number): Date {
  const key = seoulDateKey(new Date(start.getTime() - 24 * 3600_000));
  return fromSeoulLocal(`${key}T${String(hour).padStart(2, "0")}:00`);
}

/** 받침에 따라 이/가 고르기: 엄마가, 아빠가, 민준이 */
export function iGa(word: string): string {
  const c = word.charCodeAt(word.length - 1);
  if (c < 0xac00 || c > 0xd7a3) return `${word}이(가)`;
  return (c - 0xac00) % 28 ? `${word}이` : `${word}가`;
}
