import { describe, expect, it } from "vitest";
import {
  applyOperation,
  revertOperation,
  type OperationAdapter,
  type OperationEntry,
} from "./operationTransaction";

function memoryAdapter(initial: Record<string, string>): OperationAdapter & {
  files: Map<string, string>;
  directories: Set<string>;
  failWritePath: string | null;
} {
  const files = new Map(Object.entries(initial));
  const directories = new Set<string>();
  return {
    files,
    directories,
    failWritePath: null,
    inspect: async (path) => {
      if (files.has(path))
        return { kind: "file", content: files.get(path) ?? "" };
      if (directories.has(path)) return { kind: "directory", empty: true };
      return null;
    },
    writeFile: async function (path, content) {
      if (this.failWritePath === path)
        throw new Error("injected write failure");
      files.set(path, content);
    },
    createDirectory: async (path) => {
      directories.add(path);
    },
    removeFile: async (path) => {
      files.delete(path);
    },
    removeEmptyDirectory: async (path) => {
      directories.delete(path);
    },
  };
}

const edits: OperationEntry[] = [
  {
    id: "one",
    kind: "edit",
    path: "/repo/one.ts",
    originalContent: "one",
    proposedContent: "ONE",
    isNewFile: false,
  },
  {
    id: "two",
    kind: "edit",
    path: "/repo/two.ts",
    originalContent: "two",
    proposedContent: "TWO",
    isNewFile: false,
  },
];

describe("operation transaction", () => {
  it("preflights every file before writing anything", async () => {
    const adapter = memoryAdapter({
      "/repo/one.ts": "one",
      "/repo/two.ts": "changed outside",
    });
    const result = await applyOperation(edits, adapter);
    expect(result.ok).toBe(false);
    expect(adapter.files.get("/repo/one.ts")).toBe("one");
  });

  it("rolls back earlier writes if a later write fails", async () => {
    const adapter = memoryAdapter({
      "/repo/one.ts": "one",
      "/repo/two.ts": "two",
    });
    adapter.failWritePath = "/repo/two.ts";
    const result = await applyOperation(edits, adapter);
    expect(result.ok).toBe(false);
    expect(adapter.files.get("/repo/one.ts")).toBe("one");
    expect(adapter.files.get("/repo/two.ts")).toBe("two");
  });

  it("reverts a complete applied operation", async () => {
    const adapter = memoryAdapter({
      "/repo/one.ts": "one",
      "/repo/two.ts": "two",
    });
    const applied = await applyOperation(edits, adapter);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const reverted = await revertOperation(applied.operation, adapter);
    expect(reverted.ok).toBe(true);
    expect(adapter.files.get("/repo/one.ts")).toBe("one");
    expect(adapter.files.get("/repo/two.ts")).toBe("two");
  });

  it("refuses the entire revert if a file changed after apply", async () => {
    const adapter = memoryAdapter({
      "/repo/one.ts": "one",
      "/repo/two.ts": "two",
    });
    const applied = await applyOperation(edits, adapter);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    adapter.files.set("/repo/two.ts", "third-party change");
    const reverted = await revertOperation(applied.operation, adapter);
    expect(reverted.ok).toBe(false);
    expect(adapter.files.get("/repo/one.ts")).toBe("ONE");
  });
});
