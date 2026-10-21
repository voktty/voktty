import type { LaunchRequest } from "@/lib/launchRequest";
import { describe, expect, it, vi } from "vitest";
import { shouldSkipBootDirectoryLaunchRequest } from "./bootLaunchRequest";

function request(overrides: Partial<LaunchRequest> = {}): LaunchRequest {
  return {
    requestId: "boot-directory",
    source: "opened",
    intent: "openDirectoryOnly",
    paths: ["/project"],
    sourceCwd: null,
    ...overrides,
  };
}

function appliedAtBoot(id: string) {
  return (requestId: string) => requestId === id;
}

describe("boot directory launch request replay", () => {
  it("skips the macOS opened directory already selected during boot", () => {
    expect(
      shouldSkipBootDirectoryLaunchRequest(
        request(),
        appliedAtBoot("boot-directory"),
      ),
    ).toBe(true);
  });

  it("applies a different hot opened directory request", () => {
    expect(
      shouldSkipBootDirectoryLaunchRequest(
        request({ requestId: "hot-directory" }),
        appliedAtBoot("boot-directory"),
      ),
    ).toBe(false);
  });

  it("preserves the cold-start directory skip without consulting boot ownership", () => {
    const applied = vi.fn(() => false);
    expect(
      shouldSkipBootDirectoryLaunchRequest(
        request({ source: "coldStart" }),
        applied,
      ),
    ).toBe(true);
    expect(applied).not.toHaveBeenCalled();
  });

  it("leaves control CLI current-session directories actionable even with the same ID", () => {
    const applied = vi.fn(() => true);
    expect(
      shouldSkipBootDirectoryLaunchRequest(
        request({
          source: "controlCli",
          intent: "openDirectoryInCurrentSession",
        }),
        applied,
      ),
    ).toBe(false);
    expect(applied).not.toHaveBeenCalled();
  });

  it("does not skip files sharing the applied directory ID", () => {
    expect(
      shouldSkipBootDirectoryLaunchRequest(
        request({ intent: "openFilesOnly", paths: ["/project/a.ts"] }),
        appliedAtBoot("boot-directory"),
      ),
    ).toBe(false);
  });

  it("leaves a second-instance directory actionable when boot did not apply it", () => {
    expect(
      shouldSkipBootDirectoryLaunchRequest(
        request({ source: "secondInstance" }),
        appliedAtBoot("another-request"),
      ),
    ).toBe(false);
  });

  it("uses exact opaque IDs without trimming or case folding", () => {
    const applied = appliedAtBoot(" Request-ID ");
    expect(
      shouldSkipBootDirectoryLaunchRequest(
        request({ requestId: " Request-ID " }),
        applied,
      ),
    ).toBe(true);
    for (const requestId of ["Request-ID", " request-id "]) {
      expect(
        shouldSkipBootDirectoryLaunchRequest(request({ requestId }), applied),
      ).toBe(false);
    }
  });

  it("does not skip unrelated restore or standalone-tab intents", () => {
    for (const intent of ["restoreLastSession", "newStandaloneTab"] as const) {
      expect(
        shouldSkipBootDirectoryLaunchRequest(
          request({ intent }),
          appliedAtBoot("boot-directory"),
        ),
      ).toBe(false);
    }
  });
});
