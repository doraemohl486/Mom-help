import { config } from "./config.ts";
import type { Db, Parent, Schedule } from "./db.ts";

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

  toGuardian(parent: Parent, schedule: Schedule | null, kind: string, message: string) {
    this.db.addNotification({ parent_id: parent.id, schedule_id: schedule?.id ?? null, audience: "guardian", kind, message });
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
