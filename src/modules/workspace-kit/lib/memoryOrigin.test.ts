import { expect, it, vi } from "vitest";
import {
  createMemoryPanelController,
  type MemoryPanelState,
} from "@/modules/workspace-kit/lib/memoryPanel";
import { remoteMemoryError } from "@/modules/workspace-kit/lib/remoteMemoryWire";
import type { NativeMemorySelection } from "@/modules/workspace-kit/lib/nativeMemory";

it("preserves the host legacy-origin refusal without offering new settings", async () => {
  const failure = remoteMemoryError({ code: "legacyStateRequiresReview" });
  expect(failure).toMatchObject({ code: "legacyStateRequiresReview" });
  const selected = {} as NativeMemorySelection;
  const states: MemoryPanelState[] = [];
  const initializeLocalState = vi.fn(async () => {
    throw failure;
  });
  const panel = createMemoryPanelController(
    { path: "/project", environment: { kind: "local" }, source: "origin-test" },
    (state) => states.push(state),
    () => ({
      select: vi.fn(async () => selected),
      isCurrent: () => true,
      inspect: vi.fn(async () => {
        throw failure;
      }),
      discover: vi.fn(),
      initializeLocalState,
      close: vi.fn(async () => {}),
      documents: vi.fn(),
      preview: vi.fn(),
      confirmPreview: vi.fn(),
      cancelPreview: vi.fn(),
      isReviewCurrent: () => false,
      reviewRecovery: vi.fn(),
      confirmRecovery: vi.fn(),
      cancelRecovery: vi.fn(),
      isRecoveryReviewCurrent: () => false,
      reviewTrust: vi.fn(),
      confirmTrust: vi.fn(),
      cancelTrust: vi.fn(),
      isTrustReviewCurrent: () => false,
      reviewPolicy: vi.fn(),
      confirmPolicy: vi.fn(),
      cancelPolicy: vi.fn(),
      isPolicyReviewCurrent: () => false,
    }),
  );
  try {
    await panel.load();
    expect(states[states.length - 1]).toEqual({
      status: "error",
      code: "legacyStateRequiresReview",
      canPrepare: false,
    });
    expect(initializeLocalState).not.toHaveBeenCalled();
  } finally {
    await panel.dispose();
  }
});
