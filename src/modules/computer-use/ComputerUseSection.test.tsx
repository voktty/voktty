// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DetectState } from "./lib/detect";
import { COMPUTER_USE_INSTALL_COMMAND, COMPUTER_USE_INSTALL_EVENT } from "./lib/probe";

const mocks = vi.hoisted(() => ({
  detect: vi.fn(),
  emit: vi.fn(async () => undefined),
}));

vi.mock("./lib/detect", () => ({ detectComputerUse: mocks.detect }));
vi.mock("@tauri-apps/api/event", () => ({ emit: mocks.emit }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@/lib/platform", () => ({ IS_MAC: false }));
vi.mock("@/modules/ssh/sshStore", () => ({
  useSshConnections: () => [{ id: "box", name: "Box", host: "box.lan" }],
}));
vi.mock("@/modules/i18n", () => {
  const translate = (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key;
  return { t: translate, useTranslation: () => ({ t: translate }) };
});

import { ComputerUseSection } from "./ComputerUseSection";

const missing: DetectState = {
  kind: "result",
  probe: { status: "not-installed", path: null, version: null, doctor: null, error: null },
};

describe("ComputerUseSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function show(state: DetectState | Promise<DetectState>) {
    mocks.detect.mockReturnValue(Promise.resolve(state));
    await act(async () => {
      root.render(<ComputerUseSection />);
    });
  }

  const button = (label: string) =>
    [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes(label));

  it("shows the loading state while the check runs", async () => {
    mocks.detect.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      root.render(<ComputerUseSection />);
    });
    expect(container.textContent).toContain("settings.computerUse.checking");
    expect(button("settings.computerUse.install")).toBeUndefined();
  });

  it("offers the install when the tool is missing and confirms the exact command first", async () => {
    await show(missing);
    expect(container.textContent).toContain("settings.computerUse.notInstalled");
    await act(async () => {
      button("settings.computerUse.install:")?.click();
    });
    expect(document.body.textContent).toContain(COMPUTER_USE_INSTALL_COMMAND);
    expect(mocks.emit).not.toHaveBeenCalled();
    await act(async () => {
      button("settings.computerUse.installConfirm")?.click();
    });
    expect(mocks.emit).toHaveBeenCalledWith(COMPUTER_USE_INSTALL_EVENT, { hostId: null });
  });

  it("does not offer an install over a working installation and never claims readiness", async () => {
    await show({
      kind: "result",
      probe: { status: "installed", path: "/usr/bin/ocu", version: "1.1.4", doctor: "ok", error: null },
    });
    expect(container.textContent).toContain("settings.computerUse.installed");
    expect(container.textContent).toContain("settings.computerUse.installedHint");
    expect(button("settings.computerUse.install:")).toBeUndefined();
  });

  it("shows bounded diagnostics for a doctor problem", async () => {
    await show({
      kind: "result",
      probe: { status: "doctor-problem", path: "/x", version: "1.1.4", doctor: "needs a display", error: null },
    });
    expect(container.textContent).toContain("settings.computerUse.doctorProblem");
    expect(container.textContent).toContain("needs a display");
  });

  it("asks to update an outdated helper", async () => {
    await show({ kind: "helper-outdated" });
    expect(container.textContent).toContain("settings.computerUse.helperOutdated");
    expect(button("settings.computerUse.install:")).toBeUndefined();
  });

  it("shows a failed check", async () => {
    await show({ kind: "error", message: "boom" });
    expect(container.textContent).toContain("settings.computerUse.error");
    expect(container.textContent).toContain("boom");
  });
});
