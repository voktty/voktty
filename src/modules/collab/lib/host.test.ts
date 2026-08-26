import {
  grantHostedControl,
  publishHostedTerminal,
  startHostedTerminal,
} from "@/modules/collab/lib/host";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("hosted terminal bridge", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("starts sharing with the canonical PTY geometry", async () => {
    await startHostedTerminal(7, 120, 40);

    expect(invokeMock).toHaveBeenCalledWith("collab_host_start", {
      ptyId: 7,
      cols: 120,
      rows: 40,
    });
  });

  it("normalizes the optional cloudflared path", async () => {
    await publishHostedTerminal(7, "  C:/Tools/cloudflared.exe  ");

    expect(invokeMock).toHaveBeenCalledWith("collab_host_publish", {
      ptyId: 7,
      customPath: "C:/Tools/cloudflared.exe",
    });
  });

  it("uses an explicit participant id when granting control", async () => {
    await grantHostedControl(7, "participant-1");

    expect(invokeMock).toHaveBeenCalledWith("collab_host_grant_control", {
      ptyId: 7,
      participantId: "participant-1",
    });
  });

  it("uses an explicit participant id when banning a participant", async () => {
    const { banHostedParticipant } = await import("@/modules/collab/lib/host");
    await banHostedParticipant(7, "participant-1");

    expect(invokeMock).toHaveBeenCalledWith("collab_host_ban_participant", {
      ptyId: 7,
      participantId: "participant-1",
    });
  });
});
