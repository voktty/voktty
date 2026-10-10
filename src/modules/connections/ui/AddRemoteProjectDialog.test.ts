import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { AddRemoteProjectDialog } from "./AddRemoteProjectDialog";
import { remoteProjectFor, rememberRemoteProject } from "../model/remoteProjects";
import { remoteRequest } from "../model/connections";
import { isLocalProject, looksLikeProject } from "@/modules/harness/lib/recents";

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
    expect(markup).toContain("Sessions in this project run on that machine");
    expect(markup).toContain('class="absolute inset-0"');
    expect(markup).not.toContain("bg-black/30");
  });

  it("resolves and remembers remote project descriptors", async () => {
    vi.mocked(invoke).mockImplementation(async (command, input) => {
      if (command === "remote_machine_request") {
        const { method, params } = input as {
          method: string;
          params: { path?: string; cwd?: string };
        };
        if (method === "projects.browse") {
          return {
            path: "/home/me/code/app",
            parent: "/home/me/code",
            entries: [{ name: "src", path: "/home/me/code/app/src" }],
          };
        }
        if (method === "projects.open") {
          return { id: "host-proj-1", cwd: params.cwd, name: "app" };
        }
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const browseResult = await remoteRequest<{ path: string; entries: { name: string }[] }>(
      "machine-1",
      "projects.browse",
      { path: "/home/me/code/app" },
    );
    expect(browseResult.path).toBe("/home/me/code/app");
    expect(browseResult.entries).toHaveLength(1);

    const openResult = await remoteRequest<{ id: string; cwd: string; name: string }>(
      "machine-1",
      "projects.open",
      { cwd: "/home/me/code/app" },
    );
    expect(openResult.id).toBe("host-proj-1");

    const project = rememberRemoteProject("env-1", openResult);
    expect(project.key).toBe("remote://env-1/home/me/code/app");
    expect(remoteProjectFor(project.key)).toEqual({
      key: "remote://env-1/home/me/code/app",
      environmentId: "env-1",
      projectId: "host-proj-1",
      cwd: "/home/me/code/app",
    });

    // Remote projects look like valid project keys but never local paths
    expect(looksLikeProject(project.key)).toBe(true);
    expect(isLocalProject(project.key)).toBe(false);
  });
});
