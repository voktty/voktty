import { verifyCloudflared } from "@/modules/collab/lib/requirements";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("cloudflared requirements bridge", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      installed: false,
      executable: null,
      version: null,
      error: "cloudflared was not found",
      suggestion: null,
    });
  });

  it("checks PATH when no custom executable is configured", async () => {
    await verifyCloudflared();

    expect(invokeMock).toHaveBeenCalledWith("collab_cloudflared_status", {
      customPath: null,
    });
  });

  it("normalizes a custom executable path", async () => {
    await verifyCloudflared("  C:/Tools/cloudflared.exe  ");

    expect(invokeMock).toHaveBeenCalledWith("collab_cloudflared_status", {
      customPath: "C:/Tools/cloudflared.exe",
    });
  });
});
