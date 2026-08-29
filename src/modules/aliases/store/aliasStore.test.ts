import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAliasStore } from "./aliasStore";
import type { AliasesStateDto } from "../types";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";

const mockInvoke = vi.mocked(invoke);

const dummyState: AliasesStateDto = {
  configPath: "/test/aliases.json",
  effective: [
    {
      name: "ipme",
      source: "preinstalled",
      definition: {
        description: "Get public IP",
        enabled: true,
        disabledWorkspaces: [],
        disabledProfiles: [],
        target: { kind: "builtin", action: "ipme" },
      },
    },
    {
      name: "custom-cmd",
      source: "user",
      definition: {
        description: "Custom tool",
        enabled: false,
        disabledWorkspaces: [],
        disabledProfiles: [],
        target: { kind: "command", executable: "node", args: ["test.js"] },
      },
    },
  ],
  user: {
    aliases: {
      "custom-cmd": {
        description: "Custom tool",
        enabled: false,
        disabledWorkspaces: [],
        disabledProfiles: [],
        target: { kind: "command", executable: "node", args: ["test.js"] },
      },
    },
  },
  preinstalled: {
    aliases: {
      ipme: {
        description: "Get public IP",
        enabled: true,
        disabledWorkspaces: [],
        disabledProfiles: [],
        target: { kind: "builtin", action: "ipme" },
      },
    },
  },
};

describe("aliasStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAliasStore.setState({
      effective: [],
      configPath: "",
      isLoading: false,
      error: null,
      searchQuery: "",
      filter: "all",
    });
  });

  it("fetches state and populates effective aliases", async () => {
    mockInvoke.mockResolvedValueOnce(dummyState);

    await useAliasStore.getState().fetchAliases();

    expect(mockInvoke).toHaveBeenCalledWith("aliases_get_state");
    expect(useAliasStore.getState().effective).toHaveLength(2);
    expect(useAliasStore.getState().configPath).toBe("/test/aliases.json");
    expect(useAliasStore.getState().isLoading).toBe(false);
  });

  it("updates search query and filter", () => {
    useAliasStore.getState().setSearchQuery("ip");
    expect(useAliasStore.getState().searchQuery).toBe("ip");

    useAliasStore.getState().setFilter("factory");
    expect(useAliasStore.getState().filter).toBe("factory");
  });

  it("toggles alias with optimistic update", async () => {
    useAliasStore.setState({ effective: dummyState.effective });

    const toggledState: AliasesStateDto = {
      ...dummyState,
      effective: [
        {
          ...dummyState.effective[0],
          definition: { ...dummyState.effective[0].definition, enabled: false },
        },
        dummyState.effective[1],
      ],
    };
    mockInvoke.mockResolvedValueOnce(toggledState);

    await useAliasStore.getState().toggleAlias("ipme", false);

    expect(mockInvoke).toHaveBeenCalledWith("aliases_toggle_alias", {
      name: "ipme",
      enabled: false,
    });
    expect(useAliasStore.getState().effective[0].definition.enabled).toBe(false);
  });

  it("resets alias to factory defaults", async () => {
    mockInvoke.mockResolvedValueOnce(dummyState);

    await useAliasStore.getState().resetAlias("ipme");

    expect(mockInvoke).toHaveBeenCalledWith("aliases_reset_alias", {
      name: "ipme",
    });
  });
});
