// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MemoryIndicator from "@/modules/workspace-kit/components/MemoryIndicator";
import type { MemoryPanelTarget } from "@/modules/workspace-kit/lib/memoryPanel";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
const target: MemoryPanelTarget = {
  path: "/project",
  environment: { kind: "local" },
  source: "terminal:1",
};
let root: ReturnType<typeof createRoot>;
let node: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  invoke.mockReset();
  invoke.mockImplementation(async (command) => {
    if (command === "project_memory_open") return { id: 1, token: "handle" };
    if (command === "project_memory_select") return "selection";
    if (command === "project_memory_discover")
      return {
        schema: 1,
        root: "/project",
        blockedCount: 0,
        scope: { schema: 1, state: "ready", ancestryComplete: true },
      };
  });
  node = document.createElement("div");
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const render = (input: MemoryPanelTarget | null = target, active = true) =>
  root.render(
    <MemoryIndicator
      target={input}
      active={active}
      descriptionId="memory-status"
    />,
  );
const state = () =>
  node.querySelector("[data-memory-state]")?.getAttribute("data-memory-state");

it("debounces the active target and displays verified memory without private state or writes", async () => {
  await act(async () => render());
  expect(invoke).not.toHaveBeenCalled();
  expect(state()).toBe("checking");
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(state()).toBe("found");
  expect(node.querySelector("[data-memory-state]")?.className).toContain(
    "text-emerald-500",
  );
  expect(invoke.mock.calls.map(([command]) => command)).toEqual([
    "project_memory_open",
    "project_memory_select",
    "project_memory_discover",
  ]);
  expect(invoke).toHaveBeenLastCalledWith("project_memory_discover", {
    handle: { id: 1, token: "handle" },
    selection: "selection",
    inspectionOnly: true,
  });
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_select",
    ),
  ).toHaveLength(1);
});

it("withdraws old green state immediately and rejects a late old-folder observation", async () => {
  await act(async () => render());
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(state()).toBe("found");
  let complete!: (value: unknown) => void;
  invoke.mockImplementation((command) => {
    if (command === "project_memory_open")
      return Promise.resolve({ id: 2, token: "next" });
    if (command === "project_memory_select")
      return Promise.resolve("next-selection");
    if (command === "project_memory_discover")
      return new Promise((resolve) => {
        complete = resolve;
      });
    return Promise.resolve();
  });
  await act(async () => render({ ...target, path: "/replacement" }));
  expect(state()).toBe("checking");
  await act(async () => vi.advanceTimersByTimeAsync(200));
  await act(async () => render(null));
  await act(async () =>
    complete({
      schema: 1,
      root: "/replacement",
      blockedCount: 0,
      scope: { schema: 1, state: "ready", ancestryComplete: true },
    }),
  );
  expect(state()).toBe("noTarget");
});

it("explains an observed kit with unverified parents in amber without granting inspection", async () => {
  invoke.mockImplementation(async (command) => {
    if (command === "project_memory_open") return { id: 1, token: "handle" };
    if (command === "project_memory_select") return "selection";
    if (command === "project_memory_discover")
      return {
        schema: 1,
        root: null,
        blockedCount: 1,
        scope: {
          schema: 1,
          state: "incomplete",
          ancestryComplete: false,
          ancestorKits: ["observed-kit"],
        },
      };
  });
  await act(async () => render());
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(state()).toBe("foundReview");
  const indicator = node.querySelector("[data-memory-state]");
  expect(indicator?.className).toContain("text-amber-500");
  expect(indicator?.className).not.toContain("text-emerald-500");
  expect(indicator?.getAttribute("title")).toBe(
    "projectMemory.found projectMemory.review",
  );
  expect(invoke.mock.calls.map(([command]) => command)).toEqual([
    "project_memory_open",
    "project_memory_select",
    "project_memory_discover",
  ]);
});

it("starts no native work for remote, unsupported, inactive or rapidly replaced destinations", async () => {
  for (const input of [
    null,
    { ...target, path: "remote://host/project" },
    { ...target, environment: { kind: "wsl" as const, distro: "owned" } },
  ]) {
    await act(async () => render(input));
    await act(async () => vi.advanceTimersByTimeAsync(200));
  }
  expect(state()).toBe("unsupported");
  await act(async () => render(target, false));
  await act(async () => vi.advanceTimersByTimeAsync(200));
  await act(async () => render(target));
  await act(async () => render(null));
  await act(async () => vi.advanceTimersByTimeAsync(200));
  expect(invoke).not.toHaveBeenCalled();
});
