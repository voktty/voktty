// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ProjectMemoryPanel from "@/modules/workspace-kit/components/ProjectMemoryPanel";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ language: "es", t: (key: string) => key }),
}));
let container: HTMLDivElement;
let root: Root;
let absent = false;
const target = {
  path: "/owned",
  environment: { kind: "local" as const },
  source: "terminal:one",
};
const preview = {
  schema: 1,
  root: "/canonical/owned",
  revision: 1,
  review: "review-token",
  deployment: {
    canPublish: true,
    lock: null,
    entries: [
      {
        path: ".voktty/INIT.md",
        action: "create",
        reason: "missing",
        expected: null,
        proposed: "New initialization\n",
      },
      {
        path: ".voktty/.gitignore",
        action: "migrate",
        reason: "private-ignore",
        expected: "*\r\n",
        proposed: "*\n!/kit.json\n",
      },
    ],
  },
  isResuming: false,
  recoveryFiles: [],
  publicationBlocker: null,
};
function button(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (value) => value.textContent === label,
  );
  if (!button) throw new Error(`Missing button ${label}`);
  return button;
}
async function click(label: string) {
  await act(async () => button(label).click());
}
async function configure() {
  await click("projectMemory.initialize");
}
async function reviewFiles() {
  await configure();
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  absent = false;
  invoke.mockReset();
  invoke.mockImplementation(
    async (command: string, args?: { inspectAncestors?: boolean }) => {
      if (command === "project_memory_open") return { id: 1, token: "owner" };
      if (command === "project_memory_select") {
        if (args?.inspectAncestors) absent = true;
        return "selection";
      }
      if (command === "project_memory_discover")
        return {
          schema: 1,
          root: null,
          blockedCount: absent ? 0 : 1,
          scope: {
            state: absent ? "absent" : "incomplete",
            ancestryComplete: absent,
          },
        };
      if (command === "project_memory_preview") return structuredClone(preview);
      if (command === "project_memory_confirm_preview")
        return {
          schema: 1,
          created: [".voktty/kit.json"],
          skipped: [],
          migrated: [],
          cleaned: [],
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

it("explains narrow inspection and never initializes memory or private settings on opening", async () => {
  expect(container.textContent).toContain("projectMemory.inspectDescription");
  expect(container.textContent).not.toContain("projectMemory.initialize");
  expect(invoke.mock.calls.map(([command]) => command)).toEqual([
    "project_memory_open",
    "project_memory_select",
    "project_memory_discover",
  ]);
  await click("projectMemory.inspectAncestors");
  expect(invoke).toHaveBeenCalledWith("project_memory_select", {
    handle: { id: 1, token: "owner" },
    path: "/owned",
    environment: { kind: "local" },
    revision: 2,
    inspectAncestors: true,
  });
  expect(container.textContent).toContain("projectMemory.initialize");
  await click("common.refresh");
  expect(invoke).toHaveBeenLastCalledWith(
    "project_memory_discover",
    expect.anything(),
  );
  const selects = invoke.mock.calls.filter(
    ([command]) => command === "project_memory_select",
  );
  expect(selects).toHaveLength(2);
  expect(selects[selects.length - 1][1]).toHaveProperty("inspectAncestors", true);
});
it("shows exact canonical preview and requires explicit acceptance before a token-only confirmation", async () => {
  await click("projectMemory.inspectAncestors");
  await configure();
  expect(
    [
      ...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ].every((input) => !input.checked),
  ).toBe(true);
  expect(container.querySelector("form")).toBeNull();
  expect(invoke.mock.calls.some(([command]) => command === "project_memory_initialize_local_state")).toBe(false);
  expect(container.textContent).toContain("/canonical/owned");
  expect(
    [...container.querySelectorAll("pre")].map(
      (element) => element.textContent,
    ),
  ).toContain("*\r\n");
  expect(button("projectMemory.initialize").disabled).toBe(true);
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_confirm_preview",
    ),
  ).toHaveLength(0);
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[type="checkbox"]')
      ?.click(),
  );
  await click("projectMemory.initialize");
  expect(invoke).toHaveBeenLastCalledWith("project_memory_confirm_preview", {
    handle: { id: 1, token: "owner" },
    selection: "selection",
    review: "review-token",
  });
  expect(container.textContent).toContain("projectMemory.installed");
  const previewCall = invoke.mock.calls.find(
    ([command]) => command === "project_memory_preview",
  );
  expect(previewCall?.[1].request.inputs).toMatchObject({
    project_name: "owned",
    language: "es",
  });
  expect(previewCall?.[1].request.links).toEqual({
    agents: true,
    claude: true,
  });
});
it("never permits conflicting or unsupported publication, even after forced click", async () => {
  const original = invoke.getMockImplementation();
  invoke.mockImplementation(async (command, args) =>
    command === "project_memory_preview"
      ? { ...preview, publicationBlocker: "migrationUnsupported" }
      : original?.(command, args),
  );
  await click("projectMemory.inspectAncestors");
  await reviewFiles();
  expect(container.textContent).toContain("projectMemory.conflicts");
  expect(button("projectMemory.initialize").disabled).toBe(true);
  await click("projectMemory.initialize");
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_confirm_preview",
    ),
  ).toHaveLength(0);
});
it("shows acknowledged partial writes without automatic retry or success", async () => {
  const original = invoke.getMockImplementation();
  invoke.mockImplementation(async (command, args) => {
    if (command === "project_memory_confirm_preview")
      throw {
        code: "recoveryRequired",
        changes: {
          created: [".voktty/INIT.md"],
          migrated: [],
          cleaned: [],
          possibleRecoveryFiles: [".voktty/backup"],
        },
      };
    return original?.(command, args);
  });
  await click("projectMemory.inspectAncestors");
  await reviewFiles();
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[type="checkbox"]')
      ?.click(),
  );
  await click("projectMemory.initialize");
  expect(container.textContent).toContain("projectMemory.partialWarning");
  expect(container.textContent).toContain(".voktty/backup");
  expect(container.textContent).not.toContain("projectMemory.installed");
  expect(
    invoke.mock.calls.filter(
      ([command]) => command === "project_memory_confirm_preview",
    ),
  ).toHaveLength(1);
});

it("never describes unreadable current bytes as a missing file", async () => {
  const original = invoke.getMockImplementation();
  invoke.mockImplementation(async (command, args) =>
    command === "project_memory_preview"
      ? {
          ...preview,
          deployment: {
            ...preview.deployment,
            canPublish: false,
            entries: [
              {
                path: ".voktty/INIT.md",
                action: "conflict",
                reason: "unavailable",
                expected: null,
                proposed: "new bytes",
              },
            ],
          },
        }
      : original?.(command, args),
  );
  await click("projectMemory.inspectAncestors");
  await reviewFiles();
  expect(container.textContent).toContain("projectMemory.currentUnavailable");
  expect(container.textContent).not.toContain("projectMemory.missingFile");
  expect(button("projectMemory.initialize").disabled).toBe(true);
});

it("installs without local setup and returns to the discovered kit", async () => {
  let prepared = false;
  let installed = false;
  const original = invoke.getMockImplementation();
  invoke.mockImplementation(async (command, args) => {
    if (command === "project_memory_initialize_local_state") {
      prepared = true;
      return;
    }
    if (command === "project_memory_discover") {
      if (!args?.inspectionOnly && !prepared) throw { code: "missingState" };
      if (installed)
        return {
          schema: 1,
          root: "/canonical/owned",
          blockedCount: 0,
          scope: { state: "ready", ancestryComplete: true },
        };
    }
    const result = await original?.(command, args);
    if (command === "project_memory_confirm_preview") installed = true;
    return result;
  });
  await click("common.refresh");
  expect(prepared).toBe(false);
  await click("projectMemory.inspectAncestors");
  await reviewFiles();
  expect(prepared).toBe(false);
  await act(async () =>
    container.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click(),
  );
  await click("projectMemory.initialize");
  expect(container.textContent).toContain("projectMemory.installed");
  await click("projectMemory.next");
  expect(container.textContent).toContain("projectMemory.found");
  expect(container.textContent).toContain("/canonical/owned");
  expect(button("common.browse")).toBeDefined();
  expect(container.textContent).not.toContain("projectMemory.reviewTrust");
  expect(container.textContent).not.toContain("projectMemory.policyConfigure");
  expect(invoke.mock.calls.filter(([command]) => command === "project_memory_confirm_preview")).toHaveLength(1);
  expect(invoke.mock.calls.some(([command]) =>
    command === "project_memory_confirm_trust" ||
    command === "project_memory_confirm_policy" ||
    command === "project_memory_confirm_context",
  )).toBe(false);
});

it("reconnects to existing memory on refresh without dropping ancestor inspection or installing files", async () => {
  await click("projectMemory.inspectAncestors");
  const selects = invoke.mock.calls.filter(([command]) => command === "project_memory_select").length;
  const original = invoke.getMockImplementation();
  invoke.mockImplementation(async (command, args) =>
    command === "project_memory_discover"
      ? {
          schema: 1,
          root: "/canonical/parent",
          blockedCount: 0,
          scope: { state: "ready", ancestryComplete: true },
        }
      : original?.(command, args),
  );
  await click("common.refresh");
  expect(container.textContent).toContain("/canonical/parent");
  expect(container.textContent).toContain("projectMemory.found");
  expect(container.textContent).toContain("projectMemory.initialize");
  expect(button("common.browse")).toBeDefined();
  expect(container.textContent).not.toContain("projectMemory.reviewTrust");
  expect(container.textContent).not.toContain("projectMemory.policyConfigure");
  expect(invoke.mock.calls.filter(([command]) => command === "project_memory_select")).toHaveLength(selects);
  expect(invoke.mock.calls.some(([command]) => command === "project_memory_preview" || command === "project_memory_confirm_preview")).toBe(false);
});

it("offers explicit authorization when native selection rejects an unregistered local directory", async () => {
  let authorized = false;
  const original = invoke.getMockImplementation();
  invoke.mockImplementation(async (command, args) => {
    if (command === "workspace_authorize") {
      authorized = true;
      return "/canonical/owned";
    }
    if (command === "project_memory_select" && !authorized) throw { code: "denied" };
    return original?.(command, args);
  });
  await act(async () => root.render(<ProjectMemoryPanel key="denied-selection" target={target} />));
  expect(container.textContent).toContain("denied");
  expect(invoke.mock.calls.some(([command]) => command === "workspace_authorize")).toBe(false);
  await click("git.authorizeDirectory");
  expect(invoke).toHaveBeenCalledWith("workspace_authorize", {
    path: "/owned", workspace: { kind: "local" },
  });
  expect(invoke).toHaveBeenCalledWith("project_memory_select", expect.objectContaining({
    path: "/canonical/owned", environment: { kind: "local" },
  }));
  expect(container.textContent).toContain("projectMemory.inspectDescription");
  expect(invoke.mock.calls.some(([command]) => command === "project_memory_initialize_local_state" || command === "project_memory_confirm_trust")).toBe(false);
});

it("leaves the authorization loop and offers initialization when private settings deny access but project markers are readable", async () => {
  let authorized = false;
  const original = invoke.getMockImplementation();
  invoke.mockImplementation(async (command, args) => {
    if (command === "workspace_authorize") {
      authorized = true;
      return "C:/projects/example";
    }
    if (command === "project_memory_select" && !authorized)
      throw { code: "denied" };
    if (command === "project_memory_discover") {
      if (!args?.inspectionOnly) throw { code: "denied" };
      return {
        schema: 1,
        root: null,
        blockedCount: 0,
        scope: { state: "reserved", ancestryComplete: true },
      };
    }
    return original?.(command, args);
  });
  await act(async () =>
    root.render(
      <ProjectMemoryPanel
        key="private-settings-denied"
        target={{ ...target, path: "c:/projects/example" }}
      />,
    ),
  );
  await click("git.authorizeDirectory");
  expect(container.textContent).not.toContain("denied");
  expect(button("projectMemory.initialize").disabled).toBe(false);
  expect(
    invoke.mock.calls.filter(([command]) => command === "workspace_authorize"),
  ).toHaveLength(1);
  const inspections = invoke.mock.calls.filter(
    ([command]) => command === "project_memory_discover",
  );
  expect(inspections.length).toBeGreaterThan(0);
  expect(inspections.every(([, args]) => args.inspectionOnly === true)).toBe(
    true,
  );
  expect(
    invoke.mock.calls.some(
      ([command]) =>
        command === "project_memory_initialize_local_state" ||
        command === "project_memory_confirm_preview",
    ),
  ).toBe(false);
});

it("keeps the authorized canonical selection through installation without local setup", async () => {
  let prepared = false;
  let installed = false;
  const canonical = "C:/projects/example";
  const original = invoke.getMockImplementation();
  invoke.mockImplementation(async (command, args) => {
    if (command === "workspace_authorize") return canonical;
    if (command === "project_memory_select" && args.path !== canonical)
      throw { code: "denied" };
    if (command === "project_memory_initialize_local_state") {
      prepared = true;
      return;
    }
    if (command === "project_memory_discover") {
      if (!args.inspectionOnly && !prepared) throw { code: "denied" };
      return {
        schema: 1,
        root: installed ? canonical : null,
        blockedCount: 0,
        scope: {
          state: installed ? "ready" : "reserved",
          ancestryComplete: true,
        },
      };
    }
    if (command === "project_memory_preview") {
      expect(prepared).toBe(false);
      return { ...structuredClone(preview), root: canonical };
    }
    if (command === "project_memory_confirm_preview") installed = true;
    return original?.(command, args);
  });
  await act(async () =>
    root.render(
      <ProjectMemoryPanel
        key="canonical-installation"
        target={{ ...target, path: "c:/projects/example" }}
      />,
    ),
  );
  await click("git.authorizeDirectory");
  await reviewFiles();
  await act(async () =>
    container
      .querySelector<HTMLInputElement>('input[type="checkbox"]')
      ?.click(),
  );
  await click("projectMemory.initialize");
  await click("projectMemory.next");
  expect(container.textContent).toContain("projectMemory.found");
  expect(container.textContent).not.toContain("denied");
  expect(button("common.browse")).toBeDefined();
  expect(container.textContent).not.toContain("projectMemory.reviewTrust");
  expect(container.textContent).not.toContain("projectMemory.policyConfigure");
  expect(
    invoke.mock.calls.filter(([command]) => command === "workspace_authorize"),
  ).toHaveLength(1);
});
