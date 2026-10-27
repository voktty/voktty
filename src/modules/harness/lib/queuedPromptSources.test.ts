// @vitest-environment happy-dom

import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";
import { captureRemotePromptSource } from "@/modules/harness/lib/promptSource";
import { createQueuedPromptSources } from "@/modules/harness/lib/queuedPromptSources";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { afterEach, beforeEach, expect, it } from "vitest";

const cwd = "remote://voktty-ssh-fixture/srv/project";
const profile = { id: "fixture", name: "Fixture", host: "original.invalid" };
let queue = createQueuedPromptSources();
beforeEach(() => {
  queue = createQueuedPromptSources();
  localStorage.clear();
  rememberRemoteProject("voktty-ssh-fixture", {
    id: "project",
    name: "Project",
    cwd: "/srv/project",
  });
  usePreferencesStore.setState({ sshConnections: [profile] });
});
afterEach(() => {
  queue.clear();
  usePreferencesStore.setState({ sshConnections: [] });
  localStorage.clear();
});

it("transfers a full queue's receipt without acquiring or prematurely releasing preparation capacity", () => {
  const owner = {};
  for (let i = 0; i < 256; i++) queue.capture(owner, String(i), cwd);
  const source = queue.take(owner, "0", cwd);
  try {
    expect(source?.isCurrent()).toBe(true);
    expect(() => queue.assertCurrent(owner, "0", cwd)).toThrow(
      "project changed",
    );
    expect(() => queue.take(owner, "0", cwd)?.assertCurrent()).toThrow(
      "project changed",
    );
    queue.reconcile(new Map());
    source?.assertCurrent();
    const receipts = Array.from({ length: 255 }, () =>
      captureRemotePromptSource(cwd),
    );
    try {
      for (const receipt of receipts) expect(receipt?.isCurrent()).toBe(true);
      expect(() => captureRemotePromptSource(cwd)?.assertCurrent()).toThrow(
        "capacity",
      );
    } finally {
      for (const receipt of receipts) receipt?.release();
    }
  } finally {
    source?.release();
  }
});

it("does not reconstruct an absent SSH receipt when claiming dispatch", () => {
  expect(() => queue.take({}, "missing", cwd)?.assertCurrent()).toThrow(
    "project changed",
  );
});

it("keeps duplicate logical IDs isolated by session ownership and deletion", () => {
  const first = {},
    second = {};
  queue.capture(first, "same", cwd);
  queue.capture(second, "same", cwd);
  queue.reconcile(new Map([[second, new Set(["same"])]]));
  expect(() => queue.assertCurrent(first, "same", cwd)).toThrow(
    "project changed",
  );
  expect(() => queue.assertCurrent(second, "same", cwd)).not.toThrow();
});

it("retains retired queued work in its bounded budget until deletion", () => {
  const owner = {};
  for (let i = 0; i < 256; i++) queue.capture(owner, String(i), cwd);
  usePreferencesStore.setState({ sshConnections: [] });
  usePreferencesStore.setState({ sshConnections: [profile] });
  expect(() => queue.capture(owner, "overflow", cwd)).toThrow("capacity");
  expect(() => queue.assertCurrent(owner, "0", cwd)).toThrow("project changed");
  queue.reconcile(
    new Map([
      [owner, new Set(Array.from({ length: 255 }, (_, i) => String(i + 1)))],
    ]),
  );
  expect(() => queue.capture(owner, "replacement", cwd)).not.toThrow();
});

it("retains the captured working directory for native queued messages", () => {
  const owner = {};
  queue.capture(owner, "first", "C:/project");
  expect(() => queue.assertCurrent(owner, "first", "/replacement")).toThrow(
    "project changed",
  );
  expect(() => queue.assertCurrent(owner, "first", "C:/project")).not.toThrow();
});

it("does not retain failed captures and releases original observers idempotently", () => {
  const owner = {};
  usePreferencesStore.setState({ sshConnections: [] });
  for (let i = 0; i < 260; i++)
    expect(() => queue.capture(owner, String(i), cwd)).toThrow("unavailable");
  usePreferencesStore.setState({ sshConnections: [profile] });
  const release = queue.capture(owner, "original", cwd);
  release();
  release();
  queue.clear();
  for (let i = 0; i < 256; i++) queue.capture(owner, String(i), cwd);
});
