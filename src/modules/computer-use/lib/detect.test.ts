import { describe, expect, it, vi } from "vitest";
import { detectComputerUse, type DetectDeps } from "./detect";
import {
  COMPUTER_USE_INSTALL_COMMAND,
  COMPUTER_USE_VERSION,
  parseProbe,
  type ComputerUseProbe,
} from "./probe";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/modules/remote/sessionManager", () => ({ remoteSessions: {} }));

const installed: ComputerUseProbe = {
  status: "installed",
  path: "/usr/bin/ocu",
  version: "1.1.4",
  doctor: null,
  error: null,
};

function deps(overrides: Partial<DetectDeps> = {}): DetectDeps {
  return {
    local: vi.fn(async () => installed),
    remote: vi.fn(async () => installed),
    acquireHost: vi.fn(async () => ({
      sessionId: 7,
      capabilities: ["ocu.probe"],
      release: vi.fn(),
    })),
    ...overrides,
  };
}

describe("detectComputerUse", () => {
  it("probes this computer without touching any host", async () => {
    const d = deps();
    const state = await detectComputerUse({ hostId: null }, true, d);
    expect(state).toEqual({ kind: "result", probe: installed });
    expect(d.local).toHaveBeenCalledWith(true);
    expect(d.acquireHost).not.toHaveBeenCalled();
  });

  it("probes a host through its helper and always releases the session", async () => {
    const release = vi.fn();
    const d = deps({
      acquireHost: vi.fn(async () => ({ sessionId: 7, capabilities: ["ocu.probe"], release })),
    });
    const state = await detectComputerUse({ hostId: "box" }, false, d);
    expect(state.kind).toBe("result");
    expect(d.remote).toHaveBeenCalledWith(7, false);
    expect(release).toHaveBeenCalledOnce();
  });

  it("asks to update a helper that does not advertise the probe", async () => {
    const release = vi.fn();
    const d = deps({
      acquireHost: vi.fn(async () => ({ sessionId: 7, capabilities: ["exec.run"], release })),
    });
    expect(await detectComputerUse({ hostId: "box" }, true, d)).toEqual({ kind: "helper-outdated" });
    expect(d.remote).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
  });

  it("reports a host that is no longer saved", async () => {
    const d = deps({ acquireHost: vi.fn(async () => null) });
    expect(await detectComputerUse({ hostId: "gone" }, true, d)).toEqual({ kind: "unknown-host" });
  });

  it("turns a failing probe into an error and still releases", async () => {
    const release = vi.fn();
    const d = deps({
      acquireHost: vi.fn(async () => ({ sessionId: 7, capabilities: ["ocu.probe"], release })),
      remote: vi.fn(async () => {
        throw new Error("connection lost");
      }),
    });
    expect(await detectComputerUse({ hostId: "box" }, true, d)).toEqual({
      kind: "error",
      message: "connection lost",
    });
    expect(release).toHaveBeenCalledOnce();
  });
});

describe("probe contract", () => {
  it("pins one exact version in the visible install command", () => {
    expect(COMPUTER_USE_INSTALL_COMMAND).toBe(`npm i -g open-computer-use@${COMPUTER_USE_VERSION}`);
    expect(COMPUTER_USE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("accepts the Rust payload and bounds its text", () => {
    const probe = parseProbe({
      status: "doctor-problem",
      path: "/x",
      version: "1.1.4",
      doctor: "d".repeat(5000),
      error: null,
    });
    expect(probe.status).toBe("doctor-problem");
    expect(probe.doctor?.length).toBeLessThanOrEqual(2100);
  });

  it("rejects an unknown status instead of showing it as installed", () => {
    expect(() => parseProbe({ status: "ready" })).toThrow();
    expect(() => parseProbe(null)).toThrow();
  });
});
