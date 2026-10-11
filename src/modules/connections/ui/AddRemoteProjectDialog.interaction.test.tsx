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

import { AddRemoteProjectDialog } from "./AddRemoteProjectDialog";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
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
  mocks.openRemoteWorkspace.mockReset();
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
  it("opens the saved profile path directly without starting a browse session", async () => {
    const onOpen = await render();

    expect(dialogInput().value).toBe("/srv/workspace/app");
    expect(mocks.openRemoteWorkspace).not.toHaveBeenCalled();

    await act(async () => dialogButton("Open").click());

    expect(onOpen).toHaveBeenCalledWith(
      "remote://voktty-ssh-profile-1/srv/workspace/app",
    );
    expect(mocks.openRemoteWorkspace).not.toHaveBeenCalled();
  });

  it("starts browsing at the absolute path entered by the user", async () => {
    mocks.openRemoteWorkspace.mockResolvedValue({
      session_id: 17,
      workspace_root: "/workspaces",
      architecture: "x86_64",
      helper_version: "1",
      capabilities: [],
    });
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
    expect(mocks.openRemoteWorkspace.mock.calls[0]?.[1]).toBe("/workspaces");
    expect(mocks.openRemoteWorkspace.mock.calls[0]?.[2]).toEqual({
      installShellIntegration: false,
    });
    expect(mocks.requestRemoteResult).toHaveBeenCalledWith(17, "fs.readDir", {
      path: ".",
      directoriesOnly: true,
    });
  });

  it("restarts browsing when the path changes while the explorer is open", async () => {
    mocks.openRemoteWorkspace
      .mockResolvedValueOnce({
        session_id: 17,
        workspace_root: "/workspaces",
        architecture: "x86_64",
        helper_version: "1",
        capabilities: [],
      })
      .mockResolvedValueOnce({
        session_id: 18,
        workspace_root: "/srv/project",
        architecture: "x86_64",
        helper_version: "1",
        capabilities: [],
      });
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

    expect(mocks.openRemoteWorkspace).toHaveBeenCalledTimes(2);
    expect(mocks.openRemoteWorkspace.mock.calls[1]?.[1]).toBe("/srv/project");
    expect(mocks.closeRemoteWorkspace).toHaveBeenCalledWith(17);
    expect(mocks.requestRemoteResult).toHaveBeenLastCalledWith(
      18,
      "fs.readDir",
      { path: ".", directoriesOnly: true },
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
