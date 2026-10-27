// @vitest-environment happy-dom
import {
  act,
  StrictMode,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useHarnessTerminalCreation } from "@/modules/harness/hooks/useHarnessTerminalCreation";
import {
  HarnessTerminalRecovery,
  useHarnessTerminalRecovery,
} from "@/modules/harness/hooks/useHarnessTerminalRecovery";
import { HarnessTerminalMigrationContext } from "@/modules/harness/hooks/harnessTerminalMigrationContext";
import { HarnessTerminalOwner } from "@/modules/harness/hooks/harnessTerminalContext";
import { HarnessTerminalView } from "@/modules/harness/surfaces/HarnessTerminalView";
import { createLegacyTerminalMigrations } from "@/modules/harness/lib/legacyTerminalMigrations";
import {
  createHarnessWindowViews,
  type HarnessWindowViewInput,
} from "@/modules/harness/lib/harnessWindowViews";
import {
  newTerminalFile,
  newTerminalWorkspaceTab,
  type WorkspaceTab,
} from "@/modules/harness/lib/layout";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";
import { createTabIdentity } from "@/modules/tabs/lib/tabIdentity";
import type { HarnessTab, Tab, TerminalTab } from "@/modules/tabs";
import type { WorkspacePlacement } from "@/modules/spaces/lib/spaceGeometry";
import { CanonicalTerminalCatalog } from "@/modules/terminal/CanonicalTerminalCatalog";
import { TerminalSurfaceProvider } from "@/modules/terminal/TerminalSurface";
import {
  claimProjectTerminalRequest,
  PROJECT_TERMINAL_REQUEST_EVENT,
} from "@/modules/terminal/lib/projectTerminalRequest";

const legacy = vi.hoisted(() => vi.fn(() => <div data-legacy="" />));
vi.mock("@xterm/xterm", () => ({
  Terminal: legacy,
}));
const project = "/srv/app";
let container: HTMLDivElement;
let root: Root;
let service: ReturnType<typeof createLegacyTerminalMigrations>;
let views: ReturnType<typeof createHarnessWindowViews>;
let layouts: Map<number, WorkspaceTab[]>;
let dockLayouts: Map<number, HarnessWindowViewInput["projectTerminals"]>;
let tickets: Array<NonNullable<ReturnType<typeof claimProjectTerminalRequest>>>;
let errors: ReturnType<typeof vi.fn<(error: unknown) => void>>;
let setDesktopTabs: Dispatch<SetStateAction<Tab[]>>;
const source = newTerminalFile("/srv/app/src", "Build");
const tab = newTerminalWorkspaceTab(source);
const outers: HarnessTab[] = [1, 2].map((id) => ({
  ...createTabIdentity("main", () => `owner-${id}`),
  id,
  spaceId: "main",
  kind: "harness",
  title: "Harness",
  cwd: project,
}));
const occupiedTabs: TerminalTab[] = Array.from({ length: 8 }, (_, index) => ({
  ...createTabIdentity("main", () => `occupied-${index}`),
  id: 300 + index,
  kind: "terminal",
  title: "shell",
  spaceId: "main",
  activeLeafId: 400 + index,
  paneTree: { kind: "leaf", id: 400 + index },
}));
function input(
  tabs: WorkspaceTab[],
  projectTerminals: HarnessWindowViewInput["projectTerminals"] = [],
): HarnessWindowViewInput {
  return {
    tabs,
    activeTabId: tab.id,
    projectCwd: project,
    projectTerminals,
    projectReturnMemory: new Map(),
    report: {
      referencedSessionIds: [],
      foregroundSessionIds: [],
      activeSessionId: null,
    },
  };
}
function Workbench({
  id,
  enabled,
  dock = false,
}: {
  id: number;
  enabled: boolean;
  dock?: boolean;
}) {
  const [tabs, setTabs] = useState([tab]);
  const [docks, setDocks] = useState<
    HarnessWindowViewInput["projectTerminals"]
  >(() =>
    dock
      ? [
          {
            projectPath: project,
            side: "right",
            size: 300,
            open: true,
            pane: {
              id: "legacy-dock",
              activeFileId: source.id,
              files: [source],
            },
          },
        ]
      : [],
  );
  layouts.set(id, tabs);
  dockLayouts.set(id, docks);
  const [admission] = useState(createPersistenceAdmission);
  const owner = useRef<ReturnType<typeof admission.createOwner> | null>(null);
  useLayoutEffect(() => {
    owner.current = admission.createOwner();
    return () => {
      owner.current?.retire();
      owner.current = null;
    };
  }, [admission]);
  const capturePermit = () => owner.current?.capture() ?? undefined;
  const creation = useHarnessTerminalCreation({
    projectCwd: project,
    focused: enabled,
    capture: capturePermit,
    projectAvailable: () => true,
    onError: errors,
  });
  const recover = useHarnessTerminalRecovery({
    ...input(tabs),
    docks,
    enabled,
    capture: capturePermit,
    open: creation.open,
    setTabs,
    setDocks,
  });
  const registered = useRef<ReturnType<typeof views.register> | null>(null);
  const initialTabs = useRef(input(tabs, docks));
  useLayoutEffect(() => {
    registered.current = views.register(id, initialTabs.current);
    return () => registered.current?.release();
  }, [id]);
  useLayoutEffect(
    () => registered.current?.update(input(tabs, docks)),
    [tabs, docks],
  );
  const file = dock
    ? docks[0].pane.files[0]
    : tabs[0].terminalPanes[0].files[0];
  return (
    <HarnessTerminalRecovery value={recover}>
      <HarnessTerminalView
        file={file}
        slotKey={dock ? `dock:${project}` : `pane:${tab.terminalPanes[0].id}`}
        visible
        active
      />
    </HarnessTerminalRecovery>
  );
}
function Desktop({
  enabled = true,
  sibling = false,
  manualFinish = false,
  dock = false,
  occupied = false,
}: {
  enabled?: boolean;
  sibling?: boolean;
  manualFinish?: boolean;
  dock?: boolean;
  occupied?: boolean;
}) {
  const [canonical, setCanonical] = useState<Tab[]>(outers);
  setDesktopTabs = setCanonical;
  useLayoutEffect(() => {
    const listener = (event: Event) => {
      const ticket = claimProjectTerminalRequest(
        event,
        outers[0].tabKey,
        project,
      );
      if (!ticket) return;
      tickets.push(ticket);
      const created: TerminalTab = {
        ...createTabIdentity("main", () => `converted-${tickets.length}`),
        id: 100 + tickets.length,
        kind: "terminal",
        spaceId: "main",
        title: ticket.title ?? "shell",
        cwd: ticket.cwd,
        projectCwd: project,
        paneTree: { kind: "leaf", id: 200 + tickets.length },
        activeLeafId: 200 + tickets.length,
      };
      flushSync(() => setCanonical((tabs) => [...tabs, created]));
      try {
        ticket.created({ tabKey: created.tabKey });
      } catch (error) {
        ticket.fail(error);
      }
      if (!manualFinish) ticket.finish();
    };
    window.addEventListener(PROJECT_TERMINAL_REQUEST_EVENT, listener);
    return () =>
      window.removeEventListener(PROJECT_TERMINAL_REQUEST_EVENT, listener);
  }, [manualFinish]);
  return (
    <TerminalSurfaceProvider>
      <CanonicalTerminalCatalog
        tabs={occupied ? [...canonical, ...occupiedTabs] : canonical}
        activeId={1}
        placements={
          occupied
            ? [outers[0], ...occupiedTabs].map((tab) => ({
                tabId: tab.id,
                slotId: "slot" as WorkspacePlacement["slotId"],
                rect: { x: 0, y: 0, width: 1, height: 1 },
                focused: tab.id === 1,
              }))
            : undefined
        }
      >
        <HarnessTerminalMigrationContext value={service}>
          <HarnessTerminalOwner
            value={{ tabKey: outers[0].tabKey, visible: true }}
          >
            <Workbench id={1} enabled={enabled} dock={dock} />
          </HarnessTerminalOwner>
          {sibling ? (
            <HarnessTerminalOwner
              value={{ tabKey: outers[1].tabKey, visible: true }}
            >
              <Workbench id={2} enabled={false} />
            </HarnessTerminalOwner>
          ) : null}
        </HarnessTerminalMigrationContext>
      </CanonicalTerminalCatalog>
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
  views = createHarnessWindowViews();
  service = createLegacyTerminalMigrations(views);
  layouts = new Map();
  dockLayouts = new Map();
  tickets = [];
  errors = vi.fn<(error: unknown) => void>();
  legacy.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  service.dispose();
  container.remove();
  vi.unstubAllGlobals();
});

it("migrates through the real creation channel once and updates a sibling without mounting legacy renderers", async () => {
  await act(async () => root.render(<Desktop sibling />));
  expect(tickets).toHaveLength(1);
  expect(tickets[0]).toMatchObject({
    cwd: source.cwd,
    title: "Build",
    projectCwd: project,
  });
  expect(errors).not.toHaveBeenCalled();
  const one = layouts.get(1)?.[0].terminalPanes[0].files[0];
  const two = layouts.get(2)?.[0].terminalPanes[0].files[0];
  expect(one).toMatchObject({
    id: source.id,
    cwd: source.cwd,
    path: "Build",
    canonicalTerminal: { tabKey: "tab-converted-1", projectCwd: project },
  });
  expect(two?.canonicalTerminal).toEqual(one?.canonicalTerminal);
  expect(legacy).not.toHaveBeenCalled();
  expect(
    views.capture([]).tabs[0].terminalPanes[0].files[0].canonicalTerminal,
  ).toEqual(one?.canonicalTerminal);
});

it("waits for actual request confirmation before changing any layout", async () => {
  await act(async () => root.render(<Desktop manualFinish />));
  expect(tickets).toHaveLength(1);
  expect(layouts.get(1)?.[0].terminalPanes[0].files[0]).toBe(source);
  expect(
    views.capture([]).tabs[0].terminalPanes[0].files[0].canonicalTerminal,
  ).toBeUndefined();
  await act(async () => tickets[0].finish());
  expect(
    layouts.get(1)?.[0].terminalPanes[0].files[0].canonicalTerminal?.tabKey,
  ).toBe("tab-converted-1");
});

it("does not publish a pending creation after its original view retires", async () => {
  await act(async () => root.render(<Desktop manualFinish />));
  expect(tickets).toHaveLength(1);
  await act(async () => root.render(<Desktop enabled={false} />));
  await act(async () => tickets[0].finish());
  expect(tickets).toHaveLength(1);
  expect(layouts.get(1)?.[0].terminalPanes[0].files[0]).toBe(source);
});

it("survives StrictMode without duplicate canonical creation", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Desktop />
      </StrictMode>,
    ),
  );
  expect(tickets).toHaveLength(1);
  expect(
    layouts.get(1)?.[0].terminalPanes[0].files[0].canonicalTerminal,
  ).toBeDefined();
  expect(legacy).not.toHaveBeenCalled();
});

it("keeps failed request confirmation out of the shared layout and allows a retry", async () => {
  await act(async () => root.render(<Desktop manualFinish />));
  await act(async () => {
    tickets[0].fail(new Error("native creation failed"));
    flushSync(() => setDesktopTabs(outers));
    tickets[0].finish();
  });
  expect(layouts.get(1)?.[0].terminalPanes[0].files[0]).toBe(source);
  expect(
    views.capture([]).tabs[0].terminalPanes[0].files[0].canonicalTerminal,
  ).toBeUndefined();
  await act(async () =>
    container.querySelector<HTMLButtonElement>("button")?.click(),
  );
  expect(tickets).toHaveLength(2);
  await act(async () => tickets[1].finish());
  expect(
    layouts.get(1)?.[0].terminalPanes[0].files[0].canonicalTerminal?.tabKey,
  ).toBe("tab-converted-2");
});

it("recovers a missing converted reference across siblings without restoring the previous mapping", async () => {
  await act(async () => root.render(<Desktop sibling />));
  await act(async () => setDesktopTabs(outers));
  await act(async () =>
    container.querySelector<HTMLButtonElement>("button")?.click(),
  );
  expect(tickets).toHaveLength(2);
  expect(errors).not.toHaveBeenCalled();
  for (const tabs of layouts.values())
    expect(tabs[0].terminalPanes[0].files[0].canonicalTerminal?.tabKey).toBe(
      "tab-converted-2",
    );
});

it("migrates a project dock through the same channel while preserving its geometry and selection", async () => {
  await act(async () => root.render(<Desktop dock />));
  expect(tickets).toHaveLength(1);
  const dock = dockLayouts.get(1)?.[0];
  expect(dock).toMatchObject({
    side: "right",
    size: 300,
    open: true,
    pane: { id: "legacy-dock", activeFileId: source.id },
  });
  expect(dock?.pane.files[0]).toMatchObject({
    id: source.id,
    cwd: source.cwd,
    path: source.path,
    canonicalTerminal: { tabKey: "tab-converted-1", projectCwd: project },
  });
  expect(
    views.capture([]).projectTerminals[0].pane.files[0].canonicalTerminal,
  ).toEqual(dock?.pane.files[0].canonicalTerminal);
  expect(legacy).not.toHaveBeenCalled();
});

it("reuses an accepted result under a fresh slot reservation after the original presentation retires", async () => {
  await act(async () => root.render(<Desktop manualFinish />));
  expect(tickets).toHaveLength(1);
  await act(async () => {
    tickets[0].finish();
    flushSync(() => root.render(<Desktop enabled={false} />));
  });
  expect(layouts.get(1)?.[0].terminalPanes[0].files[0]).toBe(source);
  await act(async () => root.render(<Desktop />));
  await act(async () =>
    container.querySelector<HTMLButtonElement>("button")?.click(),
  );
  expect(tickets).toHaveLength(1);
  expect(
    layouts.get(1)?.[0].terminalPanes[0].files[0].canonicalTerminal?.tabKey,
  ).toBe("tab-converted-1");
});

it("does not bypass the eight-leaf budget when adopting a cached accepted result", async () => {
  await act(async () => root.render(<Desktop manualFinish />));
  await act(async () => {
    tickets[0].finish();
    flushSync(() => root.render(<Desktop enabled={false} occupied />));
  });
  await act(async () => root.render(<Desktop occupied />));
  await act(async () =>
    container.querySelector<HTMLButtonElement>("button")?.click(),
  );
  expect(layouts.get(1)?.[0].terminalPanes[0].files[0]).toBe(source);
  expect(tickets).toHaveLength(1);
  await act(async () => root.render(<Desktop />));
  await act(async () =>
    container.querySelector<HTMLButtonElement>("button")?.click(),
  );
  expect(
    layouts.get(1)?.[0].terminalPanes[0].files[0].canonicalTerminal?.tabKey,
  ).toBe("tab-converted-1");
  expect(tickets).toHaveLength(1);
});
