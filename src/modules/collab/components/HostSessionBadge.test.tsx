import { HostSessionBadgeView } from "@/modules/collab/components/HostSessionBadge";
import type { HostedTerminalView } from "@/modules/collab/lib/hostRuntime";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

describe("HostSessionBadge", () => {
  const session: HostedTerminalView = {
    leafId: 3,
    ptyId: 7,
    cols: 100,
    rows: 30,
    title: "Terminal",
    status: "ready",
    share: {
      invite: {
        sessionId: "session-1",
        inviteCode: "code-1",
        loopbackUrl: "ws://127.0.0.1/session-1",
        expiresAtMs: 1,
      },
      tunnel: {
        publicUrl: "https://example.trycloudflare.com",
        connectionUrl: "wss://example.trycloudflare.com/session-1",
      },
    },
    participants: [
      {
        id: "participant-1",
        name: "Ada",
        role: "observer",
        controlRequested: true,
        typing: true,
      },
    ],
    error: null,
  };

  it("renders persistent host status, participant count and stop action", () => {
    const markup = renderToStaticMarkup(
      <HostSessionBadgeView session={session} onStop={vi.fn()} />,
    );

    expect(markup).toContain("Terminal shared");
    expect(markup).toContain("Participants: 1");
    expect(markup).toContain("Ada");
    expect(markup).toContain("Typing...");
    expect(markup).toContain("Stop sharing");
  });
});
