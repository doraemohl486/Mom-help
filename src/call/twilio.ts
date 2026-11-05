import crypto from "node:crypto";
import express, { type Request, type Response } from "express";
import { config } from "../config.ts";
import type { Db } from "../db.ts";
import { openingLine, type AgentStep } from "./agent.ts";
import type { CallProvider, CallService } from "./service.ts";

/**
 * Twilio 음성 전화 제공자 (실험적).
 * - 발신: Twilio REST API로 동행 온다콜택시 번호에 전화
 * - 듣기: <Gather input="speech" language="ko-KR"> 로 상대방 말을 텍스트로
 * - 말하기: <Say language="ko-KR"> 로 AI 비서의 문장을 음성으로
 *
 * 주의: 한국 번호로의 발신 가능 여부·요금·발신번호 표시 규정은 Twilio와 국내 통신 규정을 확인해야 한다.
 *       국내 클라우드 전화 서비스로 바꿀 경우 이 파일과 같은 인터페이스(CallProvider)로 구현하면 된다.
 */
const VOICE = { language: "ko-KR", voice: "Polly.Seoyeon" };
const MAX_SILENCE = 6;

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);

function twiml(body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
}

function gather(callId: number, inner = "") {
  return `<Gather input="speech" language="${VOICE.language}" speechTimeout="auto" actionOnEmptyResult="true" ` +
    `action="${config.publicBaseUrl}/twilio/turn/${callId}" method="POST">${inner}</Gather>`;
}

function say(text: string) {
  return `<Say language="${VOICE.language}" voice="${VOICE.voice}">${esc(text)}</Say>`;
}

export function stepToTwiml(callId: number, step: AgentStep): string {
  let out = "";
  if (step.press_digits) out += `<Play digits="${step.press_digits.replace(/[^0-9*#w]/g, "")}"/>`;
  if (step.say) out += say(step.say);
  if (step.outcome !== "in_progress") return twiml(out + "<Hangup/>");
  return twiml(out + gather(callId));
}

/** Twilio 요청 서명 검증 (X-Twilio-Signature) */
export function validTwilioSignature(authToken: string, url: string, params: Record<string, string>, signature: string): boolean {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = crypto.createHmac("sha1", authToken).update(data).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export class TwilioProvider implements CallProvider {
  readonly name = "twilio";
  private db: Db;
  private service: CallService;
  private silence = new Map<number, number>();

  constructor(db: Db, service: CallService) {
    this.db = db;
    this.service = service;
    const { accountSid, authToken, fromNumber } = config.twilio;
    if (!accountSid || !authToken || !fromNumber || !config.publicBaseUrl) {
      throw new Error("CALL_PROVIDER=twilio 에는 TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER / PUBLIC_BASE_URL 이 필요해요.");
    }
  }

  async start(callId: number): Promise<void> {
    const { accountSid, authToken, fromNumber } = config.twilio;
    const form = new URLSearchParams({
      To: config.taxiCenterNumber,
      From: fromNumber,
      Url: `${config.publicBaseUrl}/twilio/voice/${callId}`,
      StatusCallback: `${config.publicBaseUrl}/twilio/status/${callId}`,
      Timeout: "40",
    });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`, {
      method: "POST",
      headers: { Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64") },
      body: form,
    });
    if (!res.ok) throw new Error(`Twilio ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { sid: string };
    this.db.updateCall(callId, { provider_call_id: body.sid });
  }

  router() {
    const r = express.Router();
    r.use(express.urlencoded({ extended: false }));
    r.use((req: Request, res: Response, next) => {
      const url = `${config.publicBaseUrl}/twilio${req.originalUrl.replace(/^\/twilio/, "")}`;
      if (!validTwilioSignature(config.twilio.authToken, url, req.body ?? {}, req.header("X-Twilio-Signature") ?? "")) {
        res.status(403).send("invalid signature");
        return;
      }
      next();
    });

    // 전화가 연결되면: 상대가 먼저 말하도록 듣기부터 시작
    r.post("/voice/:callId", (req, res) => {
      const callId = Number(req.params.callId);
      res.type("text/xml").send(twiml(gather(callId)));
    });

    // 상대 발화 한 턴
    r.post("/turn/:callId", async (req, res) => {
      const callId = Number(req.params.callId);
      const heard = String(req.body?.SpeechResult ?? "").trim();
      if (!heard) {
        const n = (this.silence.get(callId) ?? 0) + 1;
        this.silence.set(callId, n);
        if (n >= MAX_SILENCE) {
          await this.service.onHangup(callId, "상대방 응답이 없어요.");
          res.type("text/xml").send(twiml("<Hangup/>"));
          return;
        }
        // 연결 후 계속 조용하면 먼저 인사
        if (n === 2) {
          const brief = this.service.brief(
            this.db.getSchedule(this.db.getCall(callId)!.schedule_id)!,
            this.db.getParent(this.db.getSchedule(this.db.getCall(callId)!.schedule_id)!.parent_id)!,
          );
          res.type("text/xml").send(twiml(say(openingLine(brief)) + gather(callId)));
          return;
        }
        res.type("text/xml").send(twiml(gather(callId)));
        return;
      }
      this.silence.set(callId, 0);
      try {
        const step = await this.service.onCenterUtterance(callId, heard);
        res.type("text/xml").send(stepToTwiml(callId, step));
      } catch (err) {
        await this.service.onHangup(callId, `AI 비서 오류: ${(err as Error).message}`);
        res.type("text/xml").send(twiml(say("죄송합니다. 다시 연락드리겠습니다.") + "<Hangup/>"));
      }
    });

    // 통화 상태 (통화중, 무응답, 종료 등)
    r.post("/status/:callId", async (req, res) => {
      const callId = Number(req.params.callId);
      const status = String(req.body?.CallStatus ?? "");
      const reasons: Record<string, string> = {
        busy: "콜센터가 통화 중이에요.", "no-answer": "콜센터가 전화를 받지 않아요.",
        failed: "전화 연결에 실패했어요.", canceled: "전화가 취소됐어요.", completed: "통화가 끝났지만 배차를 확인하지 못했어요.",
      };
      if (reasons[status]) await this.service.onHangup(callId, reasons[status]);
      this.silence.delete(callId);
      res.sendStatus(204);
    });
    return r;
  }
}
