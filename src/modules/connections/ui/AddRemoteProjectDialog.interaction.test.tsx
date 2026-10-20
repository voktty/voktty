// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sshConnections: [] as Array<Record<string, unknown>>,
  openRemoteWorkspace: vi.fn(),
  closeRemoteWorkspace: vi.fn(),
  requestRemoteResult: vi.fn(),
}));

vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        "common.cancel": "Cancel",
        "common.open": "Open",
        "harness.connections.browseFolders": "Browse folders",
        "harness.connections.connecting": "Connecting over SSH…",
        "harness.connections.dialogDescription":
          "Enter its remote folder path to open it directly.",
        "harness.connections.dialogTitle": "Open a remote project",
        "harness.connections.directPathHint": "Use an absolute remote path.",
        "harness.connections.folderPath": "Remote project folder",
        "harness.connections.hideFolderBrowser": "Hide folder browser",
        "harness.connections.loadingFolders": "Loading remote folders…",
        "harness.connections.onProfile": "On",
        "harness.connections.opening": "Opening…",
        "harness.connections.pathErrors.absolute":
          "Enter an absolute path beginning with /.",
        "harness.connections.pathErrors.control": "Invalid path characters.",
        "harness.connections.pathErrors.required": "Enter a folder path.",
        "harness.connections.pathPlaceholder": "/srv/workspace/project",
      })[key] ?? key,
  }),
}));

vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: (selector: (state: { hydrated: boolean }) => unknown) =>
    selector({ hydrated: true }),
}));

vi.mock("@/modules/ssh/sshStore", () => ({
  useSshConnections: () => mocks.sshConnections,
}));

vi.mock("@/modules/remote/client", () => ({
  closeRemoteWorkspace: mocks.closeRemoteWorkspace,
  openRemoteWorkspace: mocks.openRemoteWorkspace,
  requestRemoteResult: mocks.requestRemoteResult,
}));

vi.mock("@/modules/harness/chrome/SearchableSelect", () => ({
  SearchableSelect: () => null,
}));

vi.mock("@/modules/harness/chrome/icons", () => ({
  ChevronRight: () => null,
  Folder: () => null,
}));

vi.mock("@/modules/harness/lib/layers", () => ({ LAYER: { dialog: 1000 } }));

import { remoteSessions } from "@/modules/remote/sessionManager";
import { AddRemoteProjectDialog } from "./AddRemoteProjectDialog";

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await remoteSessions.closeAll();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  window.localStorage.clear();
  mocks.sshConnections = [
    {
      id: "profile-1",
      name: "Build host",
      user: "dev",
      host: "build-host",
      port: 22,
      initialDirectory: "/srv/workspace/app",
    },
  ];
  mocks.openRemoteWorkspace.mockReset().mockResolvedValue({
    session_id: 17,
    workspace_root: "/",
    architecture: "x86_64",
    helper_version: "1",
    capabilities: [],
  });
  mocks.closeRemoteWorkspace.mockReset();
  mocks.closeRemoteWorkspace.mockResolvedValue(undefined);
  mocks.requestRemoteResult.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

async function render(onOpen = vi.fn()) {
  await act(async () => {
    root.render(
      createElement(AddRemoteProjectDialog, {
        onCancel: vi.fn(),
        onOpen,
      }),
    );
  });
  return onOpen;
}

function dialogInput(): HTMLInputElement {
  const input = document.body.querySelector<HTMLInputElement>(
    'input[aria-label="Remote project folder"]',
  );
  if (!input) throw new Error("Missing remote project path input");
  return input;
}

function dialogButton(label: string): HTMLButtonElement {
  const button = Array.from(document.body.querySelectorAll("button")).find(
    (item) => item.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Missing ${label} button`);
  return button;
}

async function setDialogInputValue(value: string) {
  const input = dialogInput();
  const setInputValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (!setInputValue) throw new Error("Missing input value setter");

  await act(async () => {
    setInputValue.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("AddRemoteProjectDialog remote flow", () => {
  it("checks that the saved profile folder exists before registering it", async () => {
    mocks.requestRemoteResult.mockResolvedValue({ kind: "dir" });
    const onOpen = await render();

    expect(dialogInput().value).toBe("/srv/workspace/app");
    expect(mocks.openRemoteWorkspace).not.toHaveBeenCalled();

    await act(async () => dialogButton("Open").click());

    expect(mocks.openRemoteWorkspace.mock.calls[0]?.[1]).toBe("/");
    expect(mocks.requestRemoteResult).toHaveBeenCalledWith(17, "fs.stat", {
      path: "srv/workspace/app",
    });
    expect(onOpen).toHaveBeenCalledWith(
      "remote://voktty-ssh-profile-1/srv/workspace/app",
    );
  });

  it("does not register a folder that is missing or is not a folder", async () => {
    mocks.requestRemoteResult.mockRejectedValueOnce(
      new Error("path does not exist"),
    );
    const onOpen = await render();
    await act(async () => dialogButton("Open").click());
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "harness.connections.pathErrors.unavailable",
    );

    mocks.requestRemoteResult.mockResolvedValueOnce({ kind: "file" });
    await act(async () => dialogButton("Open").click());
    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "harness.connections.pathErrors.notDirectory",
    );
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("starts browsing from the root session at the path entered by the user", async () => {
    mocks.requestRemoteResult.mockResolvedValue({ entries: [] });
    await render();

    expect(mocks.openRemoteWorkspace).not.toHaveBeenCalled();
    await setDialogInputValue("/workspaces/");

    await act(async () => {
      dialogButton("Browse folders").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.openRemoteWorkspace).toHaveBeenCalledOnce();
    expect(mocks.openRemoteWorkspace.mock.calls[0]?.[1]).toBe("/");
    expect(mocks.requestRemoteResult).toHaveBeenCalledWith(17, "fs.readDir", {
      path: "workspaces",
      directoriesOnly: true,
    });
  });

  it("falls back to the nearest existing parent when the typed folder is missing", async () => {
    mocks.requestRemoteResult.mockImplementation(
      async (_id: number, _method: string, params: { path: string }) => {
        if (params.path === "workspaces/missing/deeper")
          throw new Error("no such directory");
        if (params.path === "workspaces/missing")
          throw new Error("no such directory");
        return { entries: [{ name: "app", kind: "directory" }] };
      },
    );
    await render();
    await setDialogInputValue("/workspaces/missing/deeper");

    await act(async () => {
      dialogButton("Browse folders").click();
      for (let index = 0; index < 8; index += 1) await Promise.resolve();
    });

    const paths = mocks.requestRemoteResult.mock.calls.map(
      (call) => (call[2] as { path: string }).path,
    );
    expect(paths).toEqual([
      "workspaces/missing/deeper",
      "workspaces/missing",
      "workspaces",
    ]);
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
  });

  it("reuses the root session when the path changes while the explorer is open", async () => {
    mocks.requestRemoteResult.mockResolvedValue({ entries: [] });
    await render();
    await setDialogInputValue("/workspaces");

    await act(async () => {
      dialogButton("Browse folders").click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await setDialogInputValue("/srv/project");

    await act(async () => {
      dialogButton("Browse folders").click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.openRemoteWorkspace).toHaveBeenCalledOnce();
    expect(mocks.closeRemoteWorkspace).not.toHaveBeenCalled();
    expect(mocks.requestRemoteResult).toHaveBeenLastCalledWith(
      17,
      "fs.readDir",
      { path: "srv/project", directoriesOnly: true },
    );
  });
  it("shows a validation message for a relative path", async () => {
    mocks.sshConnections[0] = {
      ...mocks.sshConnections[0],
      initialDirectory: undefined,
    };
    const onOpen = await render();
    await setDialogInputValue("workspace/app");
    await act(async () => dialogButton("Open").click());

    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "Enter an absolute path beginning with /.",
    );
    expect(onOpen).not.toHaveBeenCalled();
    expect(mocks.openRemoteWorkspace).not.toHaveBeenCalled();
  });

  it("rejects a relative browsing path before starting SSH", async () => {
    mocks.sshConnections[0] = {
      ...mocks.sshConnections[0],
      initialDirectory: undefined,
    };
    await render();
    await setDialogInputValue("workspaces/app");

    await act(async () => {
      dialogButton("Browse folders").click();
      await Promise.resolve();
    });

    expect(document.body.querySelector('[role="alert"]')?.textContent).toBe(
      "Enter an absolute path beginning with /.",
    );
    expect(mocks.openRemoteWorkspace).not.toHaveBeenCalled();
  });
});
