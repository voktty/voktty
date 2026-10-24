// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { useDesktopSurface, useSurfaceDirectoryNavigation } from "@/modules/surfaces/lib/useDesktopSurface";
import { publishActiveSurface, useActiveSurfaceStore } from "@/modules/surfaces/lib/activeSurfaceStore";

it("routes chrome navigation under the original mounted owner and retires cached callbacks", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const root = createRoot(document.createElement("div"));
  const project = vi.fn();
  const firstShell = vi.fn();
  const nextShell = vi.fn();
  let navigate: ((path: string) => void) | undefined;
  function Chrome({ ownerId, tabKind, send }: { ownerId: number; tabKind: string; send: (path: string) => void }) {
    useDesktopSurface({ ownerId, tabKind, cwd: "/shell", projectCwd: "remote://machine/project", focusFolder: "remote://machine/project/src" });
    navigate = useSurfaceDirectoryNavigation(ownerId, project, send);
    return null;
  }
  try {
    await act(async () => root.render(<StrictMode><Chrome ownerId={1} tabKind="harness" send={firstShell} /></StrictMode>));
    const oldProject = navigate;
    navigate?.("remote://machine/next");
    expect(project).toHaveBeenCalledExactlyOnceWith("remote://machine/next");
    expect(firstShell).not.toHaveBeenCalled();
    await act(async () => root.render(<StrictMode><Chrome ownerId={2} tabKind="terminal" send={firstShell} /></StrictMode>));
    oldProject?.("/stale");
    expect(project).toHaveBeenCalledOnce();
    const oldShell = navigate;
    navigate?.("/current");
    expect(firstShell).toHaveBeenCalledExactlyOnceWith("/current");
    await act(async () => root.render(<StrictMode><Chrome ownerId={2} tabKind="terminal" send={nextShell} /></StrictMode>));
    oldShell?.("/old-leaf");
    expect(firstShell).toHaveBeenCalledOnce();
    navigate?.("/next-leaf");
    expect(nextShell).toHaveBeenCalledExactlyOnceWith("/next-leaf");
    publishActiveSurface({ kind: "terminal", ownerId: 9, cwd: "/foreign" });
    navigate?.("/foreign-denied");
    expect(nextShell).toHaveBeenCalledOnce();
    await act(async () => root.render(<StrictMode><Chrome ownerId={2} tabKind="editor" send={nextShell} /></StrictMode>));
    expect(useActiveSurfaceStore.getState().surface.kind).toBe("editor");
    const departed = navigate;
    await act(async () => root.render(null));
    departed?.("/after-unmount");
    expect(project).toHaveBeenCalledOnce();
    expect(nextShell).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    publishActiveSurface(null);
    vi.unstubAllGlobals();
  }
});
