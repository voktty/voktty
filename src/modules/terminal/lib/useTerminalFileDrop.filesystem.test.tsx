// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import {
  createTerminalPathDropTarget,
  useTerminalFileDrop,
} from "@/modules/terminal/lib/useTerminalFileDrop";
import {
  PATH_OPENING_EVENT,
  readPathOpeningRequest,
  type PathOpeningRequest,
} from "@/modules/surfaces/lib/pathOpeningRequest";
import { LOCAL_WORKSPACE, useWorkspaceEnvStore } from "@/modules/workspace";
import {
  FILE_ATTACHMENT_EVENT,
  takeFileAttachmentRequest,
} from "@/modules/ai/lib/fileAttachmentRequest";

const mocks = vi.hoisted(() => ({ listen: vi.fn(), paste: vi.fn() }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: mocks.listen }),
}));
vi.mock("@/modules/terminal/lib/rendererPool", () => ({
  pasteIntoLeaf: mocks.paste,
}));

it.each(["target", "native"])(
  "keeps %s OS drops local while the selected workspace is WSL",
  async (source) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const previous = useWorkspaceEnvStore.getState().env;
    useWorkspaceEnvStore.setState({ env: { kind: "wsl", distro: "Ubuntu" } });
    const received: PathOpeningRequest[] = [];
    const receive = (event: Event) => {
      const request = readPathOpeningRequest((event as CustomEvent).detail);
      if (request) received.push(request);
    };
    window.addEventListener(PATH_OPENING_EVENT, receive);
    const node = document.createElement("div");
    document.body.append(node);
    const root = createRoot(node);
    try {
      if (source === "target") {
        const target = createTerminalPathDropTarget({
          leafIdAtPoint: () => null,
          paste: vi.fn(),
          setTarget: vi.fn(),
          isAiChatAtPoint: () => false,
          isExplorerAtPoint: () => false,
        });
        expect(target.dropPath("/native/file.ts", 0, 0)).toBe(true);
      } else {
        mocks.listen.mockResolvedValue(() => {});
        vi.spyOn(document, "elementFromPoint").mockReturnValue(null);
        function Probe() {
          useTerminalFileDrop();
          return null;
        }
        await act(async () => root.render(<Probe />));
        mocks.listen.mock.calls[mocks.listen.mock.calls.length - 1][0]({
          payload: {
            type: "drop",
            paths: ["/native/file.ts"],
            position: { x: 0, y: 0 },
          },
        });
      }
      expect(received).toEqual([
        {
          path: "/native/file.ts",
          workspace: LOCAL_WORKSPACE,
          kind: "unknown",
        },
      ]);
    } finally {
      await act(async () => root.unmount());
      node.remove();
      window.removeEventListener(PATH_OPENING_EVENT, receive);
      useWorkspaceEnvStore.setState({ env: previous });
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  },
);

it.each(["target", "native", "explorer"])(
  "retains the %s attachment filesystem instead of the selected workspace",
  async (source) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const previous = useWorkspaceEnvStore.getState().env;
    useWorkspaceEnvStore.setState({
      env: { kind: "wsl", distro: "unrelated" },
    });
    const workspace = {
      kind: "ssh" as const,
      root: "/repo",
      sessionId: 9,
      connection: { id: "fixture", name: "Fixture", host: "a.test" },
    };
    const received: Array<ReturnType<typeof takeFileAttachmentRequest>> = [];
    const receive = (event: Event) =>
      received.push(takeFileAttachmentRequest((event as CustomEvent).detail));
    window.addEventListener(FILE_ATTACHMENT_EVENT, receive);
    const node = document.createElement("div");
    const root = createRoot(node);
    try {
      if (source !== "native") {
        const target = createTerminalPathDropTarget({
          leafIdAtPoint: () => null,
          paste: vi.fn(),
          setTarget: vi.fn(),
          isAiChatAtPoint: () => true,
        });
        if (source === "explorer")
          target.dropExplorerPath("/repo/file.ts", 0, 0, workspace);
        else target.dropPath("/repo/file.ts", 0, 0);
      } else {
        const chat = document.createElement("div");
        chat.setAttribute("data-ai-chat-drop", "");
        vi.spyOn(document, "elementFromPoint").mockReturnValue(chat);
        mocks.listen.mockResolvedValue(() => {});
        function Probe() {
          useTerminalFileDrop();
          return null;
        }
        await act(async () => root.render(<Probe />));
        mocks.listen.mock.calls[mocks.listen.mock.calls.length - 1][0]({
          payload: {
            type: "drop",
            paths: ["/repo/file.ts"],
            position: { x: 0, y: 0 },
          },
        });
      }
      expect(received).toEqual([
        expect.objectContaining({
          path: "/repo/file.ts",
          workspace: source === "explorer" ? workspace : LOCAL_WORKSPACE,
        }),
      ]);
    } finally {
      await act(async () => root.unmount());
      window.removeEventListener(FILE_ATTACHMENT_EVENT, receive);
      useWorkspaceEnvStore.setState({ env: previous });
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  },
);
