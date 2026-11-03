// @vitest-environment happy-dom

import ProjectMemoryPanel from "@/modules/workspace-kit/components/ProjectMemoryPanel";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ language: "en", t: (key: string) => key }),
}));
const target = {
  path: "/owned",
  environment: { kind: "local" as const },
  source: "terminal:one",
};
const token = "12345678-1234-4234-8234-123456789abc";
const backup = `.voktty/.voktty-migration-${token}-2`;
const originalText = "<script>privateOriginal()</script>\r\n*\r\n";
function reply(revision = 1) {
  return {
    schema: 1,
    revision,
    review: token,
    digest: "a".repeat(64),
    root: "/canonical/owned",
    entries: [{ target: ".voktty/.gitignore", backup, text: originalText }],
  };
}
const report = {
  schema: 1,
  created: [".voktty/.gitignore"],
  cleaned: [backup],
  migrated: [],
  skipped: [],
};
let container: HTMLDivElement;
let root: Root;
function button(label: string) {
  const result = [...container.querySelectorAll("button")].find(
    (value) => value.textContent === label,
  );
  if (!result) throw new Error(`Missing button ${label}`);
  return result;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function accept() {
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[type="checkbox"]')
      ?.click(),
  );
}
beforeEach(async () => {
  await import("@/modules/workspace-kit/components/MemoryRecovery");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  invoke.mockReset();
  invoke.mockImplementation(
    async (command: string, args?: { request?: { revision: number } }) => {
      if (command === "project_memory_open") return { id: 1, token: "owner" };
      if (command === "project_memory_select") return "selection";
      if (command === "project_memory_discover")
        return {
          schema: 1,
          root: null,
          blockedCount: 1,
          scope: { state: "partial", ancestryComplete: true },
        };
      if (command === "project_memory_review_recovery")
        return reply(args?.request?.revision);
      if (command === "project_memory_confirm_recovery")
        return structuredClone(report);
      if (command === "project_memory_cancel_recovery") return true;
      if (command === "project_memory_preview")
        return {
          schema: 1,
          revision: args?.request?.revision,
          review: "publication-review",
          root: "/canonical/owned",
          deployment: { entries: [], canPublish: true, lock: null },
          isResuming: true,
          recoveryFiles: [],
          publicationBlocker: null,
        };
    },
  );
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

it("starts with metadata only and presents original bytes and paths before explicit acceptance", async () => {
  expect(invoke.mock.calls.map(([command]) => command)).toEqual([
    "project_memory_open",
    "project_memory_select",
    "project_memory_discover",
  ]);
  await click("projectMemory.recovery.review");
  expect(container.textContent).toContain("/canonical/owned");
  expect(container.textContent).toContain(backup);
  expect(container.textContent).toContain("projectMemory.recovery.effects");
  expect(container.querySelector("pre")?.textContent).toBe(originalText);
  expect(container.querySelector("script")).toBeNull();
  expect(button("projectMemory.recovery.confirm").disabled).toBe(true);
  await click("projectMemory.recovery.confirm");
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_confirm_recovery",
    ),
  ).toBe(false);
  await accept();
  await click("projectMemory.recovery.confirm");
  expect(invoke).toHaveBeenLastCalledWith("project_memory_confirm_recovery", {
    handle: { id: 1, token: "owner" },
    selection: "selection",
    confirmation: { review: token, digest: "a".repeat(64) },
  });
  expect(container.textContent).toContain("projectMemory.recovery.restored");
  expect(container.textContent).not.toContain("projectMemory.installed");
  expect(
    invoke.mock.calls.some(
      ([command]) =>
        command === "project_memory_confirm_preview" ||
        command === "project_memory_initialize_local_state",
    ),
  ).toBe(false);
});

it("cancels on back, re-inspects the directory and never carries acceptance to another review", async () => {
  await click("projectMemory.recovery.review");
  await accept();
  await click("common.back");
  expect(invoke).toHaveBeenCalledWith("project_memory_cancel_recovery", {
    handle: { id: 1, token: "owner" },
    selection: "selection",
    revision: 1,
  });
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_discover",
    ),
  ).toHaveLength(2);
  await click("projectMemory.recovery.review");
  expect(button("projectMemory.recovery.confirm").disabled).toBe(true);
  expect(
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')
      ?.checked,
  ).toBe(false);
});

it("requires fresh discovery and a new publication preview after restoration", async () => {
  await click("projectMemory.recovery.review");
  await accept();
  await click("projectMemory.recovery.confirm");
  await click("projectMemory.recovery.continue");
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_discover",
    ),
  ).toHaveLength(2);
  expect(container.textContent).toContain("projectMemory.valuesTitle");
  expect(container.textContent).toContain(
    "projectMemory.recovery.matchInitialization",
  );
  expect(
    container.querySelector<HTMLInputElement>('input[type="date"]'),
  ).not.toBeNull();
  expect(
    invoke.mock.calls.some(([command]) => command === "project_memory_preview"),
  ).toBe(false);
  await click("projectMemory.next");
  await click("projectMemory.preview");
  expect(invoke).toHaveBeenLastCalledWith(
    "project_memory_preview",
    expect.objectContaining({
      request: expect.objectContaining({ revision: 2 }),
    }),
  );
  expect(button("projectMemory.initialize").disabled).toBe(true);
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_confirm_preview",
    ),
  ).toBe(false);
});

it("permits a pending initialization review with its original date without initializing private settings", async () => {
  await click("projectMemory.recovery.reviewInitialization");
  const date = container.querySelector<HTMLInputElement>('input[type="date"]');
  expect(date).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(date, "2025-11-02");
    date?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click("projectMemory.next");
  await click("projectMemory.preview");
  expect(invoke).toHaveBeenLastCalledWith(
    "project_memory_preview",
    expect.objectContaining({
      request: expect.objectContaining({
        inputs: expect.objectContaining({ created_at: "2025-11-02" }),
      }),
    }),
  );
  expect(
    invoke.mock.calls.some(
      ([command]) =>
        command === "project_memory_initialize_local_state" ||
        command === "project_memory_confirm_preview",
    ),
  ).toBe(false);
});

it.each(["restored", "pending"] as const)(
  "offers explicit parent inspection before configuring %s initialization",
  async (phase) => {
    const previous = invoke.getMockImplementation();
    let complete = false;
    invoke.mockImplementation((command, args) => {
      if (command === "project_memory_select" && args?.inspectAncestors)
        complete = true;
      if (command === "project_memory_discover")
        return Promise.resolve({
          schema: 1,
          root: null,
          blockedCount: 1,
          scope: { state: "partial", ancestryComplete: complete },
        });
      return previous?.(command, args);
    });
    if (phase === "restored") {
      await click("projectMemory.recovery.review");
      await accept();
      await click("projectMemory.recovery.confirm");
      await click("projectMemory.recovery.continue");
    } else {
      await click("common.refresh");
      await click("projectMemory.recovery.reviewInitialization");
    }
    expect(container.textContent).toContain("projectMemory.inspectDescription");
    expect(container.querySelector("form")).toBeNull();
    expect(complete).toBe(false);
    await click("projectMemory.inspectAncestors");
    expect(invoke).toHaveBeenCalledWith(
      "project_memory_select",
      expect.objectContaining({ inspectAncestors: true }),
    );
    expect(container.textContent).toContain("projectMemory.valuesTitle");
    expect(container.querySelector('input[type="date"]')).not.toBeNull();
    expect(
      invoke.mock.calls.some(
        ([command]) =>
          command === "project_memory_preview" ||
          command === "project_memory_confirm_preview" ||
          command === "project_memory_initialize_local_state",
      ),
    ).toBe(false);
  },
);

it("shows partial failure paths and requires another review without repeating a write", async () => {
  const previous = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) =>
    command === "project_memory_confirm_recovery"
      ? Promise.reject({
          code: "recoveryRequired",
          changes: {
            created: ["AGENTS.md"],
            migrated: [],
            cleaned: ["moved-original"],
            possibleRecoveryFiles: [backup],
          },
        })
      : previous?.(command, args),
  );
  await click("projectMemory.recovery.review");
  await accept();
  await click("projectMemory.recovery.confirm");
  expect(container.textContent).toContain("projectMemory.recovery.failed");
  expect(container.textContent).toContain("projectMemory.partialWarning");
  expect(container.textContent).toContain(backup);
  expect(container.textContent).not.toContain(
    "projectMemory.recovery.restored",
  );
  await click("projectMemory.recovery.review");
  expect(button("projectMemory.recovery.confirm").disabled).toBe(true);
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_confirm_recovery",
    ),
  ).toHaveLength(1);
});

it("disables duplicate writes, back and the checkbox through restoration settlement", async () => {
  let resolve!: (value: typeof report) => void;
  const pending = new Promise<typeof report>((yes) => {
    resolve = yes;
  });
  const previous = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) =>
    command === "project_memory_confirm_recovery"
      ? pending
      : previous?.(command, args),
  );
  await click("projectMemory.recovery.review");
  await accept();
  await click("projectMemory.recovery.confirm");
  expect(button("projectMemory.recovery.restoring").disabled).toBe(true);
  expect(button("common.back").disabled).toBe(true);
  expect(
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')
      ?.disabled,
  ).toBe(true);
  await click("projectMemory.recovery.restoring");
  await act(async () => resolve(report));
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_confirm_recovery",
    ),
  ).toHaveLength(1);
});

it("suppresses a late review when its original target is withdrawn", async () => {
  let resolve!: (value: ReturnType<typeof reply>) => void;
  const read = new Promise<ReturnType<typeof reply>>((yes) => {
    resolve = yes;
  });
  const previous = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) =>
    command === "project_memory_review_recovery"
      ? read
      : previous?.(command, args),
  );
  await click("projectMemory.recovery.review");
  await act(async () => root.render(<ProjectMemoryPanel target={null} />));
  await act(async () => resolve(reply()));
  expect(container.textContent).toContain("projectMemory.noTarget");
  expect(invoke).toHaveBeenCalledWith("project_memory_close", {
    handle: { id: 1, token: "owner" },
  });
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_confirm_recovery",
    ),
  ).toBe(false);
});
