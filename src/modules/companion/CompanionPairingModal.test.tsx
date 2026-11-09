// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CompanionPairingModal } from "./CompanionPairingModal";
import { useCompanionPairingStore } from "./useCompanionPairingStore";

const { mockToast, mockInvoke } = vi.hoisted(() => ({
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  mockInvoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("sonner", () => ({
  toast: mockToast,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

vi.mock("@/modules/i18n", () => {
  const translate = (key: string, params?: Record<string, unknown>) => {
    if (params) return `${key}:${JSON.stringify(params)}`;
    return key;
  };
  return {
    t: translate,
    useTranslation: () => ({ t: translate }),
  };
});

describe("CompanionPairingModal", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    useCompanionPairingStore.setState({ pendingRequest: null });
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

  it("does not render when there is no pending request", async () => {
    await act(async () => {
      root.render(<CompanionPairingModal />);
    });
    expect(container.innerHTML).toBe("");
  });

  it("renders modal with device name and fingerprint when request is pending", async () => {
    useCompanionPairingStore.setState({
      pendingRequest: {
        id: "req-999",
        deviceName: "Pixel 9 Pro",
        fingerprint: "FP-XYZ-123",
        expiresAtMs: Date.now() + 60000,
      },
    });

    await act(async () => {
      root.render(<CompanionPairingModal />);
    });

    expect(document.body.textContent).toContain("Pixel 9 Pro");
    expect(document.body.textContent).toContain("FP-XYZ-123");
  });

  it("approves pairing when allow button is clicked", async () => {
    useCompanionPairingStore.setState({
      pendingRequest: {
        id: "req-999",
        deviceName: "Pixel 9 Pro",
        fingerprint: "FP-XYZ-123",
        expiresAtMs: Date.now() + 60000,
      },
    });

    await act(async () => {
      root.render(<CompanionPairingModal />);
    });

    const buttons = document.querySelectorAll("button");
    const allowBtn = Array.from(buttons).find((b) =>
      b.textContent?.includes("companion.pairing.allow"),
    );
    expect(allowBtn).toBeDefined();

    await act(async () => {
      allowBtn!.click();
    });

    expect(mockInvoke).toHaveBeenCalledWith("companion_decide_pairing", {
      requestId: "req-999",
      approved: true,
    });
    expect(useCompanionPairingStore.getState().pendingRequest).toBeNull();
  });

  it("denies pairing when deny button is clicked", async () => {
    useCompanionPairingStore.setState({
      pendingRequest: {
        id: "req-999",
        deviceName: "Pixel 9 Pro",
        fingerprint: "FP-XYZ-123",
        expiresAtMs: Date.now() + 60000,
      },
    });

    await act(async () => {
      root.render(<CompanionPairingModal />);
    });

    const buttons = document.querySelectorAll("button");
    const denyBtn = Array.from(buttons).find((b) =>
      b.textContent?.includes("companion.pairing.deny"),
    );
    expect(denyBtn).toBeDefined();

    await act(async () => {
      denyBtn!.click();
    });

    expect(mockInvoke).toHaveBeenCalledWith("companion_decide_pairing", {
      requestId: "req-999",
      approved: false,
    });
    expect(useCompanionPairingStore.getState().pendingRequest).toBeNull();
  });
});
