// @vitest-environment happy-dom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  disposeSession,
  getLiveLeafCwd,
  respawnSession,
  useTerminalSession,
  waitForLeafConnection,
} from "@/modules/terminal/lib/useTerminalSession";
import type { WorkspaceEnv } from "@/modules/workspace";

const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  cwd: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/modules/terminal/lib/rendererPool");
vi.mock("@/modules/terminal/lib/useTerminalFont", () => ({
  useTerminalFont: () => ({
    fontFamily: "monospace",
    fontWeight: "400",
    fontSize: 14,
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@/modules/terminal/lib/pty-bridge", () => ({
  openPty: mocks.open,
  getRemotePtyCwd: mocks.cwd,
  disposePtyTarget: vi.fn(),
  isGuestPtyTarget: () => false,
}));
const workspace: WorkspaceEnv = {
  kind: "ssh",
  root: "/srv/app",
  sessionId: 7,
  connection: { id: "build", name: "Build", host: "build.example" },
};
let root: Root;
let container: HTMLDivElement;
function Leaf() {
  const node = useRef<HTMLDivElement>(null);
  useTerminalSession({
    leafId: 1,
    container: node,
    visible: false,
    initialCwd: "/srv/app",
    workspaceEnv: workspace,
  });
  return <div ref={node} />;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  vi.useFakeTimers();
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });
  mocks.cwd.mockResolvedValue("/srv/app/src");
  mocks.open.mockResolvedValue({
    id: 91,
    workspace: { ...workspace, sessionId: 8 },
    close: mocks.close,
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    disposeSession(1);
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("uses the resolved helper for cwd reads and the next connection instead of the inherited native ID", async () => {
  await act(async () => root.render(<Leaf />));
  await waitForLeafConnection(1);
  expect(await getLiveLeafCwd(1)).toBe("/srv/app/src");
  expect(mocks.cwd).toHaveBeenLastCalledWith(8, 91);
  mocks.open.mockResolvedValueOnce({
    id: 92,
    workspace: { ...workspace, sessionId: 9 },
    close: mocks.close,
    write: vi.fn().mockResolvedValue(undefined),
    resize: vi.fn().mockResolvedValue(undefined),
  });
  await act(async () => respawnSession(1));
  expect(mocks.open.mock.lastCall?.[7]).toMatchObject({
    kind: "ssh",
    sessionId: 8,
  });
  await getLiveLeafCwd(1);
  expect(mocks.cwd).toHaveBeenLastCalledWith(9, 92);
});
