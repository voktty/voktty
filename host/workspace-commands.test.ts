import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostStore } from "./store";
import { WorkspaceCommands } from "./workspace-commands";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function setup() {
  const directory = mkdtempSync(join(tmpdir(), "voktty-workspace-commands-"));
  const store = new HostStore(join(directory, "host.db"));
  cleanups.push(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const project = store.addProject(directory, "Project");
  const commands = new WorkspaceCommands(store, async (_id, action) =>
    action(),
  );
  return { directory, store, project, commands };
}

it("checks expected content before replacing a file", async () => {
  const { directory, commands } = setup();
  const path = join(directory, "document.txt");
  writeFileSync(path, "original");
  await expect(
    commands.run("write_text_file", {
      path,
      content: "new",
      expectedContent: "stale",
    }),
  ).rejects.toThrow("changed");
  expect(readFileSync(path, "utf8")).toBe("original");
  await commands.run("write_text_file", {
    path,
    content: "new",
    expectedContent: "original",
  });
  expect(readFileSync(path, "utf8")).toBe("new");
  await commands.run("write_text_file", {
    path: join(directory, "created.txt"),
    content: "created",
  });
  expect(readFileSync(join(directory, "created.txt"), "utf8")).toBe("created");
});

it.skipIf(process.platform === "win32")(
  "preserves file permissions during an editor save",
  async () => {
    const { directory, commands } = setup();
    const path = join(directory, "script.sh");
    writeFileSync(path, "before", { mode: 0o755 });
    await commands.run("write_text_file", {
      path,
      content: "after",
      expectedContent: "before",
    });
    expect(statSync(path).mode & 0o777).toBe(0o755);
  },
);

it.skipIf(process.platform === "win32")(
  "rejects a write through a symlink outside a registered project",
  async () => {
    const { directory, commands } = setup();
    const outsideDir = mkdtempSync(join(tmpdir(), "voktty-workspace-outside-"));
    const outside = join(outsideDir, "private.txt");
    writeFileSync(outside, "private");
    cleanups.push(() => rmSync(outsideDir, { recursive: true, force: true }));
    const path = join(directory, "link.txt");
    symlinkSync(outside, path);
    await expect(
      commands.run("write_text_file", { path, content: "overwrite" }),
    ).rejects.toThrow("outside");
    expect(readFileSync(outside, "utf8")).toBe("private");
  },
);
