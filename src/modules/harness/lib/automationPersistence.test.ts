// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  newAutomationDraft,
  type Automation,
} from "@/modules/harness/lib/automations";
import { createPersistenceAdmission } from "@/modules/harness/lib/persistenceAdmission";
import type { InboxItem } from "@/modules/harness/lib/githubTasks";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke }));

const now = Date.parse("2026-10-23T09:30:00Z");
function automation(id = "one"): Automation {
  return {
    ...newAutomationDraft("/work/one", "claude", "default"),
    triggers: undefined,
    id,
    name: "Task",
    prompt: "Run task",
    scheduleKind: "hourly",
    minute: 30,
    nextRunAt: now,
    createdAt: 1,
    updatedAt: 1,
  };
}
function item(): InboxItem {
  return {
    provider: "github",
    kind: "pr",
    number: 12,
    title: "Fix checkout",
    url: "https://github.com/acme/web/pull/12",
    state: "open",
    updatedAt: "2026-10-23T09:30:00Z",
    createdAt: "2026-10-23T09:30:00Z",
    labels: [],
    assignees: [],
    draft: false,
    repo: "acme/web",
    projectPath: "/work/one",
  };
}
function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("Missing automation fixture");
  return value;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetModules();
  native.invoke.mockReset();
  localStorage.clear();
});

describe("automation write admission", () => {
  it("does not occupy a write receipt for scheduled metadata reads or claim after retirement", async () => {
    const { claimDueAutomations } = await import(
      "@/modules/harness/lib/automations"
    );
    const listing = deferred<Automation[]>();
    native.invoke.mockReturnValueOnce(listing.promise);
    const owner = createPersistenceAdmission().createOwner();
    const permit = required(owner.capture());
    const claim = claimDueAutomations(now, permit);
    const final = required(permit.seal());
    expect(final.pending).toBeNull();
    final.cancel();
    listing.resolve([automation()]);
    expect(await claim).toEqual([]);
    expect(native.invoke.mock.calls.map(([command]) => command)).toEqual([
      "automations_list",
    ]);
  });

  it("drains an accepted scheduled claim and prevents the next member after cancellation", async () => {
    const { claimDueAutomations } = await import(
      "@/modules/harness/lib/automations"
    );
    const pending = deferred<unknown>();
    native.invoke.mockImplementation((command) =>
      command === "automations_list"
        ? Promise.resolve([automation(), automation("two")])
        : pending.promise,
    );
    const owner = createPersistenceAdmission().createOwner();
    const permit = required(owner.capture());
    const claim = claimDueAutomations(now, permit);
    await vi.waitFor(() => expect(native.invoke).toHaveBeenCalledTimes(2));
    const final = required(permit.seal());
    let drained = false;
    void required(final.pending).then(() => {
      drained = true;
    });
    final.cancel();
    expect(drained).toBe(false);
    const accepted = {
      automation: automation(),
      run: { id: "run-one", status: "pending" },
    };
    pending.resolve(accepted);
    expect(await claim).toEqual([accepted]);
    await final.pending;
    expect(native.invoke).toHaveBeenCalledTimes(2);
    expect(drained).toBe(true);
  });

  it("preserves Inbox retries when admission retires during the metadata read", async () => {
    const { claimInboxAutomationRuns } = await import(
      "@/modules/harness/lib/automationEvents"
    );
    const listing = deferred<Automation[]>();
    native.invoke.mockReturnValueOnce(listing.promise);
    const owner = createPersistenceAdmission().createOwner();
    const permit = required(owner.capture());
    const claim = claimInboxAutomationRuns([item()], now, permit);
    const final = required(permit.seal());
    expect(final.pending).toBeNull();
    final.cancel();
    const configured = {
      ...automation(),
      triggerKind: "github" as const,
      triggerEvent: "pull_request_opened",
    };
    listing.resolve([configured]);
    expect(await claim).toEqual([]);
    expect(native.invoke).toHaveBeenCalledOnce();
    expect(
      localStorage.getItem("voktty.automation-inbox-retries.v1"),
    ).toContain("Fix checkout");
    native.invoke.mockImplementation(async (command) =>
      command === "automations_list"
        ? [configured]
        : {
            automation: configured,
            run: { id: "event-one", status: "pending" },
          },
    );
    expect(
      await claimInboxAutomationRuns([], now, required(owner.capture())),
    ).toHaveLength(1);
    expect(
      localStorage.getItem("voktty.automation-inbox-retries.v1"),
    ).toBeNull();
  });

  it("denies stale Inbox input before changing its retry cache or calling native code", async () => {
    const { claimInboxAutomationRuns } = await import(
      "@/modules/harness/lib/automationEvents"
    );
    const owner = createPersistenceAdmission().createOwner();
    const permit = required(owner.capture());
    owner.retire();
    expect(await claimInboxAutomationRuns([item()], now, permit)).toEqual([]);
    expect(native.invoke).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });
});
