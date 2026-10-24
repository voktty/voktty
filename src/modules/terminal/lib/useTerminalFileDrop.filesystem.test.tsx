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
