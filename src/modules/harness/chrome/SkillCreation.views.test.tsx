// @vitest-environment happy-dom
import { act, StrictMode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Composer } from "@/modules/harness/chrome/Composer";
import { SkillsPage } from "@/modules/harness/surfaces/SkillsPage";

type PickerProps = ComponentProps<
  typeof import("@/modules/harness/chrome/SkillPicker").SkillPicker
>;
type FormProps = ComponentProps<
  typeof import("@/modules/harness/chrome/SkillPicker").CreateSkillForm
>;
const io = vi.hoisted(() => ({
  allocate: vi.fn(),
  write: vi.fn(),
  open: vi.fn(),
  refresh: vi.fn(),
  picker: null as PickerProps | null,
  form: null as FormProps | null,
}));
vi.mock("@/modules/harness/lib/fs", () => ({
  createPath: io.allocate,
  writeTextFile: io.write,
  homeDir: async () => "/home/fixture",
  listSkills: async () => [],
  readTextFile: vi.fn(),
}));
vi.mock("@/modules/harness/lib/fileIndex", () => ({
  invalidateProjectFiles: vi.fn(),
  recentOpenedFiles: () => [],
}));
vi.mock("@/modules/harness/lib/useProjectFileCatalog", () => ({
  useProjectFileCatalog: () => ({
    files: [],
    loading: false,
    isCurrent: () => true,
  }),
}));
vi.mock("@/modules/harness/chrome/useComposerSkills", () => ({
  useComposerSkills: () => ({ skills: [], refresh: io.refresh }),
}));
vi.mock("@/modules/harness/chrome/SkillPicker", async (original) => {
  const actual =
    await original<typeof import("@/modules/harness/chrome/SkillPicker")>();
  return {
    ...actual,
    SkillPicker: (props: PickerProps) => {
      io.picker = props;
      return null;
    },
    CreateSkillForm: (props: FormProps) => {
      io.form = props;
      return <actual.CreateSkillForm {...props} />;
    },
  };
});
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => [] }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: async () => () => {} }),
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
vi.mock("@/modules/harness/lib/notes", async (original) => ({
  ...(await original<typeof import("@/modules/harness/lib/notes")>()),
  peekNotes: () => [],
  loadNotes: async () => [],
}));

let root: Root, node: HTMLDivElement;
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing skill creation fixture.");
  return value;
}
function deferred() {
  let resolve!: (value: string) => void;
  const promise = new Promise<string>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function textarea() {
  return required(node.querySelector("textarea"));
}
async function renderComposer(
  overrides: Partial<ComponentProps<typeof Composer>> = {},
) {
  await act(async () =>
    root.render(
      <StrictMode>
        <Composer
          focused={false}
          harness="codex"
          model=""
          runtimeMode="supervised"
          cwd="/project"
          executionCwd="/project"
          hideTopBar
          onFocus={vi.fn()}
          onCwdChange={vi.fn()}
          onModelChange={vi.fn()}
          onRuntimeModeChange={vi.fn()}
          onSubmit={vi.fn()}
          onOpenFile={io.open}
          {...overrides}
        />
      </StrictMode>,
    ),
  );
}
async function startComposer() {
  await renderComposer();
  await act(async () => {
    textarea().value = "/review keep this";
    textarea().setSelectionRange(7, 7);
    textarea().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => required(io.picker).onStartCreate());
  expect(required(io.picker).creating).toBe(true);
}
async function renderSettings(cwd = "/project") {
  await act(async () =>
    root.render(
      <StrictMode>
        <SkillsPage cwd={cwd} />
      </StrictMode>,
    ),
  );
}
function button(text: string) {
  return required(
    [...node.querySelectorAll("button")].find(
      (entry) => entry.textContent?.trim() === text,
    ),
  );
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.clear();
  for (const mock of [io.allocate, io.write, io.open, io.refresh])
    mock.mockReset();
  io.allocate.mockResolvedValue("/project/.agents/skills/review/SKILL.md");
  io.write.mockResolvedValue(undefined);
  io.refresh.mockResolvedValue([]);
  io.picker = null;
  io.form = null;
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it.each(["context", "cancel", "draft-roundtrip", "unmount"] as const)(
  "prevents a retired Composer %s creation from writing or altering the next draft",
  async (reason) => {
    const allocation = deferred();
    io.allocate.mockReturnValueOnce(allocation.promise);
    await startComposer();
    await act(async () => required(io.picker).onCreate("review", "project"));
    if (reason === "context")
      await renderComposer({ executionCwd: "/replacement" });
    if (reason === "cancel")
      await act(async () => required(io.picker).onCancelCreate());
    if (reason === "unmount") await act(async () => root.render(null));
    if (reason === "draft-roundtrip")
      await act(async () => {
        const field = textarea();
        for (const value of ["replacement", "/review keep this"]) {
          field.value = value;
          field.dispatchEvent(new Event("input", { bubbles: true }));
        }
      });
    await act(async () =>
      allocation.resolve("/project/.agents/skills/review/SKILL.md"),
    );
    expect(io.write).not.toHaveBeenCalled();
    expect(io.open).not.toHaveBeenCalled();
    if (reason !== "unmount")
      expect(textarea().value).toBe("/review keep this");
  },
);

it("uses the original Composer callback and slash token across an ordinary rerender", async () => {
  const allocation = deferred();
  io.allocate.mockReturnValueOnce(allocation.promise);
  await startComposer();
  await act(async () => required(io.picker).onCreate("review", "project"));
  const replacement = vi.fn();
  await renderComposer({ onOpenFile: replacement });
  await act(async () =>
    allocation.resolve("/project/.agents/skills/review/SKILL.md"),
  );
  expect(io.open).toHaveBeenCalledExactlyOnceWith(
    "/project/.agents/skills/review/SKILL.md",
  );
  expect(replacement).not.toHaveBeenCalled();
  expect(textarea().value).toBe("keep this");
});

it.each(["cancel", "context"] as const)(
  "keeps Settings creation retired after %s",
  async (reason) => {
    const allocation = deferred();
    io.allocate.mockReturnValueOnce(allocation.promise);
    await renderSettings();
    await act(async () => button("Add skill").click());
    await act(async () => required(io.form).onCreate("review", "project"));
    if (reason === "cancel") {
      expect(button("Cancel").disabled).toBe(false);
      await act(async () => button("Cancel").click());
      await act(async () => button("Add skill").click());
    } else await renderSettings("/replacement");
    await act(async () =>
      allocation.resolve("/project/.agents/skills/review/SKILL.md"),
    );
    expect(io.write).not.toHaveBeenCalled();
    expect(node.querySelector("form")).not.toBeNull();
    expect(required(io.form).busy).toBe(false);
  },
);
