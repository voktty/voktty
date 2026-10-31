// @vitest-environment happy-dom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AiComposerInput } from "@/modules/ai/components/AiComposerInput";
import {
  useChatStore,
  type FileCitationSource,
} from "@/modules/ai/store/chatStore";
import type { useComposer } from "@/modules/ai/lib/composer";
import { SLASH_COMMANDS } from "@/modules/ai/lib/slashCommands";
import { t } from "@/modules/i18n";

const fixture = vi.hoisted(() => ({
  composer: null as ReturnType<typeof useComposer> | null,
  pick: null as ((path: string) => void) | null,
  guestRead: vi.fn(),
}));
vi.mock("@/modules/ai/lib/composer", () => ({
  useComposer: () => fixture.composer,
}));
vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => children,
  PopoverAnchor: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/modules/ai/components/FilePicker", () => ({
  FilePickerContent: ({ onPick }: { onPick: (path: string) => void }) => {
    fixture.pick = onPick;
    return null;
  },
}));
vi.mock("@/modules/ai/components/SnippetPicker", () => ({
  SnippetPickerContent: () => null,
}));
vi.mock("@/modules/preview", () => ({ LiveComponentBadge: () => null }));
vi.mock("@/modules/ai/hooks/useWorkspaceFiles", () => ({
  useWorkspaceFiles: () => ({ files: ["file.ts"], hasWorkspace: true }),
}));
vi.mock("@/modules/collab/lib/guestRuntime", () => ({
  readGuestFile: fixture.guestRead,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));

let root: Root | null;
let container: HTMLDivElement;
let source: FileCitationSource;
let frames: FrameRequestCallback[];
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (frame: FrameRequestCallback) =>
    frames.push(frame),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  source = { kind: "local", root: "/repo", workspace: { kind: "local" } };
  useChatStore.setState({
    activeSessionId: "original",
    sessions: ["original", "selected"].map((id) => ({
      id,
      title: id,
      createdAt: 1,
      updatedAt: 1,
    })),
    live: {
      ...useChatStore.getState().live,
      getFileCitationSource: () => source,
    },
  });
  fixture.pick = null;
  fixture.guestRead.mockReset();
  fixture.composer = {
    value: "@",
    textareaRef: { current: null },
    voice: {},
    setValue: vi.fn(),
    attachFileByPath: vi.fn(async () => true),
    attachTextFile: vi.fn(() => true),
  } as unknown as ReturnType<typeof useComposer>;
  container = document.createElement("div");
  root = createRoot(container);
  await act(async () => root?.render(createElement(AiComposerInput)));
  expect(fixture.pick).toBeTypeOf("function");
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
});

it.each([
  ["/init", [], true],
  ["  #init details ", [], true],
  ["notes", [SLASH_COMMANDS.init], true],
  ["/plan", [SLASH_COMMANDS.init], false],
  ["#custom", [SLASH_COMMANDS.init], false],
  ["notes", [SLASH_COMMANDS.plan, SLASH_COMMANDS.init], false],
  ["/initialize", [], false],
  ["normal draft", [], false],
] as const)(
  "explains init only when it will run for %s",
  async (value, pickedCommands, visible) => {
    const composer = fixture.composer;
    if (!composer) throw new Error("Missing composer fixture");
    composer.value = value;
    composer.pickedCommands = [...pickedCommands];
    composer.submit = vi.fn();
    await act(async () => root?.render(createElement(AiComposerInput)));
    const textarea = composer.textareaRef.current;
    expect(textarea).not.toBeNull();
    const helpId = textarea?.getAttribute("aria-describedby");
    const help = helpId ? container.querySelector(`[id="${helpId}"]`) : null;
    if (visible) expect(help?.textContent).toBe(t("ai.slashCommands.initHelp"));
    else expect(helpId).toBeNull();
    expect(composer.submit).not.toHaveBeenCalled();
    expect(fixture.guestRead).not.toHaveBeenCalled();
  },
);

it("passes the original filesystem and root to native attachment reads", async () => {
  source = {
    kind: "local",
    root: "/repo",
    workspace: {
      kind: "ssh",
      root: "/repo",
      sessionId: 1,
      connection: { id: "fixture", name: "Fixture", host: "example.test" },
    },
  };
  await act(async () => root?.render(createElement(AiComposerInput)));
  await act(async () => fixture.pick?.("file.ts"));
  expect(fixture.composer?.attachFileByPath).toHaveBeenCalledWith(
    "/repo/file.ts",
    source.workspace,
    expect.any(Function),
  );
});

it.each(["source", "chat", "unmount"])(
  "does not focus a late native attachment after %s retirement",
  async (mode) => {
    const composer = fixture.composer;
    if (!composer) throw new Error("Missing composer fixture");
    let finish!: (accepted: boolean) => void;
    vi.mocked(composer.attachFileByPath).mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const textarea = composer.textareaRef.current;
    if (!textarea) throw new Error("Missing textarea fixture");
    const focus = vi.spyOn(textarea, "focus");
    await act(async () => fixture.pick?.("file.ts"));
    const guard = vi.mocked(composer.attachFileByPath).mock.calls[0][2];
    await act(async () => {
      if (mode === "source") {
        source = {
          kind: "local",
          root: "/different",
          workspace: { kind: "local" },
        };
        root?.render(createElement(AiComposerInput));
      } else if (mode === "chat")
        useChatStore.setState({ activeSessionId: "selected" });
      else {
        root?.unmount();
        root = null;
      }
    });
    expect(guard?.()).toBe(false);
    await act(async () => finish(true));
    for (const frame of frames) frame(0);
    expect(focus).not.toHaveBeenCalled();
  },
);

it("does not insert a guest citation after its source changes", async () => {
  source = { kind: "collab", leafId: 1, available: true };
  await act(async () => root?.render(createElement(AiComposerInput)));
  let finish!: (result: { path: string; content: string }) => void;
  fixture.guestRead.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => fixture.pick?.("file.ts"));
  source = { kind: "collab", leafId: 2, available: true };
  await act(async () => {
    root?.render(createElement(AiComposerInput));
    finish({ path: "file.ts", content: "retired" });
  });
  expect(fixture.composer?.attachTextFile).not.toHaveBeenCalled();
});
