// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import ProjectMemoryPanel from "@/modules/workspace-kit/components/ProjectMemoryPanel";
import { memoryStorageDiagnostic } from "@/modules/workspace-kit/lib/memoryStorageDiagnostic";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key, language: "en" }),
}));

it("reports a project preview failure without attempting private setup or exposing native details", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const failed = true;
  invoke.mockImplementation(async (command: string) => {
    if (command === "project_memory_open") return { id: 1, token: "handle" };
    if (command === "project_memory_select") return "selection";
    if (command === "project_memory_discover")
      return {
        schema: 1,
        root: null,
        blockedCount: 0,
        scope: { state: "absent", ancestryComplete: true },
      };
    if (command === "project_memory_preview" && failed)
      throw {
        code: "denied",
        storage: { stage: "windows-directory-open", windowsError: 5 },
        message: "private error text that must not be displayed",
      };
  });
  const node = document.createElement("div");
  const root = createRoot(node);
  const click = async (label: string) =>
    act(async () => {
      const button = [...node.querySelectorAll("button")].find(
        (value) => value.textContent === label,
      );
      expect(button).toBeDefined();
      button?.click();
    });
  try {
    await act(async () =>
      root.render(
        <ProjectMemoryPanel
          target={{
            path: "/owned",
            source: "terminal:1",
            environment: { kind: "local" },
          }}
        />,
      ),
    );
    await click("projectMemory.initialize");
    expect(node.textContent).toContain("projectMemory.deploymentFailed");
    expect(node.textContent).not.toContain("private error text");
    expect(
      invoke.mock.calls.some(
        ([name]) => name === "project_memory_initialize_local_state",
      ),
    ).toBe(false);
    await click("common.back");
    expect(node.querySelector("form")).toBeNull();
    expect(node.textContent).toContain("projectMemory.initialize");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});

it("rejects arbitrary diagnostic text and invalid operating-system status values", () => {
  expect(
    memoryStorageDiagnostic({
      storage: { stage: "windows-owner", windowsError: null },
    }),
  ).toBe("windows-owner");
  for (const storage of [
    null,
    "private content",
    {},
    { stage: "private path" },
    ...[-1, 1.5, Infinity, 0x100000000, "5"].map((windowsError) => ({
      stage: "windows-directory-open",
      windowsError,
    })),
  ])
    expect(memoryStorageDiagnostic({ storage })).toBeUndefined();
  expect(
    memoryStorageDiagnostic({
      storage: { stage: "preferences", windowsError: 0xffffffff },
    }),
  ).toBe("preferences:4294967295");
});
