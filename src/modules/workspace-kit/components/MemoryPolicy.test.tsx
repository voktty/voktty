// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ProjectMemoryPanel from "@/modules/workspace-kit/components/ProjectMemoryPanel";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({
    language: "en",
    t: (key: string, params?: Record<string, string>) =>
      params?.policy ? `${key}: ${params.policy}` : key,
  }),
}));
let container: HTMLDivElement;
let root: Root;
let choice: "manual" | "always" | "never";
const target = {
  path: "/owned/src",
  environment: { kind: "local" as const },
  source: "terminal:one",
};
function reply(revision = 1) {
  return {
    schema: 1,
    review: `00000000-0000-4000-8000-${String(revision).padStart(12, "0")}`,
    revision,
    root: "/canonical/project",
    projectKey: "a".repeat(64),
    policy: choice,
    preference: {
      projectKey: "a".repeat(64),
      policy: "never",
      instructionDigest: null,
    },
  };
}
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
async function choose(value: string) {
  const input = container.querySelector<HTMLInputElement>(
    `input[type="radio"][value="${value}"]`,
  );
  if (!input) throw new Error(`Missing policy ${value}`);
  await act(async () => input.click());
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  choice = "manual";
  invoke.mockReset();
  invoke.mockImplementation(
    async (
      command: string,
      args?: { request?: { revision: number; policy: typeof choice } },
    ) => {
      if (command === "project_memory_open") return { id: 1, token: "owner" };
      if (command === "project_memory_select") return "selection";
      if (command === "project_memory_discover")
        return {
          schema: 1,
          root: "/canonical/project",
          blockedCount: 0,
          scope: { state: "ready", ancestryComplete: true },
        };
      if (command === "project_memory_review_policy") {
        choice = args?.request?.policy ?? "manual";
        return reply(args?.request?.revision);
      }
      if (command === "project_memory_confirm_policy")
        return {
          schema: 1,
          preference: {
            projectKey: "a".repeat(64),
            policy: choice,
            instructionDigest: null,
          },
        };
      if (command === "project_memory_cancel_policy") return true;
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

it("opens policy choices without IO, selects nothing implicitly and saves only after exact review", async () => {
  expect(invoke.mock.calls.map(([name]) => name)).toEqual([
    "project_memory_open",
    "project_memory_select",
    "project_memory_discover",
  ]);
  await click("projectMemory.policyConfigure");
  expect(container.textContent).toContain(
    "projectMemory.policyDeliveryPending",
  );
  expect(container.textContent).toContain("projectMemory.policyDescription");
  expect(container.querySelector('input[type="radio"]:checked')).toBeNull();
  expect(button("projectMemory.policyReview").disabled).toBe(true);
  await click("projectMemory.policyReview");
  expect(
    invoke.mock.calls.some(([name]) => name === "project_memory_review_policy"),
  ).toBe(false);
  await choose("always");
  expect(button("projectMemory.policyReview").disabled).toBe(false);
  expect(
    invoke.mock.calls.some(([name]) => name === "project_memory_review_policy"),
  ).toBe(false);
  await click("projectMemory.policyReview");
  expect(invoke).toHaveBeenLastCalledWith("project_memory_review_policy", {
    handle: { id: 1, token: "owner" },
    selection: "selection",
    request: { revision: 1, policy: "always" },
  });
  expect(container.textContent).toContain("/canonical/project");
  expect(container.textContent).toContain(
    "projectMemory.policyCurrentprojectMemory.policyNever",
  );
  expect(container.textContent).toContain(
    "projectMemory.policyRequestedprojectMemory.policyAlways",
  );
  expect(
    invoke.mock.calls.some(
      ([name]) => name === "project_memory_confirm_policy",
    ),
  ).toBe(false);
  await click("projectMemory.policyConfirm");
  expect(invoke).toHaveBeenLastCalledWith("project_memory_confirm_policy", {
    handle: { id: 1, token: "owner" },
    selection: "selection",
    review: reply().review,
  });
  expect(container.textContent).toContain(
    "projectMemory.policySaved: projectMemory.policyAlways",
  );
  expect(
    invoke.mock.calls.some(
      ([name]) =>
        name === "project_memory_confirm_trust" ||
        name === "project_memory_preview" ||
        name === "project_memory_initialize_local_state",
    ),
  ).toBe(false);
});

it.each(["manual", "never"] as const)(
  "persists only the explicitly chosen %s policy",
  async (value) => {
    await click("projectMemory.policyConfigure");
    await choose(value);
    await click("projectMemory.policyReview");
    await click("projectMemory.policyConfirm");
    expect(choice).toBe(value);
    expect(container.textContent).toContain(
      `projectMemory.policySaved: projectMemory.policy${value === "manual" ? "Manual" : "Never"}`,
    );
  },
);

it("returns without writing and clears radio choices after cancelling a native review", async () => {
  await click("projectMemory.policyConfigure");
  await choose("always");
  await click("common.back");
  expect(
    invoke.mock.calls.some(([name]) => name === "project_memory_cancel_policy"),
  ).toBe(false);
  await click("projectMemory.policyConfigure");
  expect(container.querySelector('input[type="radio"]:checked')).toBeNull();
  await choose("always");
  await click("projectMemory.policyReview");
  await click("common.back");
  expect(invoke).toHaveBeenLastCalledWith("project_memory_cancel_policy", {
    handle: { id: 1, token: "owner" },
    selection: "selection",
    revision: 1,
  });
  expect(container.querySelector('input[type="radio"]:checked')).toBeNull();
  expect(button("projectMemory.policyReview").disabled).toBe(true);
  expect(
    invoke.mock.calls.some(
      ([name]) => name === "project_memory_confirm_policy",
    ),
  ).toBe(false);
});

it("reports stale preferences without claiming success or automatically retrying", async () => {
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((name, args) =>
    name === "project_memory_confirm_policy"
      ? Promise.reject({ code: "stale" })
      : original?.(name, args),
  );
  await click("projectMemory.policyConfigure");
  await choose("always");
  await click("projectMemory.policyReview");
  await click("projectMemory.policyConfirm");
  expect(container.textContent).toContain("projectMemory.policyFailed");
  expect(container.textContent).not.toContain("projectMemory.policySaved");
  expect(
    invoke.mock.calls.filter(
      ([name]) => name === "project_memory_confirm_policy",
    ),
  ).toHaveLength(1);
  await click("common.back");
  expect(button("projectMemory.policyReview").disabled).toBe(true);
});

it("does not expose policy controls for blocked or unsupported memory scopes", async () => {
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((name, args) =>
    name === "project_memory_discover"
      ? Promise.resolve({
          schema: 1,
          root: "/canonical/project",
          blockedCount: 1,
          scope: { state: "incomplete", ancestryComplete: false },
        })
      : original?.(name, args),
  );
  await click("common.refresh");
  expect(container.textContent).not.toContain("projectMemory.policyConfigure");
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
  expect(container.textContent).not.toContain("projectMemory.policyConfigure");
});

it("retires an in-flight review on target withdrawal and ignores its late reply", async () => {
  let resolve!: (value: ReturnType<typeof reply>) => void;
  const read = new Promise<ReturnType<typeof reply>>((yes) => {
    resolve = yes;
  });
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((name, args) =>
    name === "project_memory_review_policy" ? read : original?.(name, args),
  );
  await click("projectMemory.policyConfigure");
  await choose("always");
  await click("projectMemory.policyReview");
  expect(button("common.refresh").disabled).toBe(true);
  await act(async () => root.render(<ProjectMemoryPanel target={null} />));
  expect(invoke).toHaveBeenCalledWith("project_memory_close", {
    handle: { id: 1, token: "owner" },
  });
  await act(async () => resolve(reply()));
  expect(container.textContent).toContain("projectMemory.noTarget");
  expect(
    invoke.mock.calls.some(
      ([name]) => name === "project_memory_confirm_policy",
    ),
  ).toBe(false);
});

it("disables duplicate saves and suppresses a confirmation that settles after closing", async () => {
  let resolve!: (value: {
    schema: number;
    preference: {
      projectKey: string;
      policy: typeof choice;
      instructionDigest: null;
    };
  }) => void;
  const write = new Promise<Parameters<typeof resolve>[0]>((yes) => {
    resolve = yes;
  });
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((name, args) =>
    name === "project_memory_confirm_policy" ? write : original?.(name, args),
  );
  await click("projectMemory.policyConfigure");
  await choose("never");
  await click("projectMemory.policyReview");
  await click("projectMemory.policyConfirm");
  expect(button("projectMemory.policySaving").disabled).toBe(true);
  expect(button("common.back").disabled).toBe(true);
  expect(button("common.refresh").disabled).toBe(true);
  await click("projectMemory.policySaving");
  expect(
    invoke.mock.calls.filter(
      ([name]) => name === "project_memory_confirm_policy",
    ),
  ).toHaveLength(1);
  await act(async () => root.render(<ProjectMemoryPanel target={null} />));
  await act(async () =>
    resolve({
      schema: 1,
      preference: {
        projectKey: "a".repeat(64),
        policy: "never",
        instructionDigest: null,
      },
    }),
  );
  expect(container.textContent).toContain("projectMemory.noTarget");
  expect(container.textContent).not.toContain("projectMemory.policySaved");
});

it("renders the native root as literal text rather than repository markup", async () => {
  choice = "always";
  const nativeRoot = "/project/<img src=x onerror=untrusted()>";
  const original = invoke.getMockImplementation();
  invoke.mockImplementation((name, args) =>
    name === "project_memory_review_policy"
      ? Promise.resolve({ ...reply(), root: nativeRoot })
      : original?.(name, args),
  );
  await click("projectMemory.policyConfigure");
  await choose("always");
  await click("projectMemory.policyReview");
  expect(container.textContent).toContain(nativeRoot);
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("script")).toBeNull();
});
