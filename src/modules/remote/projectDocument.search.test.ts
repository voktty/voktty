// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createProjectDocument } from "@/modules/remote/projectDocument";
import { parseProjectContentSearch } from "@/modules/remote/projectContentSearch";
import { createProjectFileSourceStore } from "@/modules/remote/projectFileSource";
import { rememberRemoteProject } from "@/modules/connections/model/remoteProjects";
import { usePreferencesStore } from "@/modules/settings/preferences";

const io = vi.hoisted(() => ({
  acquire: vi.fn(),
  request: vi.fn(),
  release: vi.fn(),
}));
vi.mock("@/modules/remote/sessionManager", () => ({
  remoteSessions: { acquire: io.acquire },
}));
vi.mock("@/modules/remote/client", () => ({ requestRemoteResult: io.request }));
const profile = { id: "fixture", name: "Fixture", host: "original.invalid" };
const root = "remote://voktty-ssh-fixture/alias/project";
const path = `${root}/src`;
const hit = {
  rel: "src/file.ts",
  text: "a\u{1F600}needle",
  line: 3,
  column: 4,
};
const response = () => ({ hits: [hit], truncated: false });
const lease = () => ({
  info: { session_id: 7, workspace_root: "/actual/project" },
  release: io.release,
});
let project: ReturnType<typeof rememberRemoteProject>;
let cleanups: Array<() => void>;

function source() {
  const store = createProjectFileSourceStore(path);
  cleanups.push(store.subscribe(() => {}));
  const captured = store.getSnapshot().source;
  if (!captured) throw new Error("Missing source fixture.");
  return captured;
}

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  cleanups = [];
  project = rememberRemoteProject("voktty-ssh-fixture", {
    id: "project",
    name: "Project",
    cwd: "/alias/project",
  });
  usePreferencesStore.setState({ sshConnections: [profile] });
  io.acquire.mockResolvedValue(lease());
  io.request.mockResolvedValue(response());
});
afterEach(() => {
  for (const stop of cleanups) stop();
  usePreferencesStore.setState({ sshConnections: [] });
  localStorage.clear();
});

it("uses the captured helper and preserves alias paths and UTF-16 locations", async () => {
  await expect(source().searchContent(" needle ", () => true)).resolves.toEqual(
    {
      matches: [
        {
          path: `${root}/src/file.ts`,
          relative: "src/file.ts",
          preview: "a\u{1F600}needle",
          line: 3,
          column: 4,
        },
      ],
      truncated: false,
    },
  );
  expect(io.acquire).toHaveBeenCalledExactlyOnceWith(
    { profileId: "fixture", root: "/alias/project" },
    expect.objectContaining({ host: "original.invalid" }),
  );
  expect(io.request).toHaveBeenCalledExactlyOnceWith(7, "fs.grep", {
    cwd: "src",
    pattern: "needle",
    include: [],
    exclude: [],
    caseSensitive: false,
    wholeWord: false,
    regex: false,
    showHidden: true,
    maxResults: 500,
  });
  expect(io.release).toHaveBeenCalledOnce();
});

it("captures document inputs before an acquisition starts", async () => {
  const mutableProfile = { ...profile };
  const mutableProject = { ...project };
  const document = createProjectDocument(path, mutableProject, [
    mutableProfile,
  ]);
  mutableProfile.host = "replacement.invalid";
  mutableProject.cwd = "/replacement";
  await document.searchContent("needle", () => true);
  expect(io.acquire).toHaveBeenCalledWith(
    { profileId: "fixture", root: "/alias/project" },
    expect.objectContaining({ host: "original.invalid" }),
  );
});

it("rejects caller retirement during the lazy import without opening a helper", async () => {
  let current = true;
  const read = source().searchContent("needle", () => current);
  const rejected = expect(read).rejects.toThrow("retired");
  current = false;
  await rejected;
  expect(io.acquire).not.toHaveBeenCalled();
});

it("releases a late acquisition without searching the replacement profile", async () => {
  let accept!: (value: ReturnType<typeof lease>) => void;
  io.acquire.mockImplementation(
    () =>
      new Promise((resolve) => {
        accept = resolve;
      }),
  );
  const read = source().searchContent("needle", () => true);
  const rejected = expect(read).rejects.toThrow("retired");
  await vi.waitFor(() => expect(io.acquire).toHaveBeenCalledOnce());
  usePreferencesStore.setState({
    sshConnections: [{ ...profile, host: "replacement.invalid" }],
  });
  accept(lease());
  await rejected;
  expect(io.request).not.toHaveBeenCalled();
  expect(io.release).toHaveBeenCalledOnce();
});

it("keeps a retired request and its capacity charged until physical settlement", async () => {
  const finish: Array<(value: unknown) => void> = [];
  io.request.mockImplementation(
    () => new Promise((resolve) => finish.push(resolve)),
  );
  let current = true;
  const document = createProjectDocument(path, project, [profile]);
  const reads = Promise.allSettled(
    Array.from({ length: 256 }, () =>
      document.searchContent("needle", () => current),
    ),
  );
  await vi.waitFor(() => expect(io.request).toHaveBeenCalledTimes(256));
  current = false;
  await expect(document.searchContent("fresh", () => true)).rejects.toThrow(
    "capacity",
  );
  expect(io.release).not.toHaveBeenCalled();
  for (const resolve of finish) resolve(response());
  expect((await reads).every((result) => result.status === "rejected")).toBe(
    true,
  );
  expect(io.release).toHaveBeenCalledTimes(256);
  io.request.mockResolvedValue(response());
  await expect(
    document.searchContent("fresh", () => true),
  ).resolves.toMatchObject({ truncated: false });
});

it("keeps the current helper failure and never substitutes another transport", async () => {
  const failure = new Error("helper unavailable");
  io.request.mockRejectedValue(failure);
  await expect(source().searchContent("needle", () => true)).rejects.toBe(
    failure,
  );
  expect(io.acquire).toHaveBeenCalledOnce();
  expect(io.release).toHaveBeenCalledOnce();
});

it.each(["", "   ", "a\0b", "\u{1F600}".repeat(1025)])(
  "rejects invalid query before acquiring: %j",
  async (query) => {
    await expect(
      createProjectDocument(path, project, [profile]).searchContent(
        query,
        () => true,
      ),
    ).rejects.toThrow("query");
    expect(io.acquire).not.toHaveBeenCalled();
  },
);

it.each([
  "../escape",
  "/absolute",
  "a/../b",
  "a//b",
  "a\\b",
  "a\0b",
  "C:/file",
  "a\nfile",
  "",
])("rejects unsafe helper path %j", (rel) => {
  expect(() =>
    parseProjectContentSearch(
      { hits: [{ ...hit, rel }], truncated: false },
      root,
    ),
  ).toThrow("Invalid");
});

it.each([
  null,
  {},
  { hits: [], truncated: "false" },
  { hits: [null], truncated: false },
  { hits: [{ ...hit, line: 0 }], truncated: false },
  { hits: [{ ...hit, column: 1.5 }], truncated: false },
  { hits: [{ ...hit, column: Number.MAX_SAFE_INTEGER + 1 }], truncated: false },
  { hits: [{ ...hit, text: "x".repeat(8193) }], truncated: false },
  { hits: Array.from({ length: 501 }, () => hit), truncated: true },
  { hits: [hit], truncated: false, cancelled: "false" },
])("rejects malformed or excessive helper responses", (value) => {
  expect(() => parseProjectContentSearch(value, root)).toThrow("Invalid");
});

it("does not trust helper absolute paths and preserves truncation", () => {
  expect(
    parseProjectContentSearch(
      { hits: [{ ...hit, path: "/outside/file" }], truncated: true },
      root,
    ),
  ).toMatchObject({
    matches: [{ path: `${root}/src/file.ts` }],
    truncated: true,
  });
});

it("rejects cancelled partial results and excessive aggregate text", () => {
  expect(() =>
    parseProjectContentSearch(
      { hits: [hit], truncated: false, cancelled: true },
      root,
    ),
  ).toThrow("cancelled");
  expect(() =>
    parseProjectContentSearch(
      {
        hits: Array.from({ length: 500 }, () => ({
          ...hit,
          rel: "x".repeat(200),
          text: "x".repeat(8192),
        })),
        truncated: true,
      },
      root,
    ),
  ).toThrow("Invalid");
});
