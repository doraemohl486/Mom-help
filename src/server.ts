import type express from "express";
import { config } from "./config.ts";
import { openDb } from "./db.ts";
import { Notifier } from "./notify.ts";
import { createCallAgent } from "./call/agent.ts";
import { CallService } from "./call/service.ts";
import { SimulatorProvider } from "./call/simulator.ts";
import { TwilioProvider } from "./call/twilio.ts";
import { TripFlow } from "./flow.ts";
import { createApp } from "./app.ts";
import { Intake } from "./intake.ts";
import { createParser } from "./parse.ts";

export function buildServices(dbPath = config.dbPath, provider = config.callProvider) {
  const db = openDb(dbPath);
  const notifier = new Notifier(db);
  const agent = createCallAgent();
  const calls = new CallService(db, agent, notifier, provider === "simulator" ? 3_000 : 60_000);
  let simulator: SimulatorProvider | null = null;
  const extraRouters: [string, express.Router][] = [];
  if (provider === "twilio") {
    const twilio = new TwilioProvider(db, calls);
    calls.provider = twilio;
    extraRouters.push(["/twilio", twilio.router()]);
  } else {
    simulator = new SimulatorProvider(db, calls);
    calls.provider = simulator;
  }
  const flow = new TripFlow(db, notifier, calls);
  const intake = new Intake(db, flow, createParser(), notifier);
  return { db, notifier, agent, calls, simulator, flow, intake, extraRouters };
}

if (import.meta.main) {
  const services = buildServices();
  const app = createApp(services);
  app.listen(config.port, () => {
    console.log(`엄빠어디가야 서버: http://localhost:${config.port}`);
    console.log(`  AI 비서: ${services.agent.name} · 전화: ${services.calls.provider.name}`);
  });
  // 30초마다 알림 확인
  const tick = () => services.flow.tick().catch((e) => console.error("[tick]", e));
  void tick();
  setInterval(tick, 30_000);
}
