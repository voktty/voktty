// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ProjectMemoryPanel from "@/modules/workspace-kit/components/ProjectMemoryPanel";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
let container: HTMLDivElement;
let root: Root;
const target = {
  path: "/owned/src",
  environment: { kind: "local" as const },
  source: "terminal:one",
};
const text = "café\r\n<script>literal</script><img src=x onerror=untrusted()>";
function reply() {
  return {
    schema: 1,
    root: "/canonical/project",
    complete: false,
    blockedCount: 1,
    files: [
      { path: ".voktty/PROJECT.md", fact: { kind: "file", text } },
      { path: ".voktty/plans/missing.md", fact: { kind: "absent" } },
      { path: ".voktty/plans/blocked.md", fact: { kind: "blocked" } },
    ],
  };
}
function button(label: string) {
  const found = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === label,
  );
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) => {
    if (command === "project_memory_open") return { id: 1, token: "owner" };
    if (command === "project_memory_select") return "selection";
    if (command === "project_memory_discover")
      return {
        schema: 1,
        root: "/canonical/project",
        blockedCount: 0,
        scope: { state: "ready", ancestryComplete: true },
      };
    if (command === "project_memory_documents") return reply();
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ProjectMemoryPanel target={target} />));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("browses only on explicit action with the original receipt and observed root", async () => {
  expect(invoke.mock.calls.map(([command]) => command)).toEqual([
    "project_memory_open",
    "project_memory_select",
    "project_memory_discover",
  ]);
  await click("common.browse");
  expect(invoke).toHaveBeenLastCalledWith("project_memory_documents", {
    handle: { id: 1, token: "owner" },
    selection: "selection",
    root: "/canonical/project",
  });
  expect(container.querySelector("pre")?.textContent).toBe(text);
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("projectMemory.incomplete");
  await click(".voktty/plans/missing.md");
  expect(container.textContent).toContain("projectMemory.missingFile");
  await click(".voktty/plans/blocked.md");
  expect(container.textContent).toContain("projectMemory.currentUnavailable");
  await click("common.back");
  expect(container.textContent).toContain("projectMemory.found");
  expect(invoke.mock.calls.map(([command]) => command)).toEqual([
    "project_memory_open",
    "project_memory_select",
    "project_memory_discover",
    "project_memory_documents",
  ]);
});
it("refreshes the snapshot without carrying old content through a new load", async () => {
  await click("common.browse");
  let resolve!: (value: ReturnType<typeof reply>) => void;
  const pending = new Promise<ReturnType<typeof reply>>((yes) => {
    resolve = yes;
  });
  invoke.mockImplementationOnce(() => pending);
  await click("common.refresh");
  expect(container.querySelector("pre")).toBeNull();
  expect(button("common.refresh").disabled).toBe(true);
  expect(button("common.back").disabled).toBe(true);
  await act(async () => resolve(reply()));
  expect(container.querySelector("pre")?.textContent).toBe(text);
});
it("suppresses late document data after directory withdrawal and a round trip", async () => {
  let resolve!: (value: ReturnType<typeof reply>) => void;
  const pending = new Promise<ReturnType<typeof reply>>((yes) => {
    resolve = yes;
  });
  invoke.mockImplementationOnce(() => pending);
  await click("common.browse");
  await act(async () => root.render(<ProjectMemoryPanel target={null} />));
  await act(async () => root.render(<ProjectMemoryPanel target={target} />));
  await act(async () => resolve(reply()));
  expect(container.textContent).not.toContain(text);
  expect(
    [...container.querySelectorAll("button")].some(
      (element) => element.textContent === ".voktty/PROJECT.md",
    ),
  ).toBe(false);
  expect(container.textContent).toContain("projectMemory.found");
  expect(invoke).toHaveBeenCalledWith("project_memory_close", {
    handle: { id: 1, token: "owner" },
  });
});
it("rejects a different native root and permits an explicit retry", async () => {
  invoke.mockResolvedValueOnce({ ...reply(), root: "/other" });
  await click("common.browse");
  expect(container.textContent).toContain("projectMemory.error");
  expect(container.textContent).not.toContain(text);
  await click("common.refresh");
  expect(container.querySelector("pre")?.textContent).toBe(text);
});
it("offers no browser for incomplete observations or unsupported environments", async () => {
  invoke.mockResolvedValueOnce({
    schema: 1,
    root: "/canonical/project",
    blockedCount: 1,
    scope: { state: "incomplete", ancestryComplete: false },
  });
  await click("common.refresh");
  expect(container.textContent).not.toContain("common.browse");
  await act(async () =>
    root.render(
      <ProjectMemoryPanel
        target={{
          ...target,
          environment: { kind: "wsl", distro: "unavailable" },
        }}
      />,
    ),
  );
  expect(container.textContent).toContain("projectMemory.unsupported");
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_documents",
    ),
  ).toBe(false);
});
