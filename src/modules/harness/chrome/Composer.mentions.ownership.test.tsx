// @vitest-environment happy-dom
import { act, createElement, StrictMode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Composer } from "@/modules/harness/chrome/Composer";
import {
  invalidateProjectFiles,
  loadProjectFiles,
} from "@/modules/harness/lib/fileIndex";
import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";
import { usePreferencesStore } from "@/modules/settings/preferences";

const io = vi.hoisted(() => ({
  index: vi.fn(),
  submit: vi.fn(),
  notes: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => [] }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
}));
vi.mock("@/modules/connections/model/remoteCommands", () => ({
  readCapturedProjectIndex: io.index,
}));
vi.mock("@/modules/harness/chrome/useComposerSkills", () => ({
  useComposerSkills: () => ({ skills: [], refresh: async () => [] }),
}));
vi.mock("@/modules/harness/chrome/ModelPicker", () => ({
  ModelPicker: () => null,
}));
vi.mock("@/modules/harness/chrome/AccessPicker", () => ({
  AccessPicker: () => null,
}));
vi.mock("@/modules/harness/chrome/NetworkSandboxPicker", () => ({
  NetworkSandboxPicker: () => null,
}));
vi.mock("@/modules/harness/chrome/FileTypeIcon", () => ({
  FileTypeIcon: () => null,
}));
vi.mock("@/modules/harness/lib/notes", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/notes")>()),
  peekNotes: () => [],
  loadNotes: io.notes,
}));
const cwd = "remote://voktty-ssh-fixture/srv/project";
const profile = { id: "fixture", name: "Fixture", host: "original.invalid" };
let root: Root;
let container: HTMLDivElement;
let scroll: PropertyDescriptor | undefined;

function textarea() {
  const field = container.querySelector("textarea");
  if (!field) throw new Error("Missing composer input.");
  return field;
}
function option() {
  const row = container.querySelector<HTMLButtonElement>('[role="option"]');
  if (!row) throw new Error("Missing mention row.");
  return row;
}
function capturePick(row = option()) {
  const key = Object.keys(row).find((name) => name.startsWith("__reactProps"));
  const props: unknown = key ? Reflect.get(row, key) : undefined;
  if (
    !props ||
    typeof props !== "object" ||
    !("onClick" in props) ||
    typeof props.onClick !== "function"
  )
    throw new Error("Missing React row callback.");
  const click = props.onClick;
  return () => click();
}
async function input(value: string) {
  await act(async () => {
    textarea().value = value;
    textarea().setSelectionRange(value.length, value.length);
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function render(
  overrides: Partial<ComponentProps<typeof Composer>> = {},
  strict = false,
) {
  await act(async () =>
    root.render(
      createElement(
        strict ? StrictMode : "div",
        null,
        createElement(Composer, {
          focused: false,
          harness: "codex",
          model: "",
          runtimeMode: "supervised",
          cwd,
          executionCwd: cwd,
          hideTopBar: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit: io.submit,
          ...overrides,
        }),
      ),
    ),
  );
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  scroll = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  localStorage.clear();
  rememberRemoteProject("voktty-ssh-fixture", {
    id: "project",
    name: "Project",
    cwd: "/srv/project",
  });
  usePreferencesStore.setState({ sshConnections: [profile] });
  io.index.mockResolvedValue([
    {
      name: "original.ts",
      relative: "original.ts",
      path: `${cwd}/original.ts`,
    },
  ]);
  io.notes.mockResolvedValue([]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await render();
  await input("@original");
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  option();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  invalidateProjectFiles();
  usePreferencesStore.setState({ sshConnections: [] });
  localStorage.clear();
  if (scroll)
    Object.defineProperty(Element.prototype, "scrollIntoView", scroll);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  vi.unstubAllGlobals();
});

it.each(["profile", "roundtrip", "project"])(
  "rejects a captured mention across %s replacement before React commits",
  async (change) => {
    const row = option();
    await act(async () => {
      if (change === "project")
        rememberRemoteProject("voktty-ssh-fixture", {
          id: "replacement",
          name: "Project",
          cwd: "/srv/project",
        });
      else {
        usePreferencesStore.setState({
          sshConnections: [{ ...profile, host: "replacement.invalid" }],
        });
        if (change === "roundtrip")
          usePreferencesStore.setState({ sshConnections: [profile] });
      }
      row.click();
    });
    expect(textarea().value).toBe("@original");
  },
);

it("withdraws mention highlights and rows when the SSH profile is removed", async () => {
  await input("@original.ts");
  expect(
    container.querySelector(".composer-highlight .text-mention"),
  ).not.toBeNull();
  await act(async () => usePreferencesStore.setState({ sshConnections: [] }));
  expect(container.querySelector('[role="option"]')).toBeNull();
  expect(
    container.querySelector(".composer-highlight .text-mention"),
  ).toBeNull();
  expect(textarea().value).toBe("@original.ts");
});

it("inserts the current file label and keeps normal submit available", async () => {
  await act(async () => option().click());
  expect(textarea().value).toBe("@original.ts ");
  const send = container.querySelector<HTMLButtonElement>(
    'button[aria-label="Send"]',
  );
  if (!send) throw new Error("Missing send button.");
  await act(async () => send.click());
  expect(io.submit).toHaveBeenCalledExactlyOnceWith(
    "@original.ts",
    [],
    undefined,
  );
});

it("rejects a cached picker callback after closing and reopening the same token", async () => {
  const pick = capturePick();
  await input("");
  await input("@original");
  await act(async () => pick());
  expect(textarea().value).toBe("@original");
  await act(async () => option().click());
  expect(textarea().value).toBe("@original.ts ");
});

it.each(["text", "cursor"])(
  "does not retarget a cached row to a changed %s before React commits",
  async (change) => {
    const pick = capturePick();
    const field = textarea();
    const value = change === "text" ? "say @original" : "@original";
    field.value = value;
    field.setSelectionRange(
      change === "cursor" ? 0 : value.length,
      change === "cursor" ? 0 : value.length,
    );
    await act(async () => pick());
    expect(field.value).toBe(value);
  },
);

it("retires cached rows across a composer execution-context round trip", async () => {
  const pick = capturePick();
  await render({ executionCwd: `${cwd}/other` });
  await render();
  await act(async () => pick());
  expect(textarea().value).toBe("@original");
});

it("withdraws invalidated catalog data without starting another scan", async () => {
  await input("@original.ts");
  const pick = capturePick();
  const reads = io.index.mock.calls.length;
  await act(async () => invalidateProjectFiles(cwd));
  expect(container.querySelector('[role="option"]')).toBeNull();
  expect(
    container.querySelector(".composer-highlight .text-mention"),
  ).toBeNull();
  await act(async () => pick());
  expect(textarea().value).toBe("@original.ts");
  expect(io.index).toHaveBeenCalledTimes(reads);
});

it("adopts refreshed cache data without a refresh loop", async () => {
  io.index.mockResolvedValue([
    {
      name: "replacement.ts",
      relative: "replacement.ts",
      path: `${cwd}/replacement.ts`,
    },
  ]);
  const reads = io.index.mock.calls.length;
  await act(async () => {
    await loadProjectFiles(cwd, true);
  });
  await input("@replacement");
  expect(option().textContent).toContain("replacement.ts");
  expect(io.index).toHaveBeenCalledTimes(reads + 1);
  await act(async () => option().click());
  expect(textarea().value).toBe("@replacement.ts ");
});

it("keeps a global note pick usable when its project profile disappears", async () => {
  io.notes.mockResolvedValue([
    {
      id: "global",
      slug: "global-memo",
      title: "Global memo",
      body: "memo",
      tags: [],
      slugPending: false,
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
  await input("");
  await input("@");
  const note = [
    ...container.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ].find((row) => row.textContent?.includes("Global memo"));
  if (!note) throw new Error("Missing global note.");
  await act(async () => {
    usePreferencesStore.setState({ sshConnections: [] });
    note.click();
  });
  expect(textarea().value).toBe("@note/global-memo ");
});

it("keeps disabled composers inactive and starts a fresh catalog on reactivation", async () => {
  const pick = capturePick();
  await render({ enabled: false });
  await act(async () => invalidateProjectFiles());
  const reads = io.index.mock.calls.length;
  await act(async () =>
    usePreferencesStore.setState({
      sshConnections: [{ ...profile, host: "replacement.invalid" }],
    }),
  );
  await act(async () => pick());
  expect(textarea().value).toBe("@original");
  expect(container.querySelector("[data-mention-picker]")).toBeNull();
  expect(io.index).toHaveBeenCalledTimes(reads);
  await render();
  await act(async () => option().click());
  expect(textarea().value).toBe("@original.ts ");
  expect(
    io.index.mock.calls[io.index.mock.calls.length - 1]?.[2],
  ).toMatchObject({ host: "replacement.invalid" });
});

it("does not adopt an initial scan superseded by a newer cache publication", async () => {
  await act(async () => root.unmount());
  invalidateProjectFiles();
  root = createRoot(container);
  let finish!: (value: unknown) => void;
  io.index.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  await input("@replacement");
  io.index.mockResolvedValue([
    {
      name: "replacement.ts",
      relative: "replacement.ts",
      path: `${cwd}/replacement.ts`,
    },
  ]);
  await act(async () => {
    await loadProjectFiles(cwd, true);
  });
  expect(option().textContent).toContain("replacement.ts");
  await act(async () =>
    finish([
      { name: "retired.ts", relative: "retired.ts", path: `${cwd}/retired.ts` },
    ]),
  );
  expect(option().textContent).toContain("replacement.ts");
  await act(async () => option().click());
  expect(textarea().value).toBe("@replacement.ts ");
});

it("keeps current selection usable after StrictMode setup and cleanup replay", async () => {
  await render({}, true);
  await input("@original");
  await act(async () => option().click());
  expect(textarea().value).toBe("@original.ts ");
});
