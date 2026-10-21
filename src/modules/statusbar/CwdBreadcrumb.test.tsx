// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./lib/breadcrumbDirectories", () => ({
  readBreadcrumbDirectories: mocks.read,
}));
vi.mock("@/modules/settings/preferences", () => ({
  usePreferencesStore: (selector: (state: unknown) => unknown) =>
    selector({ sshConnections: [], showHidden: false }),
}));
vi.mock("@/modules/i18n", () => ({
  t: (key: string) => key,
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/ui/dropdown-menu", async () => {
  const React = await import("react");
  const Context = React.createContext({
    open: false,
    onOpenChange: (_open: boolean) => {},
  });
  return {
    DropdownMenu: ({
      open = false,
      onOpenChange = () => {},
      children,
    }: {
      open?: boolean;
      onOpenChange?: (open: boolean) => void;
      children: ReactNode;
    }) =>
      React.createElement(
        Context.Provider,
        { value: { open, onOpenChange } },
        children,
      ),
    DropdownMenuTrigger: ({ children }: { children: ReactNode }) => {
      const state = React.useContext(Context);
      return React.createElement(
        "button",
        {
          "data-trigger": true,
          onClick: () => state.onOpenChange(!state.open),
        },
        children,
      );
    },
    DropdownMenuContent: ({ children }: { children: ReactNode }) =>
      React.useContext(Context).open
        ? React.createElement("div", { "data-menu": true }, children)
        : null,
    DropdownMenuItem: ({ children }: { children: ReactNode }) =>
      React.createElement("div", null, children),
  };
});

import { CwdBreadcrumb } from "./CwdBreadcrumb";
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const render = async (cwd: string) => {
  await act(async () => {
    root.render(createElement(CwdBreadcrumb, { cwd, onCd: () => {} }));
  });
};
const toggle = async () => {
  await act(async () => {
    const trigger =
      container.querySelector<HTMLButtonElement>("[data-trigger]");
    expect(trigger).not.toBeNull();
    trigger?.click();
  });
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.read.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.unstubAllGlobals();
});

it("never replaces a new directory result with an older pending result", async () => {
  let finish!: (directories: string[]) => void;
  mocks.read
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(["fresh"]);
  await render("/one");
  expect(mocks.read).not.toHaveBeenCalled();
  await toggle();
  expect(container.textContent).toContain("statusbar.cwd.loading");
  await render("/two");
  expect(container.textContent).toContain("fresh");
  await act(async () => {
    finish(["stale"]);
  });
  expect(container.textContent).toContain("fresh");
  expect(container.textContent).not.toContain("stale");
});

it("does not publish a rejected old request over a newer successful request", async () => {
  let fail!: (reason: Error) => void;
  mocks.read
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    )
    .mockResolvedValueOnce(["fresh"]);
  await render("/one");
  await toggle();
  await render("/two");
  await act(async () => {
    fail(new Error("old error"));
  });
  expect(container.textContent).toContain("fresh");
  expect(container.textContent).not.toContain("old error");
});

it("invalidates pending results when the dropdown closes and reloads on reopen", async () => {
  let finish!: (directories: string[]) => void;
  mocks.read
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce(["reopened"]);
  await render("/one");
  await toggle();
  await toggle();
  await act(async () => {
    finish(["closed result"]);
  });
  expect(container.querySelector("[data-menu]")).toBeNull();
  await toggle();
  expect(container.textContent).toContain("reopened");
  expect(container.textContent).not.toContain("closed result");
});

it("does not publish a late result after the view unmounts", async () => {
  let finish!: (directories: string[]) => void;
  mocks.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render("/one");
  await toggle();
  await act(async () => {
    root.render(null);
  });
  await act(async () => {
    finish(["unmounted"]);
  });
  expect(container.textContent).toBe("");
});
