// @vitest-environment happy-dom
import { act, StrictMode, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InboxDiscussionPanel } from "@/modules/harness/surfaces/InboxDiscussionPanel";

vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/modules/harness/chrome/TitleBar", () => ({
  IconButton: ({
    label,
    onClick,
    disabled,
  }: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    />
  ),
}));

type Props = ComponentProps<typeof InboxDiscussionPanel>;
const item: Props["item"] = {
  provider: "github",
  kind: "issue",
  number: 1,
  title: "One",
  url: "https://github.com/acme/app/issues/1",
  projectPath: "/work/app",
  state: "OPEN",
  updatedAt: "2026-10-23",
  labels: [],
  assignees: [],
  draft: false,
  repo: "acme/app",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
async function render(props: Props) {
  await act(async () =>
    root.render(
      <StrictMode>
        <InboxDiscussionPanel {...props} />
      </StrictMode>,
    ),
  );
}
function restart() {
  const button = host.querySelector<HTMLButtonElement>(
    "button[aria-label='harness.chrome.restartConversation']",
  );
  if (!button) throw new Error("Missing restart button");
  return button;
}
function fixture() {
  return {
    item,
    onClose: vi.fn(),
    onOpen: vi.fn(async () => "initial"),
    onRestart: vi.fn(async () => "replacement"),
    onMount: vi.fn(),
  };
}

it.each(["resolve", "reject"] as const)(
  "ignores an old restart %s after selecting another item",
  async (outcome) => {
    const props = fixture();
    const old = deferred<string>();
    props.onRestart.mockReturnValue(old.promise);
    await render(props);
    await act(async () => restart().click());
    const next = deferred<string>();
    props.onOpen.mockReturnValue(next.promise);
    await render({
      ...props,
      item: { ...item, number: 2, url: "https://github.com/acme/app/issues/2" },
    });
    props.onMount.mockClear();
    await act(async () => {
      if (outcome === "resolve") old.resolve("old-replacement");
      else old.reject(new Error("Old failure"));
    });
    expect(props.onMount).not.toHaveBeenCalled();
    expect(host.querySelector("[role='alert']")).toBeNull();
    expect(restart().disabled).toBe(true);
    await act(async () => next.resolve("new-item"));
    expect(props.onMount).toHaveBeenCalledWith({
      sessionId: "new-item",
      host: expect.any(HTMLElement),
    });
    expect(restart().disabled).toBe(false);
  },
);

it("retires the original restart when the portal callback changes", async () => {
  const props = fixture();
  const old = deferred<string>();
  props.onRestart.mockReturnValue(old.promise);
  await render(props);
  await act(async () => restart().click());
  const mount = vi.fn();
  await render({ ...props, onMount: mount });
  props.onMount.mockClear();
  mount.mockClear();
  await act(async () => old.resolve("old-replacement"));
  expect(props.onMount).not.toHaveBeenCalled();
  expect(mount).not.toHaveBeenCalled();
});

it("publishes a current restart and does not reopen on metadata-only refresh", async () => {
  const props = fixture();
  await render(props);
  props.onOpen.mockClear();
  await render({ ...props, item: { ...item, title: "Updated" } });
  expect(props.onOpen).not.toHaveBeenCalled();
  props.onMount.mockClear();
  await act(async () => restart().click());
  expect(props.onMount).toHaveBeenCalledWith({
    sessionId: "replacement",
    host: expect.any(HTMLElement),
  });
  expect(restart().disabled).toBe(false);
});

it("shows a current restart failure and permits retry", async () => {
  const props = fixture();
  props.onRestart.mockRejectedValueOnce(new Error("Current failure"));
  await render(props);
  await act(async () => restart().click());
  expect(host.querySelector("[role='alert']")?.textContent).toContain(
    "Current failure",
  );
  expect(restart().disabled).toBe(false);
  await act(async () => restart().click());
  expect(host.querySelector("[role='alert']")).toBeNull();
  expect(props.onRestart).toHaveBeenCalledTimes(2);
});

it("admits only one restart before the disabled button commits", async () => {
  const props = fixture();
  const gate = deferred<string>();
  props.onRestart.mockReturnValue(gate.promise);
  await render(props);
  await act(async () => {
    restart().click();
    restart().click();
  });
  expect(props.onRestart).toHaveBeenCalledOnce();
  await act(async () => gate.resolve("replacement"));
});
