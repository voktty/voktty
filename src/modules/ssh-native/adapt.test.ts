import { describe, expect, it } from "vitest";
import {
  defaultCredentials,
  hostKeyPrompt,
  isHostKeyError,
  isSshNativeError,
  toDirEntries,
  toDirEntry,
  toFileStat,
  toSshNativeError,
  toTarget,
} from "./adapt";
import type { NativeRemoteEntry, NativeRemoteStat } from "./types";

function entry(overrides: Partial<NativeRemoteEntry> = {}): NativeRemoteEntry {
  return {
    name: "main.rs",
    path: "/srv/app/main.rs",
    isDir: false,
    isSymlink: false,
    size: 120,
    modifiedMs: 1_700_000_000_000,
    ...overrides,
  };
}

function stat(overrides: Partial<NativeRemoteStat> = {}): NativeRemoteStat {
  return {
    path: "/srv/app",
    exists: true,
    isDir: true,
    isSymlink: false,
    size: 4096,
    modifiedMs: 1_700_000_000_000,
    ...overrides,
  };
}

describe("directory entries", () => {
  it("keeps the helper's shape for a plain file", () => {
    expect(toDirEntry(entry())).toEqual({
      name: "main.rs",
      kind: "file",
      size: 120,
      mtime: 1_700_000_000_000,
    });
  });

  it("reports a directory as a directory", () => {
    expect(toDirEntry(entry({ isDir: true })).kind).toBe("dir");
  });

  it("reports a symlink as a symlink even when it points at a directory", () => {
    expect(toDirEntry(entry({ isDir: true, isSymlink: true })).kind).toBe("symlink");
  });

  it("falls back to a zero mtime when the server omits it", () => {
    expect(toDirEntry(entry({ modifiedMs: undefined })).mtime).toBe(0);
  });

  it("maps a whole listing in order", () => {
    const entries = toDirEntries([entry({ name: "a" }), entry({ name: "b", isDir: true })]);
    expect(entries.map((e) => [e.name, e.kind])).toEqual([
      ["a", "file"],
      ["b", "dir"],
    ]);
  });
});

describe("stat", () => {
  it("maps an existing directory", () => {
    expect(toFileStat(stat())).toEqual({
      size: 4096,
      mtime: 1_700_000_000_000,
      kind: "dir",
    });
  });

  it("maps an existing file", () => {
    expect(toFileStat(stat({ isDir: false, size: 7 })).kind).toBe("file");
  });

  it("throws for a missing path, matching the helper's contract", () => {
    expect(() => toFileStat(stat({ exists: false }))).toThrow("no such path: /srv/app");
  });
});

describe("errors", () => {
  it("recognizes a serialized native error", () => {
    expect(isSshNativeError({ code: "auth_failed", message: "nope" })).toBe(true);
    expect(isSshNativeError({ message: "nope" })).toBe(false);
    expect(isSshNativeError(null)).toBe(false);
    expect(isSshNativeError("boom")).toBe(false);
  });

  it("normalizes anything unexpected into a protocol error", () => {
    expect(toSshNativeError(new Error("boom"))).toEqual({
      code: "protocol",
      message: "boom",
    });
    expect(toSshNativeError("plain").code).toBe("protocol");
  });

  it("passes a native error through untouched", () => {
    const error = { code: "timeout", message: "slow" } as const;
    expect(toSshNativeError(error)).toBe(error);
  });

  it("surfaces the prompt only for host key codes", () => {
    const prompt = {
      host: "h",
      port: 22,
      keyType: "ssh-ed25519",
      keyBase64: "AAAA",
      fingerprint: "SHA256:x",
      changed: false,
    };
    expect(hostKeyPrompt({ code: "host_key_unknown", message: "", prompt })).toBe(prompt);
    expect(hostKeyPrompt({ code: "auth_failed", message: "", prompt })).toBeUndefined();
    expect(isHostKeyError("host_key_changed")).toBe(true);
    expect(isHostKeyError("unreachable")).toBe(false);
  });
});

describe("target and credentials", () => {
  it("carries host, port, user and identity", () => {
    expect(
      toTarget({ host: "h", port: 2222, user: "root", identityFile: "~/.ssh/id" }),
    ).toEqual({
      host: "h",
      port: 2222,
      user: "root",
      identityFile: "~/.ssh/id",
    });
  });

  it("has no jumps when the connection declares none", () => {
    expect(toTarget({ host: "h" }).jumps).toBeUndefined();
  });

  it("reads a ProxyJump chain out of the extra arguments", () => {
    const target = toTarget({
      host: "dest",
      extraArgs: "-o Compression=yes -J alice@bastion:2200,relay",
    });
    expect(target.jumps).toEqual([
      { host: "bastion", port: 2200, user: "alice" },
      { host: "relay" },
    ]);
  });

  it("accepts the long jump flag and an equals sign", () => {
    expect(toTarget({ host: "d", extraArgs: "--jump=bastion" }).jumps).toEqual([
      { host: "bastion" },
    ]);
  });

  it("ignores a jump port that is not a number", () => {
    expect(toTarget({ host: "d", extraArgs: "-J bastion:abc" }).jumps).toEqual([
      { host: "bastion" },
    ]);
  });

  it("offers the agent first and the connection key after it", () => {
    expect(defaultCredentials({ host: "h", identityFile: "~/.ssh/id" })).toEqual([
      { kind: "agent" },
      { kind: "privateKey", path: "~/.ssh/id" },
    ]);
  });

  it("never assembles a password on its own", () => {
    const credentials = defaultCredentials({ host: "h" });
    expect(credentials).toEqual([{ kind: "agent" }]);
    expect(credentials.some((c) => c.kind === "password")).toBe(false);
  });

  it("ignores a blank identity file", () => {
    expect(defaultCredentials({ host: "h", identityFile: "   " })).toEqual([
      { kind: "agent" },
    ]);
  });
});
