import {
  bindAgySession,
  cancelAgyTurn,
  forgetAgySession,
  respondAgyApproval,
  sendAgyTurn,
  steerAgyTurn,
  stopAgySession,
} from "./agy";
import { refreshAgyCatalog } from "./agyCatalog";
import { type HarnessAdapter, registerHarness } from "./registry";

export const agyAdapter: HarnessAdapter = {
  id: "gemini",
  live: true,
  canSteer: false,
  sendTurn: sendAgyTurn,
  steerTurn: steerAgyTurn,
  cancelTurn: cancelAgyTurn,
  respondApproval: respondAgyApproval,
  stopSession: stopAgySession,
  forgetSession: forgetAgySession,
  bindSession: bindAgySession,
  refreshCatalog: refreshAgyCatalog,
};

let registered = false;

export function ensureGeminiRegistered(): void {
  if (registered) return;
  registerHarness(agyAdapter);
  registered = true;
}
