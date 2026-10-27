// @vitest-environment happy-dom
import type { DragDropEvent } from "@tauri-apps/api/webview";
import { act, type ComponentProps, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "./Composer";
import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";
import { usePreferencesStore } from "@/modules/settings/preferences";

const { invoke, listen, platform } = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  platform: { isWin: false },
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({ onDragDropEvent: listen }),
}));
vi.mock("../lib/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/platform")>()),
  get IS_WIN() {
    return platform.isWin;
  },
}));
vi.mock("./useComposerSkills", () => ({
  useComposerSkills: () => ({ skills: [], refresh: vi.fn() }),
}));

type NativeHandler = (event: { payload: DragDropEvent }) => void;
type ComposerProps = ComponentProps<typeof Composer>;

let container: HTMLDivElement;
let root: Root;
let handlers: Set<NativeHandler>;
let submit: ComposerProps["onSubmit"];
let submitSpy: ComposerProps["onSubmit"];
let mounted: boolean;

async function render(props: Partial<ComposerProps> = {}) {
  await act(async () => {
    root.render(
      createElement(
        "div",
        { "data-session-drop": "session-1" },
        createElement(Composer, {
          focused: false,
          harness: "codex",
          model: "",
          runtimeMode: "supervised",
          executionCwd: "~",
          hideTopBar: true,
          onFocus: vi.fn(),
          onCwdChange: vi.fn(),
          onModelChange: vi.fn(),
          onRuntimeModeChange: vi.fn(),
          onSubmit: submit,
          ...props,
        }),
      ),
    );
  });
  mounted = true;
  const session = container.querySelector<HTMLElement>("[data-session-drop]");
  if (!session) throw new Error("Session drop target was not rendered");
  session.getBoundingClientRect = () =>
    ({
      left: 0,
      top: 0,
      right: 500,
      bottom: 500,
      width: 500,
      height: 500,
      x: 0,
      y: 0,
      toJSON: () => undefined,
    }) as DOMRect;
  return session;
}

async function nativeDrop(paths: string[], x = 100, y = 100) {
  await act(async () => {
    for (const handler of handlers) {
      handler({
        payload: { type: "drop", paths, position: { x, y } } as DragDropEvent,
      });
    }
  });
}

function domDrop(
  target: HTMLElement,
  items: Array<{ kind: string; type: string; getAsFile: () => File | null }>,
) {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    value: { types: [], files: [], items },
  });
  target.dispatchEvent(event);
  return event;
}

function attachmentCount() {
  return container.querySelectorAll('button[aria-label^="Remove "]').length;
}

async function holdDropAndSend(props: Partial<ComposerProps> = {}) {
  let finish!: () => void;
  let fail!: () => void;
  invoke.mockImplementation((command: string) => {
    if (command === "inspect_paths") {
      return new Promise((resolve, reject) => {
        finish = () =>
          resolve([
            {
              path: "/project/image.png",
              name: "image.png",
              size: 12,
              isDir: false,
            },
          ]);
        fail = () => reject(new Error("fixture inspection failed"));
      });
    }
    return Promise.resolve("aW1hZ2U=");
  });
  await render({ initialDraft: "original", ...props });
  await nativeDrop(["/project/image.png"]);
  await act(async () => {
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Send"]')
      ?.click();
  });
  expect(submitSpy).not.toHaveBeenCalled();
  return async (failed = false) => {
    await act(async () => {
      if (failed) fail();
      else finish();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  platform.isWin = false;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  handlers = new Set();
  submitSpy = vi.fn<ComposerProps["onSubmit"]>();
  submit = (text, attachments, options) =>
    submitSpy(text, attachments, options);
  listen.mockReset();
  listen.mockImplementation(async (handler: NativeHandler) => {
    handlers.add(handler);
    return () => handlers.delete(handler);
  });
  invoke.mockReset();
  invoke.mockImplementation(
    async (command: string, args?: { paths?: string[] }) => {
      if (command === "inspect_paths") {
        return (args?.paths ?? []).map((path) => ({
          path,
          name: path.split(/[\\/]/).pop() ?? "file.txt",
          size: 12,
          isDir: false,
        }));
      }
      if (command === "read_file_base64") return "aW1hZ2U=";
      return [];
    },
  );
});

afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Composer file drops", () => {
  it("does not send a replacement draft after a pending drop finishes", async () => {
    const finish = await holdDropAndSend();
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("Composer textarea was not rendered");
    await act(async () => {
      textarea.value = "replacement";
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await finish();
    expect(submitSpy).not.toHaveBeenCalled();
    expect(textarea.value).toBe("replacement");
    expect(attachmentCount()).toBe(1);
  });

  it("keeps a draft roundtrip retired even when input events share one commit", async () => {
    const finish = await holdDropAndSend();
    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("Composer textarea was not rendered");
    await act(async () => {
      for (const value of ["replacement", "original"]) {
        textarea.value = value;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await finish();
    expect(submitSpy).not.toHaveBeenCalled();
    expect(textarea.value).toBe("original");
  });

  it("lets a new context submit without waiting for its predecessor's drop", async () => {
    const finish = await holdDropAndSend();
    await render({ initialDraft: "original", executionCwd: "/replacement" });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Send"]')
        ?.click();
    });
    expect(submitSpy).toHaveBeenCalledWith("original", [], undefined);
    await finish();
    expect(submitSpy).toHaveBeenCalledOnce();
    expect(attachmentCount()).toBe(0);
  });

  it("does not submit or retain attachments when unmounted during the wait", async () => {
    const finish = await holdDropAndSend();
    await act(async () => root.unmount());
    mounted = false;
    await finish();
    expect(submitSpy).not.toHaveBeenCalled();
  });

  it("does not silently submit without a dropped file whose read fails", async () => {
    const finish = await holdDropAndSend();
    await finish(true);
    expect(submitSpy).not.toHaveBeenCalled();
    expect(container.querySelector("textarea")?.value).toBe("original");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("coalesces repeated Send clicks during the same drop wait", async () => {
    const finish = await holdDropAndSend();
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Send"]')
        ?.click();
    });
    await finish();
    expect(submitSpy).toHaveBeenCalledOnce();
  });

  it("uses the original submission callback after an ordinary rerender", async () => {
    const finish = await holdDropAndSend();
    const replacement = vi.fn();
    await render({ initialDraft: "original", onSubmit: replacement });
    await finish();
    expect(replacement).not.toHaveBeenCalled();
    expect(submitSpy).toHaveBeenCalledOnce();
  });

  it.each([
    { executionCwd: "/replacement" },
    { cwd: "/replacement" },
    { enabled: false },
    { harness: "claude" as const },
    { model: "replacement" },
  ])(
    "retires the pending submission after a context roundtrip: %j",
    async (changed) => {
      const finish = await holdDropAndSend();
      await render({ initialDraft: "original", ...changed });
      await render({ initialDraft: "original" });
      await finish();
      expect(submitSpy).not.toHaveBeenCalled();
      expect(container.querySelector("textarea")?.value).toBe("original");
    },
  );

  it("does not adopt a saved SSH profile after a connection roundtrip", async () => {
    const cwd = "remote://voktty-ssh-fixture/srv/project";
    const profile = {
      id: "fixture",
      name: "Fixture",
      host: "original.invalid",
    };
    rememberRemoteProject("voktty-ssh-fixture", {
      id: "project",
      name: "Project",
      cwd: "/srv/project",
    });
    usePreferencesStore.setState({ sshConnections: [profile] });
    try {
      const finish = await holdDropAndSend({ executionCwd: cwd });
      usePreferencesStore.setState({ sshConnections: [] });
      usePreferencesStore.setState({ sshConnections: [profile] });
      await finish();
      expect(submitSpy).not.toHaveBeenCalled();
    } finally {
      usePreferencesStore.setState({ sshConnections: [] });
      localStorage.clear();
    }
  });

  it("explains native image drops without paths and accepts the DOM fallback", async () => {
    const session = await render();

    await nativeDrop([]);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Save the image",
    );

    const file = Object.assign(
      new File(["image"], "image.png", { type: "image/png" }),
      { path: "/project/image.png" },
    );
    await act(async () => {
      domDrop(session, [
        { kind: "file", type: "image/png", getAsFile: () => file },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(attachmentCount()).toBe(1);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("reports attachment read failures without exposing the path", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "inspect_paths") {
        throw new Error("Could not read /private/customer/image.png");
      }
      return "aW1hZ2U=";
    });
    await render();

    await nativeDrop(["/private/customer/image.png"]);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    const alert = container.querySelector('[role="alert"]')?.textContent ?? "";
    expect(alert).toContain("Could not attach the file");
    expect(alert).not.toContain("/private/customer/image.png");
  });

  it("reports when the dropped path no longer exists", async () => {
    invoke.mockImplementation(async (command: string) => {
      if (command === "inspect_paths") return [];
      return "aW1hZ2U=";
    });
    await render();

    await nativeDrop(["/project/moved-image.png"]);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Could not attach the file",
    );
  });

  it("accepts file items when FileList and transfer types are empty", async () => {
    const session = await render();
    const file = Object.assign(
      new File(["image"], "image.png", { type: "image/png" }),
      { path: "/project/image.png" },
    );

    await act(async () => {
      domDrop(session, [
        { kind: "file", type: "image/png", getAsFile: () => file },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(attachmentCount()).toBe(1);
  });

  it("scales Windows native coordinates before checking the session bounds", async () => {
    platform.isWin = true;
    vi.stubGlobal("devicePixelRatio", 2);
    vi.stubGlobal("innerWidth", 1200);
    vi.stubGlobal("innerHeight", 1000);
    const session = await render();
    session.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 200,
        right: 600,
        bottom: 450,
        width: 500,
        height: 250,
        x: 100,
        y: 200,
        toJSON: () => undefined,
      }) as DOMRect;

    await nativeDrop(["/project/image.png"], 600, 600);

    expect(attachmentCount()).toBe(1);
  });

  it("keeps macOS logical coordinates on a Retina display", async () => {
    vi.stubGlobal("devicePixelRatio", 2);
    const session = await render();
    session.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 200,
        right: 600,
        bottom: 450,
        width: 500,
        height: 250,
        x: 100,
        y: 200,
        toJSON: () => undefined,
      }) as DOMRect;

    await nativeDrop(["/project/image.png"], 200, 300);

    expect(attachmentCount()).toBe(1);
  });

  it("uses current attachment support without replacing the native listener", async () => {
    await render();
    await render({ harness: "fx" });
    await nativeDrop(["/project/image.png"]);

    expect(listen).toHaveBeenCalledTimes(1);
    expect(attachmentCount()).toBe(0);

    await render({ harness: "codex" });
    await nativeDrop(["/project/image.png"]);

    expect(listen).toHaveBeenCalledTimes(1);
    expect(attachmentCount()).toBe(1);
  });

  it("starts accepting file drops when a disabled composer becomes ready", async () => {
    await render({ enabled: false });
    await render({ enabled: true });
    await nativeDrop(["/project/image.png"]);

    expect(attachmentCount()).toBe(1);
  });

  it("does not attach native drops outside the session pane", async () => {
    await render();
    await nativeDrop(["/project/image.png"], 600, 600);

    expect(attachmentCount()).toBe(0);
  });

  it("waits for a native drop read before submitting", async () => {
    let finishInspection:
      | ((
          infos: Array<{
            path: string;
            name: string;
            size: number;
            isDir: boolean;
          }>,
        ) => void)
      | undefined;
    invoke.mockImplementation((command: string) => {
      if (command === "inspect_paths") {
        return new Promise((resolve) => {
          finishInspection = resolve;
        });
      }
      return Promise.resolve("aW1hZ2U=");
    });
    await render({ initialDraft: "send this" });

    await nativeDrop(["/project/image.png"]);
    await act(async () => {
      const send = container.querySelector<HTMLButtonElement>(
        'button[aria-label="Send"]',
      );
      if (!send) throw new Error("Send button was not rendered");
      send.click();
    });
    expect(submitSpy).not.toHaveBeenCalled();

    await act(async () => {
      finishInspection?.([
        {
          path: "/project/image.png",
          name: "image.png",
          size: 12,
          isDir: false,
        },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(submitSpy).toHaveBeenCalledWith(
      "send this",
      [expect.objectContaining({ name: "image.png", data: "aW1hZ2U=" })],
      undefined,
    );
    expect(attachmentCount()).toBe(0);
  });

  it("discards a pending drop after attachment support is disabled", async () => {
    let finishInspection:
      | ((
          infos: Array<{
            path: string;
            name: string;
            size: number;
            isDir: boolean;
          }>,
        ) => void)
      | undefined;
    invoke.mockImplementation((command: string) => {
      if (command === "inspect_paths") {
        return new Promise((resolve) => {
          finishInspection = resolve;
        });
      }
      return Promise.resolve("aW1hZ2U=");
    });
    await render();

    await nativeDrop(["/project/image.png"]);
    await render({ harness: "fx" });
    await render({ harness: "codex" });
    await act(async () => {
      finishInspection?.([
        {
          path: "/project/image.png",
          name: "image.png",
          size: 12,
          isDir: false,
        },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(attachmentCount()).toBe(0);
  });

  it("unlistens when registration completes after the Composer unmounts", async () => {
    let finishRegistration: (() => void) | undefined;
    listen.mockImplementation((handler: NativeHandler) => {
      handlers.add(handler);
      return new Promise((resolve) => {
        const unlisten = vi.fn(() => handlers.delete(handler));
        finishRegistration = () => resolve(unlisten);
      });
    });
    await render();

    await act(async () => root.unmount());
    mounted = false;
    await act(async () => finishRegistration?.());

    expect(handlers.size).toBe(0);
  });

  it("unlistens when native registration finishes after disabling", async () => {
    let finishRegistration: (() => void) | undefined;
    listen.mockImplementation((handler: NativeHandler) => {
      handlers.add(handler);
      return new Promise((resolve) => {
        finishRegistration = () => resolve(() => handlers.delete(handler));
      });
    });
    await render();
    await render({ enabled: false });

    await act(async () => finishRegistration?.());

    expect(handlers.size).toBe(0);
  });

  it("processes a native drop once when the browser also reports it", async () => {
    const session = await render();
    const file = Object.assign(
      new File(["image"], "image.png", { type: "image/png" }),
      { path: "/project/image.png" },
    );

    await nativeDrop(["/project/image.png"]);
    await act(async () => {
      domDrop(session, [
        { kind: "file", type: "image/png", getAsFile: () => file },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(attachmentCount()).toBe(1);
    expect(
      invoke.mock.calls.filter(([command]) => command === "inspect_paths"),
    ).toHaveLength(1);
  });
});
