// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlanDiffReview } from "@/modules/ai/components/PlanDiffReview";
import { usePlanStore } from "@/modules/ai/store/planStore";
import type { OperationResult } from "@/modules/ai/lib/operationTransaction";

const io = vi.hoisted(() => ({ inspect: vi.fn(), writeFile: vi.fn() }));
vi.mock("@/modules/ai/lib/nativeOperationAdapter", () => ({
  nativeOperationAdapter: io,
}));
vi.mock("@/modules/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      key === "ai.planReview.provenance" ? JSON.stringify(params) : key,
  }),
}));
let root: Root;
let node: HTMLDivElement;
let release: (value: { kind: "file"; content: string }) => void;
let applying: Promise<OperationResult> | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  io.inspect.mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  io.writeFile.mockResolvedValue(undefined);
  usePlanStore.setState({
    active: true,
    queue: [],
    pendingCommands: [],
    lastOperation: null,
    lastError: null,
  });
  usePlanStore.getState().enqueue({
    id: "fixture",
    kind: "edit",
    path: "/repo/file.ts",
    originalContent: "before",
    proposedContent: "after",
    isNewFile: false,
    workspaceEnv: { kind: "local" },
    sessionId: "fixture",
    modelId: "fixture",
    createdAt: 1,
  });
  node = document.createElement("div");
  root = createRoot(node);
  applying = undefined;
});
afterEach(async () => {
  await act(async () => {
    release({ kind: "file", content: "before" });
    await applying;
    root.unmount();
  });
  node.remove();
  vi.unstubAllGlobals();
});

it("disables actions in every mounted review while the shared operation is pending", async () => {
  await act(async () =>
    root.render(
      <>
        <PlanDiffReview />
        <PlanDiffReview />
      </>,
    ),
  );
  await act(async () => {
    applying = usePlanStore.getState().applyAll();
  });
  const applyButtons = [
    ...node.querySelectorAll<HTMLButtonElement>("button"),
  ].filter((button) => button.textContent?.includes("ai.diff.acceptAll"));
  expect(applyButtons).toHaveLength(2);
  for (const button of applyButtons) expect(button.disabled).toBe(true);
  for (const button of node.querySelectorAll<HTMLButtonElement>(
    'button[aria-label="ai.diff.reject"]',
  ))
    expect(button.disabled).toBe(true);
  await act(async () => {
    release({ kind: "file", content: "before" });
    await applying;
  });
  expect(usePlanStore.getState().pendingOperation).toBeNull();
});

it("retains the operation when its review presentation unmounts", async () => {
  await act(async () => root.render(<PlanDiffReview />));
  await act(async () => {
    applying = usePlanStore.getState().applyAll();
  });
  await act(async () => root.render(null));
  expect(usePlanStore.getState().pendingOperation).toBe("apply");
  await act(async () => {
    release({ kind: "file", content: "before" });
    await applying;
  });
  await act(async () => root.render(<PlanDiffReview />));
  expect(node.textContent).toContain("ai.planReview.operationApplied");
  expect(io.writeFile).toHaveBeenCalledOnce();
});

it("distinguishes identical review paths by captured filesystem without displaying SSH credentials", async () => {
  const first = usePlanStore.getState().queue[0];
  usePlanStore.getState().enqueue({
    ...first,
    id: "wsl",
    workspaceEnv: { kind: "wsl", distro: "fixture-distro" },
  });
  for (const host of ["first.invalid", "second.invalid"]) {
    usePlanStore.getState().enqueue({
      ...first,
      id: host,
      workspaceEnv: {
        kind: "ssh",
        root: "/repo",
        sessionId: 7,
        connection: {
          id: host,
          name: "Same profile name",
          host,
          user: "fixture-user",
          port: 2201,
          identityFile: "/private/key-fixture",
          extraArgs: "-J private-jump-fixture",
        },
      },
    });
  }
  await act(async () => root.render(<PlanDiffReview />));
  const rows = [...node.querySelectorAll("li")];
  expect(rows).toHaveLength(4);
  expect(rows[0].textContent).toContain("workspace.localMachine");
  expect(rows[1].textContent).toContain("fixture-distro");
  expect(rows[2].textContent).toContain("fixture-user@first.invalid:2201");
  expect(rows[3].textContent).toContain("fixture-user@second.invalid:2201");
  expect(node.textContent).not.toContain("key-fixture");
  expect(node.textContent).not.toContain("private-jump-fixture");
  expect(io.inspect).not.toHaveBeenCalled();
});

it("shows native Windows paths as local even when captured from WSL", async () => {
  usePlanStore.getState().clear();
  usePlanStore.getState().enqueue({
    id: "windows",
    kind: "edit",
    path: "C:/repo/file.ts",
    originalContent: "before",
    proposedContent: "after",
    isNewFile: false,
    workspaceEnv: { kind: "wsl", distro: "fixture-distro" },
    sessionId: "fixture",
    modelId: "fixture",
    createdAt: 1,
  });
  await act(async () => root.render(<PlanDiffReview />));
  expect(node.querySelector("li")?.textContent).toContain(
    "workspace.localMachine",
  );
  expect(node.querySelector("li")?.textContent).not.toContain("fixture-distro");
});

it("counts identical paths on different filesystems as separate applied files", async () => {
  const first = usePlanStore.getState().queue[0];
  usePlanStore.getState().enqueue({
    ...first,
    id: "wsl",
    workspaceEnv: { kind: "wsl", distro: "fixture-distro" },
  });
  await act(async () => {
    applying = usePlanStore.getState().applyAll();
    release({ kind: "file", content: "before" });
    await applying;
    root.render(<PlanDiffReview />);
  });
  expect(node.textContent).toContain('"files":2');
});
