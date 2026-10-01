import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadNotificationPreferences,
  updateNotificationPreferences,
} from "../model/notificationPreferences";
import { rememberNotificationProjects } from "../model/notificationProjects";
import { ProjectNotificationSettings } from "./ProjectNotificationSettings";

describe("ProjectNotificationSettings", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, String(value)),
      removeItem: (key: string) => store.delete(key),
      clear: () => store.clear(),
      get length() {
        return store.size;
      },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
    });
    vi.stubGlobal("window", {
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  it("renders empty state when no projects are available", () => {
    const markup = renderToStaticMarkup(
      createElement(ProjectNotificationSettings, {
        cwd: "",
        recents: [],
      }),
    );
    expect(markup).toContain("Project notifications");
    expect(markup).toContain(
      "Open a project or connect an Inbox provider to configure its notifications.",
    );
  });

  it("renders projects from catalog and recents", () => {
    rememberNotificationProjects([
      {
        id: "repository:github.com/test/repo",
        name: "test/repo",
        detail: "github.com",
        kind: "repository",
        paths: ["/workspace/test"],
      },
    ]);
    const markup = renderToStaticMarkup(
      createElement(ProjectNotificationSettings, {
        cwd: "/workspace/test",
      }),
    );
    expect(markup).toContain("test/repo");
    expect(markup).toContain("Select projects");
    expect(markup).toContain("All categories enabled");
  });

  it("shows only issue notifications for Linear projects", () => {
    rememberNotificationProjects([
      {
        id: "linear:project:p1",
        name: "Linear Roadmap",
        detail: "Linear",
        kind: "linear",
        paths: [],
      },
    ]);
    const markup = renderToStaticMarkup(
      createElement(ProjectNotificationSettings, {
        cwd: "",
      }),
    );
    expect(markup).toContain("Linear Roadmap");
  });

  it("updates category preferences accurately", () => {
    updateNotificationPreferences(["local:/my-proj"], {
      disabled: ["issues", "agentFinished"],
    });
    expect(loadNotificationPreferences()["local:/my-proj"]).toEqual({
      disabled: ["issues", "agentFinished"],
    });
  });
});
