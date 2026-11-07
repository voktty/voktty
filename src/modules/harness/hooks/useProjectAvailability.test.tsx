// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePreferencesStore } from "@/modules/settings/preferences";
import {
  useProjectAvailability,
  type ProjectAvailability,
} from "./useProjectAvailability";

const { invokeMock, pingMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  pingMock: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@/modules/ssh/types", () => ({ pingSshHost: pingMock }));

const remote = "remote://voktty-ssh-prod/home/app";
let latest: ProjectAvailability;

function Probe({ paths }: { paths: string[] }) {
  latest = useProjectAvailability(paths);
  return null;
}

async function mount(paths: string[]) {
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  await act(async () => root.render(<Probe paths={paths} />));
  return async () => {
    await act(async () => root.unmount());
    node.remove();
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  invokeMock.mockReset();
  pingMock.mockReset();
  usePreferencesStore.setState({
    sshConnections: [{ id: "prod", name: "Prod", host: "host.test", port: 22 }],
  } as never);
});
afterEach(() => vi.unstubAllGlobals());

it("marks a missing local directory and a path that is only a file", async () => {
  invokeMock.mockResolvedValue([
    { path: "/work/ok", isDir: true },
    { path: "/work/file.txt", isDir: false },
  ]);
  const unmount = await mount(["/work/ok", "/work/file.txt", "/work/gone"]);
  expect(latest.unavailableReasons.get("/work/ok")).toBeUndefined();
  expect(latest.unavailableReasons.get("/work/file.txt")).toBe("missing-directory");
  expect(latest.unavailableReasons.get("/work/gone")).toBe("missing-directory");
  await unmount();
});

it("marks an unreachable SSH host and recovers when it answers again", async () => {
  pingMock.mockResolvedValue({ online: false });
  const unmount = await mount([remote]);
  expect(latest.unavailableReasons.get(remote)).toBe("host-unreachable");
  pingMock.mockResolvedValue({ online: true });
  await act(async () => {
    await latest.recheckPath(remote);
  });
  expect(latest.unavailablePaths.has(remote)).toBe(false);
  await unmount();
});

it("marks a remote project whose saved connection was deleted", async () => {
  usePreferencesStore.setState({ sshConnections: [] } as never);
  const unmount = await mount([remote]);
  expect(latest.unavailableReasons.get(remote)).toBe("profile-missing");
  expect(pingMock).not.toHaveBeenCalled();
  await unmount();
});
