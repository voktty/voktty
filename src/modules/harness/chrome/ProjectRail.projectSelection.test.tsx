// @vitest-environment happy-dom

import { HarnessProjectOwner } from "@/modules/harness/hooks/useHarnessProjectSelection";
import {
  projectKey,
  setRemoteRootLabelResolver,
} from "@/modules/harness/lib/paths";
import { saveTabGroupLabel } from "@/modules/harness/lib/tabGroups";
import { subscribeHarnessProjectRequests } from "@/modules/surfaces/lib/harnessProjectRequest";
import { asTabKey } from "@/modules/tabs/lib/tabIdentity";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dialogs: [] as { onOpen: (path: string) => void; onCancel: () => void }[],
  menus: [] as { label: string; onExtraPick: (action: string) => void }[],
}));
vi.mock("@/modules/harness/chrome/TabGroupMenu", () => ({
  TabGroupMenu: (props: {
    label: string;
    onExtraPick: (action: string) => void;
  }) => {
    mocks.menus.push(props);
    return <div data-project-menu>{props.label}</div>;
  },
}));
vi.mock("@/modules/harness/chrome/ProjectBackgroundDialog", () => ({
  ProjectBackgroundDialog: ({ name }: { name: string }) => (
    <div data-background>{name}</div>
  ),
}));
vi.mock("@/modules/harness/chrome/RemoveProjectDialog", () => ({
  RemoveProjectDialog: ({ name }: { name: string }) => (
    <div data-removing>{name}</div>
  ),
}));
vi.mock("@/modules/connections/ui/AddRemoteProjectDialog", () => ({
  AddRemoteProjectDialog: (props: {
    onOpen: (path: string) => void;
    onCancel: () => void;
  }) => {
    mocks.dialogs.push(props);
    return <div role="dialog" />;
  },
}));
vi.mock("@/modules/i18n", () => ({
  t: (key: string) => key,
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/modules/harness/chrome/TitleBar", () => ({
  TabVisitNav: () => null,
}));
vi.mock("@/modules/harness/chrome/SettingsRail", () => ({
  SettingsNav: () => null,
}));
vi.mock("@/modules/harness/chrome/ProjectMascot", () => ({
  ProjectMascot: () => null,
}));
vi.mock("@/modules/harness/hooks/useProjectAvailability", () => ({
  useProjectAvailability: () => ({
    unavailablePaths: new Set(),
    recheckPath: vi.fn(),
  }),
}));
vi.mock("@/modules/harness/hooks/useProjectDiffStats", () => ({
  useProjectDiffStats: () => null,
}));
vi.mock("@/modules/harness/hooks/useTabGroupLogos", () => ({
  useTabGroupLogos: () => ({}),
}));
vi.mock("@/modules/harness/lib/fs", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listExternalEditors: vi.fn().mockResolvedValue([]),
}));

import { ProjectRail } from "@/modules/harness/chrome/ProjectRail";

function required<T>(value: T | null | undefined): T {
  if (value === null || value === undefined)
    throw new Error("Missing project selection fixture");
  return value;
}

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  mocks.dialogs = [];
  mocks.menus = [];
  setRemoteRootLabelResolver(() => undefined);
  localStorage.clear();
  vi.unstubAllGlobals();
});

async function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const element = document.createElement("div");
  const root = createRoot(element);
  cleanups.push(async () => {
    await act(async () => root.unmount());
  });
  const selected = vi.fn();
  cleanups.push(subscribeHarnessProjectRequests(selected));
  const render = async (ownerId = 1, cwd = "/project") => {
    await act(async () =>
      root.render(
        <HarnessProjectOwner
          value={{ ownerId, tabKey: asTabKey(`tab-${ownerId}`) }}
        >
          <ProjectRail
            cwd={cwd}
            recents={[]}
            onSelectProject={vi.fn()}
            onOpenProject={vi.fn()}
            onRemoveProject={vi.fn()}
          />
        </HarnessProjectOwner>,
      ),
    );
  };
  const open = async () => {
    await act(async () =>
      required(
        element.querySelector<HTMLButtonElement>(
          'button[title="harness.connections.openRemoteProject"]',
        ),
      ).click(),
    );
    return required(mocks.dialogs[mocks.dialogs.length - 1]);
  };
  await render();
  return { render, open, selected, element };
}

it("returns a remote folder to its original view without a DOM selection event", async () => {
  const f = await setup();
  const legacy = vi.fn();
  window.addEventListener("voktty:harness-select-project", legacy);
  cleanups.push(() =>
    window.removeEventListener("voktty:harness-select-project", legacy),
  );
  const picker = await f.open();
  await act(async () => picker.onOpen("remote://machine/project"));
  expect(f.selected).toHaveBeenCalledExactlyOnceWith({
    path: "remote://machine/project",
    target: { ownerId: 1, tabKey: "tab-1" },
  });
  expect(legacy).not.toHaveBeenCalled();
  expect(f.element.querySelector('[role="dialog"]')).toBeNull();
});

it("does not let a cancelled picker affect its successor", async () => {
  const f = await setup();
  const old = await f.open();
  await act(async () => old.onCancel());
  const current = await f.open();
  await act(async () => old.onOpen("/late"));
  expect(f.selected).not.toHaveBeenCalled();
  expect(f.element.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => current.onOpen("/current"));
  expect(f.selected).toHaveBeenCalledExactlyOnceWith({
    path: "/current",
    target: { ownerId: 1, tabKey: "tab-1" },
  });
});

it.each(["owner", "project"])(
  "retires the picker after the original %s changes",
  async (change) => {
    const f = await setup();
    const picker = await f.open();
    await f.render(
      change === "owner" ? 2 : 1,
      change === "project" ? "/other" : "/project",
    );
    await act(async () => picker.onOpen("/late"));
    expect(f.selected).not.toHaveBeenCalled();
    expect(f.element.querySelector('[role="dialog"]')).toBeNull();
  },
);

it.each(["card", "menu", "background", "delete"])(
  "names the remote root in its %s presentation",
  async (presentation) => {
    setRemoteRootLabelResolver((id) =>
      id === "voktty-ssh-profile" ? "Development server" : undefined,
    );
    const f = await setup();
    await f.render(1, "remote://voktty-ssh-profile/");
    if (presentation === "card") {
      expect(
        f.element
          .querySelector('button[aria-current="true"]')
          ?.getAttribute("aria-label"),
      ).toBe("Development server");
      return;
    }
    await act(async () =>
      required(
        f.element.querySelector<HTMLButtonElement>(
          'button[title="harness.chrome.projectOptions"]',
        ),
      ).click(),
    );
    const menu = required(mocks.menus[mocks.menus.length - 1]);
    if (presentation === "menu") expect(menu.label).toBe("Development server");
    else {
      await act(async () => menu.onExtraPick(presentation));
      expect(
        f.element.querySelector(
          presentation === "background"
            ? "[data-background]"
            : "[data-removing]",
        )?.textContent,
      ).toBe("Development server");
    }
  },
);

it("preserves custom project names over a remote connection name", async () => {
  const path = "remote://voktty-ssh-profile/";
  setRemoteRootLabelResolver(() => "Development server");
  saveTabGroupLabel(projectKey(path), "Custom root");
  const f = await setup();
  await f.render(1, path);
  expect(
    f.element
      .querySelector('button[aria-current="true"]')
      ?.getAttribute("aria-label"),
  ).toBe("Custom root");
});
