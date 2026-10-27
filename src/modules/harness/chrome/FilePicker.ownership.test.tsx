// @vitest-environment happy-dom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FilePicker } from "@/modules/harness/chrome/FilePicker";
import { invalidateProjectFiles } from "@/modules/harness/lib/fileIndex";
import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";
import { usePreferencesStore } from "@/modules/settings/preferences";

const io = vi.hoisted(() => ({
  list: vi.fn(),
  open: vi.fn(),
  close: vi.fn(),
  action: vi.fn(),
}));
vi.mock("@/modules/connections/model/remoteCommands", () => ({
  readCapturedProjectIndex: io.list,
}));
vi.mock("@/modules/harness/chrome/FileTypeIcon", () => ({
  FileTypeIcon: () => null,
}));

const cwd = "remote://voktty-ssh-fixture/srv/project";
const profile = { id: "fixture", name: "Fixture", host: "original.invalid" };
const files = (name: string) => [
  { name, relative: name, path: `${cwd}/${name}` },
];
let root: Root;
let scroll: PropertyDescriptor | undefined;

async function render(open = true, initialQuery = "original", strict = true) {
  await act(async () => {
    root.render(
      createElement(
        strict ? StrictMode : "div",
        null,
        createElement(FilePicker, {
          open,
          cwd,
          initialQuery,
          onOpenFile: io.open,
          onRunAction: io.action,
          onClose: io.close,
        }),
      ),
    );
  });
  await act(async () => {
    await vi.dynamicImportSettled();
  });
}

function option() {
  const row = document.querySelector<HTMLButtonElement>('[role="option"]');
  expect(row).not.toBeNull();
  if (!row) throw new Error("Expected a picker option.");
  return row;
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
  io.list.mockResolvedValue(files("original.ts"));
  root = createRoot(document.createElement("div"));
  await render();
});

afterEach(async () => {
  await act(async () => root.unmount());
  invalidateProjectFiles();
  localStorage.clear();
  usePreferencesStore.setState({ sshConnections: [] });
  if (scroll)
    Object.defineProperty(Element.prototype, "scrollIntoView", scroll);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  vi.unstubAllGlobals();
});

it.each(["profile", "roundtrip", "project", "missing"])(
  "rejects a captured row across %s replacement before React commits",
  async (mode) => {
    const row = option();
    await act(async () => {
      if (mode === "project") {
        rememberRemoteProject("voktty-ssh-fixture", {
          id: "replacement",
          name: "Project",
          cwd: "/srv/project",
        });
      } else {
        usePreferencesStore.setState({
          sshConnections:
            mode === "missing"
              ? []
              : [{ ...profile, host: "replacement.invalid" }],
        });
        if (mode === "roundtrip") {
          usePreferencesStore.setState({ sshConnections: [profile] });
        }
      }
      row.click();
    });
    expect(io.open).not.toHaveBeenCalled();
    expect(io.close).not.toHaveBeenCalled();
  },
);

it("loads the replacement source and keeps its current row usable", async () => {
  io.list.mockResolvedValue(files("original-new.ts"));
  await act(async () => {
    usePreferencesStore.setState({
      sshConnections: [{ ...profile, host: "replacement.invalid" }],
    });
  });
  expect(option().textContent).toContain("original-new.ts");
  await act(async () => option().click());
  expect(io.open).toHaveBeenCalledExactlyOnceWith(`${cwd}/original-new.ts`);
  expect(io.close).toHaveBeenCalledOnce();
});

it("retries the current source when the view subscribed before the index cache", async () => {
  await act(async () => root.unmount());
  invalidateProjectFiles();
  root = createRoot(document.createElement("div"));
  await render(true, "original", false);
  io.list.mockResolvedValue(files("original-new.ts"));
  await act(async () => {
    usePreferencesStore.setState({
      sshConnections: [{ ...profile, host: "replacement.invalid" }],
    });
  });
  expect(option().textContent).toContain("original-new.ts");
  await act(async () => option().click());
  expect(io.open).toHaveBeenCalledExactlyOnceWith(`${cwd}/original-new.ts`);
});

it("does not close a successor after opening retires the original source", async () => {
  io.open.mockImplementation(() => {
    usePreferencesStore.setState({ sshConnections: [] });
  });
  await act(async () => option().click());
  expect(io.open).toHaveBeenCalledExactlyOnceWith(`${cwd}/original.ts`);
  expect(io.close).not.toHaveBeenCalled();
  expect(document.querySelector('[role="option"]')).toBeNull();
});

it("withdraws rows while the replacement read is pending", async () => {
  let resolve!: (value: ReturnType<typeof files>) => void;
  io.list.mockReturnValue(
    new Promise<ReturnType<typeof files>>((accept) => {
      resolve = accept;
    }),
  );
  await act(async () => {
    usePreferencesStore.setState({
      sshConnections: [{ ...profile, host: "replacement.invalid" }],
    });
  });
  expect(document.querySelector('[role="option"]')).toBeNull();
  await act(async () => resolve(files("original-new.ts")));
  expect(option().textContent).toContain("original-new.ts");
});

it("keeps global palette commands usable without a saved SSH source", async () => {
  await act(async () => {
    usePreferencesStore.setState({ sshConnections: [] });
  });
  await render(true, ">");
  await act(async () => option().click());
  expect(io.action).toHaveBeenCalledExactlyOnceWith("reload");
  expect(io.close).toHaveBeenCalledOnce();
  expect(io.open).not.toHaveBeenCalled();
});

it("reopens against the current source after a hidden profile round trip", async () => {
  await render(false);
  const reads = io.list.mock.calls.length;
  await act(async () => {
    usePreferencesStore.setState({ sshConnections: [] });
    usePreferencesStore.setState({ sshConnections: [profile] });
  });
  expect(io.list).toHaveBeenCalledTimes(reads);
  io.list.mockResolvedValue(files("original-reopened.ts"));
  await render();
  expect(option().textContent).toContain("original-reopened.ts");
  await act(async () => option().click());
  expect(io.open).toHaveBeenCalledExactlyOnceWith(
    `${cwd}/original-reopened.ts`,
  );
});
