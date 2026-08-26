import { describe, expect, it } from "vitest";
import {
  chatPresence,
  profileForAgentIcon,
  profileForAgentName,
  terminalPresence,
} from "./presence";

describe("chatPresence", () => {
  it("maps chat lifecycle states without depending on a provider", () => {
    expect(chatPresence({ status: "idle" }).state).toBe("idle");
    expect(
      chatPresence({ status: "thinking", step: "Planning changes" }).state,
    ).toBe("planning");
    expect(
      chatPresence({ status: "thinking", step: "Reading files" }).state,
    ).toBe("tool-running");
    expect(chatPresence({ status: "streaming" }).state).toBe("streaming");
    expect(chatPresence({ status: "error" }).state).toBe("error");
  });

  it("prioritizes pending approval over the current step", () => {
    expect(
      chatPresence({
        status: "thinking",
        step: "Writing",
        approvalsPending: 1,
      }).state,
    ).toBe("awaiting-approval");
  });
});

describe("terminalPresence", () => {
  it("maps the existing terminal process contract", () => {
    expect(terminalPresence({ state: "running", agent: "codex" })?.state).toBe(
      "tool-running",
    );
    expect(
      terminalPresence({ state: "attention", agent: "claude" })?.state,
    ).toBe("awaiting-approval");
    expect(
      terminalPresence({ state: "completed", agent: "gemini" })?.state,
    ).toBe("success");
    expect(terminalPresence({ state: "failed", agent: "codex" })?.state).toBe(
      "error",
    );
    expect(terminalPresence({ state: "running", agent: null })).toBeNull();
  });
});

describe("profile mapping", () => {
  it("keeps built-in profiles distinct", () => {
    expect(profileForAgentIcon("coder")).toBe("coder");
    expect(profileForAgentIcon("architect")).toBe("architect");
    expect(profileForAgentIcon("reviewer")).toBe("reviewer");
    expect(profileForAgentIcon("security")).toBe("security");
    expect(profileForAgentIcon("designer")).toBe("designer");
  });

  it("recognizes common CLI agents without requiring their provider", () => {
    expect(profileForAgentName("codex")).toBe("coder");
    expect(profileForAgentName("claude-code")).toBe("coder");
    expect(profileForAgentName("security-audit")).toBe("security");
    expect(profileForAgentName("unknown-agent")).toBe("spark");
  });
});
