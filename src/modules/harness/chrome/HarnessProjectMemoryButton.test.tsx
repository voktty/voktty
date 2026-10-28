// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { HarnessProjectMemoryButton } from "@/modules/harness/chrome/HarnessProjectMemoryButton";
import { HarnessProjectOwner } from "@/modules/harness/hooks/useHarnessProjectSelection";
import { publishActiveSurface } from "@/modules/surfaces/lib/activeSurfaceStore";
import type { MemoryPanelTarget } from "@/modules/workspace-kit/lib/memoryPanel";
import { asTabKey } from "@/modules/tabs/lib/tabIdentity";

const { captured } = vi.hoisted(() => ({
  captured: { target: null as MemoryPanelTarget | null },
}));
vi.mock("@/modules/workspace-kit/components/ProjectMemoryButton", () => ({
  ProjectMemoryButton: ({ target }: { target: MemoryPanelTarget | null }) => {
    captured.target = target;
    return null;
  },
}));
vi.mock("@/modules/harness/lib/harnessEnvStore", () => ({
  useHarnessProjectEnvStore: (select: (state: unknown) => unknown) =>
    select({}),
  harnessProjectEnvironmentFor: () => ({
    env: { kind: "local" },
    connecting: false,
    error: null,
  }),
}));
afterEach(() => {
  publishActiveSurface(null);
  vi.unstubAllGlobals();
});

it("uses its own active Harness folder and withdraws the target when another view becomes active", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const render = () => (
    <HarnessProjectOwner
      value={{ ownerId: 20, tabKey: asTabKey("harness-key") }}
    >
      <HarnessProjectMemoryButton cwd="/harness" />
    </HarnessProjectOwner>
  );
  publishActiveSurface({
    kind: "harness",
    ownerId: 20,
    projectCwd: "/harness",
    focusFolder: "/harness/subfolder",
  });
  await act(async () => root.render(render()));
  expect(captured.target).toEqual({
    path: "/harness/subfolder",
    environment: { kind: "local" },
    source: "harness:20:harness-key",
  });
  await act(async () =>
    publishActiveSurface({
      kind: "terminal",
      ownerId: 2,
      cwd: "/other-terminal",
    }),
  );
  expect(captured.target).toBeNull();
  await act(async () =>
    publishActiveSurface({
      kind: "harness",
      ownerId: 30,
      projectCwd: "/other-view",
      focusFolder: "/other-view/sub",
    }),
  );
  expect(captured.target).toBeNull();
  await act(async () =>
    publishActiveSurface({
      kind: "harness",
      ownerId: 999,
      projectCwd: "/harness",
      focusFolder: "/harness/foreign",
    }),
  );
  await act(async () =>
    root.render(<HarnessProjectMemoryButton cwd="/harness" />),
  );
  expect(captured.target?.path).toBe("/harness");
  await act(async () => root.unmount());
  node.remove();
});
