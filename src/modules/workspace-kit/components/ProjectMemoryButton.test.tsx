// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProjectMemoryButton } from "@/modules/workspace-kit/components/ProjectMemoryButton";
import type { MemoryPanelTarget } from "@/modules/workspace-kit/lib/memoryPanel";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/modules/i18n", () => ({
  t: (key: string) => key,
  useTranslation: () => ({ t: (key: string) => key }),
}));
let root: Root;
let container: HTMLDivElement;
const target: MemoryPanelTarget = {
  path: "/owned",
  environment: { kind: "local" },
  source: "terminal:1",
};
function button(label: string) {
  const value = [...document.querySelectorAll("button")].find(
    (button) =>
      button.getAttribute("aria-label") === label ||
      button.textContent === label,
  );
  if (!value) throw new Error(`Missing fixture button: ${label}`);
  return value;
}
async function open() {
  await act(async () => {
    button("projectMemory.title").click();
    await import("@/modules/workspace-kit/components/ProjectMemoryPanel");
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) => {
    if (command === "project_memory_open") return { id: 1, token: "handle" };
    if (command === "project_memory_select") return "selection";
    if (command === "project_memory_discover")
      return {
        schema: 1,
        root: "/memory-root",
        blockedCount: 0,
        scope: { state: "ready" },
      };
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("opens only by action, shows the owned root, and never enables or initializes an agent", async () => {
  await act(async () => root.render(<ProjectMemoryButton target={target} />));
  expect(invoke).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await open();
  expect(document.body.textContent).toContain("/memory-root");
  expect(document.body.textContent).toContain("/owned");
  expect(invoke.mock.calls.map(([command]) => command)).toEqual([
    "project_memory_open",
    "project_memory_select",
    "project_memory_discover",
  ]);
  await act(async () => button("common.close").click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(invoke).toHaveBeenLastCalledWith("project_memory_close", {
    handle: { id: 1, token: "handle" },
  });
});

it("withdraws the old panel on source replacement and never reopens it on a round trip", async () => {
  await act(async () => root.render(<ProjectMemoryButton target={target} />));
  await open();
  const replacement = { ...target, path: "/replacement", source: "terminal:2" };
  await act(async () =>
    root.render(<ProjectMemoryButton target={replacement} />),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_select",
    ),
  ).toHaveLength(1);
  await act(async () => root.render(<ProjectMemoryButton target={target} />));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("keeps unsupported and missing targets explicit without opening native work", async () => {
  for (const value of [
    null,
    { ...target, path: "remote://host/project" },
    { ...target, environment: { kind: "wsl" as const, distro: "ubuntu" } },
  ]) {
    await act(async () => root.render(<ProjectMemoryButton target={value} />));
    await open();
    expect(document.body.textContent).toContain(
      value ? "projectMemory.unsupported" : "projectMemory.noTarget",
    );
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => button("common.close").click());
  }
});

it("does not offer private setup when marker inspection fails", async () => {
  let prepared = false;
  invoke.mockImplementation(async (command: string) => {
    if (command === "project_memory_open") return { id: 1, token: "handle" };
    if (command === "project_memory_select") return "selection";
    if (command === "project_memory_initialize_local_state") {
      prepared = true;
      return;
    }
    if (command === "project_memory_discover") {
      if (!prepared) throw { code: "missingState" };
      return {
        schema: 1,
        root: null,
        blockedCount: 0,
        scope: { state: "incomplete" },
      };
    }
  });
  await act(async () =>
    root.render(<ProjectMemoryButton target={target} rail />),
  );
  await open();
  expect(prepared).toBe(false);
  expect(document.body.textContent).toContain("missingState");
  expect(document.body.textContent).not.toContain(
    "projectMemory.prepareDescription",
  );
  await act(async () => button("common.refresh").click());
  expect(prepared).toBe(false);
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_initialize_local_state",
    ),
  ).toBe(false);
});

it("closes with Escape and returns keyboard focus to its original trigger", async () => {
  await act(async () => root.render(<ProjectMemoryButton target={target} />));
  const trigger = button("projectMemory.title");
  trigger.focus();
  await open();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(
    document.querySelector('[role="dialog"]')?.contains(document.activeElement),
  ).toBe(true);
  const restored = new Promise<void>((resolve) =>
    trigger.addEventListener("focus", () => resolve(), { once: true }),
  );
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await act(async () => restored);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("refreshes the footer after closing a separate rail panel", async () => {
  let installed = false;
  invoke.mockImplementation(async (command: string) => {
    if (command === "project_memory_open") return { id: 1, token: "handle" };
    if (command === "project_memory_select") return "selection";
    if (command === "project_memory_discover")
      return {
        schema: 1,
        root: installed ? "/owned" : null,
        blockedCount: 0,
        scope: {
          schema: 1,
          state: installed ? "ready" : "absent",
          ancestryComplete: true,
        },
      };
  });
  await act(async () =>
    root.render(
      <>
        <ProjectMemoryButton target={target} rail />
        <ProjectMemoryButton target={target} observe />
      </>,
    ),
  );
  await act(async () => new Promise((resolve) => setTimeout(resolve, 300)));
  await vi.waitFor(() =>
    expect(
      document
        .querySelector("[data-memory-state]")
        ?.getAttribute("data-memory-state"),
    ).toBe("absent"),
  );
  await open();
  installed = true;
  await act(async () => button("common.close").click());
  await vi.waitFor(() =>
    expect(
      document
        .querySelector("[data-memory-state]")
        ?.getAttribute("data-memory-state"),
    ).toBe("found"),
  );
});
