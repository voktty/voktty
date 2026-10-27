// @vitest-environment happy-dom

import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";
import { captureRemotePromptSource } from "@/modules/harness/lib/promptSource";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { afterEach, beforeEach, expect, it } from "vitest";

const cwd = "remote://voktty-ssh-fixture/srv/project";
const profile = { id: "fixture", name: "Fixture", host: "original.invalid" };
const receipts: NonNullable<ReturnType<typeof captureRemotePromptSource>>[] =
  [];
function capture() {
  const receipt = captureRemotePromptSource(cwd);
  if (!receipt) throw new Error("Expected a remote preparation receipt");
  receipts.push(receipt);
  return receipt;
}
beforeEach(() => {
  localStorage.clear();
  rememberRemoteProject("voktty-ssh-fixture", {
    id: "project",
    name: "Project",
    cwd: "/srv/project",
  });
  usePreferencesStore.setState({ sshConnections: [profile] });
});
afterEach(() => {
  for (const receipt of receipts.splice(0)) receipt.release();
  usePreferencesStore.setState({ sshConnections: [] });
  localStorage.clear();
});

it("keeps retired preparations counted until their owner releases them", () => {
  for (let i = 0; i < 256; i++) expect(capture().isCurrent()).toBe(true);
  usePreferencesStore.setState({ sshConnections: [] });
  usePreferencesStore.setState({ sshConnections: [profile] });
  expect(receipts[0].isCurrent()).toBe(false);
  expect(() => capture().assertCurrent()).toThrow("capacity");
  receipts[0].release();
  receipts[0].release();
  expect(capture().isCurrent()).toBe(true);
  expect(() => capture().assertCurrent()).toThrow("capacity");
});

it("retires a preparation when the saved project identity is replaced", () => {
  const receipt = capture();
  rememberRemoteProject("voktty-ssh-fixture", {
    id: "replacement",
    name: "Project",
    cwd: "/srv/project",
  });
  expect(() => receipt.assertCurrent()).toThrow("project changed");
});

it("releases the observer and never revives the old receipt", () => {
  const receipt = capture();
  receipt.release();
  expect(receipt.isCurrent()).toBe(false);
  expect(() => receipt.assertCurrent()).toThrow("project changed");
  expect(capture().isCurrent()).toBe(true);
});

it("returns a failing receipt for a missing profile without reserving capacity", () => {
  usePreferencesStore.setState({ sshConnections: [] });
  for (let i = 0; i < 260; i++)
    expect(() => capture().assertCurrent()).toThrow("unavailable");
  usePreferencesStore.setState({ sshConnections: [profile] });
  expect(capture().isCurrent()).toBe(true);
});

it("leaves native and legacy paths to their existing owners", () => {
  expect(captureRemotePromptSource("/repo")).toBeUndefined();
  expect(captureRemotePromptSource("C:\\repo")).toBeUndefined();
  expect(captureRemotePromptSource("remote://legacy/repo")).toBeUndefined();
});
