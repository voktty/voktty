// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { commandSurfaceUnavailableReason } from "@/modules/shortcuts/lib/commandSurface";
import { useGlobalShortcuts } from "@/modules/shortcuts/lib/useGlobalShortcuts";
import { publishActiveSurface } from "@/modules/surfaces/lib/activeSurfaceStore";
import { resolveActiveSurface } from "@/modules/surfaces/lib/activeSurface";
import {
  captureSurfaceCommand,
  surfaceCommandReason,
} from "@/modules/command-palette/lib/surfaceCommand";

vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: (select: (state: { shortcuts: object }) => unknown) =>
    select({ shortcuts: {} }),
}));
afterEach(() => {
  publishActiveSurface(null);
  vi.unstubAllGlobals();
});
it("refuses namespace format commands without disabling other editor actions", () => {
  const surface = resolveActiveSurface({
    kind: "editor",
    ownerId: 1,
    folder: "remote://machine/project",
  });
  expect(
    commandSurfaceUnavailableReason("editor.formatDocument", surface),
  ).toBe("format-filesystem-unsupported");
  expect(commandSurfaceUnavailableReason("editor.find", surface)).toBeNull();
  expect(
    surfaceCommandReason(
      { id: "editor.formatDocument", run: vi.fn() },
      surface,
    ),
  ).toBe("git.unsupportedFilesystem");
});
it("refuses forced captured format execution for an SSH editor", () => {
  const run = vi.fn();
  const surface = resolveActiveSurface({
    kind: "editor",
    ownerId: 1,
    folder: "/project",
    workspaceEnv: {
      kind: "ssh",
      root: "/project",
      sessionId: 7,
      connection: { id: "fixture", name: "Fixture", host: "host-a" },
    },
  });
  expect(
    captureSurfaceCommand({ id: "editor.formatDocument", run }, () => surface),
  ).toBeNull();
  expect(run).not.toHaveBeenCalled();
});
it("preserves kind-only compatibility when filesystem metadata is absent", () => {
  expect(
    commandSurfaceUnavailableReason("editor.formatDocument", {
      kind: "editor",
    }),
  ).toBeNull();
});
it("checks current formatting filesystem at every key without consuming unavailable input", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const run = vi.fn();
  function Listener() {
    useGlobalShortcuts({ "editor.formatDocument": run });
    return null;
  }
  const key = () => {
    const event = new KeyboardEvent("keydown", {
      key: "f",
      altKey: true,
      shiftKey: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    return event;
  };
  try {
    await act(async () => root.render(<Listener />));
    publishActiveSurface({
      kind: "editor",
      ownerId: 1,
      folder: "remote://machine/project",
    });
    expect(key().defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
    publishActiveSurface({ kind: "editor", ownerId: 2, folder: "/project" });
    expect(key().defaultPrevented).toBe(true);
    expect(run).toHaveBeenCalledOnce();
    publishActiveSurface({
      kind: "editor",
      ownerId: 1,
      folder: "remote://machine/project",
    });
    expect(key().defaultPrevented).toBe(false);
    expect(run).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
  }
});
