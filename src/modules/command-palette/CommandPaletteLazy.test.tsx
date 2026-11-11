// @vitest-environment happy-dom
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { CommandPalette } from "@/modules/command-palette/CommandPaletteLazy";

const lifecycle = vi.hoisted(() => ({
  loads: vi.fn(),
  mounts: vi.fn(),
  unmounts: vi.fn(),
}));
vi.mock("@/modules/command-palette/CommandPalette", () => {
  lifecycle.loads();
  return {
    CommandPalette: ({
      open,
      commandItems,
    }: {
      open: boolean;
      commandItems: { run: () => void }[];
    }) => {
      useEffect(() => {
        lifecycle.mounts();
        return () => {
          lifecycle.unmounts();
        };
      }, []);
      return open ? (
        <button type="button" onClick={commandItems[0].run}>
          Team
        </button>
      ) : null;
    },
  };
});

it("loads on first opening, forwards the team action and retains the mounted palette after closing", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  const root = createRoot(node);
  const run = vi.fn();
  const props = {
    onOpenChange: vi.fn(),
    commandItems: [
      { id: "teams.openBoard", title: "Team", group: "General" as const, run },
    ],
    workspaceRoot: null,
    onOpenContentHit: vi.fn(),
    insertCommand: null,
  };
  try {
    await act(async () =>
      root.render(<CommandPalette {...props} open={false} />),
    );
    expect(lifecycle.loads).not.toHaveBeenCalled();
    await act(async () => {
      root.render(<CommandPalette {...props} open />);
      await import("@/modules/command-palette/CommandPalette");
    });
    await act(async () => node.querySelector("button")?.click());
    expect(run).toHaveBeenCalledOnce();
    expect(lifecycle.mounts).toHaveBeenCalledOnce();
    await act(async () =>
      root.render(<CommandPalette {...props} open={false} />),
    );
    expect(node.querySelector("button")).toBeNull();
    expect(lifecycle.unmounts).not.toHaveBeenCalled();
    await act(async () => root.render(<CommandPalette {...props} open />));
    expect(lifecycle.mounts).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
