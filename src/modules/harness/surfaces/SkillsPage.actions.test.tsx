// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SkillsPage } from "@/modules/harness/surfaces/SkillsPage";

const io = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  copy: vi.fn(),
  reveal: vi.fn(),
}));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/modules/harness/lib/fs", () => ({
  listSkills: io.list,
  readTextFile: io.read,
}));
vi.mock("@/modules/harness/lib/clipboard", () => ({ copyText: io.copy }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: io.reveal }));
vi.mock("@/modules/harness/lib/skills", () => ({
  CREATE_SKILL_BODY: "builtin body",
  SKILLS_CHANGE_EVENT: "skills-test-change",
  invalidateSkills: vi.fn(),
  loadDisabledSkillPaths: () => [],
  saveDisabledSkillPaths: vi.fn(),
  createBlankSkill: vi.fn(),
}));
const skill = {
  name: "review",
  description: "Review code",
  path: "/project/SKILL.md",
  scope: "project",
  source: "agents",
};
let root: Root, node: HTMLDivElement;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function button(key: string) {
  const found = node.querySelector<HTMLButtonElement>(
    `[aria-label="skillsPage.${key}"]`,
  );
  if (!found) throw new Error(`Missing button ${key}`);
  return found;
}
async function click(key: string) {
  await act(async () => button(key).click());
}
async function render(cwd = "/project") {
  await act(async () =>
    root.render(
      <StrictMode>
        <SkillsPage cwd={cwd} />
      </StrictMode>,
    ),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  io.list.mockResolvedValue([skill]);
  io.read.mockResolvedValue("current body");
  io.copy.mockResolvedValue(undefined);
  io.reveal.mockResolvedValue(undefined);
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
});

it("does not publish a preview read after collapse and reopening", async () => {
  const old = deferred<string>();
  io.read.mockReturnValueOnce(old.promise);
  await render();
  await click("previewAriaLabel");
  await click("previewAriaLabel");
  await click("previewAriaLabel");
  expect(io.read).toHaveBeenCalledTimes(2);
  await act(async () => old.resolve("retired body"));
  expect(node.textContent).toContain("current body");
  expect(node.textContent).not.toContain("retired body");
});

it.each(["copy", "reveal"] as const)(
  "does not publish a late %s failure in a successor project",
  async (kind) => {
    const old = deferred<void>();
    io[kind].mockReturnValueOnce(old.promise);
    await render();
    await click(kind === "copy" ? "copyPathAriaLabel" : "revealAriaLabel");
    await render("/successor");
    await act(async () => old.reject(new Error("retired failure")));
    expect(node.querySelector('[role="alert"]')).toBeNull();
  },
);

it("retires the preview when the catalog refreshes with the same path", async () => {
  const old = deferred<string>();
  io.read.mockReturnValueOnce(old.promise);
  await render();
  await click("previewAriaLabel");
  await click("refreshSkills");
  await click("previewAriaLabel");
  await act(async () => old.resolve("retired body"));
  expect(node.textContent).toContain("current body");
  expect(node.textContent).not.toContain("retired body");
});

function cachedClick(element: HTMLButtonElement) {
  const key = Object.keys(element).find((key) =>
    key.startsWith("__reactProps$"),
  );
  if (!key) throw new Error("Missing React button props");
  return (element as unknown as Record<string, { onClick: () => void }>)[key]
    .onClick;
}

it("rejects content-copy callbacks retained across a preview round trip", async () => {
  await render();
  await click("previewAriaLabel");
  const old = cachedClick(button("copySkillContentAriaLabel"));
  await click("previewAriaLabel");
  await click("previewAriaLabel");
  await act(async () => old());
  expect(io.copy).not.toHaveBeenCalled();
  await click("copySkillContentAriaLabel");
  expect(io.copy).toHaveBeenCalledWith("current body", expect.any(Function));
});

it("does not schedule copied feedback when the preview closes during copy", async () => {
  const pending = deferred<void>();
  io.copy.mockReturnValueOnce(pending.promise);
  await render();
  await click("previewAriaLabel");
  await click("copySkillContentAriaLabel");
  await click("previewAriaLabel");
  await click("previewAriaLabel");
  const timer = vi.spyOn(window, "setTimeout");
  await act(async () => pending.resolve());
  expect(timer.mock.calls.filter((call) => call[1] === 2000)).toHaveLength(0);
  expect(node.textContent).not.toContain("skillsPage.copiedSkillContent");
  timer.mockRestore();
});

it("reports a current content-copy failure without an unhandled rejection", async () => {
  io.copy.mockRejectedValueOnce(new Error("clipboard failed"));
  await render();
  await click("previewAriaLabel");
  await click("copySkillContentAriaLabel");
  expect(node.querySelector('[role="alert"]')?.textContent).toBe(
    "preview.copyError",
  );
});

it("allows a successor row action while the original row action is pending", async () => {
  const old = deferred<void>();
  io.copy.mockReturnValueOnce(old.promise);
  await render();
  const cached = cachedClick(button("copyPathAriaLabel"));
  await click("copyPathAriaLabel");
  await render("/next");
  await click("copyPathAriaLabel");
  await act(async () => cached());
  expect(io.copy).toHaveBeenCalledTimes(2);
  await act(async () => old.reject(new Error("retired")));
  expect(node.querySelector('[role="alert"]')).toBeNull();
});
