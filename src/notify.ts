import { config } from "./config.ts";
import type { Db, Parent, Schedule } from "./db.ts";
import { iGa } from "./time.ts";

/**
 * 자녀에게는 "문제 있을 때만" 알린다. 평소 진행(전날 알림, 선택, 택시 예약·배차, 도착)은
 * 자녀 앱의 진행 기록에만 남고 알림으로 가지 않는다.
 */
export const GUARDIAN_ALERTS = new Set([
  "escalate", // 부모님이 답이 없으세요
  "call_failed", // 택시를 끝내 못 불렀어요
  "family", // "자녀가 태워줘"를 고르셨어요
  "sms_review", // 병원 예약 문자가 애매해서 확인 필요
  "parent_review", // 부모님이 알려 주신 일정의 장소 확인 필요
]);

/** 부모님만 보는 일정: 자녀에게는 어디 가는지 빼고 알린다 */
function privateMessage(parent: Parent, kind: string): string {
  const who = parent.name;
  switch (kind) {
    case "escalate":
      return `${iGa(who)} 알림에 아직 답이 없으세요. (개인 일정) 전화해 보세요.`;
    case "call_failed":
      return `${who} 택시를 못 불렀어요. (개인 일정) 전화해 보세요.`;
    case "family":
      return `${iGa(who)} 태워 달라고 하세요. (개인 일정) 전화해 보세요.`;
    default:
      return `${who} 개인 일정에 확인할 일이 있어요. 전화해 보세요.`;
  }
}

/**
 * 알림 발송. MVP에서는 앱 내 알림(DB)에 저장하고, 문자는 로그로만 남긴다.
 * 실제 문자/알림톡 발송은 sendSms()에 제공자(예: NHN Cloud, 카카오 알림톡)를 붙이면 된다.
 */
export class Notifier {
  private db: Db;
  constructor(db: Db) {
    this.db = db;
  }

  toParent(parent: Parent, schedule: Schedule | null, kind: string, message: string) {
    this.db.addNotification({ parent_id: parent.id, schedule_id: schedule?.id ?? null, audience: "parent", kind, message });
    this.sendSms(parent.phone, message);
  }

  /** 자녀 알림: 문제 있을 때만 보낸다. 보냈으면 true */
  toGuardian(parent: Parent, schedule: Schedule | null, kind: string, message: string): boolean {
    if (!GUARDIAN_ALERTS.has(kind)) return false;
    const isPrivate = schedule !== null && schedule.shared === 0;
    this.db.addNotification({
      parent_id: parent.id, schedule_id: isPrivate ? null : schedule?.id ?? null, audience: "guardian", kind,
      message: isPrivate ? privateMessage(parent, kind) : message,
    });
    return true;
  }

  private sendSms(to: string, message: string) {
    if (config.smsProvider === "log") {
      console.log(`[sms → ${to}] ${message}`);
      return;
    }
    // TODO: 실제 문자 제공자 연동
    console.warn(`[sms] 알 수 없는 SMS_PROVIDER=${config.smsProvider}, 발송 생략`);
  }
}
