import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectFile } from "./fs";
import {
  invalidateProjectFiles,
  rememberOpenedFile,
  resolveOpenablePath,
} from "./fileIndex";

const cwd = "/Users/me/project";
const files: ProjectFile[] = [
  {
    name: "App.tsx",
    path: "/Users/me/project/apps/desktop/src/App.tsx",
    relative: "apps/desktop/src/App.tsx",
  },
  {
    name: "App.tsx",
    path: "/Users/me/project/apps/web/src/App.tsx",
    relative: "apps/web/src/App.tsx",
  },
  {
    name: "main.tsx",
    path: "/Users/me/project/apps/desktop/src/main.tsx",
    relative: "apps/desktop/src/main.tsx",
  },
];

vi.mock("./fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fs")>();
  return {
    ...actual,
    listProjectFiles: vi.fn(async () => files),
  };
});

describe("resolveOpenablePath", () => {
  beforeEach(() => {
    invalidateProjectFiles(cwd);
  });

  it("maps a basename-only link to the shortest matching project path", async () => {
    const resolved = await resolveOpenablePath(cwd, "App.tsx");
    expect(resolved).toBe(files[1].path);
  });

  it("prefers recently opened files for ambiguous basenames", async () => {
    rememberOpenedFile(cwd, files[1].path);
    const resolved = await resolveOpenablePath(cwd, "App.tsx");
    expect(resolved).toBe(files[1].path);
  });

  it("matches a relative project path", async () => {
    const resolved = await resolveOpenablePath(cwd, "apps/desktop/src/main.tsx");
    expect(resolved).toBe(files[2].path);
  });
});
