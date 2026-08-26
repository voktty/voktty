import { describe, expect, it } from "vitest";
import { isDroppedResourceStatCompatible } from "./resourceDrop";

describe("isDroppedResourceStatCompatible", () => {
  it("accepts regular files and file symlinks", () => {
    const source = { kind: "file" as const, path: "/repo/index.ts" };
    expect(isDroppedResourceStatCompatible(source, "file")).toBe(true);
    expect(isDroppedResourceStatCompatible(source, "symlink")).toBe(true);
  });

  it("accepts directories but not a missing or mismatched path", () => {
    const source = { kind: "directory" as const, path: "/repo/src" };
    expect(isDroppedResourceStatCompatible(source, "dir")).toBe(true);
    expect(isDroppedResourceStatCompatible(source, "file")).toBe(false);
    expect(isDroppedResourceStatCompatible(source, null)).toBe(false);
  });

  it("keeps the source context available for remote callers", () => {
    const source = {
      kind: "file" as const,
      path: "/workspace/readme.md",
      workspaceId: "ssh:server:/workspace",
      workspaceEnv: {
        kind: "ssh" as const,
        connection: {
          id: "server",
          name: "Server",
          host: "example.test",
        },
        root: "/workspace",
      },
    };
    expect(source.workspaceEnv.kind).toBe("ssh");
    expect(isDroppedResourceStatCompatible(source, "file")).toBe(true);
  });
});
