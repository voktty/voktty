import {
  bindHermesSession,
  cancelHermesTurn,
  forgetHermesSession,
  respondHermesApproval,
  sendHermesTurn,
  steerHermesTurn,
  stopHermesSession,
} from "./hermes";
import { type HarnessAdapter, registerHarness } from "./registry";

export const hermesAdapter: HarnessAdapter = {
  id: "hermes",
  live: true,
  canSteer: false,
  sendTurn: sendHermesTurn,
  steerTurn: steerHermesTurn,
  cancelTurn: cancelHermesTurn,
  respondApproval: respondHermesApproval,
  stopSession: stopHermesSession,
  forgetSession: forgetHermesSession,
  bindSession: bindHermesSession,
};

let registered = false;

export function ensureHermesRegistered(): void {
  if (registered) return;
  registerHarness(hermesAdapter);
  registered = true;
}
