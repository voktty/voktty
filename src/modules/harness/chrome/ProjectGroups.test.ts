import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pathKey } from "../lib/paths";
import {
  saveProjectGroupAssignments,
  saveProjectGroups,
} from "../lib/projectGroups";
import { savePinnedProjects } from "../lib/recents";
import { ProjectRail } from "./ProjectRail";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => null),
  convertFileSrc: (path: string) => path,
}));
vi.mock("../hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: () => null,
}));

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, String(value)),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  },
  configurable: true,
  writable: true,
});

describe("ProjectGroups rail rendering", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("renders assigned projects in groups and ungrouped projects correctly", () => {
    savePinnedProjects(["/work/personal"]);
    saveProjectGroups([
      { id: "clients", name: "Client work", collapsed: false, colorIndex: 4 },
    ]);
    saveProjectGroupAssignments({ [pathKey("/work/client")]: "clients" });

    const html = renderToStaticMarkup(
      createElement(ProjectRail, {
        cwd: "/work/personal",
        recents: [
          { path: "/work/client", openedAt: 1 },
          { path: "/work/personal", openedAt: 2 },
        ],
        onSelectProject: vi.fn(),
        onOpenProject: vi.fn(),
      }),
    );

    // Should include Pinned, Groups, and Projects sections
    expect(html).toContain("Client work");
    expect(html).toContain('data-project-group="clients"');
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="Client work"');
    expect(html).toContain("Client work group options");
    expect(html).toContain("data-project-group-items");
  });

  it("renders collapsed group without group items", () => {
    saveProjectGroups([
      { id: "archive-grp", name: "Old work", collapsed: true },
    ]);
    saveProjectGroupAssignments({ [pathKey("/work/old")]: "archive-grp" });

    const html = renderToStaticMarkup(
      createElement(ProjectRail, {
        cwd: "/work/current",
        recents: [
          { path: "/work/old", openedAt: 1 },
          { path: "/work/current", openedAt: 2 },
        ],
        onSelectProject: vi.fn(),
        onOpenProject: vi.fn(),
      }),
    );

    expect(html).toContain('data-project-group="archive-grp"');
    expect(html).toContain("Old work");
    expect(html).toContain("data-group-mascot");
    // Collapsed group shouldn't render the item container
    expect(html).not.toContain("data-project-group-items");
  });
});
