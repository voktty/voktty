// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from "vitest";
import { captureProjectCitation } from "@/modules/ai/lib/projectCitation";
import { captureProjectAttachment } from "@/modules/ai/lib/projectAttachmentSource";
import {
  createProjectFileSourceStore,
  type ProjectFileSource,
} from "@/modules/remote/projectFileSource";
import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";
import { usePreferencesStore } from "@/modules/settings/preferences";

const profile = { id: "fixture", name: "Fixture", host: "original.invalid" };
const path = "remote://voktty-ssh-fixture/srv/project";
let releases: Array<() => void>;
function index() {
  const store = createProjectFileSourceStore(path);
  const stop = store.subscribe(() => {});
  releases.push(stop);
  const source = store.getSnapshot().source;
  if (!source) throw new Error("Missing fixture source");
  return { source, stop };
}
beforeEach(() => {
  releases = [];
  localStorage.clear();
  rememberRemoteProject("voktty-ssh-fixture", {
    id: "fixture",
    name: "Fixture",
    cwd: "/srv/project",
  });
  usePreferencesStore.setState({ sshConnections: [profile] });
});
afterEach(() => {
  for (const release of releases) release();
  usePreferencesStore.setState({ sshConnections: [] });
  localStorage.clear();
});

it("retains selection authority after the picker releases its own source", () => {
  const { source, stop } = index();
  const selected = captureProjectCitation(path, "file.ts", source);
  if (!selected) throw new Error("Missing selection");
  releases.push(selected.release);
  stop();
  expect(source.isCurrent()).toBe(false);
  expect(selected.isCurrent()).toBe(true);
  expect(selected.projectSource.profile).toEqual(profile);
  selected.release();
  selected.release();
  expect(selected.isCurrent()).toBe(false);
});

it("retires a retained selection through a profile round trip", () => {
  const { source } = index();
  const selected = captureProjectCitation(path, "file.ts", source);
  if (!selected) throw new Error("Missing selection");
  releases.push(selected.release);
  usePreferencesStore.setState({
    sshConnections: [{ ...profile, host: "successor.invalid" }],
  });
  usePreferencesStore.setState({ sshConnections: [profile] });
  expect(selected.isCurrent()).toBe(false);
});

it("rejects fabricated or foreign-root index receipts", () => {
  const { source } = index();
  expect(
    captureProjectCitation(path, "file.ts", { ...source } as ProjectFileSource),
  ).toBeNull();
  expect(captureProjectCitation(`${path}/other`, "file.ts", source)).toBeNull();
});

it("keeps the indexed parent project when a nested project is also registered", () => {
  rememberRemoteProject("voktty-ssh-fixture", {
    id: "nested",
    name: "Nested",
    cwd: "/srv/project/nested",
  });
  const { source } = index();
  const selected = captureProjectCitation(path, "nested/file.ts", source);
  if (!selected) throw new Error("Missing selection");
  releases.push(selected.release);
  expect(selected.projectSource.project.cwd).toBe("/srv/project");
  expect(selected.projectSource.project.projectId).toBe("fixture");
});

it("keeps derived attachments inside their original project and environment", () => {
  const owner = captureProjectAttachment(path);
  if (!owner) throw new Error("Missing owner");
  expect(captureProjectAttachment(`${path}/file.ts`, { ...owner })).toBeNull();
  expect(
    captureProjectAttachment(
      "remote://voktty-ssh-fixture/outside/file.ts",
      owner,
    ),
  ).toBeNull();
  expect(
    captureProjectAttachment(
      "remote://voktty-ssh-other/srv/project/file.ts",
      owner,
    ),
  ).toBeNull();
  expect(captureProjectAttachment(`${path}/.env`, owner)).toBeNull();
});

it.each(["../outside", "/absolute", "a\\b", "a\0b", "a//b"])(
  "rejects an invalid relative citation %j",
  (relative) => {
    const { source } = index();
    expect(captureProjectCitation(path, relative, source)).toBeNull();
  },
);

it("retains sixteen selections until their exact release and preserves successors", () => {
  const { source } = index();
  const selected = Array.from({ length: 16 }, () =>
    captureProjectCitation(path, "file.ts", source),
  );
  for (const selection of selected) {
    if (!selection) throw new Error("Missing selection");
    releases.push(selection.release);
  }
  expect(captureProjectCitation(path, "overflow.ts", source)).toBeNull();
  selected[0]?.release();
  const replacement = captureProjectCitation(path, "replacement.ts", source);
  if (!replacement) throw new Error("Missing replacement");
  releases.push(replacement.release);
  selected[0]?.release();
  expect(replacement.isCurrent()).toBe(true);
  expect(captureProjectCitation(path, "still-overflow.ts", source)).toBeNull();
});
