// @vitest-environment happy-dom
import { createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, expect, it, vi } from "vitest";

const pty = vi.hoisted(() => ({
  spawnPty: vi.fn(async (..._args: unknown[]) => {}),
  killPty: vi.fn(async () => {}),
  resizePty: vi.fn(async () => {}),
  writePty: vi.fn(async (_data: string) => {}),
  subscribePty: vi.fn(
    (
      _id: string,
      _data: (data: Uint8Array) => void,
      _exit: (code: number | null) => void,
    ) =>
      () => {},
  ),
  getPtyStatus: vi.fn(
    async (): Promise<{ foreground: string | null }> => ({ foreground: null }),
  ),
}));
const pickerUi = vi.hoisted(() => ({ props: null as unknown }));
const owned = vi.hoisted(() => ({ close: vi.fn(), write: vi.fn() }));
const input = vi.hoisted(() => ({
  handler: null as ((data: string) => void) | null,
}));
vi.mock("../lib/pty", () => ({
  ...pty,
  startOwnedPty: (...args: unknown[]) => ({
    ready: pty.spawnPty(...args),
    isCurrent: () => true,
    status: pty.getPtyStatus,
    write: (data: string) => {
      owned.write(data);
      return pty.writePty(data);
    },
    resize: pty.resizePty,
    close: () => {
      owned.close();
      return pty.killPty();
    },
  }),
}));
vi.mock("@/modules/ssh/components/SshSessionPickerModal", () => ({
  SshSessionPickerModal: (props: unknown) => {
    pickerUi.props = props;
    return null;
  },
}));
vi.mock("../lib/terminalLayout", () => ({
  fitTerminal: () => null,
  applyTerminalChrome: () => {},
  resetGridStretch: () => {},
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
    parser = { registerOscHandler: () => ({ dispose() {} }) };
    buffer = {
      active: { type: "normal" },
      onBufferChange: () => ({ dispose() {} }),
    };
    open() {}
    focus() {}
    dispose() {}
    writeln() {}
    onData(handler: (data: string) => void) {
      input.handler = handler;
      return { dispose() {} };
    }
    onRender() {
      return { dispose() {} };
    }
    attachCustomKeyEventHandler() {}
    attachCustomWheelEventHandler() {}
  },
}));
import { TerminalView } from "./TerminalView";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  const host = document.createElement("div");
  document.body.appendChild(host);
  return { host, root: createRoot(host) };
}

it("does not let StrictMode cleanup kill the replacement shell", async () => {
  const { host, root } = setup();
  try {
    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(TerminalView, {
            id: "same-id",
            cwd: "/tmp",
            active: true,
          }),
        ),
      );
    });
    expect(pty.spawnPty).toHaveBeenCalledTimes(1);
    expect(pty.subscribePty).toHaveBeenCalledTimes(1);
    expect(pty.killPty).not.toHaveBeenCalled();
  } finally {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  }
  expect(pty.killPty).toHaveBeenCalledTimes(1);
});

it("retires its captured owner on unmount rather than issuing a logical-id close directly", async () => {
  const { host, root } = setup();
  await act(async () => {
    root.render(
      createElement(TerminalView, {
        id: "captured-owner",
        cwd: "/tmp",
        active: true,
      }),
    );
  });
  expect(owned.close).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  host.remove();
  expect(owned.close).toHaveBeenCalledOnce();
  expect(pty.killPty).toHaveBeenCalledOnce();
});

it("observes a rejected teardown without leaking an unhandled rejection", async () => {
  const { host, root } = setup();
  await act(async () => {
    root.render(
      createElement(TerminalView, {
        id: "failed-helper-cleanup",
        cwd: "/srv/app",
        active: true,
      }),
    );
  });
  pty.killPty.mockRejectedValueOnce(new Error("helper cleanup pending"));
  await act(async () => root.unmount());
  host.remove();
  expect(owned.close).toHaveBeenCalledOnce();
});

it("routes input through the captured PTY owner and suppresses it after unmount", async () => {
  const { host, root } = setup();
  await act(async () => {
    root.render(
      createElement(TerminalView, {
        id: "owned-input",
        cwd: "/tmp",
        active: true,
      }),
    );
  });
  const send = input.handler;
  await act(async () => send?.("current\r"));
  expect(owned.write).toHaveBeenCalledExactlyOnceWith("current\r");
  await act(async () => root.unmount());
  host.remove();
  await act(async () => send?.("retired\r"));
  expect(owned.write).toHaveBeenCalledOnce();
});

it("discards an outstanding foreground result when its view unmounts", async () => {
  const { host, root } = setup();
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  const onMetaChange = vi.fn();
  let resolve!: (status: { foreground: string | null }) => void;
  pty.getPtyStatus.mockReturnValueOnce(
    new Promise((accept) => {
      resolve = accept;
    }),
  );
  try {
    await act(async () => {
      root.render(
        createElement(TerminalView, {
          id: "status-read",
          cwd: "/tmp",
          active: true,
          onMetaChange,
        }),
      );
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(pty.getPtyStatus).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    await act(async () => resolve({ foreground: "retired build" }));
    expect(onMetaChange).not.toHaveBeenCalled();
  } finally {
    hidden.mockRestore();
    host.remove();
  }
});

it("clears foreground metadata on the captured exit without reading a successor", async () => {
  const { host, root } = setup();
  const onMetaChange = vi.fn();
  await act(async () => {
    root.render(
      createElement(TerminalView, {
        id: "exiting",
        cwd: "/srv/app",
        active: true,
        onMetaChange,
      }),
    );
  });
  const exit = pty.subscribePty.mock.calls[0][2];
  await act(async () => exit(0));
  expect(onMetaChange).toHaveBeenCalledExactlyOnceWith({
    foreground: null,
    title: "app",
  });
  expect(pty.getPtyStatus).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  host.remove();
});

it("uses the existing SSH picker for an active terminal and passes its choice", async () => {
  const { host, root } = setup();
  try {
    await act(async () => {
      root.render(
        createElement(TerminalView, {
          id: "active-remote",
          cwd: "remote://voktty-ssh-profile-1/srv/app",
          active: true,
        }),
      );
    });

    const launch = pty.spawnPty.mock.calls[0]?.[4] as {
      multiplexerPicker: (
        connection: { id: string; name: string; host: string },
        probe: {
          supported: boolean;
          sessions: [];
        },
      ) => Promise<{ action: "attach"; sessionName: string } | null>;
    };
    expect(launch.multiplexerPicker).toBeTypeOf("function");

    const connection = { id: "profile-1", name: "Build host", host: "build" };
    const probe = { supported: true, sessions: [] as [] };
    let selection!: Promise<{ action: "attach"; sessionName: string } | null>;
    await act(async () => {
      selection = launch.multiplexerPicker(connection, probe);
    });
    expect(pickerUi.props).toMatchObject({ open: true, connection, probe });

    const picker = pickerUi.props as {
      onSelect: (action: "attach", sessionName: string) => void;
    };
    await act(async () => {
      picker.onSelect("attach", "build-session");
    });
    await expect(selection).resolves.toEqual({
      action: "attach",
      sessionName: "build-session",
    });
  } finally {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  }
});

it("does not prompt for tmux when a Harness terminal is not active", async () => {
  const { host, root } = setup();
  try {
    await act(async () => {
      root.render(
        createElement(TerminalView, {
          id: "inactive-remote",
          cwd: "remote://voktty-ssh-profile-1/srv/app",
          active: false,
        }),
      );
    });
    expect(pty.spawnPty.mock.calls[0]?.[4]).toBeUndefined();
  } finally {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  }
});

it("resolves a pending tmux picker when the terminal unmounts", async () => {
  const { host, root } = setup();
  let unmounted = false;
  try {
    await act(async () => {
      root.render(
        createElement(TerminalView, {
          id: "unmount-picker",
          cwd: "remote://voktty-ssh-profile-1/srv/app",
          active: true,
        }),
      );
    });
    const launch = pty.spawnPty.mock.calls[0]?.[4] as {
      multiplexerPicker: (
        connection: { id: string; name: string; host: string },
        probe: { supported: boolean; sessions: [] },
      ) => Promise<unknown>;
    };
    let selection!: Promise<unknown>;
    await act(async () => {
      selection = launch.multiplexerPicker(
        { id: "profile-1", name: "Build host", host: "build" },
        { supported: true, sessions: [] },
      );
    });

    await act(async () => {
      root.unmount();
    });
    unmounted = true;
    await expect(selection).resolves.toBeNull();
  } finally {
    if (!unmounted) {
      await act(async () => {
        root.unmount();
      });
    }
    host.remove();
  }
});

it("waits for a pending same-id startup and cleanup before starting again", async () => {
  const { host, root } = setup();
  const operations: string[] = [];
  let releaseSpawn!: () => void;
  pty.subscribePty.mockImplementation(() => {
    operations.push("subscribe");
    return () => {
      operations.push("unsubscribe");
    };
  });
  pty.spawnPty
    .mockImplementationOnce(() => {
      operations.push("spawn old");
      return new Promise<void>((resolve) => {
        releaseSpawn = resolve;
      });
    })
    .mockImplementationOnce(async () => {
      operations.push("spawn replacement");
    });
  pty.killPty.mockImplementation(async () => {
    operations.push("kill");
  });
  // A new `key` remounts a fresh instance with the same PTY id, as moving a
  // terminal between the dock and a file pane does.
  const view = (key: string) =>
    createElement(TerminalView, {
      key,
      id: "moved",
      cwd: "/tmp",
      active: true,
    });
  try {
    await act(async () => {
      root.render(view("dock"));
    });
    await act(async () => {
      root.render(view("pane"));
    });
    expect(operations).toEqual(["subscribe", "spawn old"]);
    await act(async () => {
      releaseSpawn();
    });
    expect(operations).toEqual([
      "subscribe",
      "spawn old",
      "unsubscribe",
      "kill",
      "subscribe",
      "spawn replacement",
    ]);
  } finally {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  }
});

it("does not hold a different terminal behind another one's teardown", async () => {
  const { host, root } = setup();
  pty.spawnPty.mockImplementationOnce(() => new Promise<void>(() => {}));
  try {
    await act(async () => {
      root.render(
        createElement(TerminalView, { id: "first", cwd: "/tmp", active: true }),
      );
    });
    await act(async () => {
      root.render(
        createElement(TerminalView, {
          id: "second",
          cwd: "/tmp",
          active: true,
        }),
      );
    });
    expect(pty.spawnPty).toHaveBeenCalledTimes(2);
    expect(pty.spawnPty).toHaveBeenLastCalledWith("second", "/tmp", 80, 24, {
      multiplexerPicker: expect.any(Function),
    });
  } finally {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  }
});
