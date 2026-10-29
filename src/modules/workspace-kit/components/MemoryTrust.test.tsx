// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ProjectMemoryPanel from "@/modules/workspace-kit/components/ProjectMemoryPanel";
import {
  trustReply,
  trustAccepted,
  trustText,
} from "@/modules/workspace-kit/lib/nativeMemoryTrust.test-utils";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ language: "en", t: (key: string) => key }),
}));
let container: HTMLDivElement;
let root: Root;
const target = {
  path: "/owned",
  environment: { kind: "local" as const },
  source: "terminal:one",
};
function button(label: string) {
  const result = [...container.querySelectorAll("button")].find(
    (element) => element.textContent === label,
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
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  invoke.mockReset();
  invoke.mockImplementation(
    async (command: string, args?: { request?: { revision: number } }) => {
      if (command === "project_memory_open") return { id: 1, token: "owner" };
      if (command === "project_memory_select") return "selection";
      if (command === "project_memory_discover")
        return {
          schema: 1,
          root: "/canonical/project",
          blockedCount: 0,
          scope: { state: "ready", ancestryComplete: true },
        };
      if (command === "project_memory_review_trust")
        return trustReply(args?.request?.revision);
      if (command === "project_memory_confirm_trust") return trustAccepted;
      if (command === "project_memory_cancel_trust") return true;
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

it("starts with metadata only, shows exact instruction text and requires a checkbox before trust", async () => {
  expect(invoke.mock.calls.map(([command]) => command)).toEqual([
    "project_memory_open",
    "project_memory_select",
    "project_memory_discover",
  ]);
  await click("projectMemory.reviewTrust");
  expect(container.textContent).toContain("/canonical/project");
  expect(container.textContent).toContain("projectMemory.trustDescription");
  expect(
    [...container.querySelectorAll("pre")].map(
      (element) => element.textContent,
    ),
  ).toContain(trustText);
  expect(container.querySelector("script")).toBeNull();
  expect(button("projectMemory.trustConfirm").disabled).toBe(true);
  await click("projectMemory.trustConfirm");
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_confirm_trust",
    ),
  ).toBe(false);
  await accept();
  await click("projectMemory.trustConfirm");
  expect(invoke).toHaveBeenLastCalledWith("project_memory_confirm_trust", {
    handle: { id: 1, token: "owner" },
    selection: "selection",
    review: trustReply().review,
  });
  expect(container.textContent).toContain("projectMemory.trustSaved");
  expect(
    invoke.mock.calls.some(
      ([command]) =>
        command === "project_memory_preview" ||
        command === "project_memory_initialize_local_state",
    ),
  ).toBe(false);
});
it("cancels on back and never carries a checkbox decision to the next review", async () => {
  await click("projectMemory.reviewTrust");
  await accept();
  await click("common.back");
  expect(invoke).toHaveBeenLastCalledWith("project_memory_cancel_trust", {
    handle: { id: 1, token: "owner" },
    selection: "selection",
    revision: 1,
  });
  await click("projectMemory.reviewTrust");
  expect(button("projectMemory.trustConfirm").disabled).toBe(true);
  expect(
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')
      ?.checked,
  ).toBe(false);
  await click("projectMemory.trustConfirm");
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_confirm_trust",
    ),
  ).toBe(false);
});
it("requires a new review after stale instructions and never reports failed trust as saved", async () => {
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) =>
    command === "project_memory_confirm_trust"
      ? Promise.reject({ code: "stale" })
      : original?.(command, args),
  );
  await click("projectMemory.reviewTrust");
  await accept();
  await click("projectMemory.trustConfirm");
  expect(container.textContent).toContain("projectMemory.trustFailed");
  expect(container.textContent).not.toContain("projectMemory.trustSaved");
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_confirm_trust",
    ),
  ).toHaveLength(1);
  await click("common.back");
  await click("projectMemory.reviewTrust");
  expect(button("projectMemory.trustConfirm").disabled).toBe(true);
});
it("does not expose review actions for incomplete scopes or unsupported environments", async () => {
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) =>
    command === "project_memory_discover"
      ? Promise.resolve({
          schema: 1,
          root: "/canonical/project",
          blockedCount: 1,
          scope: { state: "incomplete", ancestryComplete: false },
        })
      : original?.(command, args),
  );
  await click("common.refresh");
  expect(container.textContent).not.toContain("projectMemory.reviewTrust");
  await act(async () =>
    root.render(
      <ProjectMemoryPanel
        target={{ ...target, path: "remote://host/project" }}
      />,
    ),
  );
  expect(container.textContent).toContain("projectMemory.unsupported");
  expect(container.textContent).not.toContain("projectMemory.reviewTrust");
});

it("explains changed instruction hashes without inventing a historical diff or enabling use", async () => {
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) =>
    command === "project_memory_review_trust"
      ? Promise.resolve({
          ...trustReply(),
          preference: {
            ...trustAccepted.preference,
            policy: "never",
            instructionDigest: "d".repeat(64),
          },
        })
      : original?.(command, args),
  );
  await click("projectMemory.reviewTrust");
  expect(container.textContent).toContain("projectMemory.trustChanged");
  expect(container.textContent).toContain("projectMemory.trustDescription");
  expect(button("projectMemory.trustConfirm").disabled).toBe(true);
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_confirm_trust",
    ),
  ).toBe(false);
});

it("closes the original presentation and suppresses a late review when its target is withdrawn", async () => {
  let resolve!: (value: ReturnType<typeof trustReply>) => void;
  const read = new Promise<ReturnType<typeof trustReply>>((yes) => {
    resolve = yes;
  });
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((command, args) =>
    command === "project_memory_review_trust"
      ? read
      : original?.(command, args),
  );
  await click("projectMemory.reviewTrust");
  await act(async () => root.render(<ProjectMemoryPanel target={null} />));
  expect(invoke).toHaveBeenCalledWith("project_memory_close", {
    handle: { id: 1, token: "owner" },
  });
  await act(async () => resolve(trustReply()));
  expect(container.textContent).toContain("projectMemory.noTarget");
  expect(container.textContent).not.toContain("projectMemory.trustTitle");
  expect(
    invoke.mock.calls.some(
      ([command]) => command === "project_memory_confirm_trust",
    ),
  ).toBe(false);
});
