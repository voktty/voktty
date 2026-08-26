import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  get: vi.fn(async (_key: string) => [] as unknown[]),
  set: vi.fn(async (_key: string, _value: unknown) => undefined),
  save: vi.fn(async () => undefined),
  invoke: vi.fn(async (command: string) => {
    if (command === "mcp_list_servers") return [];
    return undefined;
  }),
  migrate: vi.fn(async () => undefined),
  openUrl: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    get(key: string) {
      return mocks.get(key);
    }

    set(key: string, value: unknown) {
      return mocks.set(key, value);
    }

    save() {
      return mocks.save();
    }
  },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@/lib/storageMigration", () => ({ ensureStorageMigrated: mocks.migrate }));

import { useMcpStore } from "./store";

describe("MCP store activation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMcpStore.setState({
      configs: [],
      views: {},
      credentials: {},
      busyIds: [],
      initialized: false,
      loading: false,
      errorKind: null,
    });
  });

  it("does not load configuration, invoke native commands, or open URLs on import", () => {
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.openUrl).not.toHaveBeenCalled();
  });

  it("keeps an empty configuration free of connections and authorization work", async () => {
    await useMcpStore.getState().init();

    expect(mocks.get).toHaveBeenCalledWith("servers");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenCalledWith("mcp_list_servers");
    expect(mocks.openUrl).not.toHaveBeenCalled();
    expect(useMcpStore.getState().configs).toEqual([]);
    expect(useMcpStore.getState().views).toEqual({});
  });
});
