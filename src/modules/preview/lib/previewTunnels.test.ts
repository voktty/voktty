import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensurePreviewTunnel,
  forgetPreviewTunnels,
  markPreviewLaunch,
  registerRemotePreview,
  remotePreviewForUrl,
  saveAffectsRemotePreview,
  resetPreviewTunnels,
  wasLaunchedByPreview,
} from "./previewTunnels";

beforeEach(() => resetPreviewTunnels());

describe("ensurePreviewTunnel", () => {
  it("opens a tunnel that mirrors the remote port and returns a loopback url", async () => {
    const open = vi.fn().mockResolvedValue({ tunnelId: 1, localPort: 8123 });
    const tunnel = await ensurePreviewTunnel(7, 8123, open);
    expect(open).toHaveBeenCalledWith(7, 8123, 8123);
    expect(tunnel).toEqual({ url: "http://127.0.0.1:8123", localPort: 8123 });
  });

  it("reuses the tunnel for the same session and port", async () => {
    const open = vi.fn().mockResolvedValue({ tunnelId: 1, localPort: 9001 });
    await Promise.all([
      ensurePreviewTunnel(7, 8123, open),
      ensurePreviewTunnel(7, 8123, open),
    ]);
    await ensurePreviewTunnel(7, 8123, open);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("keeps sessions and ports apart", async () => {
    const open = vi.fn().mockResolvedValue({ tunnelId: 1, localPort: 9001 });
    await ensurePreviewTunnel(7, 8123, open);
    await ensurePreviewTunnel(8, 8123, open);
    await ensurePreviewTunnel(7, 8124, open);
    expect(open).toHaveBeenCalledTimes(3);
  });

  it("forgets a failed open so the next attempt retries", async () => {
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error("ssh failed"))
      .mockResolvedValue({ tunnelId: 2, localPort: 8123 });
    await expect(ensurePreviewTunnel(7, 8123, open)).rejects.toThrow("ssh failed");
    await expect(ensurePreviewTunnel(7, 8123, open)).resolves.toMatchObject({
      localPort: 8123,
    });
    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe("launch registry", () => {
  it("remembers what the preview started and forgets it with the session", () => {
    markPreviewLaunch(7, 8123);
    expect(wasLaunchedByPreview(7, 8123)).toBe(true);
    expect(wasLaunchedByPreview(7, 8124)).toBe(false);
    forgetPreviewTunnels(7);
    expect(wasLaunchedByPreview(7, 8123)).toBe(false);
  });
});

describe("remote preview targets", () => {
  const env = {} as never;
  it("matches saves inside the project of the same session only", () => {
    registerRemotePreview(8123, { sessionId: 7, root: "/srv/site", env });
    const url = "http://127.0.0.1:8123/about";
    expect(saveAffectsRemotePreview(url, { sessionId: 7, path: "/srv/site/a.php" })).toBe(true);
    expect(saveAffectsRemotePreview(url, { sessionId: 7, path: "/srv/site2/a.php" })).toBe(false);
    expect(saveAffectsRemotePreview(url, { sessionId: 8, path: "/srv/site/a.php" })).toBe(false);
    expect(saveAffectsRemotePreview("http://127.0.0.1:9999/", { sessionId: 7, path: "/srv/site/a.php" })).toBe(false);
  });
  it("treats any save of the session as relevant when the root is unknown", () => {
    registerRemotePreview(8124, { sessionId: 7, root: null, env });
    expect(saveAffectsRemotePreview("http://localhost:8124", { sessionId: 7, path: "/x/y.php" })).toBe(true);
  });
  it("forgets targets with the session", () => {
    registerRemotePreview(8125, { sessionId: 7, root: null, env });
    forgetPreviewTunnels(7);
    expect(remotePreviewForUrl("http://127.0.0.1:8125")).toBeNull();
  });
});
