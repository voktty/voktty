// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { NewEditorDialog } from "@/modules/editor/NewEditorDialog";
import { useWorkspaceEnvStore, LOCAL_WORKSPACE } from "@/modules/workspace";
import type { ComponentProps, ReactNode } from "react";
const calls = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: calls.invoke }));
vi.mock("@/components/ui/dialog", () => {
  const Box = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div>{children}</div> : null,
    DialogContent: Box,
    DialogDescription: Box,
    DialogFooter: Box,
    DialogHeader: Box,
    DialogTitle: Box,
  };
});
vi.mock("@/components/ui/button", () => ({
  Button: ({
    variant: _variant,
    ...props
  }: ComponentProps<"button"> & { variant?: string }) => (
    <button type="button" {...props} />
  ),
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: ComponentProps<"input">) => <input {...props} />,
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const previous = useWorkspaceEnvStore.getState().env;
  useWorkspaceEnvStore.setState({ env: LOCAL_WORKSPACE });
  calls.invoke.mockReset().mockResolvedValue("/root/untitled.txt");
  const container = document.createElement("div");
  const mounted = createRoot(container);
  let open = true;
  let rootPath = "/root";
  let key = {};
  let current = true;
  const created = vi.fn();
  const change = vi.fn();
  const render = () =>
    act(async () =>
      mounted.render(
        <StrictMode>
          <NewEditorDialog
            open={open}
            rootPath={rootPath}
            requestKey={key}
            isCurrent={() => current}
            onCreated={created}
            onOpenChange={change}
          />
        </StrictMode>,
      ),
    );
  await render();
  const save = () =>
    [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Save",
    );
  return {
    render,
    created,
    change,
    save,
    container,
    current: (value: boolean) => {
      current = value;
    },
    open: (value: boolean) => {
      open = value;
    },
    replace: () => {
      key = {};
      rootPath = "/next";
    },
    close: async () => {
      await act(async () => mounted.unmount());
      useWorkspaceEnvStore.setState({ env: previous });
    },
  };
}
it("captures the filesystem when opened rather than reading global state on submit", async () => {
  const fixture = await setup();
  try {
    useWorkspaceEnvStore.setState({ env: { kind: "wsl", distro: "Debian" } });
    await act(async () => fixture.save()?.click());
    expect(calls.invoke).toHaveBeenCalledExactlyOnceWith("create_path", {
      parent: "/root",
      name: "untitled.txt",
      isDir: false,
    });
    expect(fixture.created).toHaveBeenCalledExactlyOnceWith(
      "/root/untitled.txt",
      LOCAL_WORKSPACE,
    );
    expect(fixture.change).toHaveBeenCalledExactlyOnceWith(false);
  } finally {
    await fixture.close();
  }
});
it("coalesces duplicate submits until the admitted file creation settles", async () => {
  const fixture = await setup();
  let finish!: (path: string) => void;
  calls.invoke.mockReturnValueOnce(
    new Promise((yes) => {
      finish = yes;
    }),
  );
  try {
    await act(async () => {
      fixture.save()?.click();
      fixture.save()?.click();
    });
    expect(calls.invoke).toHaveBeenCalledOnce();
    expect(fixture.save()?.disabled).toBe(true);
    await act(async () => finish("/root/untitled.txt"));
    expect(fixture.created).toHaveBeenCalledOnce();
  } finally {
    await fixture.close();
  }
});
it.each(["retirement", "replacement", "close", "unmount"] as const)(
  "does not publish a file or close a successor after %s",
  async (change) => {
    const fixture = await setup();
    let finish!: (path: string) => void;
    calls.invoke.mockReturnValueOnce(
      new Promise((yes) => {
        finish = yes;
      }),
    );
    let closed = false;
    try {
      await act(async () => fixture.save()?.click());
      if (change === "retirement") fixture.current(false);
      if (change === "replacement") {
        fixture.replace();
        await fixture.render();
      }
      if (change === "close") {
        fixture.open(false);
        await fixture.render();
        fixture.open(true);
        await fixture.render();
      }
      if (change === "unmount") {
        await fixture.close();
        closed = true;
      }
      await act(async () => finish("/root/untitled.txt"));
      expect(fixture.created).not.toHaveBeenCalled();
      expect(fixture.change).not.toHaveBeenCalled();
    } finally {
      if (!closed) await fixture.close();
    }
  },
);
it("observes a late failure without replacing the successor dialog error or busy state", async () => {
  const fixture = await setup();
  let fail!: (error: Error) => void;
  calls.invoke.mockReturnValueOnce(
    new Promise((_yes, no) => {
      fail = no;
    }),
  );
  let finish!: (path: string) => void;
  calls.invoke.mockReturnValueOnce(
    new Promise((yes) => {
      finish = yes;
    }),
  );
  try {
    await act(async () => fixture.save()?.click());
    fixture.replace();
    await fixture.render();
    await act(async () => fixture.save()?.click());
    await act(async () => fail(new Error("Old error")));
    expect(fixture.container.textContent).not.toContain("Old error");
    expect(fixture.save()?.disabled).toBe(true);
    expect(fixture.created).not.toHaveBeenCalled();
    await act(async () => finish("/next/untitled.txt"));
    expect(fixture.created).toHaveBeenCalledExactlyOnceWith(
      "/next/untitled.txt",
      LOCAL_WORKSPACE,
    );
  } finally {
    await fixture.close();
  }
});

it("retires a cancelled creation synchronously before the controlled close commits", async () => {
  const fixture = await setup();
  let finish!: (path: string) => void;
  calls.invoke.mockReturnValueOnce(
    new Promise((yes) => {
      finish = yes;
    }),
  );
  try {
    await act(async () => fixture.save()?.click());
    await act(async () =>
      [...fixture.container.querySelectorAll("button")]
        .find((button) => button.textContent === "Cancel")
        ?.click(),
    );
    expect(fixture.change).toHaveBeenCalledExactlyOnceWith(false);
    await act(async () => finish("/root/untitled.txt"));
    expect(fixture.created).not.toHaveBeenCalled();
    expect(fixture.change).toHaveBeenCalledOnce();
  } finally {
    await fixture.close();
  }
});
