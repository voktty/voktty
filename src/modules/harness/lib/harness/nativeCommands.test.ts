import { describe, expect, it } from "vitest";
import { nativeCommandInvocation, nativeCommandPrompt } from "./nativeCommands";

describe("nativeCommandInvocation", () => {
  it("prefixes reserved commands with harness id", () => {
    expect(nativeCommandInvocation("claude", "plan")).toBe("claude:plan");
    expect(nativeCommandInvocation("codex", "compact")).toBe("codex:compact");
  });

  it("leaves unreserved commands untouched", () => {
    expect(nativeCommandInvocation("claude", "help")).toBe("help");
    expect(nativeCommandInvocation("cursor", "test")).toBe("test");
    expect(nativeCommandInvocation("pi", "custom-tool")).toBe("custom-tool");
  });
});

describe("nativeCommandPrompt", () => {
  it("strips harness prefix for reserved commands", () => {
    expect(nativeCommandPrompt("claude", "/claude:plan some prompt")).toBe(
      "/plan some prompt",
    );
    expect(nativeCommandPrompt("codex", "  /codex:compact")).toBe(
      "  /compact",
    );
  });

  it("preserves unreserved or non-matching commands", () => {
    expect(nativeCommandPrompt("claude", "/help me")).toBe("/help me");
    expect(nativeCommandPrompt("claude", "/codex:plan me")).toBe(
      "/codex:plan me",
    );
    expect(nativeCommandPrompt("pi", "regular text /plan")).toBe(
      "regular text /plan",
    );
  });
});
