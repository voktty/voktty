// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DevServerPill } from "./DevServerPill";

const { kind, startServer } = vi.hoisted(() => ({
  kind: { current: null as string | null },
  startServer: vi.fn(),
}));
vi.mock("./lib/useWebProjectKind", () => ({
  useWebProjectKind: () => kind.current,
}));
vi.mock("./store/webServerStore", () => {
  const state = { servers: {}, startServer };
  const store = (select: (value: typeof state) => unknown) => select(state);
  store.getState = () => state;
  return { useWebServerStore: store };
});
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

let unmount: () => Promise<void>;

async function mount(projectRoot: string | null, onOpen = vi.fn()) {
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await act(async () =>
    root.render(
      <TooltipProvider>
        <DevServerPill
          leafId={3}
          cwd={projectRoot}
          projectRoot={projectRoot}
          onOpen={onOpen}
        />
      </TooltipProvider>,
    ),
  );
  unmount = async () => {
    await act(async () => root.unmount());
    node.remove();
  };
  return { onOpen, node };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  startServer.mockReset().mockResolvedValue({
    url: "http://127.0.0.1:4100",
    port: 4100,
    root_path: "/home/u/site",
    server_type: "php",
  });
  kind.current = null;
});
afterEach(async () => {
  await unmount();
  vi.unstubAllGlobals();
});

it("offers a project preview and opens it beside the active view", async () => {
  kind.current = "laravel";
  const { onOpen, node } = await mount("/home/u/site");
  expect(node.textContent).toContain("Laravel");
  await act(async () => node.querySelector("button")?.click());
  expect(startServer).toHaveBeenCalledWith("/home/u/site");
  expect(onOpen).toHaveBeenCalledWith(
    expect.objectContaining({
      url: "http://127.0.0.1:4100",
      scope: "integrated-4100",
      cwd: "/home/u/site",
    }),
  );
});

it("stays hidden when the folder is not a web project", async () => {
  const { node } = await mount("/home/u/notes");
  expect(node.querySelector("button")).toBeNull();
});

it("stays hidden for a project that is not on this computer", async () => {
  kind.current = "php";
  const { node } = await mount("remote://voktty-ssh-x/srv/app");
  expect(node.querySelector("button")).toBeNull();
});
