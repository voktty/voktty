import { describe, expect, it } from "vitest";
import {
  defaultNetworkAllowlist,
  UNIVERSAL_ALLOWLIST_HOSTS,
} from "./networkSandboxDefaults";
import { HARNESSES } from "./session";

describe("defaultNetworkAllowlist", () => {
  it("always includes the universal hosts", () => {
    const allowlist = defaultNetworkAllowlist("claude");
    for (const host of UNIVERSAL_ALLOWLIST_HOSTS) {
      expect(allowlist).toContain(host);
    }
  });

  it("adds the harness's own API host", () => {
    expect(defaultNetworkAllowlist("claude")).toContain("api.anthropic.com");
    expect(defaultNetworkAllowlist("codex")).toContain("api.openai.com");
  });

  it("never duplicates a host shared between the universal and harness lists", () => {
    const allowlist = defaultNetworkAllowlist("pi");
    const seen = new Set(allowlist);
    expect(seen.size).toBe(allowlist.length);
  });

  it("returns a non-empty list for every known harness", () => {
    for (const harness of HARNESSES) {
      expect(defaultNetworkAllowlist(harness).length).toBeGreaterThan(0);
    }
  });
});
