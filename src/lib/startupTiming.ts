const PREFIX = "voktty:start:";
let firstTerminalReady = false;

export function markStartupPhase(phase: string): void {
  if (typeof performance === "undefined") return;
  performance.mark(`${PREFIX}${phase}`);
}

export function markFirstTerminalReady(): void {
  if (firstTerminalReady) return;
  firstTerminalReady = true;
  markStartupPhase("terminal-ready");
}
