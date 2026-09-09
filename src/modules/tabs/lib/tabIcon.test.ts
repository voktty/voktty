import { afterEach, describe, expect, it } from "vitest";
import {
  isTabIconId,
  loadTabIconPreference,
  saveTabIconPreference,
  tabIconRouteKey,
} from "./tabIcon";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

describe("tab icon preferences", () => {
  it("uses stable normalized route keys", () => {
    expect(
      tabIconRouteKey({
        kind: "terminal",
        workspaceScopeId: "local",
        cwd: "C:\\Users\\Ada\\project\\",
      }),
    ).toBe("local:cwd:c:/Users/Ada/project");
  });

  it("persists and clears a route preference", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: memoryStorage(),
    });
    saveTabIconPreference("local:cwd:/repo", "server");
    expect(loadTabIconPreference("local:cwd:/repo")).toBe("server");
    saveTabIconPreference("local:cwd:/repo", null);
    expect(loadTabIconPreference("local:cwd:/repo")).toBeNull();
  });

  it("rejects unknown persisted icon ids", () => {
    expect(isTabIconId("codex")).toBe(true);
    expect(isTabIconId("unknown")).toBe(false);
  });
});
