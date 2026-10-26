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
  useTranslation: () => ({ t: (key: string) => key }),
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
