// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

// The real i18n hook on purpose: it subscribes to a store, which is what made
// a call after the early return change the hook count.
vi.mock("../lib/harnessUpdates", () => ({
  UPDATABLE_HARNESSES: new Set(["codex"]),
  announceHarnessUpdated: vi.fn(async () => undefined),
  claimLaunchHarnessUpdateCheck: vi.fn(async () => true),
  fetchLatestHarnessVersion: vi.fn(async () => "0.168.0"),
  findHarnessUpdates: vi.fn(async () => [
    { harness: "codex", installed: "0.167.0", latest: "0.168.0" },
  ]),
  onHarnessUpdated: vi.fn(async () => () => {}),
}));
vi.mock("../lib/harness/availability", () => ({
  isHarnessAvailable: () => true,
  probeHarnessAvailability: vi.fn(async () => undefined),
}));
vi.mock("../lib/harness/registry", () => ({
  refreshHarnessCatalogs: vi.fn(async () => undefined),
}));

import { HarnessUpdateNotice } from "./HarnessUpdateNotice";

it("appears when an update is found without changing the hook order", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(HarnessUpdateNotice));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(document.body.textContent).toContain("0.168.0");
  act(() => root.unmount());
  host.remove();
});
