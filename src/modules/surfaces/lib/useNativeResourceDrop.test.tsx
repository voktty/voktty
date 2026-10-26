// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useNativeResourceDrop } from "@/modules/surfaces/lib/useNativeResourceDrop";
import { useChatStore } from "@/modules/ai/store/chatStore";
import { useWorkspaceEnvStore } from "@/modules/workspace";
import { asSlotId, asViewSpaceId } from "@/modules/spaces/lib/spaceLayout";

const io = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: io.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
let root: Root;
let run: ReturnType<typeof useNativeResourceDrop>;
const unavailable = vi.fn();
const drop = vi.fn();
function Probe({
  sourceKey,
  deliver,
}: {
  sourceKey: string;
  deliver: typeof drop;
}) {
  run = useNativeResourceDrop({
    viewSpaceId: asViewSpaceId("view-fixture"),
    sourceKey,
    drop: deliver,
    onUnavailable: unavailable,
  });
  return null;
}
async function render(sourceKey = "original", deliver = drop) {
  await act(async () =>
    root.render(createElement(Probe, { sourceKey, deliver })),
  );
}
const event = {
  dataTransfer: { getData: () => "file:///native/file.ts" },
} as unknown as React.DragEvent<HTMLElement>;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.createElement("div"));
  useChatStore.setState({ activeSessionId: null, sessions: [] });
  io.invoke.mockReset();
  drop.mockReset();
  unavailable.mockReset();
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  useWorkspaceEnvStore.setState({ env: { kind: "local" } });
});

it("keeps native OS paths local and forwards the original drop permission", async () => {
  useWorkspaceEnvStore.setState({ env: { kind: "wsl", distro: "unrelated" } });
  io.invoke.mockResolvedValue({ kind: "file" });
  await render();
  await act(async () => run(asSlotId("slot-fixture"), event));
  expect(io.invoke).toHaveBeenCalledExactlyOnceWith("fs_stat", {
    path: "/native/file.ts",
    workspace: { kind: "local" },
  });
  expect(drop).toHaveBeenCalledWith(
    { kind: "file", path: "/native/file.ts", workspaceEnv: { kind: "local" } },
    { kind: "slot", viewSpaceId: "view-fixture", slotId: "slot-fixture" },
    expect.any(Function),
  );
  expect(drop.mock.calls[0][2]()).toBe(true);
});

it.each(["source", "chat", "chat-roundtrip"])(
  "rejects a late native stat after %s changes",
  async (mode) => {
    let finish!: (result: { kind: string }) => void;
    io.invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    let pending!: Promise<void>;
    await act(async () => {
      pending = run(asSlotId("slot-fixture"), event);
    });
    if (mode === "source") await render("replacement");
    else
      await act(async () => {
        useChatStore.setState({ activeSessionId: "replacement" });
        if (mode === "chat-roundtrip")
          useChatStore.setState({ activeSessionId: null });
      });
    await act(async () => {
      finish({ kind: "file" });
      await pending;
    });
    expect(drop).not.toHaveBeenCalled();
    expect(unavailable).not.toHaveBeenCalled();
  },
);

it("retains its original callback while equivalent context republishes callbacks", async () => {
  let finish!: (result: { kind: string }) => void;
  io.invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await render();
  let pending!: Promise<void>;
  await act(async () => {
    pending = run(asSlotId("slot-fixture"), event);
  });
  const replacement = vi.fn();
  await render("original", replacement);
  await act(async () => {
    finish({ kind: "file" });
    await pending;
  });
  expect(drop).toHaveBeenCalledTimes(1);
  expect(replacement).not.toHaveBeenCalled();
});
