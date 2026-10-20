import { describe, expect, it } from "vitest";
import {
  assertRemoteAgentSupported,
  assertRemoteAttachments,
  checkRemoteAgentProbe,
  compareVersions,
  parseVersion,
  RemoteAgentError,
  remoteAgentForCommand,
  supportsRemoteAgent,
} from "./remoteAgents";

const remote = "remote://voktty-ssh-p1/srv/app";

describe("remote agent support", () => {
  it("allows only the agents that have a remote path", () => {
    expect(["codex", "claude", "opencode"].every((id) => supportsRemoteAgent(id as never))).toBe(true);
    for (const id of ["cursor", "gemini", "grok", "hermes", "pi", "omp", "fx"]) {
      expect(supportsRemoteAgent(id as never)).toBe(false);
    }
  });

  it("refuses an unsupported harness on a remote project with a useful message", () => {
    expect(() => assertRemoteAgentSupported("cursor", remote)).toThrow(
      /cursor cannot run on a remote host yet.*codex, claude, opencode/,
    );
    try {
      assertRemoteAgentSupported("grok", remote);
    } catch (error) {
      expect(error).toBeInstanceOf(RemoteAgentError);
      expect((error as RemoteAgentError).code).toBe("remote-agent-unsupported");
    }
  });

  it("never blocks local projects or supported agents", () => {
    expect(() => assertRemoteAgentSupported("cursor", "/home/me/app")).not.toThrow();
    expect(() => assertRemoteAgentSupported("codex", remote)).not.toThrow();
  });

  it("looks agents up by the binary the helper starts", () => {
    expect(remoteAgentForCommand("claude")?.install).toContain("claude-code");
    expect(remoteAgentForCommand("sh")).toBeUndefined();
  });
});

describe("version handling", () => {
  it("extracts the first dotted number", () => {
    expect(parseVersion("2.0.15 (Claude Code)")).toBe("2.0.15");
    expect(parseVersion("codex-cli 0.46.0-beta")).toBe("0.46.0");
    expect(parseVersion("unknown")).toBeUndefined();
    expect(parseVersion(null)).toBeUndefined();
  });

  it("compares numerically, not lexically", () => {
    expect(compareVersions("2.0.9", "2.0.15")).toBeLessThan(0);
    expect(compareVersions("2.1", "2.0.15")).toBeGreaterThan(0);
    expect(compareVersions("2.0", "2.0.0")).toBe(0);
  });
});

describe("probe results", () => {
  it("explains a missing binary and how to install it", () => {
    expect(() => checkRemoteAgentProbe("codex", { found: false })).toThrow(
      /codex is not installed on the remote host.*@openai\/codex/,
    );
  });

  it("rejects a version below the known minimum and accepts equal or newer", () => {
    expect(() =>
      checkRemoteAgentProbe("opencode", { found: true, version: "opencode 2.0.14" }),
    ).toThrow(/older than 2.0.15/);
    expect(() =>
      checkRemoteAgentProbe("opencode", { found: true, version: "2.0.15" }),
    ).not.toThrow();
    expect(() =>
      checkRemoteAgentProbe("opencode", { found: true, version: "3.1.0" }),
    ).not.toThrow();
  });

  it("does not judge a version it cannot read or an agent without a minimum", () => {
    expect(() => checkRemoteAgentProbe("opencode", { found: true, version: null })).not.toThrow();
    expect(() => checkRemoteAgentProbe("claude", { found: true, version: "0.0.1" })).not.toThrow();
  });
});

describe("remote attachments", () => {
  const image = {
    id: "1",
    name: "shot.png",
    mimeType: "image/png",
    kind: "image",
    size: 10,
    data: "AAAA",
  } as never;
  const pathImage = { ...(image as object), id: "2", name: "big.png", data: undefined, path: "C:/big.png" } as never;
  const doc = {
    id: "3",
    name: "spec.pdf",
    mimeType: "application/pdf",
    kind: "file",
    size: 99,
    path: "C:/spec.pdf",
  } as never;

  it("lets inline images through and refuses anything that needs a local path", () => {
    expect(() => assertRemoteAttachments([image], remote)).not.toThrow();
    expect(() => assertRemoteAttachments([image, doc, pathImage], remote)).toThrow(
      /spec\.pdf, big\.png cannot be sent to an agent on a remote host/,
    );
  });

  it("never restricts local projects or empty attachment lists", () => {
    expect(() => assertRemoteAttachments([doc], "/home/me/app")).not.toThrow();
    expect(() => assertRemoteAttachments(undefined, remote)).not.toThrow();
    expect(() => assertRemoteAttachments([], remote)).not.toThrow();
  });
});