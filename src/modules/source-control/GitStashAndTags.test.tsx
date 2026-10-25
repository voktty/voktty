// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  StashDropdown,
  TagDropdown,
} from "@/modules/source-control/GitStashAndTags";

const mocks = vi.hoisted(() => ({
  listStash: vi.fn(),
  listTags: vi.fn(),
  mutate: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/modules/ai/lib/native", () => ({
  native: {
    gitStashList: mocks.listStash,
    gitTagList: mocks.listTags,
    gitStashApply: mocks.mutate,
    gitStashPop: mocks.mutate,
    gitStashDrop: mocks.mutate,
    gitStashSave: mocks.mutate,
    gitTagDelete: mocks.mutate,
    gitTagPush: mocks.mutate,
    gitTagCreate: mocks.mutate,
  },
}));
let root: Root;
let node: HTMLDivElement;
const refresh = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.listStash
    .mockReset()
    .mockResolvedValue([
      { index: 0, sha: "abc", message: "Changes", timestampSecs: 1 },
    ]);
  mocks.listTags.mockReset().mockResolvedValue([
    {
      name: "v1",
      sha: "abc",
      annotated: false,
      message: null,
      timestampSecs: 1,
    },
  ]);
  mocks.mutate.mockReset();
  mocks.success.mockReset();
  mocks.error.mockReset();
  refresh.mockReset();
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(async () => {
  await act(async () => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});
async function open(kind: "stash" | "tag", path = "/repo") {
  await act(async () =>
    root.render(
      kind === "stash" ? (
        <StashDropdown repoRoot={path} onRefresh={refresh} />
      ) : (
        <TagDropdown repoRoot={path} headSha={null} onRefresh={refresh} />
      ),
    ),
  );
  const trigger = node.querySelector<HTMLButtonElement>(
    `button[title="${kind === "stash" ? "Stashes" : "Tags"}"]`,
  );
  await act(async () =>
    trigger?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    ),
  );
}
it.each([
  ["stash", "Apply"],
  ["stash", "Pop (apply and remove)"],
  ["stash", "Drop"],
  ["tag", "Delete tag"],
  ["tag", "Push to remote"],
] as const)(
  "suppresses a late %s %s result after unmount",
  async (kind, label) => {
    let done!: () => void;
    mocks.mutate.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          done = resolve;
        }),
    );
    await open(kind);
    const button = document.querySelector<HTMLButtonElement>(
      `button[title="${label}"]`,
    );
    expect(button).not.toBeNull();
    await act(async () => button?.click());
    expect(mocks.mutate).toHaveBeenCalledOnce();
    await act(async () => root.render(null));
    await act(async () => done());
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  },
);
it("does not save or announce a stash twice from two immediate submits", async () => {
  let done!: () => void;
  mocks.mutate.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        done = resolve;
      }),
  );
  await open("stash");
  const add = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "New",
  );
  await act(async () => add?.click());
  const submit = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent?.trim() === "Save stash");
  expect(submit).toBeDefined();
  await act(async () => {
    submit?.click();
    submit?.click();
  });
  expect(mocks.mutate).toHaveBeenCalledTimes(1);
  await act(async () => {
    done();
  });
});

it("does not close a replacement tag dialog when a dismissed creation finishes", async () => {
  let done!: () => void;
  mocks.mutate.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        done = resolve;
      }),
  );
  await open("tag");
  const add = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "New",
  );
  await act(async () => add?.click());
  const input = document.querySelector<HTMLInputElement>(
    'input[placeholder="v1.0.0"]',
  );
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, "v2");
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const create = [
    ...document.querySelectorAll<HTMLButtonElement>("button"),
  ].find((button) => button.textContent?.trim() === "Create tag");
  expect(create?.disabled).toBe(false);
  await act(async () => create?.click());
  expect(mocks.mutate).toHaveBeenCalledOnce();
  await act(async () =>
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await open("tag");
  const next = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === "New",
  );
  await act(async () => next?.click());
  await act(async () => done());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(
    document.querySelector<HTMLInputElement>('input[placeholder="v1.0.0"]')
      ?.value,
  ).toBe("");
  expect(
    document.querySelector<HTMLInputElement>('input[placeholder="v1.0.0"]')
      ?.disabled,
  ).toBe(false);
  expect(mocks.success).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});
