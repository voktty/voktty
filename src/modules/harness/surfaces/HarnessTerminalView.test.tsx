// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import { newTerminalFile } from "@/modules/harness/lib/layout";
import { HarnessTerminalOwner } from "@/modules/harness/hooks/harnessTerminalContext";
import { HarnessTerminalView } from "@/modules/harness/surfaces/HarnessTerminalView";
import { HarnessTerminalRecovery } from "@/modules/harness/hooks/useHarnessTerminalRecovery";
import { CanonicalTerminalCatalog } from "@/modules/terminal/CanonicalTerminalCatalog";
import {
  TerminalSurfaceProvider,
  useTerminalSurfaces,
} from "@/modules/terminal/TerminalSurface";

const legacy = vi.hoisted(() =>
  vi.fn((_props: { id: string; cwd: string; active: boolean }) => (
    <div data-legacy="" />
  )),
);
vi.mock("@/modules/harness/surfaces/TerminalView", () => ({
  TerminalView: legacy,
}));
const file = {
  ...newTerminalFile("/srv/app/src", "build"),
  canonicalTerminal: { tabKey: asTabKey("tab-shell"), projectCwd: "/srv/app" },
};
let container: HTMLDivElement;
let root: Root;
let entries: ReturnType<typeof useTerminalSurfaces>["entries"];
function Probe() {
  entries = useTerminalSurfaces().entries;
  return null;
}
function Host({
  ownerVisible = true,
  visible = true,
  active = true,
  owner = true,
  layoutKey = 0,
  ownerLayoutKey = "standalone",
  onOwnerFocus = () => {},
  onPaneFocus = () => {},
}) {
  const surface = (
    <HarnessTerminalView
      file={file}
      visible={visible}
      active={active}
      layoutKey={layoutKey}
      onFocus={onPaneFocus}
    />
  );
  return (
    <TerminalSurfaceProvider>
      <Probe />
      {owner ? (
        <HarnessTerminalOwner
          value={{
            tabKey: asTabKey("tab-owner"),
            visible: ownerVisible,
            layoutKey: ownerLayoutKey,
            onFocus: onOwnerFocus,
          }}
        >
          {surface}
        </HarnessTerminalOwner>
      ) : (
        surface
      )}
    </TerminalSurfaceProvider>
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  legacy.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
it("registers a stable canonical slot without mounting the legacy PTY renderer", async () => {
  await act(async () => root.render(<Host />));
  expect(legacy).not.toHaveBeenCalled();
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    tabKey: "tab-shell",
    ownerTabKey: "tab-owner",
    projectCwd: "/srv/app",
    focused: true,
  });
  expect(
    container.querySelector("[data-terminal-surface='tab-shell']"),
  ).not.toBeNull();
});
it("withdraws hidden surfaces and retains canonical identity across focus and layout changes", async () => {
  await act(async () => root.render(<Host />));
  const identity = entries[0].identity;
  await act(async () => root.render(<Host active={false} layoutKey={1} />));
  expect(entries[0]).toMatchObject({
    identity,
    focused: false,
    layoutKey: "standalone:1",
  });
  await act(async () =>
    root.render(
      <Host active={false} layoutKey={1} ownerLayoutKey="0.5:0:0.5:1" />,
    ),
  );
  expect(entries[0]).toMatchObject({ identity, layoutKey: "0.5:0:0.5:1:1" });
  await act(async () => root.render(<Host ownerVisible={false} />));
  expect(entries).toHaveLength(0);
  await act(async () => root.render(<Host visible={false} />));
  expect(entries).toHaveLength(0);
  expect(legacy).not.toHaveBeenCalled();
});
it("does not fall back to a legacy PTY without an owning workbench", async () => {
  await act(async () => root.render(<Host owner={false} />));
  expect(entries).toHaveLength(0);
  expect(container.children).toHaveLength(0);
  expect(legacy).not.toHaveBeenCalled();
});
it("focuses the current outer owner before the pane without retaining old callbacks", async () => {
  const oldOwner = vi.fn();
  const calls: string[] = [];
  await act(async () => root.render(<Host onOwnerFocus={oldOwner} />));
  await act(async () =>
    root.render(
      <Host
        onOwnerFocus={() => {
          calls.push("owner");
        }}
        onPaneFocus={() => {
          calls.push("pane");
        }}
      />,
    ),
  );
  await act(async () => entries[0].onFocus?.());
  expect(oldOwner).not.toHaveBeenCalled();
  expect(calls).toEqual(["owner", "pane"]);
});
it("releases exact registrations through StrictMode replay and owner removal", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Host />
      </StrictMode>,
    ),
  );
  expect(entries).toHaveLength(1);
  const old = entries[0];
  await act(async () =>
    root.render(
      <StrictMode>
        <Host owner={false} />
      </StrictMode>,
    ),
  );
  expect(old.isCurrent()).toBe(false);
  expect(entries).toHaveLength(0);
  expect(legacy).not.toHaveBeenCalled();
});
it("preserves the existing legacy renderer for unmigrated terminal files", async () => {
  const { canonicalTerminal: _reference, ...unmigrated } = file;
  await act(async () =>
    root.render(<HarnessTerminalView file={unmigrated} visible active />),
  );
  expect(legacy).toHaveBeenCalled();
  expect(container.querySelector("[data-legacy]")).not.toBeNull();
  expect(legacy.mock.calls[0]?.[0]).toMatchObject({
    id: file.id,
    cwd: file.cwd,
    active: true,
  });
});

it("offers explicit recovery for an absent reference without creating on mount or double click", async () => {
  let current: () => boolean = () => false;
  let finish = () => {};
  const recover = vi.fn(
    (_file, _slot, isCurrent: () => boolean, settled: () => void) => {
      current = isCurrent;
      finish = settled;
      return true;
    },
  );
  const render = (visible = true) => (
    <TerminalSurfaceProvider>
      <CanonicalTerminalCatalog tabs={[]}>
        <HarnessTerminalOwner
          value={{ tabKey: asTabKey("tab-owner"), visible: true }}
        >
          <HarnessTerminalRecovery value={recover}>
            <HarnessTerminalView
              file={file}
              visible={visible}
              active
              slotKey="pane:p"
            />
          </HarnessTerminalRecovery>
        </HarnessTerminalOwner>
      </CanonicalTerminalCatalog>
    </TerminalSurfaceProvider>
  );
  await act(async () => root.render(render()));
  expect(recover).not.toHaveBeenCalled();
  expect(legacy).not.toHaveBeenCalled();
  const button = container.querySelector("button");
  expect(button).not.toBeNull();
  await act(async () => {
    button?.click();
    button?.click();
  });
  expect(recover).toHaveBeenCalledOnce();
  expect(current()).toBe(true);
  expect(button?.disabled).toBe(true);
  await act(async () => finish());
  expect(button?.disabled).toBe(false);
  await act(async () => button?.click());
  expect(recover).toHaveBeenCalledTimes(2);
  await act(async () => root.render(render(false)));
  expect(current()).toBe(false);
  await act(async () => finish());
  await act(async () => root.render(render()));
  expect(container.querySelector("button")?.disabled).toBe(false);
  expect(current()).toBe(false);
});
