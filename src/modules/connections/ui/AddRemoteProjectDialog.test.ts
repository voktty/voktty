import {
  isLocalProject,
  looksLikeProject,
} from "@/modules/harness/lib/recents";
import { invoke } from "@tauri-apps/api/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  rememberRemoteProject,
  remoteProjectFor,
} from "../model/remoteProjects";
import { AddRemoteProjectDialog } from "./AddRemoteProjectDialog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

vi.mock("react-dom", async () => {
  const actual = await vi.importActual<typeof import("react-dom")>("react-dom");
  return {
    ...actual,
    createPortal: (children: unknown) => children,
  };
});

const storage = new Map<string, string>();
if (typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, String(value)),
      removeItem: (key: string) => storage.delete(key),
      clear: () => storage.clear(),
      get length() {
        return storage.size;
      },
      key: (i: number) => Array.from(storage.keys())[i] ?? null,
    },
    configurable: true,
    writable: true,
  });
}

if (typeof globalThis.window === "undefined") {
  globalThis.window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
  } as unknown as Window & typeof globalThis;
}

describe("AddRemoteProjectDialog", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(invoke).mockReset();
    if (typeof globalThis.document === "undefined") {
      (globalThis as unknown as { document: unknown }).document = {
        body: {},
      };
    }
  });

  it("renders dialog shell and explanation in static markup", () => {
    const markup = renderToStaticMarkup(
      createElement(AddRemoteProjectDialog, {
        onCancel: vi.fn(),
        onOpen: vi.fn(),
      }),
    );

    expect(markup).toContain("Open folder on a machine");
    expect(markup).toContain("Voktty’s authenticated agent");
    expect(markup).toContain('class="absolute inset-0 z-0 cursor-default"');
    expect(markup).toContain("bg-background-base dark:bg-content/5");
    expect(markup).not.toContain("bg-black/30");
  });

  it("remembers a remote folder with the machine identity", () => {
    const project = rememberRemoteProject("env-1", {
      id: "ssh-env-1-/home/me/code/app",
      cwd: "/home/me/code/app",
      name: "app",
    });
    expect(project.key).toBe("remote://env-1/home/me/code/app");
    expect(remoteProjectFor(project.key)).toEqual({
      key: "remote://env-1/home/me/code/app",
      environmentId: "env-1",
      projectId: "ssh-env-1-/home/me/code/app",
      cwd: "/home/me/code/app",
    });

    // Remote projects look like valid project keys but never local paths
    expect(looksLikeProject(project.key)).toBe(true);
    expect(isLocalProject(project.key)).toBe(false);
  });
});
