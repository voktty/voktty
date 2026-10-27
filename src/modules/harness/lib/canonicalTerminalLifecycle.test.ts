import { expect, it, vi } from "vitest";
import { reapWindowRuntime } from "@/modules/harness/lib/appLifecycle";
import { newSession } from "@/modules/harness/lib/session";

const cleanup = vi.hoisted(() => ({
  forget: vi.fn().mockResolvedValue(undefined),
  probes: vi.fn().mockResolvedValue(undefined),
  invoke: vi.fn(),
}));
vi.mock("@/modules/harness/lib/harness/registry", () => ({
  forgetHarnessSession: cleanup.forget,
}));
vi.mock("@/modules/harness/lib/harness/child", () => ({
  killAllChildren: cleanup.probes,
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: cleanup.invoke }));

it("reaps Harness sessions and probes without closing canonical terminal resources", async () => {
  const session = newSession("claude", "/srv/app");
  await reapWindowRuntime([session]);
  expect(cleanup.forget).toHaveBeenCalledExactlyOnceWith("claude", session.id);
  expect(cleanup.probes).toHaveBeenCalledOnce();
  expect(cleanup.invoke).not.toHaveBeenCalled();
});
