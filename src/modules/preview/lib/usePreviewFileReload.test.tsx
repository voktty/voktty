// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePreviewFileReload } from "@/modules/preview/lib/usePreviewFileReload";
import { useWebServerStore } from "@/modules/preview/store/webServerStore";
const io = vi.hoisted(() => ({ listen: vi.fn(), reload: vi.fn() }));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ listen: io.listen }),
}));
let root: Root;
let node: HTMLDivElement;
let listeners: Map<string, (event: { payload: unknown }) => void>;
const written = (
  path = "/work/file.ts",
  filesystem: object = { kind: "local" },
) => ({ payload: { path, filesystem, source: "editor" } });
function Reader({ url }: { url: string }) {
  usePreviewFileReload(url, true, io.reload);
  return null;
}
async function render(url = "http://127.0.0.1:8080/file.html") {
  await act(async () => root.render(<Reader url={url} />));
}
async function flush() {
  await act(async () => vi.advanceTimersByTime(120));
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  listeners = new Map();
  io.listen.mockImplementation(async (name, callback) => {
    listeners.set(name, callback);
    return () => {};
  });
  useWebServerStore.setState({
    servers: {
      "/work": {
        root_path: "/work",
        port: 8080,
        url: "http://127.0.0.1:8080",
        server_type: "static",
      },
    },
  });
  node = document.createElement("div");
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function emit(name: string, event: { payload: unknown }) {
  const callback = listeners.get(name);
  if (!callback) throw new Error("Missing preview listener");
  callback(event);
}
it("reloads only writes in the registered native server root", async () => {
  await render();
  emit(
    "fs:file-written",
    written("/work/file.ts", { kind: "wsl", distro: "first" }),
  );
  emit("fs:file-written", written("/work-other/file.ts"));
  emit("fs:file-written", { payload: { path: "/work/file.ts" } });
  await flush();
  expect(io.reload).not.toHaveBeenCalled();
  emit("fs:file-written", written());
  await flush();
  expect(io.reload).toHaveBeenCalledOnce();
});
it("does not reload an external site or an unregistered loopback server from file writes", async () => {
  for (const url of ["https://example.test", "http://localhost:9090"]) {
    await render(url);
    emit("fs:file-written", written());
    await flush();
  }
  expect(io.reload).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("voktty:reload-preview"));
  await flush();
  expect(io.reload).toHaveBeenCalledOnce();
});
it("preserves local watch reloads while ignoring SSH watch payloads", async () => {
  await render();
  emit("fs:changed", { payload: { paths: ["/work/file.ts"], sessionId: 7 } });
  await flush();
  expect(io.reload).not.toHaveBeenCalled();
  emit("fs:changed", { payload: { paths: ["/work/file.ts"] } });
  await flush();
  expect(io.reload).toHaveBeenCalledOnce();
});
it("retires scheduled reloads and cached callbacks across navigation", async () => {
  await render();
  const callback = listeners.get("fs:file-written");
  emit("fs:file-written", written());
  await render("https://example.test");
  callback?.(written());
  await flush();
  expect(io.reload).not.toHaveBeenCalled();
});
it("revalidates the exact server before firing a delayed reload", async () => {
  await render();
  emit("fs:file-written", written());
  useWebServerStore.setState({ servers: {} });
  await flush();
  expect(io.reload).not.toHaveBeenCalled();
});

it("matches a native server on the default HTTP port", async () => {
  useWebServerStore.setState({
    servers: {
      "/work": {
        root_path: "/work",
        port: 80,
        url: "http://127.0.0.1",
        server_type: "static",
      },
    },
  });
  await render("http://127.0.0.1/file.html");
  emit("fs:file-written", written());
  await flush();
  expect(io.reload).toHaveBeenCalledOnce();
});
