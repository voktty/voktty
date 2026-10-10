// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  setWorktreeFocus,
  worktreeFocus,
  type WorktreeFocus,
} from "../lib/worktreeFocus";
import { createWorktree } from "../lib/worktrees";
import { SidebarWorktreeSwitcher } from "./SidebarWorktreeSwitcher";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(async () => true),
  createWorktree: vi.fn(),
}));

vi.mock("../hooks/useProjectWorktrees", () => ({
  useProjectWorktrees: () => ({
    data: {
      worktrees: [
        { path: "/picker", branch: "main", isMain: true },
        { path: "/picker-a", branch: "feature-a", isMain: false },
        { path: "/picker-b", branch: "feature-b", isMain: false },
      ],
    },
    refresh: mocks.refresh,
  }),
}));
vi.mock("../lib/worktrees", () => ({ createWorktree: mocks.createWorktree }));
let root: Root;
let container: HTMLDivElement;
const select = vi.fn<(focus?: WorktreeFocus) => void>();
const render = async (pending = false, switchError?: string) => {
  await act(async () =>
    root.render(
      createElement(SidebarWorktreeSwitcher, {
        cwd: "/picker",
        onSelect: select,
        pending,
        switchError,
      }),
    ),
  );
};
function requiredElement<T extends Element>(
  element: T | null | undefined,
  description: string,
): T {
  if (!element) throw new Error(`Missing ${description}`);
  return element;
}
const trigger = () =>
  requiredElement(
    container.querySelector<HTMLButtonElement>(
      '[aria-label="Switch working copy"]',
    ),
    "worktree switcher trigger",
  );
const findOption = (name: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
    (button) => button.textContent?.includes(name),
  );
const option = (name: string) =>
  requiredElement(findOption(name), `worktree option ${name}`);
const changeInput = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  setWorktreeFocus("/picker", undefined);
  select.mockReset();
  mocks.refresh.mockClear();
  mocks.createWorktree.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("requests a switch without publishing the destination and permits a newer selection", async () => {
  await render();
  await act(async () => trigger().click());
  await act(async () => option("feature-a").click());
  expect(select).toHaveBeenLastCalledWith({
    path: "/picker-a",
    branch: "feature-a",
  });
  expect(worktreeFocus("/picker")).toBeUndefined();
  await render(true);
  expect(trigger().getAttribute("aria-busy")).toBe("true");
  expect(trigger().textContent).toBe("Workspace");
  await act(async () => trigger().click());
  await act(async () => option("feature-b").click());
  expect(select).toHaveBeenLastCalledWith({
    path: "/picker-b",
    branch: "feature-b",
  });
  expect(worktreeFocus("/picker")).toBeUndefined();
});

it("shows a switch failure in the reopened picker", async () => {
  await render();
  await render(false, "Working copy no longer exists");
  expect(trigger().getAttribute("aria-expanded")).toBe("true");
  expect(document.querySelector('[role="alert"]')?.textContent).toBe(
    "Working copy no longer exists",
  );
  expect(trigger().textContent).toBe("Workspace");
});

it("filters working copies by branch and path", async () => {
  await render();
  await act(async () => trigger().click());
  const input = requiredElement(
    document.querySelector<HTMLInputElement>(
      '[aria-label="Search working copies"]',
    ),
    "worktree search input",
  );
  await act(async () => {
    changeInput(input, "feature-b");
  });

  expect(findOption("feature-b")).toBeTruthy();
  expect(findOption("feature-a")).toBeUndefined();
});

it("creates a worktree from a search with no matching result", async () => {
  const created = {
    path: "/picker-feature-new",
    branch: "feature/new",
    head: "abc123",
    isMain: false,
    locked: false,
    prunable: false,
    missing: false,
    dirty: null,
    unpushed: null,
    sessionIds: [],
  };
  mocks.createWorktree.mockResolvedValue(created);
  await render();
  await act(async () => trigger().click());
  const input = requiredElement(
    document.querySelector<HTMLInputElement>(
      '[aria-label="Search working copies"]',
    ),
    "worktree search input",
  );
  await act(async () => {
    changeInput(input, "feature/new");
  });
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Create worktree feature/new"))
      ?.click(),
  );

  expect(createWorktree).toHaveBeenCalledWith(
    "/picker",
    "feature/new",
    "HEAD",
    false,
  );
  expect(mocks.refresh).toHaveBeenCalled();
  expect(select).toHaveBeenLastCalledWith({
    path: created.path,
    branch: created.branch,
  });
});

it("requests fallback from a deleted worktree once and does not retry while pending or failed", async () => {
  setWorktreeFocus("/picker", { path: "/deleted", branch: "gone" });
  await render();
  expect(select).toHaveBeenCalledExactlyOnceWith(undefined);
  await render(true);
  await render(false, "Could not switch working copy");
  expect(select).toHaveBeenCalledTimes(1);
  expect(worktreeFocus("/picker")?.path).toBe("/deleted");
});
