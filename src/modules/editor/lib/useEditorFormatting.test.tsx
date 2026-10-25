// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEditorFormatting } from "@/modules/editor/lib/useEditorFormatting";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { LOCAL_WORKSPACE, type WorkspaceEnv } from "@/modules/workspace";

const io = vi.hoisted(() => ({
  invoke: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("sonner", () => ({ toast: { warning: io.warning, error: io.error } }));
let root: Root;
let actions: ReturnType<typeof useEditorFormatting>;
let state: EditorState;
let view: EditorView;
let save: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
let formatLsp: ReturnType<
  typeof vi.fn<
    (
      view: EditorView,
      isCurrent?: () => boolean,
    ) => Promise<"done" | "unsupported">
  >
>;
let adopt: ReturnType<typeof vi.fn<(text: string, mtime: number) => string>>;
let baseline: ReturnType<
  typeof vi.fn<(view: EditorView, content: string) => void>
>;
let saved: ReturnType<typeof vi.fn<(isCurrent: () => boolean) => void>>;
let lspActive: boolean;
function Reader({
  path = "/work/first.ts",
  workspace = LOCAL_WORKSPACE,
}: {
  path?: string;
  workspace?: WorkspaceEnv;
}) {
  actions = useEditorFormatting({
    path,
    workspaceEnv: workspace,
    getView: () => view,
    getLanguage: () => "ts",
    isLspActive: () => lspActive,
    formatLsp,
    save,
    adoptDiskText: adopt,
    onBaseline: baseline,
    onSaved: saved,
  });
  return null;
}
async function render(path = "/work/first.ts", workspace?: WorkspaceEnv) {
  await act(async () =>
    root.render(<Reader path={path} workspace={workspace} />),
  );
}
function edit(content: string) {
  state = state.update({
    changes: { from: 0, to: state.doc.length, insert: content },
  }).state;
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  state = EditorState.create({ doc: "original" });
  view = {
    get state() {
      return state;
    },
    dispatch: (transaction: Parameters<EditorState["update"]>[0]) => {
      state = state.update(transaction).state;
    },
  } as EditorView;
  save = vi.fn(async () => true);
  formatLsp = vi.fn<
    (
      view: EditorView,
      isCurrent?: () => boolean,
    ) => Promise<"done" | "unsupported">
  >(async () => "done");
  adopt = vi.fn((content: string) => content);
  baseline = vi.fn<(view: EditorView, content: string) => void>();
  saved = vi.fn<(isCurrent: () => boolean) => void>();
  lspActive = false;
  usePreferencesStore.setState({
    editorFormatter: "prettier",
    editorFormatterByLang: {},
    editorFormatOnSave: true,
    editorCustomFormatCommand: "",
  });
  io.invoke.mockImplementation(async (command: string) =>
    command === "fs_read_file"
      ? { kind: "text", content: "formatted", mtime: 2 }
      : { exit_code: 0, timed_out: false, stdout: "", stderr: "" },
  );
  root = createRoot(document.createElement("div"));
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("saves before manual external formatting and adopts only the captured document", async () => {
  const order: string[] = [];
  save.mockImplementation(async () => {
    order.push("save");
    return true;
  });
  io.invoke.mockImplementation(async (command: string) => {
    order.push(command);
    return command === "fs_read_file"
      ? { kind: "text", content: "formatted", mtime: 2 }
      : { exit_code: 0, timed_out: false, stdout: "", stderr: "" };
  });
  await render();
  await act(async () => actions.format());
  expect(order).toEqual(["save", "shell_run_command", "fs_read_file"]);
  expect(state.doc.toString()).toBe("formatted");
  expect(adopt).toHaveBeenCalledExactlyOnceWith("formatted", 2);
  expect(baseline).toHaveBeenLastCalledWith(view, "formatted");
});

it("does not run a formatter after a save conflict", async () => {
  save.mockResolvedValue(false);
  await render();
  await act(async () => actions.format());
  expect(io.invoke).not.toHaveBeenCalled();
  expect(adopt).not.toHaveBeenCalled();
});

it("retires pending saves and cached actions across a source round trip", async () => {
  let finish!: (value: boolean) => void;
  save.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  const old = actions;
  let pending!: Promise<void>;
  await act(async () => {
    pending = old.save();
  });
  await render("/work/second.ts");
  await render();
  await act(async () => {
    finish(true);
    await pending;
    await old.format();
  });
  expect(io.invoke).not.toHaveBeenCalled();
  expect(saved).not.toHaveBeenCalled();
  expect(baseline).not.toHaveBeenCalled();
});

it("does not format a newer buffer after its save settles", async () => {
  let finish!: (value: boolean) => void;
  save.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  let pending!: Promise<void>;
  await act(async () => {
    pending = actions.save();
  });
  edit("new typing");
  await act(async () => {
    finish(true);
    await pending;
  });
  expect(io.invoke).not.toHaveBeenCalled();
  expect(state.doc.toString()).toBe("new typing");
  expect(baseline).toHaveBeenCalledWith(view, "original");
  expect(saved).toHaveBeenCalledOnce();
});

it("does not replace newer typing with a delayed formatter read-back", async () => {
  let finish!: (value: object) => void;
  io.invoke.mockImplementation(async (command: string) =>
    command === "fs_read_file"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : { exit_code: 0, timed_out: false, stdout: "", stderr: "" },
  );
  await render();
  let pending!: Promise<void>;
  await act(async () => {
    pending = actions.format();
  });
  await vi.waitFor(() => expect(io.invoke).toHaveBeenCalledTimes(2));
  edit("new typing");
  await act(async () => {
    finish({ kind: "text", content: "stale", mtime: 2 });
    await pending;
  });
  expect(adopt).not.toHaveBeenCalled();
  expect(state.doc.toString()).toBe("new typing");
});

it("does not read or publish after retiring an accepted shell command", async () => {
  let finish!: (value: object) => void;
  io.invoke.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  let pending!: Promise<void>;
  await act(async () => {
    pending = actions.save();
  });
  await vi.waitFor(() => expect(io.invoke).toHaveBeenCalledOnce());
  await render("/work/second.ts");
  await act(async () => {
    finish({
      exit_code: 1,
      timed_out: false,
      stdout: "",
      stderr: "retired failure",
    });
    await pending;
  });
  expect(io.invoke).toHaveBeenCalledOnce();
  expect(saved).not.toHaveBeenCalled();
  expect(io.error).not.toHaveBeenCalled();
});

it("captures formatter preferences before awaiting the save", async () => {
  let finish!: (value: boolean) => void;
  save.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  let pending!: Promise<void>;
  await act(async () => {
    pending = actions.save();
  });
  usePreferencesStore.setState({
    editorFormatter: "custom",
    editorCustomFormatCommand: "other {file}",
  });
  await act(async () => {
    finish(true);
    await pending;
  });
  expect(io.invoke.mock.calls[0][1].command).toContain("prettier --write");
});

it("saves remote documents while exposing unsupported formatting without native IO", async () => {
  await render("remote://voktty-ssh-fixture/work/file.ts");
  expect(actions.unavailableReason).toBeTruthy();
  await act(async () => actions.format());
  expect(save).not.toHaveBeenCalled();
  await act(async () => actions.save());
  expect(save).toHaveBeenCalledOnce();
  expect(saved).toHaveBeenCalledOnce();
  expect(io.invoke).not.toHaveBeenCalled();
  expect(io.warning).toHaveBeenCalled();
});

it("does not save after an old LSP format completes", async () => {
  let finish!: (result: "done") => void;
  usePreferencesStore.setState({ editorFormatter: "lsp" });
  lspActive = true;
  formatLsp.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  let pending!: Promise<void>;
  await act(async () => {
    pending = actions.save();
  });
  await render("/work/second.ts");
  expect(formatLsp.mock.calls[0][1]?.()).toBe(false);
  await act(async () => {
    finish("done");
    await pending;
  });
  expect(save).not.toHaveBeenCalled();
  expect(io.invoke).not.toHaveBeenCalled();
});

it("retains the mounted StrictMode owner for current actions", async () => {
  await act(async () =>
    root.render(
      <StrictMode>
        <Reader />
      </StrictMode>,
    ),
  );
  await act(async () => actions.save());
  expect(save).toHaveBeenCalledOnce();
  expect(saved).toHaveBeenCalledOnce();
  expect(state.doc.toString()).toBe("formatted");
});

it("serializes document saves and formatting through actual native settlement", async () => {
  let finish!: (value: object) => void;
  io.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = actions.save();
    second = actions.format();
  });
  await vi.waitFor(() => expect(io.invoke).toHaveBeenCalledOnce());
  expect(save).toHaveBeenCalledOnce();
  await act(async () => {
    finish({ exit_code: 0, timed_out: false, stdout: "", stderr: "" });
    await first;
    await second;
  });
  expect(save).toHaveBeenCalledTimes(2);
  expect(io.invoke.mock.calls.map(([command]) => command)).toEqual([
    "shell_run_command",
    "fs_read_file",
    "shell_run_command",
    "fs_read_file",
  ]);
});

it("does not start a queued operation after its document retires", async () => {
  let finish!: (value: object) => void;
  io.invoke.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  let first!: Promise<void>;
  let second!: Promise<void>;
  await act(async () => {
    first = actions.save();
    second = actions.format();
  });
  await vi.waitFor(() => expect(io.invoke).toHaveBeenCalledOnce());
  await act(async () => root.render(null));
  await act(async () => {
    finish({ exit_code: 0, timed_out: false, stdout: "", stderr: "" });
    await first;
    await second;
  });
  expect(save).toHaveBeenCalledOnce();
  expect(io.invoke).toHaveBeenCalledOnce();
  expect(saved).not.toHaveBeenCalled();
});

it("does not adopt a read-back after its view unmounts", async () => {
  let finish!: (value: object) => void;
  io.invoke.mockImplementation(async (command: string) =>
    command === "fs_read_file"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : { exit_code: 0, timed_out: false, stdout: "", stderr: "" },
  );
  await render();
  let pending!: Promise<void>;
  await act(async () => {
    pending = actions.save();
  });
  await vi.waitFor(() => expect(io.invoke).toHaveBeenCalledTimes(2));
  await act(async () => root.render(null));
  await act(async () => {
    finish({ kind: "text", content: "stale", mtime: 2 });
    await pending;
  });
  expect(adopt).not.toHaveBeenCalled();
  expect(saved).not.toHaveBeenCalled();
  expect(baseline).toHaveBeenCalledOnce();
});

it("retains queued and retired operation capacity until physical settlement", async () => {
  let finish!: (value: boolean) => void;
  save.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await render();
  let cohort!: Promise<void>;
  await act(async () => {
    cohort = Promise.all(
      Array.from({ length: 256 }, () => actions.save()),
    ).then(() => {});
  });
  expect(save).toHaveBeenCalledOnce();
  await render("/work/second.ts");
  await act(async () => actions.format());
  expect(save).toHaveBeenCalledOnce();
  expect(io.error).toHaveBeenCalledOnce();
  await act(async () => {
    finish(true);
    await cohort;
  });
  expect(io.invoke).not.toHaveBeenCalled();
  await act(async () => actions.format());
  expect(save).toHaveBeenCalledTimes(2);
  expect(state.doc.toString()).toBe("formatted");
});
