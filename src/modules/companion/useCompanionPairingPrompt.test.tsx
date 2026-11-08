// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useCompanionPairingPrompt } from "./useCompanionPairingPrompt";

const { mockToast, mockInvoke, mockUnlisten, listenerHolder } = vi.hoisted(() => ({
  mockToast: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
  mockInvoke: vi.fn().mockResolvedValue(undefined),
  mockUnlisten: vi.fn(),
  listenerHolder: {
    callback: null as ((event: { payload: unknown }) => void) | null,
  },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(
    (...args: unknown[]) => mockToast.info(...args),
    mockToast,
  ),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, callback: (event: { payload: unknown }) => void) => {
    listenerHolder.callback = callback;
    return mockUnlisten;
  }),
}));

vi.mock("@/modules/i18n", () => ({
  t: (key: string, params?: Record<string, unknown>) => {
    if (params) {
      return `${key}:${JSON.stringify(params)}`;
    }
    return key;
  },
}));

function TestComponent() {
  useCompanionPairingPrompt();
  return null;
}

describe("useCompanionPairingPrompt", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    listenerHolder.callback = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("subscribes to companion:pairing-requested and presents toast with allow and deny", async () => {
    await act(async () => {
      root.render(<TestComponent />);
    });

    expect(listenerHolder.callback).toBeTruthy();

    await act(async () => {
      listenerHolder.callback?.({
        payload: {
          id: "req-123",
          deviceName: "Pixel 8",
          fingerprint: "FP-ABCD",
          expiresAtMs: Date.now() + 60000,
        },
      });
    });

    expect(mockToast.info).toHaveBeenCalledWith(
      'companion.pairing.promptTitle:{"device":"Pixel 8"}',
      expect.objectContaining({
        id: "companion-pairing-req-123",
        action: expect.objectContaining({
          label: "companion.pairing.allow",
          onClick: expect.any(Function),
        }),
        cancel: expect.objectContaining({
          label: "companion.pairing.deny",
          onClick: expect.any(Function),
        }),
      }),
    );

    const callArgs = mockToast.info.mock.calls[0][1];
    await act(async () => {
      callArgs.action.onClick();
    });
    expect(mockInvoke).toHaveBeenCalledWith("companion_decide_pairing", {
      requestId: "req-123",
      approved: true,
    });

    await act(async () => {
      callArgs.cancel.onClick();
    });
    expect(mockInvoke).toHaveBeenCalledWith("companion_decide_pairing", {
      requestId: "req-123",
      approved: false,
    });
  });

  it("unsubscribes on unmount", async () => {
    await act(async () => {
      root.render(<TestComponent />);
    });

    await act(async () => {
      root.unmount();
    });

    expect(mockUnlisten).toHaveBeenCalled();
  });
});
