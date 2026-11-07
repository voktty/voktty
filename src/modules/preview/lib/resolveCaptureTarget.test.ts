import { describe, expect, it, vi } from "vitest";
import type { WorkspaceEnv } from "@/modules/workspace";
import { isRemoteCapture, resolveCaptureTarget } from "./resolveCaptureTarget";

const ssh = (sessionId: number | undefined): WorkspaceEnv =>
  ({
    kind: "ssh",
    root: "/",
    sessionId,
    connection: { id: "c", name: "c", host: "h" },
  }) as unknown as WorkspaceEnv;

function deps(env: WorkspaceEnv | undefined, launched = false) {
  return {
    leafEnv: () => env,
    tunnel: vi
      .fn()
      .mockResolvedValue({ url: "http://127.0.0.1:8123", localPort: 8123 }),
    launched: vi.fn().mockReturnValue(launched),
  };
}

describe("resolveCaptureTarget", () => {
  it("leaves a local capture alone", async () => {
    const d = deps({ kind: "local" });
    await expect(
      resolveCaptureTarget({ leafId: 1, url: "http://localhost:5173" }, d),
    ).resolves.toEqual({ url: "http://localhost:5173", inspectViaProxy: false });
    expect(d.tunnel).not.toHaveBeenCalled();
  });

  it("tunnels a capture made in a remote terminal", async () => {
    const d = deps(ssh(9));
    const target = await resolveCaptureTarget(
      { leafId: 1, url: "http://127.0.0.1:8123" },
      d,
    );
    expect(d.tunnel).toHaveBeenCalledWith(9, 8123);
    expect(target).toEqual({ url: "http://127.0.0.1:8123", inspectViaProxy: false });
  });

  it("uses the inspector proxy only for servers the preview started", async () => {
    const d = deps(ssh(9), true);
    const target = await resolveCaptureTarget(
      { leafId: 1, url: "http://127.0.0.1:8123" },
      d,
    );
    expect(d.launched).toHaveBeenCalledWith(9, 8123);
    expect(target.inspectViaProxy).toBe(true);
  });

  it("does not tunnel without a connected session or a port", async () => {
    const noSession = deps(ssh(undefined));
    await resolveCaptureTarget({ leafId: 1, url: "http://127.0.0.1:8123" }, noSession);
    expect(noSession.tunnel).not.toHaveBeenCalled();
    const noPort = deps(ssh(9));
    await resolveCaptureTarget({ leafId: 1, url: "http://localhost" }, noPort);
    expect(noPort.tunnel).not.toHaveBeenCalled();
  });

  it("propagates a tunnel failure to the caller", async () => {
    const d = deps(ssh(9));
    d.tunnel.mockRejectedValue(new Error("ssh failed"));
    await expect(
      resolveCaptureTarget({ leafId: 1, url: "http://127.0.0.1:8123" }, d),
    ).rejects.toThrow("ssh failed");
  });
});

describe("isRemoteCapture", () => {
  it("is true only for a connected SSH leaf", () => {
    expect(isRemoteCapture(1, () => ssh(9))).toBe(true);
    expect(isRemoteCapture(1, () => ssh(undefined))).toBe(false);
    expect(isRemoteCapture(1, () => ({ kind: "local" }) as WorkspaceEnv)).toBe(false);
    expect(isRemoteCapture(1, () => undefined)).toBe(false);
  });
});
